"""Discogs scraper — public release API (auth optional, higher limits with token)."""

from __future__ import annotations

import re

import tokens
from .base import BaseScraper, IdentData


class DiscogsScraper(BaseScraper):
    source = "discogs"
    url_patterns = [re.compile(r"discogs\.com/(?:[a-z-]+/)?release/(\d+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        rid = m.group(1) if m else ""
        headers = {"Accept": "application/json"}
        if tokens.get("DISCOGS_TOKEN"):
            headers["Authorization"] = f"Discogs token={tokens.get('DISCOGS_TOKEN')}"
        data = await self.get_json(f"https://api.discogs.com/releases/{rid}", headers=headers)
        artists = ", ".join(a.get("name", "") for a in data.get("artists", []) if a.get("name")) or "Unknown"
        tracks = [t for t in data.get("tracklist", []) if t.get("type_") == "track"]
        return IdentData(
            artist=artists,
            album=str(data.get("title", "")),
            year=data.get("year") or None,
            track_count=len(tracks) or None,
            source=self.source,
        )
