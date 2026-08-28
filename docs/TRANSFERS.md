# Transfers — Downloads & Uploads: Mapping + Implementation Plan

> **Status:** Planning doc only — no code changes. Single authoritative plan for implementing
> transfers in `nicotine_mobile`, mapped 1:1 against `nicotine-plus`.
>
> **Guidelines:** `docs/Downloads_uploads.html:1` is a **visual guideline, not a requirement**.
> `docs/DESIGN.md:1` is canonical (Digital Curator, No-Line Rule, surface tiers, radii).
>
> **Recommendation adopted:** **OPFS + Bridge Proxy FS** — the bridge (`apps/bridge`) is the
> canonical file store (Docker volume `data/`); the browser never holds multi-GB in memory.
> Finished files are delivered to the user via `GET /files/:token` → browser
> `showSaveFilePicker()` / `a[download]` and optionally cached in OPFS for offline preview.
> Resume offsets live on the bridge (`incomplete/`).

**Sources read:**

- `nicotine-plus/pynicotine/transfers.py:1` · `downloads.py:1` · `uploads.py:1` · `slskmessages.py:1` · `slskproto.py:1` · `shares.py:1` · `config.py:1` · `gtkgui/transfers.py:1` · `doc/SLSKPROTOCOL.md:88`
- `nicotine_mobile/apps/bridge/src/soulseek.ts:1` · `session.ts:1` · `server.ts:1` · `soulseek.test.ts:1` · `apps/web/src/lib/protocol.ts:1` · `session.tsx:1` · `lib/config/defaults.ts:1` · `app/search/page.tsx:1` · `components/ResultCard.tsx:1` · `docs/settings-mapping.md:1` · `docs/Downloads_uploads.html:1`

---

## 1. What Nicotine+ Actually Does

### 1.1 Data model — `pynicotine/transfers.py`

**`TransferStatus` (str Enum):**
`Queued` · `Getting status` · `Transferring` · `Paused` · `Cancelled` · `Filtered` · `Finished` · `User logged off` · `Connection closed` · `Connection timeout` · `Download folder error` · `Local file error` + dynamic `TransferRejectReason` strings (`File not shared.` `File read error.` `Banned` `Pending shutdown.` `Too many files/megabytes`).

**`Transfer` (`__slots__`):** `username`, `virtual_path` (`\\`-delimited remote), `folder_path` (local destination), `token` (uint32), `size` (uint64), `current_byte_offset`, `last_byte_offset`, `transferred_bytes_total`, `speed`, `avg_speed`, `time_elapsed`, `time_left`, `file_handle`, `file_attributes` (`FileAttributes`), `sock`, `queue_position`, `modifier` (`"privileged"/"prioritized"`), `request_timer_id` (45 s), `legacy_attempt`/`retry_attempt`/`size_changed`, `is_backslash_path`/`is_lowercase_path`, `iterator` (GTK iter).

**`Transfers` base:**
`transfers: {username+virtual_path: Transfer}` master dict · `queued_transfers: OrderedDict` · `queued_users: {user: {path: Transfer}}` · `active_users: {user: {token: Transfer}}` · `failed_users: {user: {path: Transfer}}` · `total_bandwidth`, `_online_users` set, `_user_queue_limits/_user_queue_sizes`, `Statistics`.
Persistence: `<data>/downloads.json` / `uploads.json` — JSON array of `[username, virtual_path, folder_path, status, size, current_byte_offset, {FileAttributes dict}]`; legacy pickle loader; save every 180 s via `_save_transfers_callback`. Only `PAUSED`/`FILTERED`/`FINISHED` survive restart (others → `User logged off`).

**`Statistics`:** `since_timestamp`, `started/completed_downloads/uploads`, `downloaded_size/uploaded_size`; `SendUploadSpeed(121)` updates server stats.

### 1.2 Download lifecycle — `pynicotine/downloads.py`

```
Enqueue(user, virtual_path, folder_path, size, attrs)
  → if offset ≥ size → FINISHED (already complete)
  → if downloadfilters regex match → FILTERED
  → if file exists with same size in downloaddir → FINISHED
  → if offline → USER_LOGGED_OFF (watch_user, retry on login)
  → else queued_transfers+queued_users, send QueueUpload(file) peer 43
       (deferred in _pending_queue_messages until shares-ready if rescanning)
  → poll every 300 s: PlaceInQueueRequest(51) → PlaceInQueueResponse(44) place
  → remote dequeues → TransferRequest(UPLOAD, token, file, size) peer 40
  → _activate_transfer(token) → GETTING_STATUS + 45 s timer (30 s indirect + 15 s grace)
  → peer opens F connection → FileTransferInit(token uint32)
  → _file_transfer_init: open incomplete file (ab+) → FileOffset(uint64 offset)
     + DownloadFile(sock, token, file, leftbytes=size-offset) to SlskProto
  → TRANSFERRING: SlskProto._write_download_file writes chunks → file-download-progress
     _update_transfer_progress: avg_speed=total/elapsed, speed, time_left=(size-offset)/speed
  → leftbytes==0 → FINISHED → _move_finished_transfer (shutil.move to downloaddir with
     avoid_conflict " (1)" suffix) → completed_downloads++ → notification + afterfinish hook
  → failures → PAUSED/CANCELLED/FILTERED/USER_LOGGED_OFF/CONNECTION_CLOSED|TIMEOUT/
     DOWNLOAD_FOLDER_ERROR/LOCAL_FILE_ERROR or UploadDenied reason
  → retry: 180 s timer for CONNECTION_CLOSED/TIMEOUT/PENDING_SHUTDOWN
           900 s timer for DOWNLOAD_FOLDER_ERROR/LOCAL_FILE_ERROR
           limited-queue: if Too many files/megabytes → cap at max(5, len-1), spill to failed_users
```

Folder downloads: `request_folder(user, folder)` → `FolderContentsRequest(36)` + `AddAllowedResponse`, 5 s timeout + retry, `FolderContentsResponse(37 zlib)`.

### 1.3 Upload lifecycle — `pynicotine/uploads.py`

**Ingress `QueueUpload(file)` peer 43 → `_queue_upload`:**

1. `check_user_permission` (shares) → `Banned` / geo → `UploadDenied(reason)`.
2. `rescanning` → defer via `_pending_network_msgs`.
3. Already queued → `Queued`; `pending_shutdown` → `Pending shutdown.`.
4. `is_queue_limit_reached` → `Too many files` (≥ `filelimit` 100) / `Too many megabytes` (≥ `queuelimit` 10000 MB).
5. `file_is_shared` → `File not shared.` (try lowercase/backslash fix).
6. Else enqueue, `PlaceInQueueResponse` not yet — that is on `PlaceInQueueRequest`.

