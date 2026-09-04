# SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
# SPDX-License-Identifier: GPL-3.0-or-later
"""Worker service — heavy lifting off the Soulseek event loop.

Own implementation throughout (scraper *pattern* only guided by smoked-salmon).
Endpoints: GET /health, POST /scrape, POST /spectrum/request,
GET /spectrum/{stem}/full|zoom, GET /spectrum/{stem},
POST /tag, POST /tag/write, POST /tag/scrape, POST /tag/bulk,
POST /verify, POST /analyze, POST /analyze/bulk.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import subprocess
import time
import urllib.parse
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
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
import tokens

VERSION = os.environ.get("APP_VERSION", "0.1.0")
STARTED = time.monotonic()
MAX_JSON = 1_000_000

SCRAPERS = [
    DiscogsScraper(), BandcampScraper(), AppleMusicScraper(), QobuzScraper(),
    TidalScraper(), MusicBrainzScraper(), DeezerScraper(), BeatportScraper(),
]

app = FastAPI(title="nicotine-hub worker", version=VERSION)

# Browser calls the worker directly (web origin != worker origin).
# Mirrors the bridge: open by default, restricted when ALLOWED_ORIGINS is set.
_cors_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins or ["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "If-None-Match"],
    expose_headers=["ETag"],
    max_age=600,
)


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
        "auth": tokens.configured(),  # booleans only, never values
    }


class ScrapeIn(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


def _confidence(source: str) -> float:
    return 1.0 if source in ("discogs", "musicbrainz", "deezer", "apple", "qobuz", "tidal") else 0.8


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


def _resolve_any(file_name: str) -> Path | None:
    """Resolve fileName which may be basename, relative path, or absolute /data path.

    Security: all resolved paths must be inside DATA_DIR.
    Supports:
    - "/data/Music/artist/file.flac" (absolute from FileExplorer /api/files)
    - "downloads/file.flac" or "Music/file.mp3" (relative to DATA_DIR)
    - "file.flac" (basename search via spectrals.resolve_audio)
    - "Music\\Artist\\file.mp3" (virtual path — fallback to basename)
    """
    raw = file_name.strip().replace("\\", "/")
    if not raw or raw in (".", ".."):
        return None
    root = spectrals.data_dir().resolve()
    # 1. Absolute path containment check
    if raw.startswith("/"):
        try:
            cand = Path(raw).resolve()
            if cand.is_file() and cand.is_relative_to(root):
                return cand
            # Also try resolving without resolve symlink for existence
            cand2 = (root / raw.lstrip("/")).resolve()
            if cand2.is_file() and cand2.is_relative_to(root):
                return cand2
        except OSError:
            pass
    # 2. Relative path under DATA_DIR (e.g. "downloads/file.flac" or "Music/file.mp3")
    if "/" in raw:
        try:
            cand = (root / raw.lstrip("/")).resolve()
            if cand.is_file() and cand.is_relative_to(root):
                return cand
            # also try nested basename direct join
            cand2 = (root / "downloads" / Path(raw).name).resolve()
            if cand2.is_file() and cand2.is_relative_to(root):
                return cand2
        except OSError:
            pass
        # 3. Virtual path fallback: basename search
        base = Path(raw).name
        hit = spectrals.resolve_audio(base)
        if hit:
            return hit
    # 4. Basename search (downloads + shallow scan)
    hit = spectrals.resolve_audio(raw)
    if hit:
        return hit
    # 5. Direct DATA_DIR search for file explorer shared files (depth 2)
    try:
        base = Path(raw).name
        for top in (root, root / "downloads", root / "uploads", root / "shared"):
            found = spectrals._scan(top, base, root, depth=3)  # type: ignore
            if found:
                return found
    except Exception:
        pass
    return None


def _resolve_or_404(file_name: str) -> Path | JSONResponse:
    path = _resolve_any(file_name)
    if path is None:
        # fallback to old resolver for compat
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


def _read_tags_and_info(path: Path) -> tuple[dict[str, str], dict, bool]:
    """TinyTag-parity read via mutagen: tags + technical info + cover flag."""
    from mutagen import File as _mut_file

    audio = _mut_file(path)
    if audio is None:
        raise ValueError("unrecognized audio")
    tags: dict[str, str] = {}
    info: dict = {}
    # technical info
    try:
        inf = getattr(audio, "info", None)
        if inf:
            info["duration"] = round(float(getattr(inf, "length", 0) or 0), 2) or None
            br = getattr(inf, "bitrate", None)
            if br:
                info["bitrate"] = int(round(br / 1000))
            info["sampleRate"] = getattr(inf, "sample_rate", None) or getattr(inf, "samplerate", None)
            info["bitDepth"] = getattr(inf, "bits_per_sample", None) or getattr(inf, "bitdepth", None)
            info["channels"] = getattr(inf, "channels", None)
            br_mode = getattr(inf, "bitrate_mode", None)
            if br_mode is not None:
                info["vbr"] = str(br_mode)
                info["isVbr"] = str(br_mode).lower() in ("vbr", "true", "1")
            # flac/wav lossless hint
            ext = path.suffix.lstrip(".").lower()
            info["format"] = ext
            info["fileSize"] = path.stat().st_size if path.exists() else None
            # isLossless heuristic
            if ext in ("flac", "wav", "aiff", "aif", "wv") and info.get("bitDepth"):
                info["isLossless"] = True
            elif ext == "flac":
                info["isLossless"] = True
    except Exception:
        pass
    # tags via easy first, then raw fallback for musicbrainz etc
    try:
        audio_easy = _mut_file(path, easy=True)
        if audio_easy and getattr(audio_easy, "tags", None):
            for k, v in audio_easy.items():
                vals = v if isinstance(v, list) else [v]
                if vals:
                    tags[k] = str(vals[0])[:500]
        # also collect raw for keys not in easy
        raw = dict(getattr(audio, "tags", None) or {})
        for key in ("musicbrainz_albumid", "musicbrainz_artistid", "musicbrainz_trackid",
                    "TIT2", "TPE1", "TALB", "TYER", "TCON", "TPE2", "TCOM", "TPOS", "TRCK",
                    "APIC", "covr", "©nam", "©ART", "©alb"):
            if key in raw and key not in tags:
                val = raw[key]
                vals = val if isinstance(val, list) else [val]
                # for APIC/covr it's binary, skip
                if key in ("APIC", "covr"):
                    continue
                try:
                    tags[key] = str(vals[0])[:500] if vals else ""
                except Exception:
                    continue
        # map Track/disc total parsing
        if "tracknumber" in tags and "/" in tags["tracknumber"]:
            parts = tags["tracknumber"].split("/")
            tags["track"] = parts[0].strip()
            tags["track_total"] = parts[1].strip() if len(parts) > 1 else ""
        if "discnumber" in tags and "/" in tags["discnumber"]:
            parts = tags["discnumber"].split("/")
            tags["disc"] = parts[0].strip()
            tags["disc_total"] = parts[1].strip() if len(parts) > 1 else ""
    except Exception:
        pass
    # cover art detection
    cover = False
    try:
        raw = dict(getattr(audio, "tags", None) or {})
        pictures = getattr(audio, "pictures", None) or raw.get("APIC") or raw.get("covr")
        if pictures:
            cover = bool(pictures)
        else:
            # mp4 covr is under raw
            if hasattr(audio, "tags") and audio.tags:
                for k in audio.tags.keys():
                    if "covr" in str(k).lower() or "apic" in str(k).lower():
                        cover = True
                        break
    except Exception:
        pass
    return tags, info, cover


class FileIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=1024)


@app.post("/tag", dependencies=[Depends(require_auth)])
async def tag(body: FileIn):
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    try:
        tags, info, cover = _read_tags_and_info(path)
    except Exception as e:
        return JSONResponse({"detail": f"tag read failed: {e}"[:300]}, status_code=422)
    # nicotine-plus parity: surface common fields + audio props
    return {"tags": tags, "info": info, "coverArtApplied": cover, "tracklist": None, "fileName": path.name, "path": str(path)}


class TagWriteIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=1024)
    tags: dict[str, str | None] = Field(default_factory=dict)
    removeTags: list[str] = Field(default_factory=list)


@app.post("/tag/write", dependencies=[Depends(require_auth)])
async def tag_write(body: TagWriteIn):
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    # whitelist tag keys to prevent injection; mutagen easy keys + common
    allowed = {
        "artist", "album", "title", "albumartist", "composer", "genre", "date", "year",
        "tracknumber", "track", "track_total", "discnumber", "disc", "disc_total",
        "comment", "description", "organization", "copyright", "encodedby",
        "musicbrainz_albumid", "musicbrainz_artistid", "musicbrainz_trackid",
        "TIT2", "TPE1", "TALB", "TPE2", "TCOM", "TCON", "TYER", "TRCK", "TPOS",
    }
    # normalize tags: filter, trim
    clean: dict[str, str] = {}
    for k, v in (body.tags or {}).items():
        kk = k.strip()
        if kk not in allowed:
            # also allow lowercase variants
            ll = kk.lower()
            if ll not in allowed and ll not in {a.lower() for a in allowed}:
                continue
            kk = ll if ll in allowed else kk
        if v is None:
            continue
        sv = str(v).strip()[:500]
        if not sv and kk not in body.removeTags:
            continue
        # map year -> date for mutagen easy compatibility
        if kk == "year" and "date" not in clean:
            clean["date"] = sv
        elif kk == "track" and "tracknumber" not in clean:
            # handle track + track_total combine
            total = body.tags.get("track_total") or ""
            clean["tracknumber"] = f"{sv}/{total}" if total else sv
        elif kk == "disc" and "discnumber" not in clean:
            total = body.tags.get("disc_total") or ""
            clean["discnumber"] = f"{sv}/{total}" if total else sv
        else:
            clean[kk] = sv
    # handle explicit track_total/disc_total when track/disc not in clean
    if "track_total" in body.tags and "track" not in body.tags and "tracknumber" not in clean:
        existing = clean.get("tracknumber") or ""
        if existing and "/" not in existing:
            clean["tracknumber"] = f"{existing}/{body.tags['track_total']}"
    if "disc_total" in body.tags and "disc" not in body.tags and "discnumber" not in clean:
        existing = clean.get("discnumber") or ""
        if existing and "/" not in existing:
            clean["discnumber"] = f"{existing}/{body.tags['disc_total']}"

    try:
        from mutagen import File as _mut_file

        # Try easy mode first
        audio = _mut_file(path, easy=True)
        created = False
        if audio is None:
            audio = _mut_file(path)
            if audio is None:
                return JSONResponse({"detail": "unrecognized audio"}, status_code=422)
        if getattr(audio, "tags", None) is None:
            try:
                audio.add_tags()
                created = True
            except Exception:
                pass
        # For easy mode, need to ensure tags is dict-like
        # Some formats (WAV) have no easy tags, fallback to raw
        use_easy = hasattr(audio, "tags") and audio.tags is not None
        # Write via easy if possible, else raw
        if use_easy:
            for k, v in clean.items():
                # mutagen easy expects key lower
                lk = k.lower() if k.lower() in {"artist","album","title","albumartist","composer","genre","date","tracknumber","discnumber","comment"} else k
                try:
                    audio[lk] = v
                except Exception:
                    # fallback: try raw dict
                    try:
                        if getattr(audio, "tags", None) is not None:
                            audio.tags[lk] = v  # type: ignore
                    except Exception:
                        continue
            for rk in body.removeTags:
                rk = rk.strip()
                if not rk:
                    continue
                try:
                    if rk in audio:
                        del audio[rk]
                    elif rk.lower() in audio:
                        del audio[rk.lower()]
                except Exception:
                    pass
            audio.save()
        else:
            # raw fallback (rare)
            return JSONResponse({"detail": "tag write not supported for this format"}, status_code=422)
    except Exception as e:
        return JSONResponse({"detail": f"tag write failed: {e}"[:300]}, status_code=500)
    # return updated tags
    try:
        new_tags, new_info, cover = _read_tags_and_info(path)
        return {"ok": True, "tags": new_tags, "info": new_info, "coverArtApplied": cover}
    except Exception:
        return {"ok": True}


class TagScrapeIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=1024)
    url: str = Field(min_length=8, max_length=2048)
    apply: bool = Field(default=False)


@app.post("/tag/scrape", dependencies=[Depends(require_auth)])
async def tag_scrape(body: TagScrapeIn):
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    url = body.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        return JSONResponse({"detail": "only http(s) URLs can be scraped"}, status_code=400)
    # scrape
    found = None
    for scraper in SCRAPERS:
        if scraper.match(url):
            try:
                found = await scraper.scrape(url)
            except ScrapeError as e:
                return JSONResponse({"detail": str(e)[:300]}, status_code=422)
            break
    if not found:
        return JSONResponse({"detail": "no scraper handles this URL"}, status_code=422)
    suggested: dict[str, str] = {}
    if found.artist:
        suggested["artist"] = found.artist
        suggested["albumartist"] = found.artist
    if found.album:
        suggested["album"] = found.album
    if found.year:
        suggested["date"] = str(found.year)
        suggested["year"] = str(found.year)
    if found.track_count:
        suggested["track_total"] = str(found.track_count)
    # include source info
    suggested["_source"] = found.source
    suggested["_query"] = f"{found.artist} - {found.album}".strip(" -")
    if body.apply:
        # apply to file via same logic as tag_write (reuse)
        try:
            from mutagen import File as _mut_file
            audio = _mut_file(path, easy=True)
            if audio is None:
                audio = _mut_file(path)
            if audio is None:
                return JSONResponse({"detail": "unrecognized audio"}, status_code=422)
            if getattr(audio, "tags", None) is None:
                try:
                    audio.add_tags()
                except Exception:
                    pass
            # only apply known tag keys
            apply_map = {k: v for k, v in suggested.items() if not k.startswith("_")}
            for k, v in apply_map.items():
                try:
                    audio[k] = v
                except Exception:
                    continue
            audio.save()
        except Exception as e:
            return JSONResponse({"detail": f"scrape apply failed: {e}"[:300]}, status_code=500)
        # re-read
        try:
            new_tags, new_info, cover = _read_tags_and_info(path)
            return {"artist": found.artist, "album": found.album, "year": found.year, "track_count": found.track_count, "query": suggested["_query"], "source": found.source, "confidence": _confidence(found.source), "url": url, "suggested": suggested, "applied": True, "tags": new_tags, "info": new_info}
        except Exception:
            pass
    return {"artist": found.artist, "album": found.album, "year": found.year, "track_count": found.track_count, "query": suggested["_query"], "source": found.source, "confidence": _confidence(found.source), "url": url, "suggested": suggested, "applied": False}


class BulkTagIn(BaseModel):
    files: list[str] = Field(min_length=1, max_length=50)


@app.post("/tag/bulk", dependencies=[Depends(require_auth)])
async def tag_bulk(body: BulkTagIn):
    out: list[dict] = []
    for fname in body.files[:50]:
        if len(fname) > 1024:
            out.append({"fileName": fname, "error": "name too long"})
            continue
        path = _resolve_any(fname)
        if path is None:
            out.append({"fileName": fname, "error": "not found"})
            continue
        try:
            tags, info, cover = _read_tags_and_info(path)
            out.append({"fileName": fname, "path": str(path), "tags": tags, "info": info, "coverArtApplied": cover})
        except Exception as e:
            out.append({"fileName": fname, "error": str(e)[:200]})
    return {"results": out}


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


class BulkVerifyIn(BaseModel):
    files: list[str] = Field(min_length=1, max_length=50)


@app.post("/verify/bulk", dependencies=[Depends(require_auth)])
async def verify_bulk(body: BulkVerifyIn):
    out: list[dict] = []
    for fname in body.files[:50]:
        if len(fname) > 1024:
            out.append({"fileName": fname, "error": "name too long"})
            continue
        path = _resolve_any(fname)
        if path is None:
            out.append({"fileName": fname, "error": "not found"})
            continue
        try:
            from mutagen import File as _mut_file
            audio = _mut_file(path)
            if audio is None:
                out.append({"fileName": fname, "flacOk": False})
                continue
            ext = path.suffix.lstrip(".").lower()
            entry: dict = {"fileName": fname, "path": str(path), "flacOk": None, "mqa": None}
            if ext == "flac":
                entry["flacOk"] = audio.info is not None
            raw = dict(getattr(audio, "tags", None) or {})
            blob = " ".join(str(v) for v in raw.values())[:2000].lower()
            if "mqa" in blob or "mqaencoder" in str(raw.keys()).lower():
                entry["mqa"] = True
            out.append(entry)
        except Exception as e:
            out.append({"fileName": fname, "error": str(e)[:200]})
    return {"results": out}


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


class BulkAnalyzeIn(BaseModel):
    files: list[str] = Field(min_length=1, max_length=50)


@app.post("/analyze/bulk", dependencies=[Depends(require_auth)])
async def analyze_bulk(body: BulkAnalyzeIn):
    out: list[dict] = []
    for fname in body.files[:50]:
        if len(fname) > 1024:
            out.append({"fileName": fname, "error": "name too long"})
            continue
        path = _resolve_any(fname)
        if path is None:
            out.append({"fileName": fname, "error": "not found"})
            continue
        try:
            from mutagen import File as _mut_file
            audio = _mut_file(path)
            if audio is None or audio.info is None:
                out.append({"fileName": fname, "error": "unrecognized"})
                continue
            info = audio.info
            entry: dict = {
                "fileName": fname,
                "path": str(path),
                "bitrate": round(info.bitrate / 1000) if getattr(info, "bitrate", None) else None,
                "sampleRate": getattr(info, "sample_rate", None) or getattr(info, "samplerate", None),
                "bitDepth": getattr(info, "bits_per_sample", None),
                "channels": getattr(info, "channels", None),
                "duration": round(float(getattr(info, "length", 0) or 0), 2) or None,
                "vbr": str(getattr(info, "bitrate_mode", None)) if getattr(info, "bitrate_mode", None) else None,
            }
            # add attrs for share response convenience
            attrs: list[list[int]] = []
            if entry["bitrate"]:
                attrs.append([0, int(entry["bitrate"])])
            if entry["duration"]:
                attrs.append([1, int(entry["duration"])])
            if entry["vbr"]:
                # VBR flag 2 per soulseek attrs
                attrs.append([2, 1 if str(entry["vbr"]).lower() in ("vbr", "true") else 0])
            if entry["sampleRate"]:
                attrs.append([4, int(entry["sampleRate"])])
            if entry["bitDepth"]:
                attrs.append([5, int(entry["bitDepth"])])
            entry["attrs"] = attrs
            out.append(entry)
        except Exception as e:
            out.append({"fileName": fname, "error": str(e)[:200]})
    return {"results": out}


class ScanIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=512)
    size: int = Field(default=0, ge=0, le=10**13)
    username: str = Field(default="", max_length=256)
    virtualPath: str = Field(default="", max_length=1024)
    transferId: str = Field(default="", max_length=1024)
    downloadUrl: str = Field(default="", max_length=1024)
    destinationPath: str = Field(default="", max_length=1024)


def _valid_scan_url(url: str) -> bool:
    if not url or len(url) > 2048:
        return False
    if not url.lower().startswith(("http://", "https://")):
        return False
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.netloc:
            return False
        if parsed.username or parsed.password:
            return False
        # no creds, netloc present, scheme ok
        return True
    except Exception:
        return False


@app.post("/scan", dependencies=[Depends(require_auth)])
async def scan(body: ScanIn):
    target = tokens.get("MEDIA_SCAN_URL").strip()
    if not target:
        return JSONResponse({"detail": "media scan not configured — set MEDIA_SCAN_URL in Worker settings"}, status_code=422)
    if not _valid_scan_url(target):
        return JSONResponse({"detail": "configured MEDIA_SCAN_URL invalid"}, status_code=422)
    token = tokens.get("MEDIA_SCAN_TOKEN").strip()
    payload = {
        "event": "download.finished",
        "eventType": "Download",
        "fileName": body.fileName,
        "size": body.size,
        "username": body.username,
        "virtualPath": body.virtualPath,
        "destinationPath": body.destinationPath,
        "transferId": body.transferId,
        "downloadUrl": body.downloadUrl,
        "source": "nicotine-hub-bridge",
    }
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # fire-and-forget with 5s timeout, never relay body
    try:
        import aiohttp
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as sess:
            async with sess.post(target, json=payload, headers=headers, allow_redirects=False) as resp:
                # consume but don't log body
                await resp.text()
                return {"ok": True, "forwarded": True, "status": resp.status}
    except Exception as e:
        return JSONResponse({"detail": f"scan forward failed: {e}"[:300]}, status_code=502)


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
