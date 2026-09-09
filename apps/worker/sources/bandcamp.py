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
                    track_obj = item.get("track", {})
                    if isinstance(track_obj, dict):
                        elements = track_obj.get("itemListElement", []) or []
                    elif isinstance(track_obj, list):
                        elements = track_obj
                    else:
                        elements = []
                    tracks = item.get("numTracks") or len(elements) or None
                    year = str(item.get("datePublished", ""))[:4] or None
                    tracklist = []
                    for i, el in enumerate(elements):
                        rec = el.get("item", el) if isinstance(el, dict) and isinstance(el.get("item"), dict) else (el if isinstance(el, dict) else {})
                        t_artist = rec.get("byArtist", {})
                        t_name = t_artist.get("name") if isinstance(t_artist, dict) else str(t_artist or "")
                        dur = rec.get("duration", "")
                        tracklist.append({
                            "pos": str(el.get("position", i + 1) if isinstance(el, dict) else i + 1),
                            "title": str(rec.get("name", "") or ""),
                            "artist": str(t_name or ""),
                            "duration": str(dur) if dur else "",
                        })
                    image = item.get("image")
                    if isinstance(image, list):
                        image = image[0] if image else None
                    og_image = soup.find("meta", property="og:image")
                    og_image = og_image.get("content", "") if og_image else ""
                    label = item.get("recordLabel")
                    if isinstance(label, dict):
                        label = label.get("name")
                    genre = item.get("genre", item.get("keywords"))
                    if isinstance(genre, str):
                        genre = [genre]
                    m = self.match(url)
                    release_id = (m.group(3) if m else None) or str(item.get("@id", "") or "") or None
                    return IdentData(
                        artist=name or "Unknown", album=str(item.get("name", "")),
                        year=year, track_count=tracks, source=self.source,
                        tracklist=tracklist or None, cover_url=str(image or og_image or "") or None,
                        label=str(label or "") or None, genre=genre,
                        release_id=str(release_id or "") or None,
                    )
        # fallback: og tags
        og_title = (soup.find("meta", property="og:title") or {}).get("content", "") if soup else ""
        if og_title and " by " in og_title:
            album, _, artist = og_title.partition(" by ")
            return IdentData(artist=artist.strip(), album=album.strip(), year=None, track_count=None, source=self.source)
        raise ScrapeError("bandcamp: no release metadata found")