**`_check_upload_queue` every 10 s + on limit change:**

- Guard `is_new_upload_accepted()` — `uploadslots` (3, `useupslots=True`) OR `uploadbandwidth` (KB/s) + `rescanning`.
- Candidate pick `_get_upload_candidate()`:
  - `fifoqueue=True` → earliest `queued_transfers` insertion.
  - `fifoqueue=False` (default) → round-robin: user with smallest `_user_update_counters[user]` among users that still have queued-but-not-active transfers.
  - Privilege gate: if any privileged users queued (`core.users.privileged` ∪ `is_buddy_prioritized` when `preferfriends` / `priority` flag), only they are considered; others starve until drained. Sets `modifier="privileged"/"prioritized"` for UI.
- Validate `online`, `file_is_shared` + `_get_current_file_size` (size_changed → truncate handling).
- `increment_token` → `_dequeue`→`_activate`→ `TransferRequest(UPLOAD, token, file, size)` peer 40 + wait for `TransferResponse` allow.

**`PlaceInQueueRequest(51) → _place_in_queue_request`:**
FIFO: `index in queued_transfers` (+ privileged prefix); RR: `num_privileged_users + len(queued_users) + position_in_user_queue`. Cached in `_queue_positions`.

### 1.4 Protocol — `doc/SLSKPROTOCOL.md`

| Bucket | Code | Name | Direction / note |
|--------|------|------|------------------|
| Server | 1 | Login | `string user + string pass + u32 177 + string md5(user+pass) + u32 1` → `bool success + banner/ip/checksum/isSupporter` or `reason+detail` |
| Server | 2 | SetWaitPort | `u32 port` |
| Server | 3 | GetPeerAddress | `string user` ↔ `username + u32 ip + u32 port + u32 obfType + u16 obfPort` (`soulseek.ts:326` already parses) |
| Server | 18 | ConnectToPeer | **Missing in bridge** — `u32 token + string username + string type(P/F/D)` ↔ `username+type+u32 ip+u32 port+u32 token+bool privileged` |
| Server | 35 | SharedFoldersFiles | `u32 dirs + u32 files` |
| Server | 69 | PrivilegedUsers | `u32 n + n× string` (privilege source) |
| Server | 1001 | CantConnectToPeer | `u32 token (± string user)` |
| Server | 121 | SendUploadSpeed | `u32 speed` on finish |
| PeerInit | 1 | PeerInit | `string user + string type(P/F/D) + u32 0` — framed `[u32 len][u8 code][payload]` (`soulseek.ts:252`) |
| PeerInit | 0 | PierceFirewall | `u32 token` — response to indirect 18 |
| Peer | 4 | GetShareFileList | ↔ `5 SharedFileListResponse (zlib)` |
| Peer | 9 | FileSearchResponse | zlib, already in `soulseek.ts:466` |
| Peer | 15/16 | UserInfo | already in bridge |
| Peer | 36/37 | FolderContents | `u32 token+string folder` ↔ `token+folder+nDirs×… zlib` |
| Peer | 40 | TransferRequest | `u32 direction(0 download/1 upload) + u32 token + string file + (u64 size if upload)` |
| Peer | 41a/b | TransferResponse | `u32 token + bool allowed + (u64 size if download allow else string reason)` — download-allow deprecated; always reply Queued via 43 flow |
| Peer | 43 | QueueUpload | `string file` — **primary download request** since 3.0.3 |
| Peer | 44 | PlaceInQueueResponse | `string file + u32 place` |
| Peer | 46 | UploadFailed | `string file` — F closed unexpectedly |
| Peer | 50 | UploadDenied | `string file + string reason` |
| Peer | 51 | PlaceInQueueRequest | `string file` — poll every 300 s |
| File (F conn) | — | FileTransferInit | first 4 bytes `u32 token` |
| File | — | FileOffset | `u64 offset` (resume point) |

**Transfer example flow (`SLSKPROTOCOL.md:3185`):** `FileSearch(26)` → `FileSearchResponse(P,9)` → `QueueUpload(43)` → `TransferRequest(UPLOAD,40)` → `TransferResponse(allow,41b)` → `F: FileTransferInit(token)` → `F: FileOffset(offset)` → raw bytes → downloader closes F on complete → `SendUploadSpeed(121)`.

Connection establishment (`SLSKPROTOCOL.md:2453` Modern): A→server `ConnectToPeer(token,user,"P")` + A→server `GetPeerAddress(user)`; server→B `ConnectToPeer(token)`; A→B `PeerInit("P")` direct; else B→A `PierceFirewall(token)` indirect; else `CantConnectToPeer`.

**File attributes** `SLSKPROTOCOL.md:195`: 0 bitrate kbps, 1 duration s, 2 VBR, 4 sampleRate Hz, 5 bitDepth bits. Combos: `{0,1,2}` legacy, `{0,1}` MP3, `{1,4,5}` FLAC/WAV, `{0,1,4,5}` WV.

### 1.5 File I/O & resume — `downloads.py`

- `downloaddir = $XDG_DATA/nicotine/downloads`, `incompletedir = .../incomplete`, `uploaddir = .../received`, `usernamesubfolders` toggle.
- Incomplete path: `md5 = hex(MD5(virtual_path + username))`, `prefix = "INCOMPLETE"+md5` (42 chars), `basename = clean_file(virtual_path.rpartition("\\")[-1])`, truncate to `NAME_MAX-len(prefix)-len(ext)`, join `incomplete_dir/prefix+basename`. E.g. `INCOMPLETEa1b2…My Song.mp3`.
- Open: `mkdir incomplete; open(path,"ab+"); fcntl LOCK_EX|NB; if size_changed truncate 0; offset = seek(END)`.
- Finish move: `basename = get_download_basename(virtual_path, downloaddir, avoid_conflict=True)` → truncate + `" (1)"` loop; `get_complete_download_file_path` checks existence by size; `shutil.move`.
- Stale sweep on quit: delete `INCOMPLETE[0-9a-f]{32}.*` orphans. Errors map to `DOWNLOAD_FOLDER_ERROR` / `LOCAL_FILE_ERROR`.

### 1.6 Queue / bandwidth / privilege knobs

Defaults (`settings-mapping.md:128`): `uploadslots=3`, `useupslots=True`, `uploadbandwidth=50` MB/s, `uploadlimit/downloadlimit=1000` KB/s, `use_upload_speed_limit="unlimited"`, `queuelimit=10000` MB, `filelimit=100`, `fifoqueue=False`, `friendsnolimits=False`, `preferfriends=False`, `autoclear=false`, `enablefilters=False`, `groupdownloads/uploads="folder_grouping"`, `expand="all"`.

