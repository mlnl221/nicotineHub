"""Tidal scraper — needs TIDAL_TOKEN env (no hardcoded secrets)."""

from __future__ import annotations

import re

import tokens
from .base import BaseScraper, IdentData, ScrapeError


class TidalScraper(BaseScraper):
    source = "tidal"
    url_patterns = [re.compile(r"(?:tidal\.com/browse|listen\.tidal\.com)/album/(\d+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        token = tokens.get("TIDAL_TOKEN")
        if not m:
            raise ScrapeError("tidal: unrecognized URL")
        if not token:
            raise ScrapeError("tidal: needs TIDAL_TOKEN (Settings → Worker)")
        country = (tokens.get("TIDAL_COUNTRY") or "US").upper()
        album_id = m.group(1)
        data = await self.get_json(
            f"https://api.tidalhifi.com/v1/albums/{album_id}",
            params={
                "token": token,
                "countrycode": country,
            },
        )
        artists = ", ".join(a.get("name", "") for a in data.get("artists", [])) or "Unknown"
        cover_raw = data.get("cover") or ""
        cover_url = None
        if cover_raw:
            if cover_raw.startswith("http"):
                cover_url = cover_raw.replace("{w}x{h}", "1280x1280").replace("{w}", "1280").replace("{h}", "1280")
            else:
                cover_url = f"https://resources.tidal.com/images/{cover_raw.replace('-', '/')}/1280x1280.jpg"
        label = data.get("copyright") or data.get("recordLabel") or None
        genre = data.get("genre") or None
        release_raw = str(data.get("releaseDate") or "")
        year = release_raw[:4] or None
        if year and len(release_raw) >= 10 and release_raw[5:10] == "01-01":
            try:
                if int(year) < 2013:
                    year = None
            except ValueError:
                pass
        media_type = str(data.get("type")) if data.get("type") else None
        catalog_no = str(data.get("upc")) if data.get("upc") else None
        tracklist = None
        try:
            items: list = []
            offset = 0
            limit = 100
            while len(items) < 200:
                tdata = await self.get_json(
                    f"https://api.tidalhifi.com/v1/albums/{album_id}/tracks",
                    params={
                        "token": token,
                        "countrycode": country,
                        "limit": limit,
                        "offset": offset,
                    },
                )
                batch = tdata.get("items", [])
                if not batch:
                    break
                items.extend(batch)
                if len(batch) < limit:
                    break
                offset += limit
            tracklist = []
            for i, t in enumerate(items[:200]):
                title = str(t.get("title", ""))
                version = t.get("version")
                if version and version not in title:
                    title = f"{title} ({version})"
                tracklist.append(
                    {
                        "pos": str(t.get("trackNumber") or i + 1),
                        "title": title,
                        "artist": ", ".join(a.get("name", "") for a in t.get("artists", [])),
                        "duration": int(t.get("duration", 0) or 0),
                    }
                )
        except Exception:
            tracklist = None
        return IdentData(
            artist=artists,
            album=str(data.get("title", "")),
            year=year,
            track_count=data.get("numberOfTracks"),
            source=self.source,
            tracklist=tracklist,
            label=label,
            genre=[genre] if genre else None,
            media_type=media_type,
            catalog_no=catalog_no,
            release_id=str(data.get("id", album_id)),
            cover_url=cover_url,
        )
