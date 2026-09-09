"""Worker tests — hermetic (tmp DATA_DIR/SPECTRUM_DIR, no network, sox optional)."""

import os
import shutil
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app as worker_app
import spectrals
import tokens


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SPECTRUM_DIR", str(tmp_path / "spectra"))
    monkeypatch.setattr(worker_app, "worker_token", lambda: "")
    (tmp_path / "data" / "downloads").mkdir(parents=True)
    with TestClient(worker_app.app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    for src in ("discogs", "bandcamp", "apple", "qobuz", "tidal", "musicbrainz", "deezer"):
        assert src in body["sources"]
    assert set(body["auth"]) == {"discogs", "tidal", "qobuz", "media_scan"}


def test_tokens_env_wins_and_json_fallback(monkeypatch, tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / "worker.json").write_text('{"discogs_token": "from-json", "tidal_token": "t-json"}')
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
    monkeypatch.delenv("TIDAL_TOKEN", raising=False)
    tokens._cache, tokens._cache_mtime = {}, -1.0
    assert tokens.get("DISCOGS_TOKEN") == "from-json"
    monkeypatch.setenv("DISCOGS_TOKEN", "from-env")
    assert tokens.get("DISCOGS_TOKEN") == "from-env"
    assert tokens.configured() == {"discogs": True, "tidal": True, "qobuz": False, "media_scan": False}
    tokens._cache, tokens._cache_mtime = {}, -1.0


def test_scrape_rejects_non_url(client):
    r = client.post("/scrape", json={"url": "pink floyd animals"})
    assert r.status_code in (400, 422)


def test_scrape_rejects_unknown_host(client):
    r = client.post("/scrape", json={"url": "https://example.com/some/album/123"})
    assert r.status_code == 422


def test_scrape_rejects_ssrf(client):
    r = client.post("/scrape", json={"url": "http://127.0.0.1:8789/health"})
    assert r.status_code == 422


def _fake_discogs_21(monkeypatch):
    from sources.base import IdentData
    from sources.discogs import DiscogsScraper

    async def fake_scrape(self, url):
        return IdentData(
            artist="D.Kay", album="Bingo Sessions Volume 4", year=2005,
            track_count=21, source="discogs",
            tracklist=[
                {"pos": str(i + 1), "title": f"Track {i + 1}", "artist": "", "duration": ""}
                for i in range(21)
            ],
        )

    monkeypatch.setattr(DiscogsScraper, "scrape", fake_scrape)


def test_scrape_returns_tracklist(client, monkeypatch):
    _fake_discogs_21(monkeypatch)
    r = client.post("/scrape", json={"url": "https://www.discogs.com/release/1167407-D-Kay-Bingo-Sessions-Volume-4"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["tracklist"]) == 21
    assert body["tracklist"][1]["title"] == "Track 2"


def test_tag_scrape_track_index_preview(client, tmp_path, monkeypatch):
    _fake_discogs_21(monkeypatch)
    (tmp_path / "data" / "downloads" / "probe.mp3").write_bytes(b"x")
    url = "https://www.discogs.com/release/1167407-D-Kay-Bingo-Sessions-Volume-4"
    r = client.post("/tag/scrape", json={"fileName": "probe.mp3", "url": url, "apply": False, "trackIndex": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["suggested"]["title"] == "Track 2"
    assert body["suggested"]["tracknumber"] == "2"
    assert body["suggested"]["album"] == "Bingo Sessions Volume 4"
    assert len(body["tracklist"]) == 21
    # out of range
    r = client.post("/tag/scrape", json={"fileName": "probe.mp3", "url": url, "apply": False, "trackIndex": 21})
    assert r.status_code == 422
    # no index = release-level tags only
    r = client.post("/tag/scrape", json={"fileName": "probe.mp3", "url": url, "apply": False})
    assert r.status_code == 200, r.text
    assert "title" not in r.json()["suggested"]


def test_auth_enforced(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SPECTRUM_DIR", str(tmp_path))
    monkeypatch.setattr(worker_app, "worker_token", lambda: "secret")
    with TestClient(worker_app.app) as c:
        assert c.get("/health").status_code == 200  # open
        assert c.post("/scrape", json={"url": "https://x.com/"}).status_code == 401
        ok = c.post("/scrape", json={"url": "https://x.com/"}, headers={"Authorization": "Bearer secret"})
        assert ok.status_code == 422  # authed, but no scraper matches


def test_zoom_startpoint():
    assert spectrals.calculate_zoom_startpoint(None) == 0
    assert spectrals.calculate_zoom_startpoint(3) == 0
    assert spectrals.calculate_zoom_startpoint(100) == 50


def test_spectrum_hash_deterministic():
    h1 = spectrals.spectrum_hash("42", 1000.0, 999)
    assert h1 == spectrals.spectrum_hash("42", 1000.0, 999)
    assert len(h1) == 16
    assert spectrals.spectrum_hash("43", 1000.0, 999) != h1


def test_spectrum_rejects_non_audio(client):
    r = client.post("/spectrum/request", json={"fileName": "notes.txt"})
    assert r.status_code == 422


def test_spectrum_missing_file(client):
    r = client.post("/spectrum/request", json={"fileName": "ghost.flac", "size": 10})
    assert r.status_code == 404


def _make_wav(path, seconds=2):
    path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["sox", "-n", "-r", "44100", "-b", "16", str(path), "synth", str(seconds), "sine", "440"],
        capture_output=True, timeout=30,
    )
    assert r.returncode == 0, "sox synth failed"


@pytest.mark.skipif(not shutil.which("sox"), reason="sox not installed")
def test_spectrum_end_to_end(client, tmp_path):
    data = tmp_path / "data" / "downloads"
    wav = data / "sine.wav"
    _make_wav(wav)
    r = client.post("/spectrum/request", json={"fileName": "sine.wav", "token": 7})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fromCache"] is False
    full_url, zoom_url = body["urls"]["full"], body["urls"]["zoom"]
    for u in (full_url, zoom_url):
        img = client.get(u)
        assert img.status_code == 200
        assert img.headers["content-type"] == "image/png"
    etag = body["etag"]
    cached = client.get(full_url, headers={"If-None-Match": etag})
    assert cached.status_code == 304
    # second request is a cache hit
    r2 = client.post("/spectrum/request", json={"fileName": "sine.wav", "token": 7})
    assert r2.json()["fromCache"] is True


@pytest.mark.skipif(not shutil.which("sox"), reason="sox not installed")
def test_analyze_wav(client, tmp_path):
    wav = tmp_path / "data" / "downloads" / "tone.wav"
    _make_wav(wav)
    r = client.post("/analyze", json={"fileName": "tone.wav"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sampleRate"] == 44100
    assert body["bitDepth"] == 16


@pytest.mark.skipif(not shutil.which("sox"), reason="sox not installed")
def test_tag_and_verify_wav(client, tmp_path):
    wav = tmp_path / "data" / "downloads" / "plain.wav"
    _make_wav(wav)
    t = client.post("/tag", json={"fileName": "plain.wav"})
    assert t.status_code == 200, t.text
    assert t.json()["coverArtApplied"] is False
    v = client.post("/verify", json={"fileName": "plain.wav"})
    assert v.status_code == 200
    assert set(v.json()) == {"flacOk", "upconvert", "mqa", "logScore", "logChecksum", "durationMismatch"}


def test_scan_not_configured(client):
    r = client.post("/scan", json={"fileName": "track.flac", "size": 123, "username": "peer", "virtualPath": "Music\\track.flac", "transferId": "peer::Music\\track.flac", "downloadUrl": "/files/1"})
    assert r.status_code == 422
    assert "not configured" in r.text


def test_scan_validates_url(monkeypatch, tmp_path):
    client_tmp = tmp_path / "data"
    client_tmp.mkdir(parents=True)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SPECTRUM_DIR", str(tmp_path / "spectra"))
    monkeypatch.setenv("MEDIA_SCAN_URL", "ftp://example.com/hook")
    tokens._cache, tokens._cache_mtime = {}, -1.0
    monkeypatch.setattr(worker_app, "worker_token", lambda: "")
    with TestClient(worker_app.app) as c:
        r = c.post("/scan", json={"fileName": "track.flac"})
        assert r.status_code == 422
        assert "invalid" in r.text.lower()
    monkeypatch.delenv("MEDIA_SCAN_URL", raising=False)
    tokens._cache, tokens._cache_mtime = {}, -1.0


def test_mediainfo_missing_file(client):
    r = client.post("/mediainfo", json={"fileName": "ghost.flac"})
    assert r.status_code == 404


def test_mediainfo_no_allowlist(client, tmp_path):
    # absolute path anywhere on disk resolves (no roots gate)
    outside = tmp_path / "elsewhere" / "note.flac"
    outside.parent.mkdir(parents=True)
    outside.write_bytes(b"fake-flac")
    r = client.post("/mediainfo", json={"fileName": str(outside)})
    assert r.status_code != 404, r.text
    # nonexistent paths still 404 (relative escape + absolute miss)
    for bad in ("../../etc/passwd", "/definitely/not/here.flac"):
        r = client.post("/mediainfo", json={"fileName": bad})
        assert r.status_code == 404, bad


def test_any_mount_resolves_without_gate(monkeypatch, tmp_path):
    data = tmp_path / "data"
    media = tmp_path / "media"
    (data / "downloads").mkdir(parents=True)
    (media / "Orpheus").mkdir(parents=True)
    track = media / "Orpheus" / "song.flac"
    track.write_bytes(b"fake-flac")
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.setenv("SPECTRUM_DIR", str(tmp_path / "spectra"))
    monkeypatch.setattr(worker_app, "worker_token", lambda: "")
    # absolute path outside DATA_DIR resolves — no allowlist
    assert worker_app._resolve_any(str(track)) == track.resolve()
    with TestClient(worker_app.app) as c:
        r = c.post("/mediainfo", json={"fileName": str(track)})
        # file exists but is not valid audio — either 422 (parsed, unrecognized) or 500/200
        # depending on mediainfo presence; key assertion is NOT 404
        assert r.status_code != 404, r.text


def test_mediainfo_rejects_empty(client):
    r = client.post("/mediainfo", json={"fileName": ""})
    assert r.status_code in (400, 422)


@pytest.mark.skipif(not shutil.which("mediainfo"), reason="mediainfo not installed")
def test_mediainfo_wav(client, tmp_path):
    wav = tmp_path / "data" / "downloads" / "m tone.wav"
    _make_wav(wav, seconds=1)
    r = client.post("/mediainfo", json={"fileName": "m tone.wav"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fileName"] == "m tone.wav"
    assert isinstance(body["tracks"], list)
    assert body["tracks"], "no tracks"
    assert body["summary"]["format"] is not None
    assert "General" in body["raw"]
    # basename containment via alternative path also works
    r2 = client.post("/mediainfo", json={"fileName": str(wav)})
    assert r2.status_code == 200


def test_rename_happy(client, tmp_path):
    f = tmp_path / "data" / "downloads" / "orig.txt"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("hi")
    r = client.post("/rename", json={"fileName": "orig.txt", "newName": "renamed.txt"})
    assert r.status_code == 200, r.text
    assert r.json()["newPath"].endswith("renamed.txt")
    assert not f.exists()
    assert (tmp_path / "data" / "downloads" / "renamed.txt").exists()


def test_rename_collision_suffix(client, tmp_path):
    a = tmp_path / "data" / "downloads" / "a.txt"
    b = tmp_path / "data" / "downloads" / "b.txt"
    a.parent.mkdir(parents=True, exist_ok=True)
    a.write_text("a")
    b.write_text("b")
    # first rename a -> target.txt
    r1 = client.post("/rename", json={"fileName": "a.txt", "newName": "target.txt"})
    assert r1.status_code == 200
    # second rename b -> same target, should suffix
    r2 = client.post("/rename", json={"fileName": "b.txt", "newName": "target.txt"})
    assert r2.status_code == 200
    assert r2.json()["suffixed"] is True
    assert r2.json()["newPath"].endswith("target (2).txt")


def test_rename_invalid(client, tmp_path):
    f = tmp_path / "data" / "downloads" / "x.txt"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("x")
    for bad in ("", "a/b.txt", "a\\b.txt", "..", ".", "   "):
        r = client.post("/rename", json={"fileName": "x.txt", "newName": bad})
        assert r.status_code in (400, 422), bad


def test_rename_missing_file_404(client):
    for bad in ("/definitely/not/here.flac", "../../etc/passwd"):
        r = client.post("/rename", json={"fileName": bad, "newName": "ok.txt"})
        assert r.status_code == 404, bad


def test_rename_template_render():
    import app as worker_app
    assert worker_app._render_rename_template("{track}. {artist} - {title}", "3", "Pink Floyd", "Speak to Me") == "03. Pink Floyd - Speak to Me"
    assert worker_app._render_rename_template("{track} - {title}", "3/12", "A", "T") == "03 - T"
    # template without track should succeed even if track is None
    assert worker_app._render_rename_template("{artist} - {title}", None, "A", "T") == "A - T"
    assert worker_app._render_rename_template("{artist} - {title}", "", "A", "T") == "A - T"
    # missing title -> skip
    assert worker_app._render_rename_template("{track}. {artist} - {title}", "1", "A", "") is None
    # missing track when template needs it -> skip
    assert worker_app._render_rename_template("{track} - {title}", "", "A", "T") is None
    # unknown token
    assert worker_app._render_rename_template("{track} {foo}", "1", "A", "T") is None
    # slash in values -> dash
    assert "/" not in worker_app._render_rename_template("{artist} - {title}", "1", "A/B", "T/C")  # type: ignore


def test_sanitize_filename():
    import app as worker_app
    assert worker_app._sanitize_filename("  my file .txt  ") == "my file .txt"
    assert worker_app._sanitize_filename("a/b.txt") is None
    assert worker_app._sanitize_filename("") is None
    assert worker_app._sanitize_filename("   ") is None


def _fake_discogs_vinyl(monkeypatch):
    from sources.base import IdentData
    from sources.discogs import DiscogsScraper

    async def fake_scrape(self, url):
        return IdentData(
            artist="Test Artist", album="Vinyl LP", year=1977,
            track_count=2, source="discogs",
            tracklist=[
                {"pos": "A1", "title": "Side A Track", "artist": "", "duration": ""},
                {"pos": "B1", "title": "Side B Track", "artist": "", "duration": ""},
            ],
            catalog_no="ABC-123", country="UK", label="Test Label",
            release_id="999", cover_url="https://example.com/cover.jpg",
        )

    monkeypatch.setattr(DiscogsScraper, "scrape", fake_scrape)


def test_tag_scrape_vinyl_pos_verbatim(client, tmp_path, monkeypatch):
    _fake_discogs_vinyl(monkeypatch)
    (tmp_path / "data" / "downloads" / "vinyl.mp3").write_bytes(b"x")
    url = "https://www.discogs.com/release/999-Test-Artist-Vinyl-LP"
    r = client.post("/tag/scrape", json={"fileName": "vinyl.mp3", "url": url, "apply": False, "trackIndex": 0})
    assert r.status_code == 200, r.text
    suggested = r.json()["suggested"]
    assert suggested["tracknumber"] == "A1"
    assert suggested["publisher"] == "Test Label"
    assert suggested["catalognumber"] == "ABC-123"
    assert suggested["country"] == "UK"
    assert suggested["discogs_release_id"] == "999"


def _fake_discogs_full_meta(monkeypatch):
    from sources.base import IdentData
    from sources.discogs import DiscogsScraper

    async def fake_scrape(self, url):
        return IdentData(
            artist="Meta Artist", album="Meta Album", year=2001,
            track_count=1, source="discogs",
            tracklist=[{"pos": "1", "title": "Track 1", "artist": "", "duration": ""}],
            catalog_no="CAT-001", country="Germany", label="Meta Label",
            genre=["Electronic"], style=["Techno"], media_type="Vinyl (LP)",
            release_id="12345", cover_url="https://example.com/meta.jpg",
        )

    monkeypatch.setattr(DiscogsScraper, "scrape", fake_scrape)


def test_scrape_returns_meta(client, monkeypatch):
    _fake_discogs_full_meta(monkeypatch)
    r = client.post("/scrape", json={"url": "https://www.discogs.com/release/12345-Meta-Artist-Meta-Album"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["catalog_no"] == "CAT-001"
    assert body["country"] == "Germany"
    assert body["label"] == "Meta Label"
    assert body["media_type"] == "Vinyl (LP)"
    assert body["release_id"] == "12345"
    assert body["cover_url"] == "https://example.com/meta.jpg"


def _fake_discogs_no_cover(monkeypatch):
    from sources.base import IdentData
    from sources.discogs import DiscogsScraper

    async def fake_scrape(self, url):
        return IdentData(
            artist="No Cover Artist", album="No Cover Album", year=2010,
            track_count=1, source="discogs",
            tracklist=[{"pos": "1", "title": "Track 1", "artist": "", "duration": ""}],
            cover_url=None,
        )

    monkeypatch.setattr(DiscogsScraper, "scrape", fake_scrape)


def test_tag_cover_no_cover_422(client, tmp_path, monkeypatch):
    _fake_discogs_no_cover(monkeypatch)
    (tmp_path / "data" / "downloads" / "nocover.mp3").write_bytes(b"x")
    url = "https://www.discogs.com/release/777-No-Cover-Artist-No-Cover-Album"
    r = client.post("/tag/cover", json={"fileName": "nocover.mp3", "url": url})
    assert r.status_code == 422, r.text
    r = client.post("/tag/cover", json={"fileName": "ghost.mp3", "url": url})
    assert r.status_code == 404, r.text


import asyncio


def test_scrape_apple_canonical(monkeypatch):
    from sources.apple_music import AppleMusicScraper

    async def _fake(self, url, params=None, headers=None):
        return {"results": [
            {"wrapperType": "collection", "artistName": "Apple Artist", "collectionName": "Apple Album", "releaseDate": "2008-07-01T07:00:00Z", "trackCount": 2, "artworkUrl100": "https://example.com/art/100x100bb.jpg", "primaryGenreName": "Rock", "copyright": "Test", "collectionId": 123456789},
            {"wrapperType": "track", "trackNumber": 1, "trackName": "Song One", "artistName": "Apple Artist", "trackTimeMillis": 125000},
            {"wrapperType": "track", "trackNumber": 2, "trackName": "Song Two", "artistName": "Apple Artist", "trackTimeMillis": 61000},
        ]}

    monkeypatch.setattr(AppleMusicScraper, "get_json", _fake)
    found = asyncio.run(AppleMusicScraper().scrape("https://music.apple.com/us/album/test-album/123456789"))
    assert found.artist == "Apple Artist"
    assert found.album == "Apple Album"
    assert found.year == "2008"
    assert found.tracklist[0]["pos"] == "1"
    assert found.tracklist[0]["title"] == "Song One"
    assert ":" in found.tracklist[0]["duration"]
    assert found.cover_url == "https://example.com/art/1200x1200bb.jpg"
    assert found.genre == ["Rock"]
    assert found.release_id == "123456789"


def test_scrape_bandcamp_canonical(monkeypatch):
    from sources.bandcamp import BandcampScraper

    async def _fake(self, url):
        from bs4 import BeautifulSoup
        html = '<html><head><meta property="og:image" content="https://example.com/bc-og.jpg"/></head><body><script type="application/ld+json">{"@type": "MusicAlbum", "name": "BC Album", "byArtist": {"name": "BC Artist"}, "datePublished": "2015-03-10", "numTracks": 2, "image": "https://example.com/bc-cover.jpg", "recordLabel": {"name": "BC Label"}, "genre": "Electronic", "track": {"itemListElement": [{"position": 1, "item": {"name": "BC One", "byArtist": {"name": "BC Artist"}, "duration": "PT4M5S"}}, {"position": 2, "item": {"name": "BC Two", "byArtist": {"name": "BC Artist"}, "duration": ""}}]}}</script></body></html>'
        return BeautifulSoup(html, "lxml")

    monkeypatch.setattr(BandcampScraper, "fetch_page", _fake)
    found = asyncio.run(BandcampScraper().scrape("https://artist.bandcamp.com/album/test-album"))
    assert found.artist == "BC Artist"
    assert found.album == "BC Album"
    assert found.year == "2015"
    assert found.tracklist[0]["pos"] == "1"
    assert found.tracklist[0]["title"] == "BC One"
    assert found.tracklist[0]["duration"] == "4:05"
    assert found.cover_url == "https://example.com/bc-cover.jpg"
    assert found.label == "BC Label"
    assert found.genre == ["Electronic"]


def test_scrape_deezer_canonical(monkeypatch):
    from sources.deezer import DeezerScraper

    async def _fake(self, url, params=None, headers=None):
        return {"id": 98765, "title": "Deezer Album", "release_date": "2010-05-17", "nb_tracks": 2, "artist": {"name": "Deezer Artist"}, "tracks": {"data": [{"track_position": 1, "title": "DZ One", "artist": {"name": "DZ Artist"}, "duration": 245}, {"track_position": 2, "title": "DZ Two", "artist": {"name": "DZ Artist"}, "duration": 61}]}, "cover_xl": "https://example.com/dz.jpg", "label": "DZ Label", "genres": {"data": [{"name": "Pop"}]}}

    monkeypatch.setattr(DeezerScraper, "get_json", _fake)
    found = asyncio.run(DeezerScraper().scrape("https://www.deezer.com/us/album/98765"))
    assert found.artist == "Deezer Artist"
    assert found.album == "Deezer Album"
    assert found.year == "2010"
    assert found.tracklist[0]["pos"] == "1"
    assert found.tracklist[0]["title"] == "DZ One"
    assert found.tracklist[0]["duration"] == "4:05"
    assert found.tracklist[1]["duration"] == "1:01"
    assert found.cover_url == "https://example.com/dz.jpg"
    assert found.genre == ["Pop"]
    assert found.release_id == "98765"


def test_scrape_beatport_disabled(client):
    r = client.post("/scrape", json={"url": "https://www.beatport.com/release/test-release/555"})
    assert r.status_code == 422


def test_scrape_musicbrainz_canonical(monkeypatch):
    from sources.musicbrainz import MusicBrainzScraper

    async def _fake(self, url, params=None, headers=None):
        return {"title": "MB Album", "artist-credit-phrase": "MB Artist", "date": "2008-07-01", "country": "US", "media": [{"tracks": [{"number": "1", "title": "MB One", "artist-credit": [{"name": "MB Artist"}], "length": 185000}, {"number": "2", "title": "MB Two", "artist-credit": [{"name": "MB Artist"}], "length": 60000}]}], "label-info": [{"label": {"name": "MB Label"}}]}

    monkeypatch.setattr(MusicBrainzScraper, "get_json", _fake)
    found = asyncio.run(MusicBrainzScraper().scrape("https://musicbrainz.org/release/11111111-2222-3333-4444-555555555555"))
    assert found.artist == "MB Artist"
    assert found.album == "MB Album"
    assert found.year == "2008"
    assert found.tracklist[0]["pos"] == "1"
    assert found.tracklist[0]["title"] == "MB One"
    assert ":" in found.tracklist[0]["duration"]
    assert found.cover_url == "https://coverartarchive.org/release/11111111-2222-3333-4444-555555555555/front"
    assert found.label == "MB Label"
    assert found.release_id == "11111111-2222-3333-4444-555555555555"


def test_scrape_qobuz_canonical(monkeypatch):
    from sources.qobuz import QobuzScraper

    monkeypatch.setenv("QOBUZ_APP_ID", "test-app")

    async def _fake(self, url, params=None, headers=None):
        return {"id": "qobuz123", "title": "Qobuz Album", "release_date_original": "2008-07-01", "tracks_count": 2, "artist": {"name": "Qobuz Artist"}, "tracks": {"items": [{"track_number": 1, "title": "Q One", "performer": {"name": "Q Artist"}, "duration": 245}, {"track_number": 2, "title": "Q Two", "performer": {"name": "Q Artist"}, "duration": 61}]}, "image": {"large": "https://example.com/qob.jpg"}, "label": {"name": "Q Label"}, "genres": {"list": [{"name": "Jazz"}]}}

    monkeypatch.setattr(QobuzScraper, "get_json", _fake)
    found = asyncio.run(QobuzScraper().scrape("https://www.qobuz.com/us-en/album/qobuz-album/qobuz123"))
    assert found.artist == "Qobuz Artist"
    assert found.album == "Qobuz Album"
    assert found.year == "2008"
    assert found.tracklist[0]["pos"] == "1"
    assert found.tracklist[0]["title"] == "Q One"
    assert found.tracklist[0]["duration"] == "4:05"
    assert found.cover_url == "https://example.com/qob.jpg"
    assert found.genre == ["Jazz"]
    assert found.release_id == "qobuz123"


def test_scrape_tidal_canonical(monkeypatch):
    from sources.tidal import TidalScraper

    monkeypatch.setenv("TIDAL_TOKEN", "test-token")

    async def _fake(self, url, params=None, headers=None):
        if "/tracks" in url:
            return {"items": [{"trackNumber": 1, "title": "T One", "artists": [{"name": "T Artist"}], "duration": 245}, {"trackNumber": 2, "title": "T Two", "artists": [{"name": "T Artist"}], "duration": 61}]}
        return {"id": 11223, "title": "Tidal Album", "releaseDate": "2020-01-02", "numberOfTracks": 2, "artists": [{"name": "Tidal Artist"}], "cover": "abcdef12-3456-7890-abcd-ef1234567890", "recordLabel": "Tidal Label", "genre": "Hip Hop"}

    monkeypatch.setattr(TidalScraper, "get_json", _fake)
    found = asyncio.run(TidalScraper().scrape("https://listen.tidal.com/album/11223"))
    assert found.artist == "Tidal Artist"
    assert found.album == "Tidal Album"
    assert found.year == "2020"
    assert found.tracklist[0]["pos"] == "1"
    assert found.tracklist[0]["title"] == "T One"
    assert found.tracklist[0]["duration"] == "4:05"
    assert found.cover_url.startswith("https://resources.tidal.com/images/")
    assert found.genre == ["Hip Hop"]
    assert found.release_id == "11223"


def test_ident_coercion_and_deezer_tag_key(client, tmp_path, monkeypatch):
    from sources.base import IdentData
    from sources.deezer import DeezerScraper

    coerced = IdentData(artist="A", album="B", year="2008-07-01", track_count=1, source="x", genre="Rock", cover_url="https://example.com/c.jpg", tracklist=[{"pos": "1", "title": "T", "artist": "", "duration": 125}])
    assert coerced.genre == ["Rock"]
    assert coerced.year == "2008"
    assert coerced.tracklist[0]["duration"] == "2:05"

    async def _fake(self, url):
        return IdentData(artist="DZ Artist", album="DZ Album", year=2010, track_count=1, source="deezer", tracklist=[{"pos": "1", "title": "DZ Track", "artist": "", "duration": ""}], release_id="98765", cover_url="https://example.com/dz.jpg")

    monkeypatch.setattr(DeezerScraper, "scrape", _fake)
    (tmp_path / "data" / "downloads" / "dz.mp3").write_bytes(b"x")
    r = client.post("/tag/scrape", json={"fileName": "dz.mp3", "url": "https://www.deezer.com/us/album/98765", "apply": False})
    assert r.status_code == 200, r.text
    assert r.json()["suggested"]["deezer_release_id"] == "98765"


def _make_flac(path, seconds=2):
    wav = path.with_suffix(".wav")
    _make_wav(wav, seconds=seconds)
    r = subprocess.run(["flac", "-s", "-f", "-o", str(path), str(wav)], capture_output=True, timeout=60)
    assert r.returncode == 0, "flac encode failed"


def test_tag_rename_preview_renders(client, tmp_path):
    p = tmp_path / "data" / "downloads" / "song.flac"
    _make_flac(p)
    w = client.post("/tag/write", json={"fileName": "song.flac", "tags": {"title": "Speak to Me", "artist": "Pink Floyd", "tracknumber": "3"}})
    assert w.status_code == 200, w.text
    r = client.post("/tag/rename-preview", json={"files": ["song.flac"], "template": "{track}. {artist} - {title}"})
    assert r.status_code == 200, r.text
    row = r.json()["results"][0]
    assert row["newName"] == "03. Pink Floyd - Speak to Me.flac"


def test_tag_rename_preview_skips_missing_title(client, tmp_path):
    p = tmp_path / "data" / "downloads" / "notitle.flac"
    _make_flac(p)
    w = client.post("/tag/write", json={"fileName": "notitle.flac", "tags": {"artist": "A", "tracknumber": "1"}})
    assert w.status_code == 200, w.text
    r = client.post("/tag/rename-preview", json={"files": ["notitle.flac"], "template": "{track}. {artist} - {title}"})
    assert r.status_code == 200, r.text
    row = r.json()["results"][0]
    assert row["newName"] is None
    assert "missing" in str(row.get("skipped") or row.get("reason") or "").lower()


def test_tag_rename_preview_invalid(client):
    r = client.post("/tag/rename-preview", json={"files": ["song.mp3"], "template": "{foo}"})
    assert r.status_code == 422
    r = client.post("/tag/rename-preview", json={"files": [], "template": "{title}"})
    assert r.status_code == 422