Bandwidth shaping (`slskproto.py`): `SetDownloadLimit/SetUploadLimit`; per-transfer vs shared split; adaptive read `max(4096, sent*1.25/dt)`. Bridge will simplify to progress-derived `speed` + header aggregates.

### 1.7 GTK UI & settings

- `gtkgui/transfers.py:1` — treeview, grouping (`user/folder/ungrouped`), status translation, parent-row aggregation. Popovers `Transferspeeds`.
- Notifications (`notifications` section): file/folder/queued_upload/private_message etc. → map to Web `Notification` API.
- `settings-mapping.md:127` maps 11 Downloads keys + 13 Uploads keys to `transfers` section — see §6.

---

## 2. What nicotine_mobile Has Today — Gap Analysis

**Bridge — `apps/bridge/src/soulseek.ts:19` / `session.ts:1` / `server.ts:1`:**

- ✅ Framing `[u32 len][u32 code][payload]` LE, `SlskReader`, `pack*`, `frameMessage`/`tryParseMessage`, `frameInitMessage` for PeerInit/PierceFirewall.
- ✅ Login `buildLogin` (`soulseek.ts:215`) + `parseLoginResponse:365` + `describeRejection:410`, `SetWaitPort:230`, `FileSearch:237` (token+query), `BuildPeerInit:257`, `BuildPierceFireWall:268` (but never called).
- ✅ Inbound P listener `session.ts: startListener()` on `LISTEN_PORT` (2234), `handlePeerData` for `FileSearchResponse(9)` (zlib) → `searches Map<token, ActiveSearch>`, `UserInfo` peer 15/16 and server `GetPeerAddress(3)`/`GetUserStatus(7)` plumbing (methods `requestUserInfo`, `watchUser` exist but not routed to WS).
- ❌ `SERVER_MESSAGE_CODES:19` missing `fileSearch:26` entry was ad-hoc? (already added as `26` literal). Missing `connectToPeer:18`, `cantConnectToPeer:1001`, `sendUploadSpeed:121`, `privilegedUsers:69`, `relugged:41`, `branchLevel/Root` etc.
- ❌ `PEER_MESSAGE_CODES:45` only 1/15/16 — missing `40/41/43/44/46/50/51` and file `FileTransferInit/Offset`.
- ❌ No `F` connection handling — `handlePeerData` only handles `code 9` and `15/16`/`1`. No demux of incoming `F` (first 4 bytes token) vs `P`. No outgoing F dial, no `FileOffset` nor raw byte streaming.
- ❌ `server.ts:1` only `login` + `search` WS routes; no `download:request`/`transfer:*`.

**Web — `apps/web/src/lib/protocol.ts:1` / `session.tsx:1` / `config/defaults.ts:68` / `app/search/page.tsx:1` / `components/ResultCard.tsx:1`:**

