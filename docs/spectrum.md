# Analyze Spectrum

> Right-click a **Finished** audio download on `/downloads` → **Analyze Spectrum**. Bridge renders two PNG spectrograms with `sox` + `oxipng` (port of [`smoked-salmon`](https://github.com/smokin-salmon/smoked-salmon) `src/salmon/uploader/spectrals.py`, Apache-2.0) and the web shows them on hover / modal. Images live only in `/tmp/hub-spectrum` inside the bridge container — wiped on reboot.

## UX

1. **Trigger** — `/downloads` → `TransferCard` → right-click (`transferMenu` in `apps/web/src/lib/context-menu/menus.ts:118`) shows **Analyze Spectrum** iff `status==="Finished"` and `fileName` matches audio (`flac`, `wav`, `aiff`, `mp3`, `ogg`, `wma`, `m4a`, `wv`, … via `isAudioForSpectrum` in `apps/web/src/app/downloads/page.tsx:20`). Otherwise the entry is hidden (upload or non-audio / not finished).
2. **Generating** — card shows `Generating spectrum…` (pulse) while bridge works; `spectrum:error` shows inline.
3. **Badge** — after `spectrum:ready` the card gains `SPECTRUM ✓` (`SpectrumHoverCard` in `apps/web/src/components/transfers/SpectrumHoverCard.tsx:1`) + hint `Hover to preview • Click for Full + Zoom`.
4. **Hover** — desktop (`hidden md:block`) shows a 400 px portal at cursor with **Full** `2000×513` thumbnail. Because the provider caches blob URLs (`URL.createObjectURL` in `apps/web/src/lib/spectrum.tsx:1`) + `ETag`, second hover is instant (no network).
5. **Modal** — clicking the card (or badge area) opens a fixed modal with two tabs: **Full (2000×513)** and **Zoom (500×1025, 0:02 slice)**. Each tab has a `Download` anchor (`download="…-Full.png"`). Mobile: tap card → bottom sheet (safe-area aware).
6. **Cache hint** — modal header notes `sox Kaiser • -z 120 • cached in /tmp (wiped on reboot)` and a tip about lossy cutoffs (~16 kHz).

## Bridge pipeline (`apps/bridge/src/spectrum.ts:1`)

```
WS spectrum:request {id} → resolve file → stat mtime/size → probe duration → sox → oxipng → /tmp
```

* **Resolve file** — `TransferManager.getFilePathForToken(token)` (like `GET /files/:token` at `apps/bridge/src/server.ts:604`) + fallback scan of `DATA_DIR/downloads/<safeName>`. Rejects if `status!=="Finished"`.
* **Duration** — `music-metadata` `parseFile(path,{duration:true})` (existing dep at `apps/bridge/package.json:17`); fallback `undefined` → `zoomStart=0`.
* **Zoom start** — `calculateZoomStartpoint(duration) => duration>5 ? floor(duration/2) : 0` (same as salmon’s `calculate_zoom_startpoint` at `smoked-salmon/src/salmon/uploader/spectrals.py:320`).
* **sox** — single invocation with both outputs:
  ```
  sox --multi-threaded <in> --buffer 128000 -n remix 1 spectrogram -x 2000 -y 513 -z 120 -w Kaiser -o <token>-<hash>-Full.png remix 1 spectrogram -x 500 -y 1025 -z 120 -w Kaiser -S <zoomStart> -d 0:02 -o <token>-<hash>-Zoom.png
  ```
  `hash = sha256(token:mtimeMs:size)[0..16]`, `etag = "hash"`, paths `/tmp/hub-spectrum/<token>-<hash>-{Full,Zoom}.png` + `.json` sidecar.
* **oxipng** — `oxipng -o 2 --strip all <png>` per file, 15 s timeout, best-effort (if missing, just skips).
* **Concurrency** — `SpectrumManager.maxConcurrent=2` (like salmon’s `CapacityLimiter(cfg.upload.simultaneous_threads)`), queue, 90 s `sox` timeout, `SIGKILL` on exceed.
* **Storage** — `/tmp/hub-spectrum` (created at import, `chmod 777`), LRU prune when >100 files (delete oldest `mtime`). No `DATA_DIR` persistence — `docker restart` clears.
* **Single-flight** — `inFlight` map `token:hash → Promise` dedupes concurrent requests for same file.

## HTTP (`apps/bridge/src/server.ts:594` + `~620`)

* `GET /spectrum/:token/full` and `/spectrum/:token/zoom` — `BRIDGE_TOKEN` gated like `/files/:token` (`extractToken` via `?token`/`Authorization`/`Sec-WebSocket-Protocol`), containment `resolve(SPECTRUM_DIR)`, `If-None-Match` → `304`, otherwise `200 image/png` with `ETag: "hash"`, `Cache-Control: private, max-age=3600`, `X-Content-Type-Options: nosniff`. `404` if not yet generated, `202` is not used — WS drives status.
* `GET /api/spectrum/:token` — JSON `{token, etag, full:"/spectrum/:token/full", zoom:"/spectrum/:token/zoom"}` for pre-check, `404 {error:"no spectrum"}`.

## WebSocket (`apps/bridge/src/server.ts:1060` + `apps/web/src/lib/protocol.ts:640`)

Validated with `zod` (`SpectrumRequestSchema`, `SpectrumStatusRequestSchema`):

```
client → server: {type:"spectrum:request", id}   // id = transfer.id "user::path"
server → client: {type:"spectrum:status", id, phase:"queued"|"generating"|"done"|"missing", progress}
server → client: {type:"spectrum:ready", id, token, etag, hash, urls:{full,zoom}, fromCache}
server → client: {type:"spectrum:error", id, error}
client → server: {type:"spectrum:status", id}    // poll for existing
```

## Web provider (`apps/web/src/lib/spectrum.tsx:1`)

* `SpectrumProvider` subscribes to `useSession` `subscribe`, keeps `Map<id,SpectrumEntry>` (`status`, `etag`, `fullUrl`/`zoomUrl`, `fullBlobUrl`/`zoomBlobUrl`).
* On `spectrum:ready` fetches both PNGs with `If-None-Match: etag`, creates `URL.createObjectURL(blob)` and stores for hover instant render; revokes previous URLs.
* `requestSpectrum(id)` sets `queued` optimistically then `send({type:"spectrum:request",id})`.
* Bridge base derived from `NEXT_PUBLIC_BRIDGE_URL` / `localStorage.nicotineHub.bridgeUrl` → `http://host:port` (same derivation as files).

## Docker

`apps/bridge/Dockerfile:59` runner stage:

```dockerfile
RUN apk add --no-cache sox flac oxipng && mkdir -p /tmp/hub-spectrum && chmod 777 /tmp/hub-spectrum || true
```

`sox 14.4.2` pulls `libpng`; `oxipng` is ~1 MB. No change to `compose.yaml` — `/tmp` is container-private tmpfs, no volume.

## Attribution

Pipeline is a port of `smokin-salmon/smoked-salmon` `src/salmon/uploader/spectrals.py` (Apache-2.0) — sox spectrogram + oxipng. See `ATTRIBUTION.md:98` and `LICENSES/`. `sox`/`oxipng` are GPL/MIT and `oxipng` is already bundled via `apk`.

## Testing

* `apps/bridge/src/spectrum.test.ts:1` — unit `calculateZoomStartpoint`, `getSpectrumHash` (16 hex), `getSpectrumPaths` (`/tmp/hub-spectrum`), + integration `sox synth 1 sine 440 → ensureSpectrum → Full+Zoom exist` when `sox` present (skipped otherwise).
* Manual: place a FLAC in `DATA_DIR/downloads` (or download via Soulseek), finish it, right-click → Analyze → hover.
* Reboot wipe: `docker restart <bridge>` → `GET /spectrum/:token/full` → `404` until re-analyzed.
