"""Scraper base — regex + release_format + get_json/fetch_page + IdentData.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from random import choice
from typing import Any
from urllib.parse import urlparse

import aiohttp
from bs4 import BeautifulSoup

# ponytail: tiny UA pool, no external constants module
UAGENTS = [
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
]


class ScrapeError(Exception):
    """Raised when a release URL cannot be scraped."""


@dataclass(frozen=True)
class IdentData:
    artist: str
    album: str
    year: int | str | None
    track_count: int | None
    source: str
    # Per-track entries [{pos, title, artist, duration}]; None when scraper lacks it.
    tracklist: list[dict[str, str]] | None = None
    catalog_no: str | None = None
    country: str | None = None
    label: str | None = None
    genre: list[str] | None = None
    style: list[str] | None = None
    media_type: str | None = None
    release_id: str | None = None
    cover_url: str | None = None

    def __post_init__(self):
        if isinstance(self.genre, str):
            object.__setattr__(self, "genre", [self.genre])
        if isinstance(self.style, str):
            object.__setattr__(self, "style", [self.style])
        if isinstance(self.year, str):
            m = re.match(r"\d{4}", self.year)
            if m:
                object.__setattr__(self, "year", m.group(0))
        if isinstance(self.tracklist, list):
            out = []
            for t in self.tracklist:
                try:
                    if not isinstance(t, dict) or "duration" not in t:
                        out.append(t)
                        continue
                    v = t["duration"]
                    if isinstance(v, str):
                        # ISO 8601 durations (Bandcamp PT4M5S / P00H04M43S)
                        iso = re.match(
                            r"^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$", v.strip().upper()
                        )
                        if iso and any(iso.groups()):
                            h, mi, s = iso.groups()
                            v = int(h or 0) * 3600 + int(mi or 0) * 60 + float(s or 0)
                    if isinstance(v, (int, float)):
                        d = dict(t)
                        # millis (iTunes/MB, >10000) vs seconds
                        s = v / 1000 if v > 10000 else v
                        d["duration"] = f"{int(s // 60)}:{int(s % 60):02d}"
                        out.append(d)
                    elif v is None:
                        d = dict(t)
                        d["duration"] = ""
                        out.append(d)
                    else:
                        out.append(t)
                except Exception:
                    out.append(t)
            object.__setattr__(self, "tracklist", out)


def assert_public_url(url: str) -> str:
    """Reject non-http(s) URLs and hosts resolving to private IPs (SSRF guard)."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ScrapeError(f"Only public http(s) URLs can be scraped: {url[:80]}")
    try:
        infos = socket.getaddrinfo(parts.hostname, None)
    except OSError as e:
        raise ScrapeError(f"Cannot resolve {parts.hostname}") from e
    for info in infos:
        try:
            if ipaddress.ip_address(info[4][0]).is_private:
                raise ScrapeError(f"Refusing to scrape private IP for {parts.hostname}")
        except ValueError:
            raise ScrapeError(f"Cannot resolve {parts.hostname}")
    return url


class BaseScraper:
    """One scraper per source site. Subclasses set ``source`` + ``url_patterns``."""

    source: str = ""
    url_patterns: list[re.Pattern[str]] = []

    @classmethod
    def match(cls, url: str) -> re.Match[str] | None:
        for pat in cls.url_patterns:
            m = pat.search(url)
            if m:
                return m
        return None

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {"User-Agent": choice(UAGENTS), **(extra or {})}

    async def get_json(
        self, url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None
    ) -> dict[str, Any]:
        assert_public_url(url)
        timeout = aiohttp.ClientTimeout(total=10)
        try:
            async with (
                aiohttp.ClientSession(timeout=timeout) as session,
                session.get(url, params=params or {}, headers=self._headers(headers)) as resp,
            ):
                if resp.status != 200:
                    raise ScrapeError(f"{self.source}: HTTP {resp.status}")
                try:
                    # content_type=None: some APIs (iTunes) serve JSON as text/javascript
                    data = await resp.json(content_type=None)
                except Exception as e:
                    raise ScrapeError(f"{self.source}: not JSON") from e
                return data if isinstance(data, dict) else {"items": data}
        except ScrapeError:
            raise
        except Exception as e:
            raise ScrapeError(f"{self.source}: request failed ({e})") from e

    async def fetch_page(self, url: str) -> BeautifulSoup:
        assert_public_url(url)
        timeout = aiohttp.ClientTimeout(total=10)
        try:
            async with (
                aiohttp.ClientSession(timeout=timeout) as session,
                session.get(url, headers=self._headers()) as resp,
            ):
                if resp.status != 200:
                    raise ScrapeError(f"{self.source}: HTTP {resp.status}")
                return BeautifulSoup(await resp.read(), "lxml")
        except ScrapeError:
            raise
        except Exception as e:
            raise ScrapeError(f"{self.source}: fetch failed ({e})") from e

    async def scrape(self, url: str) -> IdentData:
        raise NotImplementedError
