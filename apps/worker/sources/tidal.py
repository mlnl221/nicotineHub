"""Tidal scraper — needs TIDAL_TOKEN env (no hardcoded secrets)."""

from __future__ import annotations

import re

import tokens
from .base import BaseScraper, IdentData, ScrapeError


class TidalScraper(BaseScraper):
    source = "tidal"
    url_patterns = [re.compile(r"(?:tidal\.com/browse|listen\.tidal\.com)/album/(\d+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        token = tokens.get("TIDAL_TOKEN")
        if not m:
            raise ScrapeError("tidal: unrecognized URL")
        if not token:
            raise ScrapeError("tidal: needs TIDAL_TOKEN (Settings → Worker)")
        data = await self.get_json(
            f"https://api.tidalhifi.com/v1/albums/{m.group(1)}",
            params={
                "token": token,
                "countrycode": (tokens.get("TIDAL_COUNTRY") or "US").upper(),
            },
        )
        artists = ", ".join(a.get("name", "") for a in data.get("artists", [])) or "Unknown"
        return IdentData(
            artist=artists,
            album=str(data.get("title", "")),
            year=str(data.get("releaseDate", ""))[:4] or None,
            track_count=data.get("numberOfTracks"),
            source=self.source,
        )
