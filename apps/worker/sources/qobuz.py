"""Qobuz scraper — needs QOBUZ_APP_ID env (no hardcoded secrets)."""

from __future__ import annotations

import re

import tokens
from .base import BaseScraper, IdentData, ScrapeError


class QobuzScraper(BaseScraper):
    source = "qobuz"
    url_patterns = [re.compile(r"qobuz\.com/[a-z-]*/album/[^/]+/([^/?#]+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        app_id = tokens.get("QOBUZ_APP_ID")
        if not m:
            raise ScrapeError("qobuz: unrecognized URL")
        if not app_id:
            raise ScrapeError("qobuz: needs QOBUZ_APP_ID (Settings → Worker)")
        album_id = m.group(1)
        headers = {}
        if tokens.get("QOBUZ_USER_AUTH_TOKEN"):
            headers["X-User-Auth-Token"] = tokens.get("QOBUZ_USER_AUTH_TOKEN")
        data = await self.get_json(
            "https://www.qobuz.com/api.json/0.2/album/get",
            params={"album_id": album_id, "app_id": app_id},
            headers=headers or None,
        )
        tracks = data.get("tracks")
        if isinstance(tracks, dict):
            items = tracks.get("items")
        elif isinstance(tracks, list):
            items = tracks
        else:
            items = None
        if not items:
            try:
                tdata = await self.get_json(
                    "https://www.qobuz.com/api.json/0.2/album/getTracks",
                    params={"album_id": album_id, "app_id": app_id},
                    headers=headers or None,
                )
                if isinstance(tdata.get("items"), list):
                    items = tdata["items"]
                elif isinstance(tdata.get("tracks"), dict):
                    items = tdata["tracks"].get("items")
                elif isinstance(tdata.get("tracks"), list):
                    items = tdata["tracks"]
            except ScrapeError:
                items = None
        tracklist = None
        if isinstance(items, list):
            tracklist = []
            for i, t in enumerate(items):
                if not isinstance(t, dict):
                    continue
                perf = t.get("performer") or t.get("artist") or {}
                artist = perf.get("name") if isinstance(perf, dict) else str(perf)
                try:
                    duration = int(t.get("duration") or 0)
                except (TypeError, ValueError):
                    duration = 0
                tracklist.append(
                    {
                        "pos": str(t.get("track_number") or i + 1),
                        "title": str(t.get("title") or ""),
                        "artist": str(artist or ""),
                        "duration": duration,
                    }
                )
        image = data.get("image") or {}
        cover_url = image.get("large") or image.get("original") or None
        label = data.get("label")
        if isinstance(label, dict):
            label = label.get("name")
        genres = data.get("genres")
        genre = None
        if isinstance(genres, dict) and isinstance(genres.get("list"), list):
            genre = [str(g.get("name") if isinstance(g, dict) else g) for g in genres["list"]]
        elif isinstance(genres, list):
            genre = [str(g.get("name") if isinstance(g, dict) else g) for g in genres]
        elif isinstance(data.get("genre"), dict):
            genre = [str(data["genre"].get("name"))]
        return IdentData(
            artist=str((data.get("artist") or {}).get("name", "Unknown")),
            album=str(data.get("title", "")),
            year=str(data.get("release_date_original", data.get("released_at", "")))[:4] or None,
            track_count=data.get("tracks_count"),
            source=self.source,
            tracklist=tracklist,
            label=str(label) if label else None,
            genre=genre or None,
            release_id=str(data.get("id") or album_id),
            cover_url=str(cover_url) if cover_url else None,
        )