- ✅ `login:start/result`, `search:start/result/done` WS contract; `SessionProvider` single `WebSocket` + `bridgeUrl()` override (`localStorage.nicotine.bridgeUrl` → `NEXT_PUBLIC_BRIDGE_URL` → `:8787/ws`).
- ✅ Search live results wired: `search:result` appends, `ResultCard` `fileToCard` (size/bitrate/duration).
- ❌ No `transfers` slice: no `transfers` array, no `search:download` handoff stub (spec'd in `docs/search/ui.md`), no `/downloads` `/uploads` routes (Sidebar href `#`). `Settings` has no `transfers` section.
- ❌ No FS surface; browser cannot write `downloaddir` arbitrarily.

**Design:** `DESIGN.md` north star, glassmorphism, no borders; `Downloads_uploads.html` visual is guideline — contains desktop patterns to simplify.

---

## 3. Target UX — Mapping `docs/Downloads_uploads.html` → Mobile

**File `docs/Downloads_uploads.html:84` structure:** `nav.w-72` + `main.ml-72` · header sticky with `h2 Downloads & Uploads` `p 12 active connections` + pills `45.2 MB/s` `12.8 MB/s` + `settings` icon · `section Network Throughput` faux SVG (primary+tertiary lines) · `grid xl:grid-cols-2` → `Downloading (4)` / `Uploading (8)` lists · cards `surface-container-lowest p-4` `gap-3` group hover `pause/close` or `arrow_upward/play_arrow/close` for queued.

| HTML element (`Downloads_uploads.html:line`) | Mobile target | Notes vs `DESIGN.md` |
|---|---|---|
| `h2 Downloads & Uploads + Monitoring 12` `150` | Keep verbatim: `Noto Serif 3xl bold tracking-tight text-on-surface` + `Inter text-sm text-on-surface-variant` with live `N active` count | Editorial whitespace; dark mode `inverse-on-surface`. |
| Speed pills `156-163` `arrow_downward/upward 45.2/12.8 MB/s` in `surface-container-low` | Keep, but live from `total_download_bandwidth`/`total_upload_bandwidth` aggregates reported by bridge every 2 s; show `—` when idle | Tokens `primary` down, `tertiary` up. |
| `settings` gear `164` | Route to `Settings → Transfers` (not modal) | One primary action per view — gear is secondary. |
| Throughput chart `172-186` SVG gradient + two paths | **Defer Phase 6.** Ship static faint gradient placeholder (no animation) on first release; replace with live canvas/Recharts sparklines (primary/tertiary `0.1` fill) sampling last 60 s | Not required for transfers correctness; avoid mocking false real-time. |
| Grid `188 xl:grid-cols-2` | **Mobile: single column with tab switcher** `Downloads | Uploads` (`Public Sans xs uppercase tracking-widest`); **Desktop ≥1280 px: two columns** as in HTML | HTML `xl:` breakpoint keeps desktop mock; collapses to one column would be >1200 px tall. |
| Card `197 surface-container-lowest p-4 rounded-lg gap-3 group` | `glass-card` `surface-container-lowest` `rounded-xl` (Design min `sm`), `ghost-border` `outline_variant@15%`, `p-4` dark variant | `progress-glow` `0 0 10px rgba(9,76,178,0.5)` only for downloading `primary` bar; uploads use `tertiary` without glow. |
| Card title `200 font-body font-semibold truncate max-w-[250px]` + `Peer: User_Alpha99 • 2.4 GB` `201` | Keep truncate, but `Peer:` → `From @user` / `To @user`; size via `humanSize` respecting `ui.file_size_unit` (`defaults.ts:38`) | Preserve `on-surface-variant` label. |
| Speed `204 font-bold text-primary` + `ETA 03:12` `205` | Live `speed` + `time_left` from `_update_transfer_progress` math (`size-offset // speed`) → `mm:ss` or `hh:mm:ss`; show `Queued`/`Getting status`/`Paused` states substituting speed | Nicotine+ status strings are end-user visible — mirror them. |
| Progress `208 bg-surface-container-highest rounded-full h-1.5` inner `primary/tertiary/outline` | Keep `h-1.5`, width `% = current/size*100`; queued `0%` `outline` + `opacity-75` card `266`; finished `100%` tinted; honour `ghost-border` not real border | No 1px borders (`DESIGN.md:10`). |
| Actions `211 group-hover:opacity-100 pause/close`, queued `280 prioritize/play/close` | **Touch: always visible** (no hover). Targets ≥44 px; icons `pause`, `close`, `arrow_upward` (prioritize), `play_arrow` (resume). Also overflow menu `⋯` with `Cancel`/`Retry`/`Clear` | Hover-only fails on mobile; use `group-hover` on desktop but `opacity-100` below `md`. |
| Badges `downloading/upload` in nav `106-116` `downloading` filled + `primary-fixed/30` | Sidebar active: `text-primary font-bold bg-primary-fixed/30 rounded-xl` with `FILL 1` icon — match HTML. Uploads badge count `Uploading (N)` | `Sidebar.tsx` already has `downloading` placeholder; wire `href /downloads` + count. |
| `New Transfer` gradient CTA `94 from-primary to-primary-container` | Keep but relabel `New Download` → opens search focus (no manual URL entry in v1) | Gradient `primary→primary-container` per `DESIGN.md:11`. |
| Filters/search inside transfers, bulk select | **Defer.** No multi-select in Phase 3. | |
| Grouping `folder_grouping` | **Defer.** Flat list Phase 3, grouped by `user` or `folder` toggle Phase 5 mirrors `gtkgui/transfers.py`. | |

**Page routes:**

- `/downloads` and `/uploads` — separate pages per guideline's "*download page is 'downloads' and upload page is 'Uploads'*" (`docs/DESIGN.md` + HTML two lists). Also provide tab switcher cross-link when viewed on mobile (so user can toggle without sidebar).
- Auth guard: `state.status !== "connected" → "/"` like `search/page.tsx:52`.
- Empty states: editorial illustration + CTA `Search Files` per `DESIGN.md` whitespace — no mock `TRENDING` card reuse.

---

## 4. Target Architecture

### 4.1 Bridge Proxy FS + OPFS — Recommendation

```
Peer F ──raw bytes──▶ Bridge (Bun, LISTEN_PORT) ──write──▶ data/incomplete/INCOMPLETE<md5><name>
                                                  ──on finish──▶ data/downloads/<name> (+ dedup " (1)")
                                                                     │
                                                                     ▼
Browser ◀──── GET /files/:token (stream) ────────────or─────────── /ws transfer:finished {token, size}
   │ creates writable via showSaveFilePicker() / File System Access API
   └─ optionally caches small previews in OPFS (Origin Private File System) for offline view
```

- **Rationale:** Browser cannot accept raw TCP `F` connections, cannot `open()` multi-GB files in memory, and `incompletedir` semantics require server-side resume. Bridge volumes survive container restarts; `downloads.json` mirrors nicotine+'s persistence.
- **Env:** `DATA_DIR=/data` (Docker volume), `INCOMPLETE_DIR=/data/incomplete`, `DOWNLOADS_DIR=/data/downloads`, `UPLOADS_DIR=/data/received` (remote-initiated). `UPLOAD_SLOTS` default 2 (vs 3 desktop) to protect homelab uplink; override via `compose.yaml`.
- **Security:** Password never persisted (per `AGENTS.md`); `host/port` overridable via `NEXT_PUBLIC_BRIDGE_URL` / `localStorage.nicotine.bridgeUrl` (already present).

### 4.2 Data model (TS — `apps/web/src/lib/protocol.ts` + bridge `transfers.ts`)

```ts
type TransferStatus =
  | "Queued" | "Getting status" | "Transferring" | "Paused" | "Cancelled"
  | "Filtered" | "Finished" | "User logged off" | "Connection closed"
  | "Connection timeout" | "Download folder error" | "Local file error"
  // + UploadDenied reasons mapped to status for display
  | "Banned" | "File not shared." | "File read error." | "Pending shutdown."
  | "Too many files" | "Too many megabytes";

interface Transfer {
  id: string;                // `${username}::${virtualPath}`
  username: string;
  virtualPath: string;       // remote \\ path from search result SearchFile.name
  folderPath: string;        // bridge relative (DOWNLOADS_DIR + maybe username subfolder)
  fileName: string;          // basename virtualPath
  token: number;             // uint32, bridge-allocated, echoed on F
  size: number;              // uint64
  current: number;           // bytes transferred (= offset when resuming)
  speed: number;             // B/s instantaneous
  avgSpeed: number;          // B/s aggregate
  timeLeft: number | null;   // s
  status: TransferStatus;
  queuePosition: number | null;
  modifier: "privileged" | "prioritized" | null;
  isPrivate: boolean;        // from search result
}
```

`FileAttributes` (`soulseek.ts:52` `FILE_ATTRIBUTE`) travels alongside to populate `ResultCard` meta (`bitrate/sampleRate/bitDepth/length`).

### 4.3 WebSocket contract (`apps/web/src/lib/protocol.ts:78`, `apps/bridge/src/server.ts`)

**Client → Bridge:**

| type | payload | notes |
|------|---------|-------|
| `login` | `{username, password, host?, port?}` | existing |
| `search` | `{query}` | existing |
| `download:request` | `{username, virtualPath, size, attrs?, isPrivate?}` | enqueue from `ResultCard` |
| `download:cancel` | `{id}` | `CANCELLED` — keep in failed for retry |
| `download:pause` | `{id}` | `PAUSED` |
| `download:resume` | `{id}` | re-enqueue if paused |
| `download:retry` | `{id}` | clear failed → queued |
| `download:clear` | `{id}` | remove finished/cancelled |
| `download:clearFinished` | `{}` | autoclear analog |
| `upload:cancel` | `{id}` | receiver-side abort → `UploadFailed` |
| `upload:clear` | `{id}` | clear finished |

**Bridge → Client:**

| type | payload |
|------|---------|
| `login:*`, `search:*`, `error` | existing |
| `transfer:update` | `{transfer: Transfer}` — any status/progress change |
| `transfer:queue` | `{id, place}` — from `PlaceInQueueResponse` |
| `transfer:finished` | `{id, fileName, size, downloadUrl: "/files/:token"}` |
| `transfer:removed` | `{id}` |
| `transfer:stats` | `{downloadSpeed, uploadSpeed, activeDownloads, activeUploads, queuedDownloads, queuedUploads}` — 2 s tick, drives header pills |

### 4.4 Upload visibility — nicotine+ parity

- Uploads **always visible** as a nav item & page (`Uploads` `folder_managed`), just like nicotine+ (Uploads tab never hidden).
- When `shares` is empty / unconfigured, `/uploads` shows **disabled banner**:
  `No shared folders configured. Uploads are queued but cannot start until you configure Shares (Settings → Shares).`
  Incoming `QueueUpload` requests still enqueue and reply `File not shared.` (matching `uploads.py: _check_queue_upload_allowed → FILE_NOT_SHARED`), so the queue is inspectable. Place-in-queue still reported.
- `shares` itself is out-of-scope Phase 3 (File System Access API is user-gesture gated — see `settings-mapping.md:123`); we stub with `data/shares.json` editable via Settings (advanced) or compose volume mount until a proper picker ships (Phase 7). No background rescan in web.

---

## 5. Phases — Step-by-Step Implementation

> Each phase lists files, logic, and verification (`bun test && bun run build` per `AGENTS.md`). Do not batch.

### Phase 0 — Docs + Protocol Shims (this document + code shims, no UI)

**Goal:** Wire the protocol types so Phases 1–2 compile without mocks.

**Files:**

- `docs/TRANSFERS.md` (this file) ✅
- `apps/bridge/src/soulseek.ts:19` — extend `SERVER_MESSAGE_CODES` with `connectToPeer:18, cantConnectToPeer:1001, sendUploadSpeed:121, privilegedUsers:69, relogged:41`; `PEER_MESSAGE_CODES` with `transferRequest:40, transferResponse:41, queueUpload:43, placeInQueueResponse:44, uploadFailed:46, uploadDenied:50, placeInQueueRequest:51, folderContentsRequest:36, folderContentsResponse:37`; `PEER_INIT_CODES` constant. Add builders:
  `buildConnectToPeer(token,user,type)`, `buildCantConnectToPeer(token)`, `buildSendUploadSpeed(speed)`,
  `buildQueueUpload(file)`, `buildTransferRequest(dir,token,file,size)`, `buildTransferResponse(token,allowed,reasonOrSize)`, `buildPlaceInQueueRequest/Response`, `buildUploadFailed/Denied`, `buildFolderContentsRequest/Response` (zlib inflate/deflate helpers) and parsers mirroring `SlskReader` patterns already in `soulseek.ts:120`. Add `packUint64` (LE hi/lo) for `FileOffset` and size fields; `parseFileOffset`.
- `apps/bridge/src/soulseek.test.ts:1` — hex vectors from `SLSKPROTOCOL.md:458` Login 72-byte + new vectors: `TransferRequest` (direction+token+string+u64), `QueueUpload`, `FileTransferInit`/`FileOffset` round-trips.
- `apps/web/src/lib/protocol.ts:1` — add status unions + transfer message types (§4.3). Keep `BridgeInboundMessage` union extended but backward compat.
- `apps/web/src/lib/config/defaults.ts:68` — no changes yet (do in Phase 5) but add TODO comment.

**Verify:** `bun test` (new parser hex vs doc), `bun run build`.

### Phase 1 — Indirect Connectivity (mandatory for transfers)

**Goal:** ~60 % of peers need indirect `ConnectToPeer/PierceFirewall`; without this, downloads fail.

**Files:**

- `apps/bridge/src/session.ts:1` — server handler switch: case `18` `parseConnectToPeer` → store pending `{token, username, connType}` + if `connType==="P"` attempt **Pierce**: `Bun.connect(ip,port)` → send `buildPierceFireWall(token)` immediately (no PeerInit); else if `F` let transfers layer dial. Handle `1001` `CantConnectToPeer`. `GetPeerAddress(3)` cache (`Map<user,{ip,port,expiry 60s}>`) to avoid repeat lookups (`buildGetPeerAddress:564`).
- Listener demux: current `Bun.listen` peer handler reads first 4 bytes length. For `F` connections, the first 4 bytes are `token` LE with no `PeerInit` — detect by peeking: if after `PierceFirewall` probe (`code 0`) vs `PeerInit` (`code 1` + two strings) fails, treat as raw F `FileTransferInit`. Record `fileToken`.
- Outbound peer dial utility `connectPeer(username, type): Promise<Socket>` that does `GetPeerAddress` → `Bun.connect` + `PeerInit(P)` → race against `ConnectToPeer` indirect trigger (45 s timeout like `downloads.py` Getting status). Track `pendingConnects: Map<token, {resolve,reject,timer}>`.
- `apps/bridge/src/server.ts:1` — expose WS `peer:connect {username}` diagnostic for manual testing.

**Verify:** connect to two test peers (one behind NAT); logs `ConnectToPeer → PierceFirewall → P established` for indirect.

### Phase 2 — Bridge Transfer Engine — Downloads (minimal viable)

**Goal:** Search result → queued → Transferring → finished file on bridge volume.

**New file `apps/bridge/src/transfers.ts` (TransferManager):**

- State mirrors nicotine+ (§1.1) but simplified: `Map<id, Transfer> transfers`, `queued: Map<id,Transfer>` (insertion order), `active: Map<token,Transfer>`, `failed: Map<id,Transfer>`, `totalDownloadBandwidth/uploadBandwidth` (bytes/s rolling 2 s window).
- `enqueueDownload({username, virtualPath, size, attrs, isPrivate})`:
  1) dedup `transfers.has(id) → already Queued`
  2) if `watchUser` shows offline → `User logged off`, `watch_user(username)` + re-queue on `GetUserStatus:2`.
  3) `queued.set(id, t)` + persist `downloads.json` (debounce 2 s)
  4) send `QueueUpload(virtualPath)` via P socket (open if needed via `connectPeer(username,"P")`). If `shares rescanning` defer (stub bool false in mobile).
  5) emit `transfer:update` over WS (`Queued`, `queuePosition=null` until `PlaceInQueueResponse`).
