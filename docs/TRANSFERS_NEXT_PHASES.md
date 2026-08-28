# Transfers — Next Phases (Post-Stub Roadmap)

> **Companion to `docs/TRANSFERS.md`** (full 1:1 Nicotine+ mapping) and **intentionally does not duplicate its §1–§4 reference tables**.
> This is the **execution checklist** for what remains after the **Phase 2/3 stub** landed in `feat/transfers` (`9b874bf`):
> - `apps/bridge/src/transfers.ts` — in-memory `TransferManager` with demo timers, no real `F` sockets
> - `apps/web/src/app/{downloads,uploads}/page.tsx` + `components/transfers/TransferCard.tsx`
> - `e2e/transfers.spec.ts` (MockWS) — UI verified, no live Soulseek transfer

Status after stub: `bun --cwd apps/bridge test` 30 pass, `bun run build` passes. Per-connection manager, no persistence, no file I/O, no protocol shims for `F` — by design.

---

## What the stub already proves

| Area | Delivered | Gap left |
|------|-----------|----------|
| WS contract | `download:request` / `download:control` / `upload:control` → `transfer:update|removed|stats` (2 s) `apps/bridge/src/server.ts:132` + `apps/web/src/lib/transfers.tsx:46` | Missing `transfer:queue` (`PlaceInQueueResponse:44`), `transfer:finished {downloadUrl}`, `GET /files/:token` |
| UI | Header pills, placeholder chart, `TransfersProvider`, `Sidebar` counts/badges `apps/web/src/components/Sidebar.tsx:20`, tab switcher (`xl:grid-cols-2` / mobile `tab-downloads`) | No `ThroughputChart`, no grouping, no `FileAttributes` overlay |
| Bridge engine | `Map<id,BridgeTransfer>` + `seedDemoUploads` + 350 ms → 1200 ms timers + `setInterval 500ms` progress | No `downloads.json`/`uploads.json`, no `incomplete INCOMPLETE<md5>` FS, no `QueueUpload(43)` send |

---

## Sequencing — why this order

1. **Phase 0 shims first** — everything else frames/parses with `packUint64LE` / `FileOffset`; without it Phases 1–2 don't compile-tests-pass.
2. **Phase 1 indirect (`ConnectToPeer 18` / `PierceFirewall 0`) before real downloads** — ≈60 % of peers are never direct; observed in `downloads.py:_transfer_timeout 45 s` (30 s indirect + 15 s grace). Building downloads first would silently fail in the field.
3. **Phase 2 downloads before uploads** — downloads only need `P` to send `QueueUpload`; uploads need shares/queue-fairness and are observable without being functional (banner).
4. **Phase 5 (fairness/filters/persistence) before polish** — correctness > chart.

Do not batch phases; gate each with `bun test && bun run build` per `AGENTS.md`.

---

## Phase 0 — Protocol shims (no UI, compiles subsequent phases)

**Why first:** All later phases import these builders/parsers.

**Files**

- `apps/bridge/src/soulseek.ts:19` — extend `SERVER_MESSAGE_CODES` with `connectToPeer:18, cantConnectToPeer:1001, sendUploadSpeed:121, privilegedUsers:69, relogged:41`; `PEER_MESSAGE_CODES` with `transferRequest:40, transferResponse:41, queueUpload:43, placeInQueueResponse:44, uploadFailed:46, uploadDenied:50, placeInQueueRequest:51, folderContentsRequest:36, folderContentsResponse:37`; add `PEER_INIT_CODES` const.
- Builders: `buildConnectToPeer(token,user,type)` / `buildCantConnectToPeer(token)` / `buildSendUploadSpeed(speed)` / `buildQueueUpload(file)` / `buildTransferRequest(dir,token,file,size)` / `buildTransferResponse(token,allowed,reasonOrSize)` / `buildPlaceInQueueRequest/Response` / `buildUploadFailed/Denied` / `buildFolderContentsRequest/Response` (zlib). Parsers mirror `SlskReader` at `soulseek.ts:120`.
- Add `packUint64LE(lo,hi)` / `unpackUint64LE` for `FileOffset` and `TransferRequest.size` (high-word = `hi * 2**32`).
- `apps/bridge/src/soulseek.test.ts:1` — hex vectors from `SLSKPROTOCOL.md:458` 72-byte Login + new: `TransferRequest` (direction+token+string+u64), `QueueUpload`, `FileTransferInit`/`FileOffset` round-trips. Re-use helpers from existing search tests.
- `apps/web/src/lib/protocol.ts:1` — already has 19-variant `TransferStatus` + `TransferUpdate/Removed/Stats`; add `transfer:queue` (`{id,place}`) and `transfer:finished {id,fileName,size,downloadUrl}` to `BridgeOutboundMessage`. Keep `isUpload` vs `modifier` distinction from `TRANSFERS.md:218`.
- `apps/web/src/lib/config/defaults.ts:68` — add `TODO(Phase 5): transfers section` comment only.

