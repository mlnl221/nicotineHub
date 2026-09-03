"""Deezer scraper — public album API, no auth needed."""

from __future__ import annotations

import re

from .base import BaseScraper, IdentData, ScrapeError


class DeezerScraper(BaseScraper):
    source = "deezer"
    url_patterns = [re.compile(r"deezer\.com/[a-z]*/album/(\d+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        if not m:
            raise ScrapeError("deezer: unrecognized URL")
        data = await self.get_json(f"https://api.deezer.com/album/{m.group(1)}")
        if data.get("error"):
            raise ScrapeError(f"deezer: {data['error'].get('message', 'not found')}")
        artist = data.get("artist", {})
        return IdentData(
            artist=str(artist.get("name", "Unknown")),
            album=str(data.get("title", "")),
            year=str(data.get("release_date", ""))[:4] or None,
            track_count=data.get("nb_tracks"),
            source=self.source,
        )