- Inbound `TransferRequest(UPLOAD, token, file, size)` → `_activate`: verify `queued.has(fileKey)` → `{status:"Getting status", token}` + 45 s `setTimeout(()→ Connection timeout)` → emit.
- Inbound `PlaceInQueueResponse(file, place)` → `queuePosition=place` → emit `transfer:queue`.
- Inbound `UploadDenied(file, reason)` → map to status `reason` (`File not shared.` etc.) or `Cancelled` → `failed` + emit.
- Poll `PlaceInQueueRequest(file)` every 300 s for all `Queued` items (configurable 60 s for mobile).
- F accept: when inbound `F` with `token` arrives, lookup `active[token]` → open `incompletePath` (`getIncompletePath` per §1.5: `INCOMPLETE<md5(virtualPath+username)>+basename` truncated to 255) via `Bun.file`/`fs.openSync "ab+"` → compute `offset = stat.size` (or 0 if `size_changed`). Send `FileOffset(uint64 offset)` (pack 8 bytes LE) → create `DownloadFile` job that reads raw bytes until `size-offset` received. On each chunk: decrement `leftbytes`, update `current = size-leftbytes`, `speed = bytes/dt`, `avgSpeed`, `timeLeft`, emit `transfer:update` throttled 500 ms.
- On `leftbytes==0` → `FINISHED` → close handle → `moveFinished` (`fs.rename` with `"(1)"` collision loop + `NAME_MAX` truncate) → `SendUploadSpeed(avgSpeed)` not needed for download but track stats → `transfer:finished {downloadUrl}` → `downloads.json` persist. Downloader **must close F** to signal completion to uploader.
- On socket close with `leftbytes>0` → `Connection closed` → `failed.set(id,t)` + `UploadFailed` is ignored (re-queue) unless `Cancelled/Finished`. Timers: 180 s retry for `Connection closed/timeout`, 900 s for `Local file error` (bridge disk full etc.) — simple `setTimeout` re-enqueue.
- Persistence: `data/downloads.json` JSON array `[username, virtualPath, folderPath, status, size, current, {attrs}]` loaded on bridge start; only `PAUSED/FILTERED/FINISHED` retained as `Paused` otherwise `User logged off` (nicotine+ compat).
- `GET /files/:token` HTTP handler in `server.ts` streams finished file with `Content-Disposition: attachment; filename="..."` — browser downloads or OPFS ingest.