**Acceptance**

- [ ] `bun test` — new vectors pass, framing `tryParseMessage` still handles `[u32 len][u32 code][payload]` vs init `[u32 len][u8 code][payload]` at `soulseek.ts:252`.
- [ ] `bun run build` — no type errors in `protocol.ts` unions.

**Risk:** `packUint64` on JS `number` capped at `2^53`; transfers use `size < 10 TB` so safe, but add `bigint` guard and test `size = 4_294_967_296` edge.

---

## Phase 1 — Indirect connectivity (mandatory for transfers)

**Depends on:** Phase 0.

**Files**

- `apps/bridge/src/session.ts:1` — server switch: `case 18: parseConnectToPeer(payload)` → stash `pending {token,username,connType}`; if `connType==="P"` → `Bun.connect(ip,port)` + `buildPierceFireWall(token)` (no `PeerInit`); else delegate to `TransferManager` for `F`. Handle `1001 CantConnectToPeer`. Cache `GetPeerAddress(3)` at `buildGetPeerAddress:564` → `Map<user,{ip,port,expiry:60s}>`.
- Listener demux `Bun.listen` at `session.ts:334` — peek first `u32`: if init probe `code 0/1` + strings fails, treat as raw `F` `FileTransferInit` (first 4 bytes = token LE). Record `fileToken` for `transfers.ts` to match `active[token]`.
- Utility `connectPeer(username,type):Promise<Socket>` — `GetPeerAddress` → `Bun.connect` + `PeerInit(P)` → race vs `ConnectToPeer` server relay, 45 s timeout like `downloads.py:Getting status`. Track `pendingConnects:Map<token,{resolve,reject,timer}>`.
- `apps/bridge/src/server.ts:1` — WS diagnostic `peer:connect {username}` for manual NAT testing (remove before release).

**Acceptance**

- [ ] Two peers (one direct, one behind NAT) → logs `ConnectToPeer → PierceFirewall → P established` for indirect; `GetPeerAddress` cache hit on second dial.
- [ ] `apps/bridge/src/session.ts:247` relogged `41` still aborts; no regression on `FileSearchResponse(9)` routing.

**Risk:** `LISTEN_PORT 2234` must be forwarded on homelab `compose.yaml:8` — Phase 1 mitigates but not fully; document fallback.

---

## Phase 2 — Bridge transfer engine — Downloads (minimal viable)

**Depends on:** Phases 0–1.

**New file `apps/bridge/src/transfers.ts` (replace stub):**

- State mirrors `Transfers` `transfers.py:60` but simplified: `Map<id,Transfer>`, `queued:Map<id,Transfer>` (insertion order), `active:Map<token,Transfer>`, `failed:Map<id,Transfer>`, `totalDownloadBandwidth/uploadBandwidth` (2 s rolling).
- `enqueueDownload({username,virtualPath,size,attrs,isPrivate})` — mirrors `downloads.py:_enqueue_transfer:510`:
  1. dedup `transfers.has(id)` → re-emit `Queued`
  2. `offset >= size` → `FINISHED`; `downloadfilters` regex (defer to Phase 5, stub false)
  3. `get_complete_download_file_path` size check → `FINISHED`
  4. `UserStatus.OFFLINE` via `watchUser` → `User logged off` + re-queue on `GetUserStatus:7`
  5. `queued.set(id,t)` + debounce `downloads.json` persist 2 s
  6. send `QueueUpload(43)` via `P` (`connectPeer` if needed); defer in `_pending_queue_messages` until `shares-ready` (stub `false` for mobile)
  7. emit `transfer:update` (`Queued`, `queuePosition=null`)
