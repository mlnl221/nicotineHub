"""MusicBrainz scraper — public ws/2 JSON API, no auth needed."""

from __future__ import annotations

import asyncio
import re

from .base import BaseScraper, IdentData, ScrapeError


async def _mb_get(scraper, url, headers):
    try:
        return await scraper.get_json(url, headers=headers)
    except ScrapeError as e:
        msg = str(e)
        if "HTTP 503" in msg or "HTTP 429" in msg:
            await asyncio.sleep(3)
            return await scraper.get_json(url, headers=headers)
        raise


class MusicBrainzScraper(BaseScraper):
    source = "musicbrainz"
    url_patterns = [re.compile(r"musicbrainz\.org/(release(?:-group)?)/([a-f0-9-]{36})", re.I)]

    async def _caa_cover(self, mbid: str, headers: dict) -> str | None:
        try:
            caa = await _mb_get(self, f"https://coverartarchive.org/release/{mbid}", headers=headers)
        except Exception:
            return None
        if "images" not in caa:
            return f"https://coverartarchive.org/release/{mbid}/front"
        for img in caa.get("images") or []:
            if isinstance(img, dict) and img.get("front"):
                u = img.get("image")
                if u:
                    return str(u)
        return None

    def _release_data(self, data: dict, mbid: str, cover_url: str | None = None) -> IdentData:
        tracklist = []
        idx = 0
        for med in data.get("media", []):
            for t in med.get("tracks", []):
                idx += 1
                rec = t.get("recording") or {}
                ac = t.get("artist-credit") or rec.get("artist-credit") or []
                if isinstance(ac, list):
                    artist = "".join(a.get("name", "") + a.get("joinphrase", "") for a in ac if isinstance(a, dict))
                else:
                    artist = str(ac or "")
                length = t.get("length") or rec.get("length")
                try:
                    duration: object = int(length) if length else ""
                except (TypeError, ValueError):
                    duration = ""
                tracklist.append(
                    {
                        "pos": str(t.get("number") or t.get("position") or idx),
                        "title": str(t.get("title") or rec.get("title") or ""),
                        "artist": artist,
                        "duration": duration,
                    }
                )
        label_info = data.get("label-info") or []
        first = label_info[0] if label_info else {}
        label = ((first.get("label") or {}).get("name"))
        catalog_no = first.get("catalog-number")
        phrase = data.get("artist-credit-phrase")
        if not phrase:
            rac = data.get("artist-credit") or []
            if isinstance(rac, list):
                phrase = "".join(a.get("name", "") + a.get("joinphrase", "") for a in rac if isinstance(a, dict)) or None
            else:
                phrase = str(rac) if rac else None
        return IdentData(
            artist=phrase or "Unknown",
            album=str(data.get("title", "")),
            year=str(data.get("date", ""))[:4] or None,
            track_count=len(tracklist) or None,
            source=self.source,
            tracklist=tracklist or None,
            label=label,
            catalog_no=catalog_no,
            country=data.get("country"),
            release_id=mbid,
            cover_url=cover_url,
        )

    async def scrape(self, url: str) -> IdentData:
        m = self.match(url)
        if not m:
            raise ScrapeError("musicbrainz: unrecognized URL")
        kind, mbid = m.group(1).lower(), m.group(2)
        ua = {"User-Agent": "NicotineHubWorker/0.1 ( https://github.com/mlnl221/nicotineHub )"}
        if kind == "release-group":
            data = await _mb_get(
                self,
                f"https://musicbrainz.org/ws/2/release-group/{mbid}?fmt=json&inc=artists+releases", headers=ua
            )
            releases = data.get("releases") or []
            rid = releases[0].get("id") if releases else None
            if not rid:
                tracks = (releases[0].get("media") or [{}])[0].get("track-count") if releases else None
                year = str(data.get("first-release-date", ""))[:4] or None
                return IdentData(
                    artist=data.get("artist-credit-phrase") or "Unknown",
                    album=str(data.get("title", "")),
                    year=year,
                    track_count=tracks,
                    source=self.source,
                    release_id=None,
                    cover_url=None,
                )
            await asyncio.sleep(1.1)
            data = await _mb_get(
                self,
                f"https://musicbrainz.org/ws/2/release/{rid}?fmt=json&inc=artists+media+recordings",
                headers=ua,
            )
            await asyncio.sleep(1.1)
            return self._release_data(data, rid, await self._caa_cover(rid, ua))
        data = await _mb_get(
            self,
            f"https://musicbrainz.org/ws/2/release/{mbid}?fmt=json&inc=artists+media+recordings",
            headers=ua,
        )
        await asyncio.sleep(1.1)
        return self._release_data(data, mbid, await self._caa_cover(mbid, ua))
