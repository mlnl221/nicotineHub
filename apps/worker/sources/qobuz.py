"""Qobuz scraper — needs QOBUZ_APP_ID env (no hardcoded secrets)."""

from __future__ import annotations

import os
import re

from .base import BaseScraper, IdentData, ScrapeError


class QobuzScraper(BaseScraper):
    source = "qobuz"
    url_patterns = [re.compile(r"qobuz\.com/[a-z-]*/album/[^/]+/([^/?#]+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        app_id = os.environ.get("QOBUZ_APP_ID", "")
        if not m:
            raise ScrapeError("qobuz: unrecognized URL")
        if not app_id:
            raise ScrapeError("qobuz: needs QOBUZ_APP_ID env (see worker README section)")
        data = await self.get_json(
            "https://www.qobuz.com/api.json/0.2/album/get",
            params={"album_id": m.group(1), "app_id": app_id},
        )
        return IdentData(
            artist=str(data.get("artist", {}).get("name", "Unknown")),
            album=str(data.get("title", "")),
            year=str(data.get("release_date_original", data.get("released_at", "")))[:4] or None,
            track_count=data.get("tracks_count"),
            source=self.source,
        )