- Inbound `TransferRequest(UPLOAD,40)` → `_activate` (`transfers.py:_activate_transfer:236`) — verify `queued.has(fileKey)` → `{status:"Getting status", token}` + 45 s `setTimeout → Connection timeout` → emit. Outbound `TransferResponse` not used for downloads (Queued via 43 flow).
- `PlaceInQueueResponse(44)` → `queuePosition=place` → emit `transfer:queue`.
- `UploadDenied(50)` → status `reason` (`File not shared.` etc.) or `Cancelled` → `failed` + emit.
- Poll `PlaceInQueueRequest(51)` every **300 s** (Phase 2) for `Queued` items (configurable 60 s later).
- **F accept:** inbound `F` with `token` → lookup `active[token]` → `getIncompletePath` per `downloads.py:get_incomplete_download_file_path` (`INCOMPLETE<md5(virtualPath+username)>+basename` truncated to `NAME_MAX 255`) via `Bun.file`/`fs.openSync "ab+"` → `offset = stat.size` (or `0` if `size_changed` then `truncate 0`). Send `FileOffset(uint64)` (LE 8 bytes) → `DownloadFile(sock, token, handle, leftbytes=size-offset)` job streaming raw bytes until `size-offset`. Per chunk: `current = size-leftbytes`, `speed=bytes/dt`, `avgSpeed=total/elapsed`, `timeLeft=(size-offset)/speed`, emit throttled 500 ms (mirrors `downloads.py:_update_transfer_progress:310` + `slskproto._write_download_file`).
- `leftbytes==0` → `FINISHED` → `close handle` → `moveFinished` (`fs.rename` with `"(1)"` collision loop + `truncate_string_byte`) → `SendUploadSpeed(121)` bookkeeping → `transfer:finished {downloadUrl:"/files/:token"}` → persist. Downloader **must close `F`** to signal uploader.
- Socket close with `leftbytes>0` → `Connection closed` → `failed.set(id,t)`; `UploadFailed(46)` ignored unless `Cancelled/Finished`. Timers: **180 s** retry `CONNECTION_CLOSED/TIMEOUT/PENDING_SHUTDOWN`, **900 s** for `DOWNLOAD_FOLDER_ERROR/LOCAL_FILE_ERROR` per `downloads.py:_retry_*`.
- Persistence: `data/downloads.json` JSON array `[username, virtualPath, folderPath, status, size, current, {attrs}]` on bridge start — only `PAUSED/FILTERED/FINISHED` retained as `Paused` else `User logged off` (compat). Atomic write `tmp → rename` via `write_file_and_backup`.
- `GET /files/:token` in `apps/bridge/src/server.ts:113` — `Content-Disposition: attachment; filename="..."` stream for browser `showSaveFilePicker` / `a[download]` + OPFS optional cache.
- `compose.yaml` — `bridge-data:/data` volume for `bridge`.

**Acceptance**

- [ ] `bun --cwd apps/bridge dev` → enqueue small known file from `Search` → `Queued → Getting status → Transferring 45% → Finished`, file at `data/downloads/`, `GET /files/:token` downloads.
- [ ] Kill mid-transfer → `Connection closed` → 180 s re-queue; disk-full simulation → `Download folder error` → 900 s.

**Risk:** `DATA_DIR=/data` must be gitignored but Docker-volumed; browser `localStorage` mirror is not truth — clear site data does not delete server files.

---

## Phase 3 — Web hardening (ship what stub already looks like, but non-mock)

**Depends on:** Phase 2 bridge real.

No new routes (they already exist at `apps/web/src/app/downloads/page.tsx:17` / `uploads/page.tsx:17`), but swap mock store for real reducer:

- `apps/web/src/lib/session.tsx:50` — extend `SessionState { transfers, transferStats }` with reducers for `transfer:update|queue|finished|stats`; selectors `useTransfers(kind)`; actions `downloadFile(result)` / `cancel/pause/resume/retry/clear`.
- Finalize `TransfersProvider` to remove `SEED` demo after bridge sends real `list()` on `open` at `server.ts:150` (keep demo only behind `NODE_ENV==="development"` flag if desired).
- Keep `TransferCard` layout at `apps/web/src/components/transfers/TransferCard.tsx:33` (`ghost-border`, `progress-glow` download-only) and `DownloadsInner` tab switcher — no change except wiring `onRetry` → `download:control retry` (currently `resume`).