**Files:**

- `apps/bridge/src/transfers.ts` (new), `apps/bridge/src/session.ts` (delegate P messages 40/41/43/44/50/51 to TransferManager), `apps/bridge/src/server.ts` (WS download:* routes, HTTP /files/:token + /health).
- `compose.yaml` add `volumes: - bridge-data:/data` for `bridge` service.

**Verify:** `bun run --cwd apps/bridge dev` → enqueue a small known file from search → observe `Queued → Getting status → Transferring 45% → Finished` + file on `data/downloads/`.

### Phase 3 — Web Downloads & Uploads Pages (visual guideline → editorial reality)

**Goal:** Ship the HTML's visual language as real React routes, touch-safe.

**Files:**

- `apps/web/src/lib/session.tsx:1` — extend `SessionState { transfers: Transfer[], transferStats: {downloadSpeed,uploadSpeed,active,queued}, transfersByStatus }` + reducers for WS `transfer:update|finished|queue|stats`; selectors `useTransfers(kind)`; action `downloadFile(result: SearchFile & {username})`, `cancelTransfer(id)`, etc.
- `apps/web/src/lib/protocol.ts` — finalize types added in Phase 0.
- New `apps/web/src/components/transfers/TransferCard.tsx` — props map §4.2; layout:
  ```tsx
  <div className="bg-surface-container-lowest rounded-xl p-4 flex flex-col gap-3 ghost-border">
    <div className="flex justify-between items-start">
      <div><h4 className="font-body font-semibold text-sm truncate max-w-[240px]">{title}</h4>
      <p className="font-label text-xs text-on-surface-variant mt-1">{peerLabel} • {humanSize(size)}</p></div>
      <div className="text-right"><span className="font-label font-bold text-primary text-sm">{speedLabel}</span>
      <span className="font-label text-xs text-on-surface-variant">{etaOrStatus}</span></div>
    </div>
    <div className="w-full bg-surface-container-highest rounded-full h-1.5">
      <div className={`h-1.5 rounded-full ${upload ? 'bg-tertiary':'bg-primary progress-glow'}`} style={{width:`${pct}%`}}/>
    </div>
    <div className="flex justify-end gap-2">…pause/close or prioritize/play/close…</div>
  </div>
  ```
  Queued variant `opacity-75` + `outline` bar, Finished `100%` muted. Action buttons `min-h-11 min-w-11` per touch target.

- `apps/web/src/components/transfers/TransfersHeader.tsx` — pills `arrow_downward/upward` + speeds, `settings` gear link to `/settings?section=transfers`.

- `apps/web/src/app/downloads/page.tsx` (primary) and `apps/web/src/app/uploads/page.tsx` (peer) — both guarded `status!=connected → "/"` like `search/page.tsx:52`. Desktop: `grid xl:grid-cols-2` from HTML; Mobile: segmented tabs control (`Downloads | Uploads`) switching via `next/navigation` push with `replace` (preserves `translations`). Header, throughput placeholder (light `surface` `h-64` gradient — no live chart yet), transfers list `map transfers.filter(kind)`. Empty state: editorial centered `Noto Serif` `No active downloads yet` + `Search Files` CTA.
- `apps/web/src/components/Sidebar.tsx:1` — wire `Downloads href="/downloads"` active when `pathname==="/downloads"` (filled `downloading` `FILL 1` + `bg-primary-fixed/30`) and `Uploads → "/uploads"` similarly; show counts from `transferStats`.

- Search integration: `apps/web/src/components/ResultCard.tsx:1` add `Download` button `bg-primary → primary-container gradient` `Add to downloads` that calls `downloadFile({username,size,name,attrs})` + toast `Queued`. Respect `min_search_chars` not relevant.

**Verify:** Playwright before UI drive: `cp apps/web/.env.example apps/web/.env` (per `AGENTS.md`), `bun run build`, navigate `/downloads` gated, enqueue from `/search` → card appears `Queued → Transferring`.

### Phase 4 — Bridge Upload Serving (homelab as uploader — parity with nicotine+)

**Goal:** Other peers can download from us; queue is inspectable, disabled when no shares.

**Files:**

- `apps/bridge/src/transfers.ts` — upload path mirror of download: `enqueueUpload` incoming handler `handleQueueUpload(username, virtualPath, ip)`:
  1 checks `checkUserPermission` (stubbed `allow all` until bans/geo Phase 5; read `data/shares.json` for `file_is_shared` — legacy `virtual2real` via `shares` map `virtualName→realDir`),
  2 `rescanning→defer`, `isQueued→Queued`, `pending_shutdown→Pending shutdown.`, `isQueueLimitReached→Too many files/megabytes` (use `queuelimit/filelimit` from Settings env),
  3 else `queued.set`, emit `UploadDenied(Queued)` not allowed via TransferResponse legacy path is deprecated — instead just `PlaceInQueueResponse` on poll; initiate `checkUploadQueue` timer (10 s loop).
