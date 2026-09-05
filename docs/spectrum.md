# Analyze Spectrum

> Right-click a **Finished** audio download on `/downloads` → **Analyze Spectrum**. The **worker** (`apps/worker`, FastAPI `:8789`) renders two PNG spectrograms with `sox` (`oxipng` recompress when present in the image — currently skipped, PNGs served raw) (own implementation; output semantics match the old bridge port of [`smoked-salmon`](https://github.com/smokin-salmon/smoked-salmon) `src/salmon/uploader/spectrals.py`, Apache-2.0) and the web shows them on hover / modal. Images live only in `/tmp/spectrals` (ephemeral `/tmp/spectrals`, no volume — regenerated on demand, wiped on reboot/restart).

## UX

1. **Trigger** — `/downloads` → `TransferCard` → right-click (`transferMenu` in `apps/web/src/lib/context-menu/menus.ts:118`) shows **Analyze Spectrum** iff `status==="Finished"` and `fileName` matches audio (`flac`, `wav`, `aiff`, `mp3`, `ogg`, `wma`, `m4a`, `wv`, … via `isAudioForSpectrum` in `apps/web/src/app/downloads/page.tsx:20`). Otherwise the entry is hidden (upload or non-audio / not finished).
2. **Generating** — card shows `Generating spectrum…` (pulse) while the worker works; errors show inline.
3. **Badge** — after the worker responds the card gains `SPECTRUM ✓` (`SpectrumHoverCard` in `apps/web/src/components/transfers/SpectrumHoverCard.tsx:1`) + hint `Hover to preview • Click for Full + Zoom`.
4. **Hover** — desktop (`hidden md:block`) shows a 400 px portal at cursor with **Full** `2000×513` thumbnail. Because the provider caches blob URLs (`URL.createObjectURL` in `apps/web/src/lib/spectrum.tsx:1`) + `ETag`, second hover is instant (no network).
5. **Modal** — clicking the card (or badge area) opens a fixed modal with two tabs: **Full (2000×513)** and **Zoom (500×1025, 0:02 slice)**. Each tab has a `Download` anchor (`download="…-Full.png"`). Mobile: tap card → bottom sheet (safe-area aware).
6. **Cache hint** — modal header notes `sox Kaiser • -z 120 • cached in /tmp (wiped on reboot)` and a tip about lossy cutoffs (~16 kHz).

## Worker pipeline (`apps/worker/spectrals.py` + `app.py`)

```
POST /spectrum/request {fileName, size?, token?} → resolve file → stat mtime/size → probe duration → sox → oxipng → /tmp/spectrals
```

* **Resolve file** — worker scans `DATA_DIR/downloads` by basename (containment-checked, `resolve().is_relative_to(DATA_DIR)`); never trusts a client-provided path. `404` when absent.
* **Duration** — `mutagen` length (existing worker dep); fallback `None` → `zoomStart=0`.
* **Zoom start** — `duration>5 ? floor(duration/2) : 0` (same knee as before).
* **sox** — single invocation with both outputs (same args as the old bridge):
  ```
  sox --multi-threaded <in> --buffer 128000 -n remix 1 spectrogram -x 2000 -y 513 -z 120 -w Kaiser -o <label>-<hash>-Full.png remix 1 spectrogram -x 500 -y 1025 -z 120 -w Kaiser -S <zoomStart> -d 0:02 -o <label>-<hash>-Zoom.png
  ```
  `label = token` when the web parsed it from `/files/:token`, else `f<sha1(fileName)[0..8]>`; `hash = sha256(label:mtimeMs:size)[0..16]`, `etag = "hash"`, paths `/tmp/spectrals/<label>-<hash>-{Full,Zoom}.png`.
* **oxipng** — `oxipng -o 2 --strip all <png>` per file, 15 s timeout, best-effort (if missing, just skips).
* **Concurrency** — `asyncio.Semaphore(2)`, queue, 90 s `sox` timeout, LRU prune when >100 files (delete oldest `mtime`).
* **Single-flight** — `_in_flight` map `label:hash → Task` dedupes concurrent requests for same file.

## HTTP (`apps/worker/app.py`, `WORKER_TOKEN` Bearer gated, `/health` open)

* `POST /spectrum/request {fileName, size?, token?}` → `{etag, hash, urls:{full,zoom}, fromCache}` (`422` non-audio, `404` missing).
* `GET /spectrum/{stem}/full` and `/zoom` — `If-None-Match` → `304`, else `200 image/png` with `ETag: "hash"`, `Cache-Control: private, max-age=3600`. `GET /spectrum/{stem}` returns `{etag, urls}` JSON.
* Bridge compat: `GET /spectrum/*` on the bridge returns `410 {error:"moved to worker…"}` and WS `spectrum:request|status` replies `spectrum:error` pointing at `:8789` (stale-bundle guard only).

## Web provider (`apps/web/src/lib/spectrum.tsx` + `apps/web/src/lib/worker.ts`)

* `SpectrumProvider` keeps `Map<id,SpectrumEntry>` (`status`, `etag`, `fullUrl`/`zoomUrl`, `fullBlobUrl`/`zoomBlobUrl`). No WS involved.
* `requestSpectrum(id, {fileName, size, token})` sets `queued`, `POST`s the worker, stores the result, then fetches both PNGs with `If-None-Match: etag` + `WORKER_TOKEN` Bearer, caching blob URLs for instant hover; revokes previous URLs.
* Worker base URL from `NEXT_PUBLIC_WORKER_URL` / `localStorage.nicotineHub.workerUrl` → `http://host:8789` (worktree: web `3001` → worker `8789`, `3002` → `8791`).

## Docker

`apps/worker/Dockerfile` (`python:3.11-slim`):

```dockerfile
RUN apt-get install -y sox flac ffmpeg curl && pip install -r requirements.txt
```

`compose.yaml` shares `data:/data` (worker reads finished downloads). The bridge image no longer installs audio tooling.

## Attribution

Output semantics match the old bridge port of `smokin-salmon/smoked-salmon` `src/salmon/uploader/spectrals.py` (Apache-2.0) — sox spectrogram + oxipng. Worker code is original. See `ATTRIBUTION.md:98` and `LICENSES/`.

## Testing

* `apps/worker/tests/test_worker.py` — health/sources, scrape validation + SSRF reject + auth, spectrum hash/zoom units, `404`/`422` paths, + `sox` end-to-end (synth wav → Full+Zoom PNGs, `304`, cache hit) and `tag`/`verify`/`analyze` on wav when `sox` present.
* Manual: place audio in `DATA_DIR/downloads`, finish it, right-click → Analyze → hover.
* Reboot wipe: `docker restart worker` → `GET /spectrum/{stem}/full` → `404` until re-analyzed.