**Acceptance**

- [ ] Playwright (first `cp apps/web/.env.example apps/web/.env` per `AGENTS.md`) → `/downloads` gated (`state.status!=connected → "/"` like `search/page.tsx:52`), enqueue from `/search` sheet `Download` → card appears `Queued → Transferring`, pause/close targets ≥44 px (`min-h-11`).

---

## Phase 4 — Bridge upload serving (homelab as uploader — nicotine+ parity)

**Depends on:** Phase 2 engine.

Uploads **always visible** (`Uploads → /uploads`, `folder_managed`) even when `shares` empty — nicotine+ parity.

- `transfers.ts` — incoming `QueueUpload(43)` → `_queue_upload` per `uploads.py:68`:
  1. `check_user_permission` (stub `allow all` until bans/geo Phase 5; read `data/shares.json` via `virtual2real` `virtualName→realDir`)
  2. `rescanning → defer`, `isQueued → Queued`, `pending_shutdown → Pending shutdown.`
  3. `is_queue_limit_reached` → `Too many files` (≥ `filelimit 100`) / `Too many megabytes` (≥ `queuelimit 10000 MB`)
  4. `file_is_shared` → `File not shared.` (try lowercase/backslash fix)
  5. else enqueue + `PlaceInQueueResponse` on poll
- `_check_upload_queue` every **10 s** + on limit change: guard `is_new_upload_accepted()` (`uploadslots 3→2` mobile, `useupslots True` vs `uploadbandwidth 50 MB/s`); pick `_get_upload_candidate()` — **start FIFO only** (insertion order); RR + privileged deferred to Phase 5. Validate `online` + `file_exists` + `size_changed`. `_dequeue→_activate→TransferRequest(UPLOAD,40)` + `PlaceInQueueResponse` for remainder. Wait `TransferResponse` allow → expect outbound `F` with `FileOffset`; `open(file,"rb")` → `UploadFile` streaming throttled via `max(4096, sent*1.25/dt)` like `slskproto._process_upload`.
- `server.ts` — `transfer:stats` now both directions; debug `GET /shares`.
- `/uploads` banner when `shares.length===0` — already at `apps/web/src/app/uploads/page.tsx:55` `No shared folders configured` — keep, just wire to real `shares.json` length.

**Acceptance**

- [ ] Two-bridge test: A shares file via `data/shares.json`, B `QueueUpload` → A serves → B finishes; downloader closes `F` → `SendUploadSpeed(121)`.

---

## Phase 5 — Queue fairness, privilege, filters, persistence hardening

**Depends on:** Phase 4.

- `transfers.ts` — `fifoqueue` (`FIFO_QUEUE` env): `true` → FIFO, `false` → RR via `_userUpdateCounters:Map<string,number>` incremented on enqueue/dequeue/abort; only queued-non-active users counted. Privileged gate: load `privilegedUsers` from server `69` + `buddies` (`preferfriends`) → `isPrivileged(user)`; if any privileged queued, restrict candidate set; set `modifier="privileged"|"prioritized"` for UI pill (`tertiary-fixed-dim`).
- `apps/web/src/lib/config/defaults.ts:68` — add `transfers` section per `settings-mapping.md:127` (11 download + 13 upload keys; defaults `TRANSFERS.md:132`). Expose in `Settings → Transfers` via `controls.tsx` `NumberControl/Toggle/Radio/Select` (`uploadslots min 1`, `queuelimit 10000 MB`, etc.). Persist `localStorage nicotine.settings` + sync subset to bridge via `settings:update`.
- Permission: `check_user_permission` via `server.banlist/ipblocklist` + `transfers.usecustomban/customban`, `geoblock/geoblockcc` (`settings-mapping.md:274`). `virtual2real` with backslash fix.
- Filters: `transfers.enablefilters` + `downloadfilters` regex (`re.compile("(\\(" + "|".join(filters) + ")$")` `downloads.py:94`) → `Filtered`.
- Persistence hardening: `downloads.json` atomic `tmp→rename`, `Aborted → Paused` migration, legacy `"123 (vbr)"` parsing, `normpath` cache, stale `INCOMPLETE` sweep on quit (`downloads.py:_delete_stale_*`).
- Web OPFS finish: after `transfer:finished {downloadUrl}`, `fetch(downloadUrl)` → `showSaveFilePicker` `WritableStream` else `a.download`; offer `Save to OPFS` for <200 MB via `navigator.storage.getDirectory()`.

