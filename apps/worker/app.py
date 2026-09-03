# SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
# SPDX-License-Identifier: GPL-3.0-or-later
"""Worker service — heavy lifting off the Soulseek event loop.

Own implementation throughout (scraper *pattern* only guided by smoked-salmon).
Endpoints: GET /health, POST /scrape, POST /spectrum/request,
GET /spectrum/{stem}/full|zoom, GET /spectrum/{stem},
POST /tag, POST /verify, POST /analyze.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import subprocess
import time
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from sources.apple_music import AppleMusicScraper
from sources.bandcamp import BandcampScraper
from sources.base import IdentData, ScrapeError
from sources.beatport import BeatportScraper
from sources.deezer import DeezerScraper
from sources.discogs import DiscogsScraper
from sources.musicbrainz import MusicBrainzScraper
from sources.qobuz import QobuzScraper
from sources.tidal import TidalScraper
import spectrals

VERSION = os.environ.get("APP_VERSION", "0.1.0")
STARTED = time.monotonic()
MAX_JSON = 1_000_000

SCRAPERS = [
    DiscogsScraper(), BandcampScraper(), AppleMusicScraper(), QobuzScraper(),
    TidalScraper(), MusicBrainzScraper(), DeezerScraper(), BeatportScraper(),
]

app = FastAPI(title="nicotine-hub worker", version=VERSION)


@app.middleware("http")
async def cap_body(request: Request, call_next):
    try:
        if int(request.headers.get("content-length", "0")) > MAX_JSON:
            return JSONResponse({"detail": "body too large"}, status_code=413)
    except ValueError:
        pass
    return await call_next(request)


def worker_token() -> str:
    return os.environ.get("WORKER_TOKEN", "")


async def require_auth(request: Request):
    token = worker_token()
    if not token:
        return
    got = ""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        got = auth[7:].strip()
    elif request.query_params.get("token"):
        got = request.query_params["token"]
    if not got or not hmac.compare_digest(got, token):
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="bad token")


@app.get("/health")
async def health():
    return {
        "ok": True,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptime": round(time.monotonic() - STARTED, 1),
        "version": VERSION,
        "sources": sorted(s.source for s in SCRAPERS),
        "queueDepth": len(spectrals._in_flight),
    }


class ScrapeIn(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


def _confidence(source: str) -> float:
    return 1.0 if source in ("discogs", "musicbrainz", "deezer", "apple") else 0.8


@app.post("/scrape", dependencies=[Depends(require_auth)])
async def scrape(body: ScrapeIn):
    url = body.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        return JSONResponse({"detail": "only http(s) URLs can be scraped"}, status_code=400)
    for scraper in SCRAPERS:
        if scraper.match(url):
            try:
                found: IdentData = await scraper.scrape(url)
            except ScrapeError as e:
                return JSONResponse({"detail": str(e)[:300]}, status_code=422)
            query = f"{found.artist} - {found.album}".strip(" -")
            return {
                "artist": found.artist, "album": found.album, "year": found.year,
                "track_count": found.track_count, "query": query,
                "source": found.source, "confidence": _confidence(found.source), "url": url,
            }
    return JSONResponse({"detail": "no scraper handles this URL"}, status_code=422)


class SpectrumIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=512)
    size: int = Field(default=0, ge=0, le=10**13)
    token: int | None = None


def _label(body: SpectrumIn) -> str:
    if body.token is not None:
        return str(body.token)
    return "f" + hashlib.sha1(body.fileName.encode()).hexdigest()[:8]


@app.post("/spectrum/request", dependencies=[Depends(require_auth)])
async def spectrum_request(body: SpectrumIn):
    if not spectrals.is_audio_file(body.fileName):
        return JSONResponse({"detail": "not an audio file"}, status_code=422)
    path = spectrals.resolve_audio(body.fileName)
    if path is None:
        return JSONResponse({"detail": "file not found in DATA_DIR"}, status_code=404)
    try:
        st = path.stat()
    except OSError:
        return JSONResponse({"detail": "file not readable"}, status_code=404)
    duration = _probe_duration(path)
    try:
        res = await spectrals.ensure_spectrum(path, _label(body), st.st_mtime * 1000, st.st_size, duration)
    except Exception as e:
        return JSONResponse({"detail": str(e)[:300]}, status_code=500)
    stem = f"{_label(body)}-{res['hash']}"
    return {
        "etag": res["etag"], "hash": res["hash"],
        "urls": {"full": f"/spectrum/{stem}/full", "zoom": f"/spectrum/{stem}/zoom"},
        "fromCache": res["fromCache"],
    }


@app.get("/spectrum/{stem}")
async def spectrum_info(stem: str, _auth=Depends(require_auth)):
    found = _stem_lookup(stem)
    if not found:
        return JSONResponse({"detail": "no spectrum"}, status_code=404)
    return {"etag": found["etag"], "urls": {"full": f"/spectrum/{stem}/full", "zoom": f"/spectrum/{stem}/zoom"}}


@app.get("/spectrum/{stem}/{variant}")
async def spectrum_png(
    stem: str, variant: str, request: Request, _auth=Depends(require_auth),
):
    if variant not in ("full", "zoom"):
        return JSONResponse({"detail": "not found"}, status_code=404)
    found = _stem_lookup(stem)
    if not found:
        return JSONResponse({"detail": "not found"}, status_code=404)
    path = found["full"] if variant == "full" else found["zoom"]
    if request.headers.get("if-none-match") == found["etag"]:
        return JSONResponse(None, status_code=304, headers={"ETag": found["etag"]})
    return FileResponse(
        path, media_type="image/png",
        headers={"ETag": found["etag"], "Cache-Control": "private, max-age=3600"},
    )


def _stem_lookup(stem: str) -> dict | None:
    if not stem or len(stem) > 64 or not all(c.isalnum() or c in "-_" for c in stem):
        return None
    d = spectrals.spectrum_dir()
    full = d / f"{stem}-Full.png"
    # stem is "{label}-{hash}"; zoom sibling shares the stem
    zoom = d / f"{stem}-Zoom.png"
    try:
        if full.is_file() and zoom.is_file():
            digest = stem.rsplit("-", 1)[-1]
            return {"full": full, "zoom": zoom, "etag": f'"{digest}"', "hash": digest}
    except OSError:
        return None
    return None


def _resolve_or_404(file_name: str) -> Path | JSONResponse:
    path = spectrals.resolve_audio(file_name)
    if path is None:
        return JSONResponse({"detail": "file not found in DATA_DIR"}, status_code=404)
    return path


def _probe_duration(path: Path) -> float | None:
    try:
        from mutagen import File as _mut_file

        audio = _mut_file(path)
        if audio and audio.info and getattr(audio.info, "length", None):
            return float(audio.info.length)
    except Exception:
        pass
    return None


class FileIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=512)


@app.post("/tag", dependencies=[Depends(require_auth)])
async def tag(body: FileIn):
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    tags: dict[str, str] = {}
    cover = False
    try:
        from mutagen import File as _mut_file

        audio = _mut_file(path)
        if audio is None:
            return JSONResponse({"detail": "unrecognized audio"}, status_code=422)
        raw = dict(getattr(audio, "tags", None) or {})
        # ponytail: flatten first value per key, keep it small
        for key in ("artist", "album", "title", "date", "year", "genre", "albumartist", "tracknumber",
                    "musicbrainz_albumid", "TIT2", "TPE1", "TALB", "TYER", "TCON"):
            if key in raw:
                val = raw[key]
                vals = val if isinstance(val, list) else [val]
                tags[key] = str(vals[0])[:300] if vals else ""
        pictures = getattr(audio, "pictures", None) or raw.get("APIC") or raw.get("covr")
        cover = bool(pictures)
    except Exception as e:
        return JSONResponse({"detail": f"tag read failed: {e}"[:200]}, status_code=422)
    return {"tags": tags, "coverArtApplied": cover, "tracklist": None}


@app.post("/verify", dependencies=[Depends(require_auth)])
async def verify(body: FileIn):
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    out = {"flacOk": None, "upconvert": None, "mqa": None,
           "logScore": None, "logChecksum": None, "durationMismatch": None}
    try:
        from mutagen import File as _mut_file

        audio = _mut_file(path)
        if audio is None:
            out["flacOk"] = False
            return out
        ext = path.suffix.lstrip(".").lower()
        if ext == "flac":
            out["flacOk"] = audio.info is not None
        raw = dict(getattr(audio, "tags", None) or {})
        blob = " ".join(str(v) for v in raw.values())[:2000].lower()
        if "mqa" in blob or "mqaencoder" in str(raw.keys()).lower():
            out["mqa"] = True
    except Exception:
        out["flacOk"] = False
    return out


@app.post("/analyze", dependencies=[Depends(require_auth)])
async def analyze(body: FileIn):
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    out: dict = {"bitrate": None, "vbr": None, "sampleRate": None, "bitDepth": None,
                 "cutoffHz": None, "likelyTranscode": None, "confidence": 0.0}
    try:
        from mutagen import File as _mut_file

        audio = _mut_file(path)
        if audio is None or audio.info is None:
            return JSONResponse({"detail": "unrecognized audio"}, status_code=422)
        info = audio.info
        out["sampleRate"] = getattr(info, "sample_rate", None)
        out["bitDepth"] = getattr(info, "bits_per_sample", None)
        br = getattr(info, "bitrate", None)
        if br:
            out["bitrate"] = round(br / 1000)
        mode = getattr(info, "bitrate_mode", None)
        out["vbr"] = str(mode) if mode else None
        out["confidence"] = 0.5
    except Exception as e:
        return JSONResponse({"detail": f"analyze failed: {e}"[:200]}, status_code=422)
    cutoff = _cutoff_hz(path)
    if cutoff:
        out["cutoffHz"] = cutoff
        # ponytail: 16kHz knee heuristic — CD audio reaches ~20-22k
        out["likelyTranscode"] = cutoff < 17000
        out["confidence"] = 0.85
    return out


def _cutoff_hz(path: Path) -> int | None:
    """Spectral knee via ffmpeg snippet + numpy. None when deps/binaries missing."""
    try:
        import numpy as np  # noqa
    except ImportError:
        return None
    if not spectrals.is_audio_file(path.name):
        return None
    import shutil
    import tempfile
    import wave

    if not shutil.which("ffmpeg"):
        return None
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
            tmp = fh.name
        r = subprocess.run(
            ["ffmpeg", "-y", "-t", "30", "-i", str(path), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", tmp],
            capture_output=True, timeout=30,
        )
        if r.returncode != 0:
            return None
        import numpy as np

        with wave.open(tmp, "rb") as w:
            n = w.getnframes()
            raw = w.readframes(min(n, 44100 * 30))
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float64)
        if samples.size < 44100:
            return None
        window = samples[: 44100 * 10]
        spec = np.abs(np.fft.rfft(window * np.hanning(window.size)))
        freqs = np.fft.rfftfreq(window.size, 1 / 44100)
        peak = spec.max()
        if peak <= 0:
            return None
        thresh = peak * 0.01  # -40dB
        band = (freqs >= 16000) & (freqs <= 22000)
        above = freqs[band][spec[band] > thresh]
        if above.size == 0:
            return 16000
        return int(above.max())
    except Exception:
        return None
    finally:
        try:
            if tmp:
                os.unlink(tmp)
        except OSError:
            pass
