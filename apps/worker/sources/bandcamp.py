"""Bandcamp scraper — embedded ld+json on the album/track page."""

from __future__ import annotations

import json
import re

from .base import BaseScraper, IdentData, ScrapeError


class BandcampScraper(BaseScraper):
    source = "bandcamp"
    url_patterns = [re.compile(r"https?://([^./]+)\.bandcamp\.com/(album|track)/([^/?#]+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        soup = await self.fetch_page(url)
        for tag in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(tag.string or "")
            except (ValueError, TypeError):
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                if item.get("@type") in ("MusicAlbum", "MusicRelease", "MusicRecording"):
                    artist = item.get("byArtist", {})
                    name = artist.get("name") if isinstance(artist, dict) else str(artist or "")
                    tracks = item.get("numTracks") or len(item.get("track", {}).get("itemListElement", [])) or None
                    year = str(item.get("datePublished", ""))[:4] or None
                    return IdentData(
                        artist=name or "Unknown", album=str(item.get("name", "")),
                        year=year, track_count=tracks, source=self.source,
                    )
        # fallback: og tags
        og_title = (soup.find("meta", property="og:title") or {}).get("content", "") if soup else ""
        if og_title and " by " in og_title:
            album, _, artist = og_title.partition(" by ")
            return IdentData(artist=artist.strip(), album=album.strip(), year=None, track_count=None, source=self.source)
        raise ScrapeError("bandcamp: no release metadata found")