**Acceptance**

- [ ] `fifoqueue` toggle reorders queue; banned user → `Banned`; `*.exe` filter → `Filtered`; `bun test` filter regex vectors.

---

## Phase 6 — Throughput chart + bandwidth shaping (polish)

**Depends on:** Phase 5.

- `apps/web/src/components/transfers/ThroughputChart.tsx` — canvas/Recharts `AreaChart` (download `primary #094cb2`, upload `tertiary #6d5e00`, `fillOpacity 0.1/0.05` linear `transparent→tint` matching `Downloads_uploads.html:177`). Sample `transfer:stats` every 2 s → ring 60 points (120 s). Dark mode `primary-container` fill; fallback static SVG when `active==0`.
- `apps/bridge/src/transfers.ts` — `SetDownloadLimit/SetUploadLimit` env → bytes/s; `_calc_upload_limit` splits across `active.size`; `_process_upload` `max(4096, sent*1.25/dt)`. Emit `total_bandwidth` for chart.

**Acceptance**

- [ ] 2 parallel downloads → two-line area live, header pills update.

---

## Phase 7 — Shares + folder downloads + full parity (stretch)

**Depends on:** Phases 4–5.

- `transfers.ts` — `request_folder(user, folder)` → `FolderContentsRequest(36)` + `AddAllowedResponse`, 5 s retry once; `FolderContentsResponse(37)` zlib parse; auto-enqueue each file; `folder-download-finished` per `downloads.py:_folder_downloaded_actions:356`.
- Shares scanning: mount `shares` volumes + `rescan_shares` background job (or `shares.json` manual). `Settings → Shares` picker via `showDirectoryPicker()` where available.
- Notifications: `notifications.notification_popup_{file,folder,queued_upload}` → `Notification` API + `vibrate` fallback; `notification_window_title` badge.
- Grouping: `groupdownloads/groupuploads:"folder_grouping"` → parent rows by `folder_path`/`user`, `expand_downloads:"all"` collapse default.
- Auto-clear toggles `autoclear_downloads/uploads` — on `Finished` emit `transfer:removed`.

**Acceptance**

- [ ] `FolderContentsRequest 36/37` → all files enqueued; `Finished` count matches; browse-shares → download folder end-to-end.

---

## Do-not-implement (deferred from HTML guideline)

- Real-time chart in Phase 3 (ship placeholder — `TRANSFERS.md:178`).
- File-attribute–aware search filtering beyond simple `downloadfilters` regex.
- Multi-select/bulk, column sorting, drag-reorder.
- Desktop `afterfinish`/`afterfolder` shell hooks, plugin system, `MPRIS`/`Last.fm`.
- Obfuscated port support (`SLSKPROTOCOL.md:515` explicitly omitted).
- Distributed search `D` connections — only `P` + `F` needed.

---

## Checklist for next branch

Branch off `main` post-merge of `feat/transfers` (`9b874bf`):

```bash
git fetch origin && git checkout main && git pull
git checkout -b feat/transfers-phase0   # or feat/transfers-phase1
# implement Phase 0 shims → bun test && bun run build → push → PR
```

Per-phase gating: `bun test` (hex vectors vs `SLSKPROTOCOL.md:472` 72-byte Login + new Transfer vectors) + `bun run build` + Playwright smoke `cp apps/web/.env.example apps/web/.env` → `/downloads` gated, card glow, ≥44 px targets, mobile tabs, `xl` two-col.

---

*Last verified:* `bun --cwd apps/bridge test` 30 pass, `bun run build` OK at `9b874bf`. Next to implement: **Phase 0 shims, then Phase 1 indirect** — open branch off `main`.
