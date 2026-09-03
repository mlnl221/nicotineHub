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
    assert set(body["auth"]) == {"discogs", "tidal", "qobuz"}


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
    assert tokens.configured() == {"discogs": True, "tidal": True, "qobuz": False}
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