- `checkUploadQueue`: guard `isNewUploadAccepted()` (`queued.size===0 || active.size>=slots || totalBandwidth>=limit || rescanning`). Pick `getUploadCandidate()` — start with **FIFO only** (simple `queued` insertion order); RR + privileged deferred to Phase 5. Validate `online` + `file_exists` + `current_size`. `_dequeue→_activate→TransferRequest(UPLOAD, token, file, size)` (+ `PlaceInQueueResponse` of remaining). Listen for `TransferResponse` allow → expect outbound F from downloader with `FileOffset`; then `open(file,"rb")` → `UploadFile(job)` streaming raw bytes throttled via adaptive `4096` chunk calc like `slskproto._process_upload`.

- `apps/bridge/src/server.ts` — WS `transfer:stats` now includes both directions; `GET /shares` debug endpoint.

- `apps/web/src/app/uploads/page.tsx` — same card component with `tertiary` progress; queued variant `arrow_upward` prioritize + `play_arrow` resume; `Uploads` always visible nav; when `shares.length===0` show banner `No shared folders` (nicotine+ parity) with `Configure Shares → /settings#transfers`.

**Verify:** Two-bridge test: Bridge A shares a file via volume `data/shares.json`, Bridge B `QueueUpload` → Bridge A serves → Bridge B finishes.

### Phase 5 — Queue Fairness, Privilege, Filters, Persistence Hardening

**Goal:** Match nicotine+ queue subtleties before calling transfers complete.

**Files:**

- `apps/bridge/src/transfers.ts` — implement `fifoqueue: boolean` (env `FIFO_QUEUE`) true→FIFO, false→round-robin `_userUpdateCounters: Map<string, number>` incremented on every enqueue/dequeue/abort (like nicotine+ `_update_user_counter`); only queued-non-active users counted. Privileged gate: load `privilegedUsers` from server 69 (`PrivilegedUsers` WS passthrough) plus `buddies` list (from Settings `server.userlist` / `preferfriends`) → `isPrivileged(user)` check; if any queued privileged exists, restrict candidate set. Set `modifier` for UI badge `Privileged` pill (`tertiary-fixed-dim`).
- `apps/web/src/lib/config/defaults.ts:68` — add `transfers` section per `settings-mapping.md:127` (11 download + 13 upload keys; defaults as table §1.6). Expose in `Settings` → `NetworkSection`/`UiSection` analog `TransfersSection` using `controls.tsx` `NumberControl`/`ToggleControl`/`RadioGroupControl`/`SelectControl` (`uploadslots min 1`, `queuelimit 10000 MB`, etc.). Persist `localStorage nicotine.settings` + sync subset to bridge via WS `settings:update` for active limits.
- Upload permission checks: `shares.check_user_permission` via `server.banlist/ipblocklist` + `transfers.usecustomban/customban`, `transfers.geoblock/geoblockcc` (`settings-mapping.md:274`). File sharing: `virtual2real` with backslash fix + `check_user_permission`.
- Filters: `transfers.enablefilters` + `downloadfilters` regex (`re.compile("\\\\(" + "|".join(filters) + ")$")`) applied on enqueue → `Filtered`.
- Persistence hardening: `downloads.json` atomic write (`write tmp → rename`), `transfers_file_path` load filter `["Paused","Filtered","Finished"]` only (like nicotine+ `_get_stored_transfers`), `Aborted → Paused` migration, legacy `"123 (vbr)"` attribute parsing, `normpath` folder cache.
- Web OPFS finish: after `transfer:finished {downloadUrl}`, browser calls `fetch(downloadUrl)` → if `showSaveFilePicker` available, stream via `WritableStream`; else `a.href=downloadUrl; a.download=fileName; a.click()`. Offer `Save to OPFS` toggle for small (<200 MB) files via `navigator.storage.getDirectory()`.

**Verify:** `bun test` includes filter regex; `fifoqueue toggle → queued order changes`; banned user gets `Banned` status.

### Phase 6 — Throughput Chart + Bandwidth Shaping (deferred polish)

**Goal:** Replace static HTML placeholder with live viz; optional shaping.

**Files:**

- `apps/web/src/components/transfers/ThroughputChart.tsx` — canvas or Recharts `AreaChart` (2 series `primary #094cb2` download `tertiary #6d5e00` upload, `fillOpacity 0.1/0.05` linear gradient `transparent → tint`, matching `Downloads_uploads.html:177` faux). Sample `transfer:stats` every 2 s → ring buffer 60 points (120 s). Dark mode swap `primary-container` fill. Placeholder static SVG kept as fallback when `active==0`.
- `apps/bridge/src/transfers.ts` — adaptive throttling: `SetDownloadLimit/SetUploadLimit` env maps to bytes/s; `_calc_upload_limit` splits across `active.size`; `_process_upload` reads `max(4096, sent*1.25/dt)` (like nicotine+). Emit `total_bandwidth` for chart. No kernel QoS.

**Verify:** Start 2 parallel downloads → chart shows two-line area, header pills update live.

### Phase 7 — Shares + Folder Downloads + Full Parity (stretch)

**Goal:** Complete upload parity and folder downloads; true nicotine+ “Correct” requirement.

**Files:**

- `apps/bridge/src/transfers.ts` — `request_folder(user, folderPath)` → `FolderContentsRequest(36)` + `AddAllowedResponse` pattern, 5 s retry once; handle `FolderContentsResponse(37)` zlib parse; auto-enqueue each file via `enqueueDownload`; emit `folder-download-finished` per `pynicotine/downloads.py:_folder_downloaded_actions`.
- Shares scanning: mount `shares` volumes + `rescan_shares` background job (or stub `shares.json` manual). UI `Settings → Shares` folder picker using `showDirectoryPicker()` where available, else path input.
- Notifications: map `notifications.notification_popup_{file,folder,queued_upload}` to Web `Notification.requestPermission()` + `navigator.vibrate` fallback; title badge via `notification_window_title`.
- Grouping: `groupdownloads/groupuploads: "folder_grouping"` toggle → parent rows by `folder_path` or `user`, collapsing `expand_downloads="all"` default.
- Auto-clear toggles `autoclear_downloads/uploads` — on `Finished` if true emit `transfer:removed` immediately vs keep for inspection.

**Verify:** `userbrowse.download_folder` end-to-end (browse shares → download folder) + folder finished notification.

---

## 6. Settings — What Changes (`docs/settings-mapping.md:127` / `defaults.ts:68`)

**Add new `transfers` section** (merge with existing `shares` stub — shares is part of `transfers` per nicotine+ `pynicotine/config.py`):

