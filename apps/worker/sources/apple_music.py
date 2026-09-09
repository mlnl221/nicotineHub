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
        data = await self.get_json(f"https://itunes.apple.com/lookup?id={m.group(1)}&entity=song&limit=200")
        results = data.get("results", [])
        col = next((r for r in results if r.get("wrapperType") == "collection"), None)
        if not col:
            raise ScrapeError("apple: album not found")
        tracks = [r for r in results if r.get("wrapperType") == "track"]
        tracklist = [
            {
                "pos": str(t.get("trackNumber") or i + 1),
                "title": str(t.get("trackName") or ""),
                "artist": str(t.get("artistName") or ""),
                "duration": t.get("trackTimeMillis"),
            }
            for i, t in enumerate(tracks)
        ]
        artwork = col.get("artworkUrl100") or ""
        genres = col.get("genreNames") or ([str(col.get("primaryGenreName"))] if col.get("primaryGenreName") else None)
        label = col.get("recordLabel") or col.get("copyright") or None
        return IdentData(
            artist=str(col.get("artistName", "Unknown")),
            album=str(col.get("collectionName", "")),
            year=str(col.get("releaseDate", ""))[:4] or None,
            track_count=col.get("trackCount") or len(tracks) or None,
            tracklist=tracklist,
            cover_url=artwork.replace("100x100", "1200x1200") if artwork else None,
            genre=[str(g) for g in genres] if genres else None,
            label=str(label) if label else None,
            media_type=str(col.get("collectionType")) if col.get("collectionType") else None,
            release_id=str(col.get("collectionId")) if col.get("collectionId") is not None else None,
            source=self.source,
        )
