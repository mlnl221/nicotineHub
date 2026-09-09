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
                    if not tracklist:
                        if item.get("@type") == "MusicRecording":
                            tracklist = [{
                                "pos": "1",
                                "title": str(item.get("name", "") or ""),
                                "artist": str(name or ""),
                                "duration": str(item.get("duration", "") or ""),
                            }]
                        else:
                            tbl = soup.select_one("#track_table")
                            if tbl is not None:
                                rows = [r for r in tbl.select("tr") if r.get_text(strip=True)]
                                if len(rows) == 1:
                                    t_el = rows[0].select_one(".track-title")
                                    t_title = t_el.get_text(strip=True) if t_el else rows[0].get_text(strip=True)
                                    if not t_title:
                                        t_title = str(item.get("name", "") or "")
                                    tracklist = [{
                                        "pos": "1",
                                        "title": t_title,
                                        "artist": str(name or ""),
                                        "duration": str(item.get("duration", "") or ""),
                                    }]
                    if tracklist and not tracks:
                        tracks = len(tracklist)
                    art_img = soup.select_one("#tralbumArt img")
                    art_src = art_img.get("src", "") if art_img else ""
                    image = item.get("image")
                    if isinstance(image, list):
                        image = image[0] if image else None
                    og_image = soup.find("meta", property="og:image")
                    og_image = og_image.get("content", "") if og_image else ""
                    cover = art_src or image or og_image or ""
                    og_site = soup.find("meta", property="og:site_name")
                    og_site = og_site.get("content", "").strip() if og_site else ""
                    acct_el = soup.select_one(".account_title")
                    acct_title = acct_el.get_text(strip=True) if acct_el else ""
                    owner = acct_title or og_site or ""
                    label = item.get("recordLabel")
                    if isinstance(label, dict):
                        label = label.get("name")
                    label = owner or label
                    tag_anchors = [a.get_text(strip=True) for a in soup.select(".tralbum-tags a")]
                    tag_anchors = [t for t in tag_anchors if t]
                    if tag_anchors:
                        genre = tag_anchors
                    else:
                        genre = item.get("genre", item.get("keywords"))
                        if isinstance(genre, str):
                            genre = [genre]
                    album_name = str(item.get("name", ""))
                    catalog_no = None
                    mcat = re.match(r"^\s*([A-Z0-9][A-Z0-9\-\. ]{2,})\s*[-–—]", album_name)
                    if mcat:
                        catalog_no = mcat.group(1).strip()
                        album_name = album_name[mcat.end():].strip()
                    m = self.match(url)
                    release_id = (m.group(3) if m else None) or str(item.get("@id", "") or "") or None
                    return IdentData(
                        artist=name or "Unknown", album=album_name,
                        year=year, track_count=tracks, source=self.source,
                        tracklist=tracklist or None, cover_url=str(cover or "") or None,
                        label=str(label or "") or None, genre=genre,
                        catalog_no=str(catalog_no or "") or None,
                        release_id=str(release_id or "") or None,
                    )
        # fallback: og tags
        og_title = (soup.find("meta", property="og:title") or {}).get("content", "") if soup else ""
        if og_title and " by " in og_title:
            album, _, artist = og_title.partition(" by ")
            return IdentData(artist=artist.strip(), album=album.strip(), year=None, track_count=None, source=self.source)
        raise ScrapeError("bandcamp: no release metadata found")
