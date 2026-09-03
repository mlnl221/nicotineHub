"""Spectrum generation — own implementation.

Same output semantics as the old ``apps/bridge/src/spectrum.ts``
(Full 2000x513 + Zoom 500x1025, Kaiser -z 120, sha256(token:mtime:size) etag)
so cached URLs stay compatible. No smoked-salmon code.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import subprocess
import time
from pathlib import Path

AUDIO_EXTS = {"flac", "wav", "aiff", "aif", "mp3", "ogg", "wma", "m4a", "wv", "aac", "opus"}
NEEDS_TRANSCODE = {"mp3", "m4a", "aac", "wma", "opus", "alac"}
MAX_FILES = 100
SOX_TIMEOUT = 90


def spectrum_dir() -> Path:
    return Path(os.environ.get("SPECTRUM_DIR", "/tmp/hub-spectrum"))


def data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data"))


def calculate_zoom_startpoint(duration: float | None) -> int:
    if isinstance(duration, (int, float)) and duration > 5:
        return int(duration // 2)
    return 0


def spectrum_hash(label: str, mtime_ms: float, size: int) -> str:
    return hashlib.sha256(f"{label}:{mtime_ms}:{size}".encode()).hexdigest()[:16]


def spectrum_paths(label: str, digest: str, out_dir: Path | None = None) -> tuple[Path, Path, Path]:
    d = out_dir or spectrum_dir()
    base = f"{label}-{digest}"
    return d / f"{base}-Full.png", d / f"{base}-Zoom.png", d / f"{base}.json"


def is_audio_file(name: str) -> bool:
    return name.rsplit(".", 1)[-1].lower() in AUDIO_EXTS if "." in name else False


def resolve_audio(file_name: str) -> Path | None:
    """Find a finished download by basename under DATA_DIR (containment-checked)."""
    base = os.path.basename(file_name.replace("\\", "/"))
    if not base or base in (".", ".."):
        return None
    root = data_dir().resolve()
    # direct candidates first (mirrors old bridge lookup)
    for cand in (root / "downloads" / base, root / base):
        try:
            if cand.is_file() and cand.resolve().is_relative_to(root):
                return cand.resolve()
        except OSError:
            continue
    # shallow recursive scan of downloads/ then DATA_DIR (depth 2)
    for top in (root / "downloads", root):
        hit = _scan(top, base, root, depth=2)
        if hit:
            return hit
    return None


def _scan(d: Path, target: str, root: Path, depth: int) -> Path | None:
    try:
        if not d.is_dir():
            return None
        for ent in d.iterdir():
            try:
                resolved = ent.resolve()
                if not resolved.is_relative_to(root):
                    continue
                if ent.name == target and resolved.is_file():
                    return resolved
                if depth > 0 and ent.is_dir():
                    hit = _scan(ent, target, root, depth - 1)
                    if hit:
                        return hit
            except OSError:
                continue
    except OSError:
        return None
    return None


def prune_if_needed(out_dir: Path | None = None) -> None:
    d = out_dir or spectrum_dir()
    try:
        files = sorted(
            (p for p in d.iterdir() if p.is_file()),
            key=lambda p: p.stat().st_mtime,
        )
        for old in files[: max(0, len(files) - MAX_FILES)]:
            try:
                old.unlink()
            except OSError:
                pass
    except OSError:
        pass


def _transcode_to_wav(src: Path, workdir: Path) -> Path | None:
    tmp = workdir / f".transcode-{int(time.time() * 1000)}.wav"
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(tmp)],
            capture_output=True, timeout=20,
        )
        if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 1000:
            return tmp
        tmp.unlink(missing_ok=True)
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def _sox_once(inp: Path, full: Path, zoom: Path, zoom_start: int) -> None:
    """Single sox invocation rendering Full + Zoom (mirrors old bridge args)."""
    subprocess.run(
        ["sox", "--multi-threaded", str(inp), "--buffer", "128000", "-n",
         "remix", "1", "spectrogram",
         "-x", "2000", "-y", "513", "-z", "120", "-w", "Kaiser", "-o", str(full),
         "remix", "1", "spectrogram",
         "-x", "500", "-y", "1025", "-z", "120", "-w", "Kaiser",
         "-S", str(zoom_start), "-d", "0:02", "-o", str(zoom)],
        capture_output=True, timeout=SOX_TIMEOUT, check=True,
    )


def _run_sox(src: Path, full: Path, zoom: Path, zoom_start: int) -> None:
    effective, tmp_wav = src, None
    if src.suffix.lstrip(".").lower() in NEEDS_TRANSCODE:
        tmp_wav = _transcode_to_wav(src, full.parent)
        if tmp_wav:
            effective = tmp_wav
    try:
        try:
            _sox_once(effective, full, zoom, zoom_start)
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or b"").decode(errors="ignore")
            if not tmp_wav and ("no handler" in msg or "FAIL formats" in msg):
                tmp_wav = _transcode_to_wav(src, full.parent)
                if tmp_wav:
                    effective = tmp_wav
                    _sox_once(effective, full, zoom, zoom_start)
                    return
            raise RuntimeError(f"sox failed: {msg[:300]}") from e
    finally:
        if tmp_wav:
            tmp_wav.unlink(missing_ok=True)


def _compress_png(path: Path) -> None:
    # ponytail: oxipng binary best-effort, skip silently when absent
    if not shutil.which("oxipng"):
        return
    try:
        subprocess.run(["oxipng", "-o", "2", "--strip", "all", str(path)],
                       capture_output=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        pass


_sem = asyncio.Semaphore(2)
_in_flight: dict[str, asyncio.Task] = {}


async def ensure_spectrum(
    file_path: Path, label: str, mtime_ms: float, size: int, duration: float | None = None
) -> dict:
    digest = spectrum_hash(label, mtime_ms, size)
    etag = f'"{digest}"'
    full, zoom, _meta = spectrum_paths(label, digest)
    if full.exists() and zoom.exists():
        return {"full": full, "zoom": zoom, "etag": etag, "hash": digest, "fromCache": True}
    key = f"{label}:{digest}"
    task = _in_flight.get(key)
    if task is None:
        task = asyncio.create_task(_generate(file_path, label, digest, duration))
        _in_flight[key] = task
        task.add_done_callback(lambda _t: _in_flight.pop(key, None))
    res = await task
    return {**res, "fromCache": False}


async def _generate(file_path: Path, label: str, digest: str, duration: float | None) -> dict:
    full, zoom, _meta = spectrum_paths(label, digest)
    async with _sem:
        if full.exists() and zoom.exists():
            etag = f'"{digest}"'
            return {"full": full, "zoom": zoom, "etag": etag, "hash": digest}
        full.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(_run_sox, file_path, full, zoom, calculate_zoom_startpoint(duration))
        if not full.exists() or not zoom.exists():
            raise RuntimeError("sox did not produce expected files")
        await asyncio.to_thread(_compress_png, full)
        await asyncio.to_thread(_compress_png, zoom)
        prune_if_needed(full.parent)
        etag = f'"{digest}"'
        return {"full": full, "zoom": zoom, "etag": etag, "hash": digest}


def find_latest(label: str) -> dict | None:
    """Newest spectrum pair for a label prefix (bridge-compat lookup)."""
    d = spectrum_dir()
    try:
        cands = sorted(d.glob(f"{label}-*-Full.png"), key=lambda p: p.stat().st_mtime)
    except OSError:
        return None
    for full in reversed(cands):
        digest = full.name[len(label) + 1: -len("-Full.png")]
        zoom = d / f"{label}-{digest}-Zoom.png"
        if zoom.exists():
            return {"full": full, "zoom": zoom, "etag": f'"{digest}"', "hash": digest}
    return None
