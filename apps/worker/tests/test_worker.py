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
    for src in ("discogs", "bandcamp", "apple", "qobuz", "tidal", "musicbrainz", "deezer", "beatport"):
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


def test_mediainfo_traversal_blocked(client):
    for bad in ("/etc/passwd", "../../etc/passwd", "/data/../etc/passwd"):
        r = client.post("/mediainfo", json={"fileName": bad})
        assert r.status_code == 404, bad


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


def test_rename_traversal_blocked(client):
    for bad in ("/etc/passwd", "../../etc/passwd"):
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


def _make_wma(path, seconds=10):
    path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={seconds}",
         "-c:a", "wmav2", str(path)],
        capture_output=True, timeout=60,
    )
    assert r.returncode == 0, "ffmpeg wma synth failed"


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_audio_transcode_cold_and_warm(client, tmp_path, monkeypatch):
    """Sequential /audio wma hits: cold transcode 200, warm cache 200."""
    import app as worker_app

    tc_dir = tmp_path / "transcodes"
    monkeypatch.setattr(worker_app, "TRANSCODE_DIR", tc_dir)
    _make_wma(tmp_path / "data" / "downloads" / "t.wma")

    r1 = client.get("/audio", params={"file": "t.wma"})
    assert r1.status_code == 200, r1.text[:200]
    assert r1.headers["content-type"] == "audio/ogg"
    assert r1.content[:4] == b"OggS"
    assert len(r1.content) > 1000
    r2 = client.get("/audio", params={"file": "t.wma"})
    assert r2.status_code == 200
    assert r2.content == r1.content
    assert list(tc_dir.glob("*.tmp.opus")) == []


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_transcode_to_opus_concurrent_unique_tmp(tmp_path, monkeypatch):
    """Concurrent _transcode_to_opus calls must not share/clobber tmps.

    Regression test for the shared-tmp race: N parallel ffmpeg runs used to
    write one `<hash>.tmp.opus` (mutual truncation + loser-unlink-wins →
    None/422s or promoted corrupt files). Tmps are now unique per attempt, so
    every caller gets a valid output. Sync function — threads are safe here
    (no event loop involved, unlike TestClient).
    """
    import threading

    import app as worker_app

    tc_dir = tmp_path / "transcodes"
    monkeypatch.setattr(worker_app, "TRANSCODE_DIR", tc_dir)
    wma = tmp_path / "data" / "downloads" / "t.wma"
    _make_wma(wma)

    n = 4
    barrier = threading.Barrier(n)
    results: list = []
    errors: list[str] = []

    def run(i):
        try:
            barrier.wait(timeout=30)
            results.append(worker_app._transcode_to_opus(wma))
        except Exception as e:  # noqa: BLE001 — surfaced via assert below
            errors.append(f"thread {i}: {e!r}")

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=240)

    assert not errors, errors
    assert len(results) == n
    assert all(r is not None for r in results), "transcode returned None under concurrency"
    assert {str(r) for r in results} == {str(results[0])}, "divergent outputs"
    assert results[0].read_bytes()[:4] == b"OggS"
    assert list(tc_dir.glob("*.tmp.opus")) == []
    assert len(list(tc_dir.glob("*.opus"))) == 1


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_audio_transcode_singleflight(tmp_path, monkeypatch):
    """Concurrent ensure_opus calls coalesce onto a single ffmpeg run."""
    import asyncio

    import app as worker_app

    tc_dir = tmp_path / "transcodes"
    monkeypatch.setattr(worker_app, "TRANSCODE_DIR", tc_dir)
    wma = tmp_path / "data" / "downloads" / "t.wma"
    _make_wma(wma)

    calls: list[str] = []
    real_transcode = worker_app._transcode_to_opus

    def counting_transcode(src):
        calls.append(str(src))
        return real_transcode(src)

    monkeypatch.setattr(worker_app, "_transcode_to_opus", counting_transcode)

    async def run_all():
        return await asyncio.gather(*[worker_app.ensure_opus(wma) for _ in range(4)])

    results = asyncio.run(run_all())
    assert all(r is not None for r in results)
    assert {str(r) for r in results} == {str(results[0])}
    assert len(calls) == 1, f"expected 1 transcode, got {len(calls)}"
    assert list(tc_dir.glob("*.tmp.opus")) == []
    assert worker_app._sanitize_filename("   ") is None