| Key (transfers) | Default (nicotine+) | Web control | Phase |
|---|---|---|---|
| `downloaddir` | `data/downloads` | Read-only in bridge; browser download dir is user picker | 2 |
| `incompletedir` | `data/incomplete` | Read-only bridge | 2 |
| `uploaddir` | `data/received` | Bridge volume | 4 |
| `shared` / `buddyshared` / `trustedshared` | `[]` | File System Access picker — defer display only (banner) | 4 |
| `downloadlimit` / `downloadlimitalt` | `1000` / `100` KB/s | Number/slider | 5 |
| `use_download_speed_limit` | `"unlimited"` | Radio primary/alternative/unlimited | 5 |
| `uploadlimit` / `uploadlimitalt` | `1000` / `100` KB/s | Number/slider | 5 |
| `use_upload_speed_limit` | `"unlimited"` | Radio | 5 |
| `uploadbandwidth` | `50` % | Slider | 5 |
| `useupslots` | `true` | Radio fixed slots vs auto-bandwidth | 5 |
| `uploadslots` | `3` → **2** on mobile (protect uplink) | Number min 1 | 5 |
| `queuelimit` | `10000` MB | Slider | 5 |
| `filelimit` | `100` | Number | 5 |
| `fifoqueue` | `false` (RR default) | Toggle | 5 |
| `limitby` | `true` (by MB) | Radio MB vs files | 5 |
| `friendsnolimits` | `false` | Toggle | 5 |
| `preferfriends` | `false` | Toggle | 5 |
| `autoclear_downloads/uploads` | `false` | Toggle | 7 |
| `enablefilters` + `downloadfilters` | `false` | Toggle + list editor | 5 |
| `usernamesubfolders` | `false` | Toggle | 2 |
| `groupdownloads/groupuploads` | `"folder_grouping"` | Select | 7 |
| `expand_downloads/uploads` | `"all"` | Select | 7 |
| `remotedownloads` / `uploadallowed` | `false` / `3` | Toggle + Select (0 None /2 Buddies /3 Trusted) | 4 |

Omit in browser: `afterfinish`/`afterfolder` shell commands (`settings-mapping.md:143`), MPRIS/speech.

---

## 7. Verification & Do-Not-Implement List

**Per-phase verification (required `bun test && bun run build`):**

- Phase 0: `bun test` — packing vectors vs `SLSKPROTOCOL.md:472` 72-byte Login + new Transfer messages; `bun run build` types pass.
- Phase 1: Bridge logs `ConnectToPeer(18) → PierceFirewall(0) → P established` for indirect peer; `GetPeerAddress` cache hit.
- Phase 2: Enqueue small file from `/search` → `Queued (place 3) → Getting status → Transferring 45% → Finished`; `data/downloads/` file present; `GET /files/:token` download.
- Phase 3: Playwright (first `cp apps/web/.env.example apps/web/.env` per `AGENTS.md`) → `/downloads` gated, card progress glow, pause/close touch ≥44 px, tabs on mobile, two-col on `xl`.
- Phase 4: Cross-bridge upload → downloader closes F → `SendUploadSpeed(121)` + uploader credits.
- Phase 5: `fifoqueue` toggle reorders queue; banned user → `Banned`; filter regex `*.exe` → `Filtered`.
- Phase 7: Folder download `36/37` → all files enqueued; `Finished` count matches.

**Do NOT implement (HTML guideline deferral):**

- Real-time Network Throughput chart in Phase 3 (ship placeholder — §3 table).
- File-attribute–aware search filtering (`defilter`) beyond simple regex (Phase 5 only simple `downloadfilters`).
- Multi-select/bulk actions, column sorting, drag reorder in transfers list.
- Desktop `afterfinish` shell hooks, plugin system, `MPRIS`/`Last.fm` Now Playing (see `settings-mapping.md:245`).
- Obfuscated port support (nicotine+ explicitly omits — `SLSKPROTOCOL.md:515`).
- Distributed search network `D` connections — only `P` and `F` needed for transfers.

---

## 8. Risks

- **Inbound port** `LISTEN_PORT` must be forwarded on homelab (`compose.yaml` `2234:2234`) for direct peers — documented `README.md` / `AGENTS.md` `Keep login MVP minimal` note; Phase 1 indirect mitigates but not fully.
- **Browser → bridge volume divorce:** browser localStorage `transfers` is mirror only; bridge JSON is truth. Clear site data does not delete server files.
- **Large files >2 GB:** NS offset -1 bug (`SLSKPROTOCOL.md:3174`) — guard `offset > size → Local file error` and truncate incomplete.
- **One active `P` per peer** — do not open parallel P sockets to same user (violates protocol).
- **Experimental version 177/1** (`soulseek.ts:76`) is reserved — do not reuse `160/157` etc. (`SLSKPROTOCOL.md:240`).

---

## Appendix — File Reference Index

| Concern | Source | Mobile analog |
|---|---|---|
| Downloads queue/filter/resume | `pynicotine/downloads.py:1` | `apps/bridge/src/transfers.ts` enqueue + incomplete `INCOMPLETE+md5` |
| Uploads slot/privilege | `pynicotine/uploads.py:1` | same `transfers.ts` candidate select |
| Transfer types | `pynicotine/slskmessages.py: FileAttribute:0`, `TransferDirection:158`, `TransferRejectReason:166` | `apps/bridge/src/soulseek.ts:52` already `FILE_ATTRIBUTE` |
| Networking | `pynicotine/slskproto.py` `DownloadFile/UploadFile/Set*Limit` | `apps/bridge/src/session.ts` `Bun.connect` + F streaming |
| Config | `pynicotine/config.py: transfers` | `apps/web/src/lib/config/defaults.ts:68` `transfers` section |
| UI grouping | `pynicotine/gtkgui/transfers.py:1` | `TransferCard` grouping deferred Phase 7 |
| Protocol | `doc/SLSKPROTOCOL.md:88` constants + `:3185` flow | `apps/bridge/src/soulseek.ts:215` builders |
| Search handoff | `docs/search/workflow.md` + `ui.md:5` | `apps/web/src/app/search/page.tsx:1` `ResultCard` Download CTA |
| HTML guideline | `docs/Downloads_uploads.html:150` | `apps/web/src/app/downloads/page.tsx` / `uploads/page.tsx` per §3 |
| Design | `docs/DESIGN.md:1` | `globals.css` tokens, `Sidebar.tsx:1` active `FILL 1` |

---

*Next step:* implement Phase 0 shims, then Phase 1 indirect — open a branch off `main` with `bun test && bun run build` gating each phase.
