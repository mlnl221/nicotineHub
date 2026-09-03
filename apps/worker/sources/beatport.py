"""Beatport scraper — embedded __NEXT_DATA__ on the release page."""

from __future__ import annotations

import json
import re

from .base import BaseScraper, IdentData, ScrapeError


class BeatportScraper(BaseScraper):
    source = "beatport"
    url_patterns = [re.compile(r"beatport\.com/release/[^/]+/(\d+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        soup = await self.fetch_page(url)
        tag = soup.find("script", id="__NEXT_DATA__")
        if tag and tag.string:
            try:
                data = json.loads(tag.string)
                rel = (
                    data.get("props", {}).get("pageProps", {}).get("release")
                    or data.get("props", {}).get("pageProps", {}).get("data", {}).get("release")
                    or {}
                )
                if rel.get("name"):
                    artists = ", ".join(a.get("name", "") for a in rel.get("artists", [])) or "Unknown"
                    tracks = rel.get("track_count") or len(rel.get("tracks", [])) or None
                    return IdentData(
                        artist=artists, album=str(rel["name"]),
                        year=str(rel.get("release_date", ""))[:4] or None,
                        track_count=tracks, source=self.source,
                    )
            except (ValueError, KeyError, TypeError):
                pass
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            # "Release Name by Artist on Beatport" — best effort split
            title = og_title["content"].replace(" on Beatport", "")
            if " by " in title:
                album, _, artist = title.partition(" by ")
                return IdentData(artist=artist.strip(), album=album.strip(), year=None, track_count=None, source=self.source)
        raise ScrapeError("beatport: no release metadata found")
