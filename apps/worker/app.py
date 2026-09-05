# SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
# SPDX-License-Identifier: GPL-3.0-or-later
"""Worker service — heavy lifting off the Soulseek event loop.

Own implementation throughout (scraper *pattern* only guided by smoked-salmon).
Endpoints: GET /health, POST /scrape, POST /spectrum/request,
GET /spectrum/{stem}/full|zoom, GET /spectrum/{stem},
POST /tag, POST /tag/write, POST /tag/scrape, POST /tag/bulk,
POST /verify, POST /analyze, POST /analyze/bulk, POST /mediainfo, POST /rename.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import subprocess
import time
import urllib.parse
import uuid
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
    # Optional auto-rename on apply: template like "{track}. {artist} - {title}"
    # Tokens: {track} zero-padded 2-digit, {artist}, {title}. Must contain >=1 token.
    renameTemplate: str | None = Field(default=None, max_length=256)
    renameEnabled: bool = Field(default=False)


def _sanitize_filename(name: str) -> str | None:
    """Filesystem-safe basename (no dirs). None if invalid."""
    raw = name.strip()
    if not raw or raw in (".", ".."):
        return None
    # reject path separators and control/unsafe chars
    if "/" in raw or "\\" in raw or "\x00" in raw:
        return None
    if any(ord(c) < 32 for c in raw):
        return None
    if len(raw) > 255:
        raw = raw[:255]
    # Windows trailing dots/spaces break peers + Soulseek
    raw = raw.strip().rstrip(" .")
    if not raw or raw in (".", ".."):
        return None
    return raw


def _unique_dest(dir_path: Path, desired: str) -> Path:
    """Auto-suffix (2),(3)... before ext if desired exists, like transfers."""
    cand = dir_path / desired
    if not cand.exists():
        return cand
    stem = Path(desired).stem
    suffix = Path(desired).suffix
    n = 2
    while n < 1000:
        alt = f"{stem} ({n}){suffix}"
        cand2 = dir_path / alt
        if not cand2.exists():
            return cand2
        n += 1
    return cand


_RENAME_TEMPLATE_TOKENS = {"track", "artist", "title"}
_RENAME_TOKEN_RE = None  # lazy


def _render_rename_template(template: str, track: str | None, artist: str | None, title: str | None) -> str | None:
    """Render template or None if missing required tags / invalid."""
    import re
    global _RENAME_TOKEN_RE
    if _RENAME_TOKEN_RE is None:
        _RENAME_TOKEN_RE = re.compile(r"\{(\w+)\}")
    found = set(_RENAME_TOKEN_RE.findall(template))
    if not found:
        return None
    if not found.issubset(_RENAME_TEMPLATE_TOKENS):
        return None
    # need at least one present
    if found & _RENAME_TEMPLATE_TOKENS == set():
        return None
    # track zero-pad
    track_out = ""
    if track:
        m = re.match(r"^\s*(\d+)", track)
        if m:
            try:
                track_out = f"{int(m.group(1)):02d}"
            except ValueError:
                track_out = track.strip()
        else:
            track_out = track.strip()
    vals = {
        "track": track_out,
        "artist": (artist or "").strip().replace("/", "-").replace("\\", "-"),
        "title": (title or "").strip().replace("/", "-").replace("\\", "-"),
    }
    # missing required tag → skip rename
    for tok in found:
        if not vals.get(tok):
            return None
    out = template
    for k, v in vals.items():
        out = out.replace("{" + k + "}", v)
    # reject if still has unmatched brace token left
    if "{" in out or "}" in out:
        return None
    return out.strip() or None


def _do_rename(src: Path, desired_basename: str) -> Path | str:
    """Rename src to dir/desired_basename (unique). Returns new Path or error string."""
    sanitized = _sanitize_filename(desired_basename)
    if not sanitized:
        return "invalid filename"
    # keep extension from desired, but ensure not empty
    dest = _unique_dest(src.parent, sanitized)
    try:
        # refuse to rename directories (files only)
        if src.is_dir():
            return "directories cannot be renamed"
        src.rename(dest)
        return dest
    except FileExistsError:
        return "destination already exists"
    except OSError as e:
        return str(e)[:200]


class RenameIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=1024)
    newName: str = Field(min_length=1, max_length=255)


@app.post("/rename", dependencies=[Depends(require_auth)])
async def rename_file(body: RenameIn):
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    if path.is_dir():
        return JSONResponse({"detail": "directories cannot be renamed"}, status_code=422)
    sanitized = _sanitize_filename(body.newName)
    if not sanitized:
        return JSONResponse({"detail": "invalid filename — no path separators, control chars, or blank names"}, status_code=422)
    # refuse if caller tried to sneak an extension change that empties name; still allow
    dest = _unique_dest(path.parent, sanitized)
    # if requested name existed and we suffixed, dest != sanitized; that's the auto-suffix path
    try:
        path.rename(dest)
    except FileExistsError:
        return JSONResponse({"detail": "destination already exists"}, status_code=409)
    except OSError as e:
        return JSONResponse({"detail": str(e)[:300]}, status_code=500)
    return {"ok": True, "newPath": str(dest), "fileName": dest.name, "suffixed": dest.name != sanitized}


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
            # optional rename on apply
            rename_result = None
            if body.renameEnabled and body.renameTemplate:
                tmpl = body.renameTemplate.strip()
                if tmpl:
                    import re as _re2
                    found_tokens = set((_RENAME_TOKEN_RE or _re2.compile(r"\{(\w+)\}")).findall(tmpl))
                    if found_tokens and not found_tokens.issubset(_RENAME_TEMPLATE_TOKENS):
                        return JSONResponse({"detail": f"unknown template token — allowed: {sorted(_RENAME_TEMPLATE_TOKENS)}"}, status_code=422)
                    if not found_tokens:
                        return JSONResponse({"detail": "rename template must contain at least one of {track} {artist} {title}"}, status_code=422)
                    # derive track/artist/title from freshly written tags
                    tnum = new_tags.get("tracknumber") or new_tags.get("track") or ""
                    art = new_tags.get("artist") or new_tags.get("albumartist") or found.artist or ""
                    tit = new_tags.get("title") or ""
                    desired_base = _render_rename_template(tmpl, tnum, art, tit)
                    if desired_base is None:
                        # missing required tag → skip, report
                        rename_result = {"skipped": True, "reason": "missing track/artist/title tag for template"}
                    else:
                        # preserve extension from original file
                        ext = path.suffix
                        if not desired_base.lower().endswith(ext.lower()) and ext:
                            desired_base = desired_base + ext
                        sanitized = _sanitize_filename(desired_base)
                        if not sanitized:
                            rename_result = {"skipped": True, "reason": "invalid filename from template"}
                        else:
                            dest = _unique_dest(path.parent, sanitized)
                            try:
                                if path.is_dir():
                                    rename_result = {"skipped": True, "reason": "directories cannot be renamed"}
                                else:
                                    path.rename(dest)
                                    rename_result = {"renamed": True, "newPath": str(dest), "suffixed": dest.name != sanitized}
                                    path = dest
                            except OSError as e:
                                rename_result = {"skipped": True, "reason": str(e)[:200]}
                            # re-read after rename to keep tags consistent (path changed)
                            try:
                                new_tags, new_info, cover = _read_tags_and_info(path)
                            except Exception:
                                pass
            payload: dict = {"artist": found.artist, "album": found.album, "year": found.year, "track_count": found.track_count, "query": suggested["_query"], "source": found.source, "confidence": _confidence(found.source), "url": url, "suggested": suggested, "applied": True, "tags": new_tags, "info": new_info}
            if rename_result is not None:
                payload["rename"] = rename_result
                if rename_result.get("newPath"):
                    payload["newPath"] = rename_result["newPath"]
            return payload
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
        import shutil

        audio = _mut_file(path)
        if audio is None:
            out["flacOk"] = False
            return out
        ext = path.suffix.lstrip(".").lower()
        if ext == "flac":
            if shutil.which("flac"):
                try:
                    r = subprocess.run(["flac", "-t", "--totally-silent", str(path)], capture_output=True, timeout=30)
                    out["flacOk"] = r.returncode == 0
                except Exception:
                    out["flacOk"] = audio.info is not None
            else:
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
            import shutil
            audio = _mut_file(path)
            if audio is None:
                out.append({"fileName": fname, "flacOk": False})
                continue
            ext = path.suffix.lstrip(".").lower()
            entry: dict = {"fileName": fname, "path": str(path), "flacOk": None, "mqa": None}
            if ext == "flac":
                if shutil.which("flac"):
                    try:
                        r = subprocess.run(["flac", "-t", "--totally-silent", str(path)], capture_output=True, timeout=30)
                        entry["flacOk"] = r.returncode == 0
                    except Exception:
                        entry["flacOk"] = audio.info is not None
                else:
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
            # spectral cutoff — opt-in style, best-effort, cached via _cutoff_hz internal file
            try:
                cutoff = _cutoff_hz(path)
                if cutoff:
                    entry["cutoffHz"] = cutoff
                    entry["likelyTranscode"] = cutoff < 17000
            except Exception:
                pass
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


MEDIAINFO_TIMEOUT = 30
MEDIAINFO_CAP = 2_000_000  # raw text cap (chars)


def _mediainfo_track_summary(tracks: list[dict]) -> dict:
    """Summarize mediainfo JSON tracks into a small UI-friendly dict."""
    general = next((t for t in tracks if t.get("@type") == "General"), {})
    videos = [t for t in tracks if t.get("@type") == "Video"]
    audios = [t for t in tracks if t.get("@type") == "Audio"]
    texts = [t for t in tracks if t.get("@type") == "Text"]
    return {
        "format": general.get("Format") or general.get("Format_String") or None,
        "duration": general.get("Duration_String3") or general.get("Duration") or general.get("Duration_String") or None,
        "fileSize": general.get("FileSize_String") or general.get("FileSize") or None,
        "overallBitRate": general.get("OverallBitRate_String") or general.get("OverallBitRate") or None,
        "video": [
            {
                "format": v.get("Format") or v.get("Format_String") or None,
                "codecId": v.get("CodecID") or v.get("Format_Profile") or None,
                "width": v.get("Width"),
                "height": v.get("Height"),
                "frameRate": v.get("FrameRate_String") or v.get("FrameRate") or None,
                "bitRate": v.get("BitRate_String") or v.get("BitRate") or None,
                "duration": v.get("Duration_String3") or v.get("Duration") or None,
            }
            for v in videos
        ] if videos else None,
        "audio": [
            {
                "format": a.get("Format") or a.get("Format_String") or None,
                "codecId": a.get("CodecID") or None,
                "channels": a.get("Channels_String") or a.get("Channels") or None,
                "samplingRate": a.get("SamplingRate_String") or a.get("SamplingRate") or None,
                "bitRate": a.get("BitRate_String") or a.get("BitRate") or None,
                "bitDepth": a.get("BitDepth") or a.get("BitDepth_String") or None,
                "duration": a.get("Duration_String3") or a.get("Duration") or None,
            }
            for a in audios
        ] if audios else None,
        "textCount": len(texts),
    }


@app.post("/mediainfo", dependencies=[Depends(require_auth)])
async def mediainfo(body: FileIn):
    """Run `mediainfo` on a file under DATA_DIR and return parsed JSON + raw text."""
    path = _resolve_or_404(body.fileName)
    if isinstance(path, JSONResponse):
        return path
    # mediainfo CLI is stateless; cap resolved path
    if not path.is_file():
        return JSONResponse({"detail": "not a file"}, status_code=422)
    try:
        st = path.stat()
        if st.st_size > 20 * 1024 * 1024 * 1024:  # 20 GiB guard
            return JSONResponse({"detail": "file too large for mediainfo"}, status_code=413)
    except OSError:
        pass

    def _run(args: list[str]) -> subprocess.CompletedProcess:
        return subprocess.run(args, capture_output=True, timeout=MEDIAINFO_TIMEOUT, text=True)

    try:
        proc_json = await asyncio.to_thread(_run, ["mediainfo", "--Output=JSON", str(path)])
    except FileNotFoundError:
        return JSONResponse({"detail": "mediainfo not installed on worker — rebuild the worker image"}, status_code=501)
    except subprocess.TimeoutExpired:
        return JSONResponse({"detail": "mediainfo timed out"}, status_code=504)
    except Exception as e:
        return JSONResponse({"detail": f"mediainfo failed: {e}"[:300]}, status_code=500)
    if proc_json.returncode != 0 and not proc_json.stdout.strip():
        err = (proc_json.stderr or proc_json.stdout or "mediainfo failed").strip()[:300]
        return JSONResponse({"detail": err}, status_code=422)
    raw_out = proc_json.stdout.strip()
    if not raw_out:
        return JSONResponse({"detail": "mediainfo produced no output"}, status_code=422)
    try:
        import json as _json
        parsed = _json.loads(raw_out)
        tracks = parsed.get("media", {}).get("track", []) if isinstance(parsed, dict) else []
        if not isinstance(tracks, list):
            tracks = []
    except Exception:
        return JSONResponse({"detail": "mediainfo JSON parse failed"}, status_code=422)
    summary = _mediainfo_track_summary(tracks)
    # second run for Inform-style raw text (small, header-only for most files)
    raw_text = ""
    try:
        proc_text = await asyncio.to_thread(_run, ["mediainfo", str(path)])
        raw_text = (proc_text.stdout or "").strip()[:MEDIAINFO_CAP]
    except Exception:
        raw_text = raw_out[:MEDIAINFO_CAP]
    return {
        "fileName": body.fileName,
        "path": str(path),
        "tracks": tracks,
        "summary": summary,
        "raw": raw_text or raw_out[:MEDIAINFO_CAP],
    }


# ---- in-browser audio: direct serve for native formats, ffmpeg→opus for exotic ----
# Mirrors bridge AUDIO_MIME/TRANSCODE_EXTS (apps/bridge/src/files.ts).
AUDIO_NATIVE_EXTS = {"mp3", "flac", "ogg", "oga", "opus", "wav", "m4a", "aac"}
AUDIO_TRANSCODE_EXTS = {"wma", "wv", "ape", "aiff", "aif", "alac", "mp2"}
AUDIO_MIME = {
    "mp3": "audio/mpeg", "flac": "audio/flac", "ogg": "audio/ogg", "oga": "audio/ogg",
    "opus": "audio/ogg", "wav": "audio/wav", "m4a": "audio/mp4", "aac": "audio/aac",
}
TRANSCODE_DIR = Path(os.environ.get("TRANSCODE_DIR", "/tmp/transcodes"))
TRANSCODE_CACHE_BYTES = 500 * 1024 * 1024


def _parse_range(header: str | None, size: int):
    """Single bytes= range → (start, end) | 'unsatisfiable' | None. Multipart ignored."""
    if not header or not header.startswith("bytes="):
        return None
    spec = header[6:].strip()
    if "," in spec:
        return None
    s, _, e = spec.partition("-")
    if s == "":
        try:
            suffix = int(e)
        except ValueError:
            return None
        if suffix <= 0:
            return None
        return (max(0, size - suffix), size - 1)
    try:
        start = int(s)
    except ValueError:
        return None
    if start < 0:
        return None
    if e == "":
        end = size - 1
    else:
        try:
            end = int(e)
        except ValueError:
            return None
        if end < start:
            return None
    if start >= size:
        return "unsatisfiable"
    return (start, min(end, size - 1))


def _file_chunks(path: Path, start: int, end: int, chunk: int = 1 << 20):
    try:
        f = open(path, "rb")
    except OSError:
        return
    with f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            try:
                data = f.read(min(chunk, remaining))
            except OSError:
                break
            if not data:
                break
            remaining -= len(data)
            yield data


def _ranged_audio_response(path: Path, request: Request, media_type: str, filename: str):
    from fastapi.responses import StreamingResponse

    size = path.stat().st_size
    base_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": f'inline; filename="{filename}"',
    }
    parsed = _parse_range(request.headers.get("range"), size)
    if parsed == "unsatisfiable":
        return JSONResponse({"detail": "range not satisfiable"}, status_code=416,
                            headers={**base_headers, "Content-Range": f"bytes */{size}"})
    if parsed is None:
        return StreamingResponse(_file_chunks(path, 0, size - 1), media_type=media_type,
                                 headers={**base_headers, "Content-Length": str(size)})
    start, end = parsed
    return StreamingResponse(_file_chunks(path, start, end), status_code=206, media_type=media_type,
                             headers={**base_headers, "Content-Range": f"bytes {start}-{end}/{size}",
                                      "Content-Length": str(end - start + 1)})


def _transcode_cache_key(src: Path) -> str:
    st = src.stat()
    h = hashlib.sha1(f"{src.resolve()}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:24]
    return f"{h}.opus"


# Max age of an in-progress transcode temp before the cache trim treats it as
# orphaned (crashed ffmpeg / killed worker). Must stay far above any legit
# transcode duration (ffmpeg timeout is 180 s) — a trim must never delete a
# live `*.tmp.opus`, otherwise it becomes the very race this fixes.
_TRANSCODE_TMP_MAX_AGE_S = 3600


def _trim_transcode_cache() -> None:
    """Evict oldest cached opus files over budget; sweep stale transcode tmps.

    In-progress `*.tmp.opus` files are excluded from size accounting and are
    only swept when older than _TRANSCODE_TMP_MAX_AGE_S — concurrent
    same-file transcodes each own a unique tmp (see _transcode_to_opus), so
    the trim must never delete a fresh tmp or it reintroduces the race.
    """
    try:
        TRANSCODE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    try:
        entries = list(TRANSCODE_DIR.glob("*.opus"))
    except OSError:
        return
    # Sweep orphaned tmps by age; never touch a live one.
    now = time.time()
    for tmp in entries:
        if not tmp.name.endswith(".tmp.opus"):
            continue
        try:
            if now - tmp.stat().st_mtime > _TRANSCODE_TMP_MAX_AGE_S:
                tmp.unlink(missing_ok=True)
        except OSError:
            pass
    sized: list[tuple[Path, int]] = []
    total = 0
    for p in entries:
        if p.name.endswith(".tmp.opus"):
            continue
        try:
            size = p.stat().st_size
        except OSError:
            continue
        sized.append((p, size))
        total += size
    sized.sort(key=lambda item: _safe_mtime(item[0]))
    for old, size in sized:
        if total <= TRANSCODE_CACHE_BYTES:
            break
        try:
            old.unlink()
            total -= size
        except OSError:
            pass


def _safe_mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def _transcode_to_opus(src: Path) -> Path | None:
    """ffmpeg → cached opus. None when ffmpeg missing/failed."""
    import shutil

    if not shutil.which("ffmpeg"):
        return None
    try:
        TRANSCODE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    out = TRANSCODE_DIR / _transcode_cache_key(src)
    if out.exists() and out.stat().st_size > 1000:
        return out
    # Unique tmp per attempt: concurrent same-file transcodes must never share
    # an output path — shared tmps let one ffmpeg truncate another's output and
    # let a loser's unlink delete the winner's file before replace() (spurious
    # 422s, or worse a promoted corrupt file). os.replace() below is atomic, so
    # concurrent winners serialize at the filesystem: last-wins, always whole.
    tmp = out.with_name(f"{out.stem}.{uuid.uuid4().hex}.tmp.opus")
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", str(src), "-vn", "-c:a", "libopus", "-b:a", "128k", str(tmp)],
            capture_output=True, timeout=180,
        )
        if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 1000:
            tmp.replace(out)
            _trim_transcode_cache()
            return out
        tmp.unlink(missing_ok=True)
    except (OSError, subprocess.SubprocessError):
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
    return None


# Single-flight transcode: concurrent same-file /audio hits share one ffmpeg
# instead of each spawning its own (CPU + transient disk per attempt, and
# pressure on the shared to_thread pool that also serves spectrum/mediainfo).
# Mirrors spectrals.ensure_spectrum: per-key in-flight task + semaphore +
# double-checked cache inside. Unique tmps in _transcode_to_opus stay as the
# safety net for distinct keys racing the pool.
_transcode_sem = asyncio.Semaphore(2)
_transcode_in_flight: dict[str, asyncio.Task[Path | None]] = {}


async def ensure_opus(src: Path) -> Path | None:
    """Cached transcode with cross-request coalescing. None on failure."""
    try:
        key = _transcode_cache_key(src)
    except OSError:
        return None
    out = TRANSCODE_DIR / key
    try:
        if out.exists() and out.stat().st_size > 1000:
            return out
    except OSError:
        pass
    task = _transcode_in_flight.get(key)
    if task is None:
        task = asyncio.create_task(_generate_opus(src, key))
        _transcode_in_flight[key] = task
        task.add_done_callback(lambda _t: _transcode_in_flight.pop(key, None))
    try:
        return await task
    except (OSError, subprocess.SubprocessError):
        return None


async def _generate_opus(src: Path, key: str) -> Path | None:
    async with _transcode_sem:
        out = TRANSCODE_DIR / key
        try:
            if out.exists() and out.stat().st_size > 1000:
                return out
        except OSError:
            pass
        return await asyncio.to_thread(_transcode_to_opus, src)


@app.get("/audio", dependencies=[Depends(require_auth)])
async def audio(file: str, request: Request):
    """Playable audio for the browser mini-player.

    Query `file`: basename, DATA_DIR-relative, or absolute /data path
    (same resolution as tag/verify). Native formats stream directly;
    wma/wv/ape/aiff/alac/mp2 transcode to cached opus. Others → 415,
    ffmpeg failure → 422 (web shows a toast; original stays downloadable).
    """
    resolved = _resolve_or_404(file)
    if isinstance(resolved, JSONResponse):
        return resolved
    ext = resolved.suffix.lstrip(".").lower()
    if ext in AUDIO_TRANSCODE_EXTS:
        out = await ensure_opus(resolved)
        if out is None:
            return JSONResponse({"detail": f"cannot transcode .{ext} for browser playback"}, status_code=422)
        try:
            return _ranged_audio_response(out, request, "audio/ogg", f"{resolved.stem}.opus")
        except OSError:
            # Cache evicted between transcode and serve (trim race) — report
            # transcode failure rather than an unhandled 500.
            return JSONResponse({"detail": f"cannot transcode .{ext} for browser playback"}, status_code=422)
    if ext in AUDIO_NATIVE_EXTS:
        return _ranged_audio_response(resolved, request, AUDIO_MIME[ext], resolved.name)
    return JSONResponse({"detail": f".{ext or '?'} is not playable in the browser"}, status_code=415)
