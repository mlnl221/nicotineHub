# Worker Service Plan — Python FastAPI for heavy lifting (scrape, tag, spectrum)

> **Status:** Plan — no code yet. Extracted from `r_soulseek_improvement_plan.md` on 2026-09-03 per architectural split request.
> **Parent plan:** `docs/improvements/r_soulseek_improvement_plan.md` (Full P0–P2, worker = P1/P2 heavy ops).
> **Guide, not copy:** Use `~/projects/smoked-salmon/src/salmon/` (`sources/base.py:26` `BaseScraper`, `search/base.py:16` `IdentData`, `uploader/spectrals.py`, `tagger/`, `checks/`, `pyproject.toml:8`) as **design guide only**. **Implement all own code** — do not import or copy smoked-salmon code (own GPL-3.0).
> **Docs to update:** `docs/architecture.md` (add `## Worker` section), `README.md` (update diagram), `compose.yaml` (add service), `AGENTS.md` (worktree ports for 8789).
> **Bridge principle:** `apps/bridge` stays **SLSK-only** (`server.slsknet.org:2242` TCP + `P/F/D` leaf + `ws://:8787/ws` + `/health` + `/files/:token`). No `fetch()` egress, no `sox`/`ffmpeg`/`oxipng` after migration. See `docs/architecture.md:5`.

---

## 0. Goal

Isolate CPU/IO heavy work from SLSK event loop (`network-audit.md:11` N2 inflate bomb, `server.ts:451` diag flood) into a separate Python service `apps/worker` (FastAPI + uvicorn, python:3.11-slim) that:

- **Scrapes** Discogs/Bandcamp/Apple/Qobuz/Tidal/MusicBrainz/Deezer/Beatport URLs into `IdentData(artist, album, year, track_count, source)` for search.
- **Generates spectra** Full 2000×513 + Zoom 500×1025 (`sox -z 120 Kaiser`, `ffmpeg` transcode, `oxipng -o 2`).
- **Tags/verifies/analyzes** (future, same service) via own `mutagen`/`musicbrainzngs`/`pillow`/`numpy`/`av` logic.

Existing r/Soulseek evidence that motivates this split: `1vzc2al` 61/29 *Mac client — paste Discogs link*, `1fwli2j` 176/24 *Spotify webclient*, `1ufawq3` 112/83 *fake lossless*, `1t3r1sl` 29/42 cutoffs, `1jov01f` 12/56. See parent plan `r_soulseek_improvement_plan.md:103` / `152` / `175`.

---

## 1. Architecture

```
[ Browser (Next.js PWA) ] --WS JSON--> [ bridge:8788 SLSK only ] --TCP--> server.slsknet.org:2242
        |              \--HTTP--> [ worker:8789 FastAPI ] --HTTP--> Discogs/Bandcamp/Apple/Qobuz/Tidal/Deezer/Beatport
        |                              sox/flac/ffmpeg/oxipng/numpy/mutagen/pillow
        |                            \--volume--> bridge-data:/data (RO) + /tmp/hub-spectrum (RW shared)
        \--HTTP--> bridge GET /files/:token (finished downloads, Content-Disposition sanitized per security.md:C4)
compose.yaml: web:3001 + bridge:8788/60755 + worker:8789
worktree triplet per AGENTS.md:worktree ports → 3001/8788/8789, 3002/8789/8790, …
env: BRIDGE_TOKEN (bridge+web), WORKER_TOKEN (web→worker, same or HMAC), SCRAPER_TOKENS (Discogs/Qobuz/Tidal via DATA_DIR/worker.json or env)
```

**Choice:** Bridge never `fetch()`s external URLs after this; web calls worker directly via `NEXT_PUBLIC_WORKER_URL` (single `WORKER_TOKEN` auth). Alternative bridge `POST /api/scrape` → worker proxy is kept as option if CORS prefer single origin, but direct is cleaner per your “keep bridge clean”.

---

## 2. Worker endpoints (own implementation, not smoked-salmon copy)

Implement `apps/worker/app.py` (FastAPI) + `pyproject.toml` (`fastapi`, `uvicorn`, `aiohttp[speedups]`, `beautifulsoup4[lxml]`, `msgspec[toml]`, `aiolimiter`, `musicbrainzngs`, `mutagen`, `pillow`, `numpy`, `pyoxipng`, `av`, `anyio`, `tenacity`), own `sources/` hierarchy guided by `sources/base.py:26` pattern:

- `GET /health` and `GET /health?json` → `{ok, ts, uptime, version, sources: [discogs,bandcamp,apple,qobuz,tidal,musicbrainz,deezer,beatport], queueDepth}` for `compose.yaml:healthcheck` + `apps/web Diagnostics` (mirrors `bridge GET /health` gated on `BRIDGE_TOKEN` per `server.ts:400`).
- `POST /scrape {url}` → `{artist, album, year, track_count, query, source, confidence, url}` — own `BaseScraper` (`regex`, `release_format`, `get_params`, `handle_json_response`, `get_json` with 10s timeout + `ScrapeError`, `fetch_page` → `BeautifulSoup` `lxml`) per `sources/base.py:26` + `search/base.py:16` `IdentData`. Handles `discogs.com/release/(\d+)` (`discogs.py:14`), `bandcamp.com/(album|track)/`, `music.apple.com/album/`, `qobuz.com/album/`, `tidal.com/album/` etc. `UAGENTS` random, cache 5m, SSRF private-IP reject (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`) per `security.md:36` C5. Do not shell `exec*`.

- `POST /spectrum/request {token, fileName, size, mtimeMs, filePath?}` → `{etag, hash, urls: {full, zoom}, fromCache}` and `GET /spectrum/{token}/full|zoom` → `image/png` (`ETag="hash"`, `private, max-age=3600`, `If-None-Match` → 304) and `GET /spectrum/{token}` → `{etag, urls}` JSON. Own `sox` wrapper (same args as `apps/bridge/src/spectrum.ts:87` `runSox`: `--multi-threaded <in> --buffer 128000 -n remix 1 spectrogram -x 2000 -y 513 -z 120 -w Kaiser -o Full.png remix 1 spectrogram -x 500 -y 1025 -z 120 -w Kaiser -S <zoomStart> -d 0:02 -o Zoom.png`, `zoomStart = duration>5 ? floor(duration/2) : 0` (`spectrum.ts:19`), `ffmpeg` pre-transcode for `mp3/m4a/aac` via `tmp .wav`, `oxipng -o 2 --strip all` best-effort 15s, `semaphore(2)` + 90s `sox` kill + LRU prune >100 files at `/tmp/hub-spectrum`). Hash `sha256(token:mtimeMs:size)[0..16]` (`spectrum.ts:24`). Reads from shared `/data/downloads` RO; worker never trusts bridge-provided `filePath` without `basename` + `resolve` containment (`security.md:C2`).

- `POST /tag {token}` → `{tags, coverArtApplied, tracklist}` — own tagging guided by `src/salmon/tagger/` + `src/salmon/images/` (`pillow`, `pycambia`, `pyimgbox`, `musicbrainzngs` `get_release_by_id` with `["artists","labels","recordings","release-groups","media"]` per `musicbrainz.py:9`), not copied. Writes ID3/Vorbis via `mutagen` if `DATA_DIR` writable, else returns suggested tags for preview.

- `POST /verify {token}` → `{flacOk, upconvert, mqa, logScore, logChecksum, durationMismatch}` — own checks guided by `src/salmon/checks/` (`flac -t`, `mp3val`, `pycambia` log parser), not copied.

- `POST /analyze {token}` → `{bitrate, vbr, sampleRate, bitDepth, cutoffHz, likelyTranscode, confidence}` — own `numpy` spectrogram cutoff + `av` decode, extends P2 `VBR/320` badge (`apps/web filter.ts`, `apps/bridge shares.ts music-metadata` attrs `0/1/4/5`).

All worker routes validate Bearer `WORKER_TOKEN` via `crypto.timingSafeEqual` style (Python `hmac.compare_digest`), 1 MB JSON cap, `perMessageDeflate` disabled.

---

## 3. What moves from bridge/web to worker (cleanup checklist)

| Current location | Action | Own destination (do not copy) | Reason |
|---|---|---|---|
| `apps/bridge/src/spectrum.ts:1` 334 lines (`SPECTRUM_DIR`, `SpectrumManager`, `runSox --multi-threaded … -x 2000 -y 513 -z 120`, `transcodeToWav ffmpeg`, `compressPng oxipng`) | **Delete** | `apps/worker/spectrals.py` **own reimplementation guided by `src/salmon/uploader/spectrals.py`** + `apps/worker/app.py` `POST /spectrum` | Offload CPU from SLSK loop; bridge slims ~400 lines. See `docs/architecture.md:80`. |
| `apps/bridge/src/spectrum.test.ts:4` (`SPECTRUM_DIR /tmp/hub-spectrum`, `calculateZoomStartpoint`, `spectrumManager.ensureSpectrum`) | **Delete / move** | `apps/worker/tests/test_spectrals.py` own pytest (`sox` mock) | Tests follow code; no `sox` in `oven/bun:1.4-alpine`. |
| `apps/bridge/src/server.ts:192` `SpectrumRequestSchema` + `server.ts:720` `GET /spectrum/:token/full\|zoom` + `GET /api/spectrum/:token` + `server.ts:1509` `spectrum:request|status` WS handlers | **Delete / thin proxy** | Worker `GET /spectrum/{token}/full\|zoom`, `POST /spectrum/request` own | Bridge becomes proxy if needed `fetch(http://worker:8789/spectrum/…)` forward, else web calls worker directly. Keeps single `BRIDGE_TOKEN` auth option. |
| `apps/bridge/src/transfers.ts:1489` spectrum stub + `1515` synth valid audio for `sox` | **Delete / shrink** | Worker reads `DATA_DIR/downloads` directly (own synth if no source) | Bridge only finds `basename` + `resolve` path, worker does valid-audio synth. |
| `apps/bridge/Dockerfile:62` `RUN apk add --no-cache sox flac ffmpeg oxipng && mkdir -p /tmp/hub-spectrum && chmod 777 /tmp/hub-spectrum` | **Delete** | `apps/worker/Dockerfile` `FROM python:3.11-slim` `RUN apk add --no-cache sox flac ffmpeg oxipng` + `pip install pyoxipng av numpy pillow mutagen musicbrainzngs beautifulsoup4[lxml] msgspec aiohttp[speedups] aiolimiter` | Bridge image loses ~80 MB, stays `oven/bun:1.4-alpine` minimal (`security.md:42` + `network-audit.md:7`). |
| `apps/web/src/lib/linkParser.ts` (planned client regex for Discogs/Bandcamp, previously P1 client-only) | **Delete** | Own `apps/worker/sources/discogs.py`/`bandcamp.py`/`apple_music.py`/`qobuz.py`/`tidal.py`/`musicbrainz.py`/`deezer.py`/`beatport.py` reimplemented from scratch guided by `regex`+`release_format`+`get_json` pattern, **not copied** | Real `fetch` + `BeautifulSoup` vs lossy `split('-')` slug; web never imports `beautifulsoup4`. |
| `apps/web/src/lib/spectrum.tsx:32` `bridgeHttpBase()` + `90` `fetchAndCache` `fetch(${base}/spectrum/…)` via bridge + `buildUrl` `?token=` | **Update** | `workerHttpBase()` via `NEXT_PUBLIC_WORKER_URL` (or bridge proxy `WORKER_URL` env) + `WORKER_TOKEN` Bearer header | Point PNG fetch at worker `GET /spectrum/{token}/full` with `If-None-Match` `ETag`. Keep revoke `URL.createObjectURL` cleanup. |
| `apps/web/src/lib/tagger.ts` / `apps/web/src/components/tag/*` (if anyone added) | **Do not add** | Worker `POST /tag` own | Keep web thin, avoid `mutagen` in browser. |
| `apps/bridge/src/tagger.ts` / `apps/bridge/src/upconvert.ts` (if added) | **Do not add** | Worker `POST /analyze` / `POST /verify` own (`numpy`/`av`) | Heavy stays Python. |
| `apps/web/src/lib/worker.ts` (new) | **Add thin helper** | — | `export async function scrape(url:string){ return fetch(WORKER_URL+"/scrape",{method:"POST",headers:{Authorization:`Bearer ${WORKER_TOKEN}`, "Content-Type":"application/json"}, body:JSON.stringify({url})}).then(r=>r.json()) }` — web never imports `beautifulsoup4` or `aiohttp`. |

**Net:** ~400 lines removed from bridge, ~200 lines FastAPI shim + own `sources/` reimplemented (guide `~500` lines in smoked-salmon, but own GPL-3.0). Bridge `oven/bun:1.4-alpine` minimal; worker `python:3.11-slim` with `sox/flac/ffmpeg/oxipng`. Update `docs/architecture.md:80` `SpectrumManager` line to note moved, and add new `## Worker` section.

---

## 4. Implementation phases

| Phase | Scope | Verify |
|---|---|---|
| **0 — Worker scaffold** | `apps/worker/` `app.py` (FastAPI) + `Dockerfile` (python:3.11-slim, `sox flac ffmpeg oxipng`, `pip install fastapi uvicorn[standard] aiohttp[speedups] beautifulsoup4[lxml] msgspec aiolimiter musicbrainzngs mutagen pillow numpy pyoxipng av tqdm`) + own `sources/base.py` + per-source scrapers (`discogs`/`bandcamp`/`apple`/`qobuz`/`tidal`/`musicbrainz`/`deezer`/`beatport`) **reimplemented guided by `~/projects/smoked-salmon/src/salmon/sources/base.py:26` (do not copy)** + `GET /health` + `POST /scrape` + `compose.yaml` add `worker:8789` (web:3001+bridge:8788/60755+worker:8789), `bridge-data:/data:ro` + `spectrum-cache:/tmp/hub-spectrum` shared volume + `healthcheck: CMD curl -f http://localhost:8789/health` | `docker compose up --build worker` → `curl -sf http://localhost:8789/health?json \| jq .sources` → `[discogs,bandcamp,apple,qobuz,tidal,musicbrainz]` |
| **F — Migrate spectrum to worker** | Delete bridge `spectrum.ts`/`spectrum.test.ts`/`server.ts:192,720,1509`/`transfers.ts:1489`/`Dockerfile:62` apk; add worker `POST /spectrum/request` + `GET /spectrum/{token}/full\|zoom``; update `apps/web/src/lib/spectrum.tsx:32` `bridgeHttpBase()`→`workerHttpBase()` (or bridge proxy) and `compose.yaml:bridge-data` RO | Finished flac → `Analyze Spectrum` → worker `Full`+`Zoom` PNGs, bridge `ps aux | grep sox` empty, `bun test` no spectrum import |
| **G — Tag/verify/analyze (opt)** | Worker `POST /tag`/`/verify`/`/analyze` own (`src/salmon/tagger/`/`checks/` guides) | `curl -X POST http://localhost:8789/verify -H "Authorization: Bearer $WORKER_TOKEN" -d '{"token":123}' \| jq .flacOk` |

Phases **A–E, H** stay in parent plan `r_soulseek_improvement_plan.md:201` (share safety, ProveIt, wildcard, webhook, HoneyPot). Worker phases run parallel or before F.

Each phase: `git worktree add ../nicotine_mobile-feat_worker -b feat/worker stage && bun test && bun run build && docker compose up --build worker --health` per `AGENTS.md:worktree ports` (`PORT=8789` + `LISTEN_PORT` offset). After worker lands, update `docs/architecture.md:5` Bridge diagram + new `## Worker` section + `docs/improvements/r_soulseek_improvement_plan.md` cross-link to this doc.

---

## 5. Docs to update (required per split)

- **`docs/architecture.md`** — add `## Worker` after `## Tests` (107→ new): FastAPI endpoints, shared volumes `/data` RO + `/tmp/hub-spectrum`, auth `WORKER_TOKEN`, `GET /health`/`POST /scrape`/`POST /spectrum`/`POST /tag`/`POST /verify`, keep Bridge `## Bridge files` `spectrum.ts` line marked *migrated to worker* + new `## Worker files` list.
- **`README.md`** — update `compose.yaml — web:3000 + bridge:8787/60754 → bridge-data:/data` line to `web:3000 + bridge:8787/60754 + worker:8789 → … + spectrum-cache` + add “Worker (scrape/spectrum)” bullet under Features.
- **`compose.yaml`** — add `worker:` service (build `apps/worker/Dockerfile`, `ports: ["8789:8789"]`, `volumes: [bridge-data:/data:ro, spectrum-cache:/tmp/hub-spectrum]`, `healthcheck: curl -f http://localhost:8789/health`, `environment: WORKER_TOKEN, SCRAPER_TOKENS, DATA_DIR`).
- **`AGENTS.md`** — extend Worktrees triplet example to `web:3001 + bridge:8788 + worker:8789` vs `web:3000 + bridge:8787 + worker:8789`.
- **`docs/improvements/r_soulseek_improvement_plan.md`** — replace inlined worker deep-dives (`0.1`, `3.3`, `3.5`, `3.6`, `5`) with pointers to this doc; keep summary table row `P1 scrape → worker`.

---

## 6. Not building (carry from parent)

- Full Spotify→Soulseek sync / Lidarr shim `1mdaobf`/`1tnbh45` separate containers; community blocklist auto-sync `1tipagj:25`; native iOS `1rkop84`; `YT-rip → FLAC` (warn via `POST /analyze`). See `r_soulseek_improvement_plan.md:240`.

---

## 7. Open decisions (worker-specific)

1. Web→worker **direct** (`NEXT_PUBLIC_WORKER_URL`, `WORKER_TOKEN` Bearer) vs bridge `POST /api/scrape` proxy (single `BRIDGE_TOKEN`) — default direct for clean split.
2. `SCRAPER_TOKENS` — per-service `DATA_DIR/worker.json` vs env `DISCOGS_TOKEN` etc. — env first.
3. Spectrum volume — `tmpfs` vs named `spectrum-cache:/tmp/hub-spectrum` (ephemeral OK per `docs/spectrum.md:8` `/tmp` wiped on restart).

---

*Next: start Phase 0 worker scaffold — `mkdir -p apps/worker/sources && implement apps/worker/app.py + sources/base.py guided by ~/projects/smoked-salmon/src/salmon/sources/base.py:26 (do not copy) && rm apps/bridge/src/spectrum.ts && docker compose up --build worker`*
