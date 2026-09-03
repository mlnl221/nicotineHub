"""Scraper base — own implementation.

Only the *pattern* (regex + release_format + get_json/fetch_page + IdentData)
is guided by smoked-salmon's ``sources/base.py``. No code is imported or copied.
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
                    data = await resp.json()
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
