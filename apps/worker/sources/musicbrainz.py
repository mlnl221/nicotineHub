"""MusicBrainz scraper — public ws/2 JSON API, no auth needed."""

from __future__ import annotations

import re

from .base import BaseScraper, IdentData, ScrapeError


class MusicBrainzScraper(BaseScraper):
    source = "musicbrainz"
    url_patterns = [re.compile(r"musicbrainz\.org/(release(?:-group)?)/([a-f0-9-]{36})", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        if not m:
            raise ScrapeError("musicbrainz: unrecognized URL")
        kind, mbid = m.group(1).lower(), m.group(2)
        ua = {"User-Agent": "NicotineHubWorker/0.1 ( https://github.com/mlnl221/nicotineHub )"}
        if kind == "release-group":
            data = await self.get_json(
                f"https://musicbrainz.org/ws/2/release-group/{mbid}?fmt=json&inc=artists+releases", headers=ua
            )
            releases = data.get("releases") or []
            first = releases[0] if releases else {}
            tracks = (first.get("media") or [{}])[0].get("track-count")
            year = str(data.get("first-release-date", ""))[:4] or None
            return IdentData(
                artist=data.get("artist-credit-phrase") or "Unknown",
                album=str(data.get("title", "")),
                year=year,
                track_count=tracks,
                source=self.source,
            )
        data = await self.get_json(
            f"https://musicbrainz.org/ws/2/release/{mbid}?fmt=json&inc=artists+recordings", headers=ua
        )
        tracks = sum(len(med.get("tracks", [])) for med in data.get("media", [])) or None
        return IdentData(
            artist=data.get("artist-credit-phrase") or "Unknown",
            album=str(data.get("title", "")),
            year=str(data.get("date", ""))[:4] or None,
            track_count=tracks,
            source=self.source,
        )
