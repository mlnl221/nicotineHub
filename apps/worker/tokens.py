"""Token loading for metadata services — env first, DATA_DIR/worker.json second.

``worker.json`` is written by the bridge on Settings save (``config:update``
section ``worker``) and never read back by clients — the Settings UI only
shows configured/not-set booleans from ``GET /health``. Values are never
logged. Own implementation.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# env name -> worker.json key
NAMES = {
    "DISCOGS_TOKEN": "discogs_token",
    "TIDAL_TOKEN": "tidal_token",
    "TIDAL_COUNTRY": "tidal_country",
    "QOBUZ_APP_ID": "qobuz_app_id",
    "QOBUZ_USER_AUTH_TOKEN": "qobuz_user_auth_token",
}

_cache: dict[str, str] = {}
_cache_mtime: float = -1.0


def _json_path() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")) / "worker.json"


def _load_file() -> dict[str, str]:
    """Read worker.json when it changed (stat-checked, cheap)."""
    global _cache, _cache_mtime
    path = _json_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        if _cache_mtime != -1.0:
            _cache, _cache_mtime = {}, -1.0
        return {}
    if mtime != _cache_mtime:
        try:
            data = json.loads(path.read_text())
            _cache = {k: str(v)[:512] for k, v in data.items() if isinstance(v, (str, int))}
        except (OSError, ValueError):
            _cache = {}
        _cache_mtime = mtime
    return _cache


def get(env_name: str) -> str:
    """Token value: env wins, then worker.json. Empty string when unset."""
    if os.environ.get(env_name):
        return os.environ[env_name]
    key = NAMES.get(env_name, "")
    return _load_file().get(key, "") if key else ""


def configured() -> dict[str, bool]:
    """Presence booleans only — safe for /health and the Settings UI."""
    return {
        "discogs": bool(get("DISCOGS_TOKEN")),
        "tidal": bool(get("TIDAL_TOKEN")),
        "qobuz": bool(get("QOBUZ_APP_ID")),
    }
