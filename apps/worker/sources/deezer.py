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
        tracks: list[dict] = []
        for i, t in enumerate((data.get("tracks") or {}).get("data") or []):
            title = str(t.get("title", ""))
            version = str(t.get("version") or "").strip()
            if version and version not in title:
                title = f"{title} ({version})"
            tracks.append(
                {
                    "pos": str(t.get("track_position") or i + 1),
                    "title": title,
                    "artist": str((t.get("artist") or {}).get("name") or ""),
                    "duration": int(t.get("duration") or 0),
                }
            )
        page_url = data.get("tracklist")
        while page_url and len(tracks) < 200:
            page = await self.get_json(page_url)
            for t in page.get("data") or []:
                if len(tracks) >= 200:
                    break
                title = str(t.get("title", ""))
                version = str(t.get("version") or "").strip()
                if version and version not in title:
                    title = f"{title} ({version})"
                tracks.append(
                    {
                        "pos": str(t.get("track_position") or len(tracks) + 1),
                        "title": title,
                        "artist": str((t.get("artist") or {}).get("name") or ""),
                        "duration": int(t.get("duration") or 0),
                    }
                )
            page_url = page.get("next")
        label = data.get("label")
        return IdentData(
            artist=str(artist.get("name", "Unknown")),
            album=str(data.get("title", "")),
            year=str(data.get("release_date", ""))[:4] or None,
            track_count=data.get("nb_tracks"),
            tracklist=tracks,
            cover_url=data.get("cover_xl") or data.get("cover_big"),
            label=str(label) if label else None,
            genre=[g.get("name") for g in (data.get("genres") or {}).get("data") or [] if g.get("name")],
            release_id=str(data.get("id", "")),
            media_type=str(data.get("record_type")).capitalize() if data.get("record_type") else None,
            catalog_no=str(data.get("upc")) if data.get("upc") else None,
            source=self.source,
        )
