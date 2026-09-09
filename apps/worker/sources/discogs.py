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
        tracklist = [
            {
                "pos": str(t.get("position") or (i + 1)).upper(),
                "title": str(t.get("title") or ""),
                "artist": ", ".join(a.get("name", "") for a in t.get("artists", []) if a.get("name")) or ", ".join(a.get("name", "") for a in t.get("extraartists", []) if a.get("name")),
                "duration": str(t.get("duration") or ""),
            }
            for i, t in enumerate(tracks)
        ]
        labels = data.get("labels") or []
        label_names = [str(l.get("name")) for l in labels if isinstance(l, dict) and l.get("name")]
        catnos = [str(l.get("catno")).strip() for l in labels if isinstance(l, dict) and str(l.get("catno") or "").strip() and str(l.get("catno") or "").strip().lower() != "none"]
        country = str(data.get("country")) if data.get("country") else None
        _genres = data.get("genres")
        genre = [str(g) for g in _genres if g] if isinstance(_genres, list) and _genres else None
        _styles = data.get("styles")
        style = [str(s) for s in _styles if s] if isinstance(_styles, list) and _styles else None
        _formats = data.get("formats") or []
        _first = _formats[0] if _formats and isinstance(_formats[0], dict) else {}
        _name = _first.get("name")
        _descs = [str(d) for d in (_first.get("descriptions") or []) if d]
        media_type = (
            f"{_name} ({', '.join(_descs)})" if _name and _descs else (str(_name) if _name else None)
        )
        _images = data.get("images") or []
        _primary = next(
            (i for i in _images if isinstance(i, dict) and i.get("type") == "primary"), None
        )
        _img = (
            _primary
            if isinstance(_primary, dict)
            else (_images[0] if _images and isinstance(_images[0], dict) else {})
        )
        cover_url = str(_img.get("uri")) if _img.get("uri") else None
        return IdentData(
            artist=artists,
            album=str(data.get("title", "")),
            year=data.get("year") or None,
            track_count=len(tracks) or None,
            source=self.source,
            tracklist=tracklist or None,
            catalog_no=", ".join(catnos) or None,
            country=country,
            label=", ".join(label_names) or None,
            genre=genre,
            style=style,
            media_type=media_type,
            release_id=str(rid) if rid else None,
            cover_url=cover_url,
        )
