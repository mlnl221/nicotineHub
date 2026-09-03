"""Apple Music scraper — public iTunes Lookup API, no auth needed."""

from __future__ import annotations

import re

from .base import BaseScraper, IdentData, ScrapeError


class AppleMusicScraper(BaseScraper):
    source = "apple"
    url_patterns = [re.compile(r"music\.apple\.com/[a-z]+/album/(?:[^/]+/)?(\d+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        if not m:
            raise ScrapeError("apple: unrecognized URL")
        data = await self.get_json(f"https://itunes.apple.com/lookup?id={m.group(1)}&entity=song")
        results = data.get("results", [])
        col = next((r for r in results if r.get("wrapperType") == "collection"), None)
        if not col:
            raise ScrapeError("apple: album not found")
        songs = sum(1 for r in results if r.get("wrapperType") == "track")
        return IdentData(
            artist=str(col.get("artistName", "Unknown")),
            album=str(col.get("collectionName", "")),
            year=str(col.get("releaseDate", ""))[:4] or None,
            track_count=col.get("trackCount") or songs or None,
            source=self.source,
        )
