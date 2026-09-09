"""Beatport scraper — DISABLED (not registered in app.SCRAPERS).

Page structure no longer matches this parser and the site is bot-walled.
Revival path: official v4 API (/catalog/releases, /catalog/tracks) with user
OAuth token (see smoked-salmon beatport source for reference).
Kept for reference; remove entirely if unneeded after revival decision."""

from __future__ import annotations

import json
import re

from .base import BaseScraper, IdentData, ScrapeError


class BeatportScraper(BaseScraper):
    source = "beatport"
    url_patterns = [re.compile(r"beatport\.com/release/[^/]+/(\d+)", re.I)]

    async def scrape(self, url: str) -> IdentData:
        soup = await self.fetch_page(url)
        tag = soup.find("script", id="__NEXT_DATA__")
        if tag and tag.string:
            try:
                data = json.loads(tag.string)
                rel = (
                    data.get("props", {}).get("pageProps", {}).get("release")
                    or data.get("props", {}).get("pageProps", {}).get("data", {}).get("release")
                    or {}
                )
                if rel.get("name"):
                    artists = ", ".join(a.get("name", "") for a in rel.get("artists", [])) or "Unknown"
                    tracks = rel.get("track_count") or len(rel.get("tracks", [])) or None
                    tracklist = []
                    for i, t in enumerate(rel.get("tracks", []) or []):
                        if not isinstance(t, dict):
                            continue
                        t_artists = t.get("artists") or []
                        if isinstance(t_artists, list):
                            t_artist = ", ".join(a.get("name", "") if isinstance(a, dict) else str(a) for a in t_artists)
                        elif isinstance(t_artists, dict):
                            t_artist = str(t_artists.get("name", ""))
                        else:
                            t_artist = str(t_artists) if t_artists else ""
                        dur = t.get("length") or t.get("duration") or ""
                        tracklist.append({"pos": str(t.get("track_number") or t.get("position") or i + 1), "title": str(t.get("name") or t.get("title") or ""), "artist": t_artist, "duration": str(dur) if dur else ""})
                    cover = rel.get("image") or rel.get("artwork") or rel.get("picture")
                    if isinstance(cover, dict):
                        cover = cover.get("url")
                    cover_url = str(cover) if cover else None
                    lbl = rel.get("label")
                    if isinstance(lbl, dict):
                        lbl = lbl.get("name")
                    label = str(lbl) if lbl else None
                    raw_genre = rel.get("genres") or rel.get("genre")
                    genre = None
                    if isinstance(raw_genre, list):
                        genre = [g.get("name", "") if isinstance(g, dict) else str(g) for g in raw_genre]
                        genre = [g for g in genre if g] or None
                    elif isinstance(raw_genre, dict):
                        genre = [str(raw_genre.get("name", ""))] if raw_genre.get("name") else None
                    elif isinstance(raw_genre, str) and raw_genre:
                        genre = [raw_genre]
                    rid = rel.get("id")
                    return IdentData(
                        artist=artists, album=str(rel["name"]),
                        year=str(rel.get("release_date", ""))[:4] or None,
                        track_count=tracks, source=self.source,
                        tracklist=tracklist or None, cover_url=cover_url,
                        label=label, genre=genre,
                        release_id=str(rid) if rid else None,
                    )
            except (ValueError, KeyError, TypeError):
                pass
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            # "Release Name by Artist on Beatport" — best effort split
            title = og_title["content"].replace(" on Beatport", "")
            if " by " in title:
                album, _, artist = title.partition(" by ")
                return IdentData(artist=artist.strip(), album=album.strip(), year=None, track_count=None, source=self.source)
        raise ScrapeError("beatport: no release metadata found")
