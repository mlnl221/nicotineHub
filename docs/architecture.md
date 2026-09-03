# Architecture & Protocol

This doc holds the technical details removed from `README.md` for brevity.

## Bridge

The browser cannot open raw TCP; the bridge is the only SLSK speaker. JSON over `ws://host:8787/ws` is translated to Soulseek binary framing `[uint32 len][uint32 code][payload]` (little-endian; `PeerInit`/`D` use `[uint32 len][uint8 code][payload]`).

```
[ Browser (Next.js PWA) ] --WS JSON--> [ Bun bridge :8787 ] --TCP--> server.slsknet.org:2242
         |                    --HTTP--> [ Python worker :8789 ] --HTTP--> Discogs/Bandcamp/Apple/…
          |                                sox/flac/ffmpeg/numpy/mutagen (oxipng recompress skipped — not in image)
         |                              \--volumes--> bridge-data:/data (RO) + spectrum-cache:/tmp/hub-spectrum
         \--HTTP--> bridge GET /files/:token (finished downloads)

Bridge peer legs: `--P--> peers (messages)`, `--F--> file (raw bytes)`, `--D--> distrib (leaf only)`.
```

Reference: [nicotine-plus `doc/SLSKPROTOCOL.md`](https://github.com/nicotine-plus/nicotine-plus) (GPL-3.0-or-later) and `apps/bridge/src/soulseek.ts` (102 server / 18 peer / 6 distrib / 2 file codes). See `ATTRIBUTION.md` and `LICENSE` — this bridge is a port of `pynicotine/slskmessages.py`/`slskproto.py` under GPL-3.0-or-later.

## Login

1. `Login` (1): `string username`, `string password`, `uint32 major=160`, `string md5_hex(username+password)`, `uint32 minor=3` (`apps/bridge/src/soulseek.ts:198`)
2. `SetWaitPort` (2): `uint32 port` + `SharedFoldersFiles 35` (`dirs/files` from `ShareDB`) after success (nicotine parity).  
   Response `Login` (1): `bool success` → on success `string banner`, `uint32 ip`, `string checksum`, `bool isSupporter`; on fail `string reason` ∈ {`INVALIDUSERNAME`,`EMPTYPASSWORD`,`INVALIDPASS`,`INVALIDVERSION`,`SVRFULL`,`SVRPRIVATE`} + detail.

## Search

- Modes: `FileSearch 26` (global), `UserSearch 42`, `RoomSearch 120`, `WishlistSearch 103` / `WishlistInterval 104`, `ExcludedSearchPhrases 160` gated.
- Flow: browser `search:start {query,mode}` → bridge allocates `uint32` token (`allowedSearchTokens` gate, incr wrapping at `2^32`) → `FileSearch` to server → server floods via `DistribSearch 3` → peers connect back over `P` and send `FileSearchResponse 9`.
- `FileSearchResponse 9` over `P`: `[len][code 9][zlib(payload)]`, two-stage inflate 16M compressed / 128M decompressed, flat file list (`\`-split for folder grouping, sorted by name when `n>1`), `>2GiB` NS sentinel fix, private block (≤10000), `slotFree`/`avgspeed`/`inQueue` header, token-matched then `MAX_DISPLAYED_RESULTS 400` cap + per-user dedup.
- Query hygiene: split on space, drop bare `-word` before transmit (reapplied client-side as `excluded_words`), preserve `"exact phrase"`/`*partial`, `min_search_chars 3` (web default; bridge schemas accept `≥1`). Attributes: `0 bitrate kbps`, `1 duration s`, `2 VBR`, `4 sampleRate Hz`, `5 bitDepth bits` (combos `{0,1,2}` lossy, `{1,4,5}` FLAC/WAV, `{0,1,4,5}` WV).
- Filters (live, nicotine parity defilter): `filterin/filterout` regex on path+username, `filtersize` (`< <= == != >= >`, bare `= → ==`, `k/m/g` binary, `MiB`/`B` decimal, `>10.5m <1g`), `filterbr` kbps, `filterlength` sec or `HH:MM:SS` (`>6:00 <12:00`), `filtertype` `flac wav` / `!mp3` / generic `audio/image/video/document/text/archive/executable`, `filtercc` `US !DE` / `,`/`;`/`-` split, `filterslot` (free slot only), `filterpublic` (hide private). Live on keystroke, clear/restore toggle, history 50.
- Connect-back: direct `PeerInit 1` (`string user`+`string type P`+`uint32 0`, framing `[len][u8 code][payload]`) vs indirect `ConnectToPeer 18` relay + `PierceFireWall 0` (`uint32 token`). `P`/`S` framing `[len][uint32 code][payload]`, `D`/`PeerInit` `[len][uint8 code][payload]`.

## Transfers (F)

- `ConnectToPeer 18` / `CantConnectToPeer 1001` — direct + indirect `PierceFireWall 0` race 45s (`CONNECT_PEER_TIMEOUT_MS`, `GetPeerAddress 3` cache 30m)
- `QueueUpload 43` → `TransferRequest 40` (`direction 1` upload) → `FileTransferInit` (4B token) + `FileOffset` (8B LE) → raw bytes
- `PlaceInQueueRequest 51` → `PlaceInQueueResponse 44` (real place via `TransferManager.getQueuePlace`), `UploadDenied 50`/`UploadFailed 46`
- Incomplete: `DATA_DIR/incomplete/INCOMPLETE<md5(virtualPath+username)>` + resume offset, `SendUploadSpeed 121` on finish, limiter `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT` (KB/s, TokenBucket `GetAsync` + `limiterDelay` backpressure split per active transfer `max(1024,base/active)`, env aliases `UPLOADLIMIT`/`DOWNLOADLIMIT`)
- Persistence: `DATA_DIR/downloads.json` (atomic tmp→rename) + `transfers.json` compat, `Finished` served via `GET /files/:token` (`Content-Disposition`)
- **Spectrum moved to the worker** (was bridge `spectrum.ts`, deleted) — see `## Worker` + `docs/spectrum.md`. Bridge only materializes the finished file under `DATA_DIR/downloads` (copy shared source or synth valid audio) so the worker has real input.

## Browse / Shares

- `SharedFileListRequest 4` → `SharedFileListResponse 5` (zlib lvl4 sorted), `FolderContentsRequest 36` → `FolderContentsResponse 37`, 0.4s throttle per peer (`ShareDB.shouldThrottle`), `ExcludedSearchPhrases` gated, FS scanner `ShareDB.scanFsShares` via `SHARED_DIRS` colon list (attrs empty on sync scan, enriched async via `music-metadata`).

## Chat / Rooms / Privileges

- `SayChatroom 13`, `MessageUser 22`+`MessageAcked 23`/`MessageUsers 149`, `JoinRoom 14`/`LeaveRoom 15`/`UserJoined/Left 16/17`/`RoomList 64`/`RoomMembers 133`/`Add/RemoveMember 134/135`/`RoomTickers 113-116`/`GlobalRoom 150-152`
- `WatchUser 5`/`Unwatch 6`/`GetUserStatus 7`/`GetUserStats 36`/`UserInterests 57`/`Recommendations 54/56`/`SimilarUsers 110`/`ItemRecommendations 111`/`ItemSimilarUsers 112`/`GivePrivileges 123`/`CheckPrivileges 92`/`ChangePassword 142`
- `UserInfo` `descr/pic/totalupl/queuesize/slotsavail/uploadallowed` via `UserProfileSection.tsx`: `userinfo: {action:"setProfile", profile: {...}}` → stored (`session.ts:956`) and served via `buildUserInfoResponse` (`soulseek.ts:879`, banned peers get empty descr); web debounces 800 ms when `useSession` `connected`, base64 `pic` 5 MB guard + WebP 512 px resize

## WebSocket JSON bridge (`apps/bridge/src/server.ts`)

Browser ↔ bridge JSON (all `zod` validated, 1 MB frame guard):

```
login {type:"login", username,password, host?,port?} → {type:"login:result", ok}
search {type:"search", searchId, query} | {type:"search:user", username,query} | {type:"search:room", room,query} | {type:"search:wishlist"} → {type:"search:start",token} + {type:"search:result",rows} + {type:"search:end"}
search:stop / search:page (paged slices; no server-side cache — search cache disabled, always hits network) / browse:page (5-min `browseCache`, `userInfoCache` 5m)
browse {type:"browse", action:"shares"|"folder", username,folder?,token?} → {type:"browse:shares"|"browse:folder"}
chat:room {action:"join"|"leave"|"say"|"ticker"|"setTicker"|...} + chat:private {action:"send"|"ack"} → {type:"chat:event"|"room:event"}
download:request {username,virtualPath,size,fileName?} + download:control/upload:control {id,action} → {type:"transfer:update/stats/queue/finished"}
spectrum via worker HTTP (`apps/web/src/lib/worker.ts`), not WS — bridge WS `spectrum:request|status` only replies `spectrum:error` (stale-bundle guard), `GET /spectrum/*` on bridge returns `410`
userinfo {action:"watch"|"unwatch"|"get"|"peerAddress"|"recommendations"|...} → {type:"userinfo:event"}
plugin:list / toggle / reload / uninstall / plugin:settings / resetSettings → {type:"plugin:list"|"plugin:toggled"|...} (bridge `PluginManager`, builtins-only — `install*` paths disabled, return null) + `plugin:installGithubTs` (disabled, same guard)
 config:update {section,key,value} / wishlist:update {terms} + statistics:request / reset + ping→pong
 diagnostics + `/health` (plain `ok`; `?json` full `{listenPort,dataDir,upnp,...}` only with token, limited otherwise) + `/api/upnp/status` + `/interfaces` + `/api/files` (host-root browser, token-gated) + `/portchecker` (open)
 ```

## Distributed (leaf-only, `stage` `5c65ea9`+)

Bridge is **leaf-only** (no child aggregation — matches nicotine leaf mode): sends `HaveNoParent 71` + `BranchLevel 126/Distrib 4` (+1) + `BranchRoot 127/5` + server notify on login, handles `PossibleParents 102` (10 parallel `D` dials, `_adoptParent` best `branchLevel` on `DistribSearch 3`), `ParentMinSpeed 83`/`Ratio 84` → `maxChildren = min(speed//ratio//100,10)`, forwards `DistribSearch 3`/`EmbeddedMessage 93` (`DistribSearch` again), replies `DistribPing 0`, re-bootstraps on `ResetDistributed 130` + `AcceptChildren 100` toggle (uploadSpeed), 15m watchdog `HaveNoParent` when parentless. `D` framing is `[len][uint8 code]` vs `P`/`S` `[len][uint32 code]`; `session.ts` `startListener` advertises `LISTEN_PORT` via `SetWaitPort 2` + `PortMapper`.

## Bridge files

- `soulseek.ts` — framing/packing, builders/parsers for all codes (102 server / 18 peer / 6 distrib / 2 file)
- `session.ts` — server socket + `startListener` (`P` vs `F` strict demux via `pendingFileTokens` only, no heuristic), peer states (`buf/initDone/isFileConn/fileToken`), idle sweep (2s init, 10s ghost, 60s max), `GetPeerAddress` cache 30m, search/browses, distributed leaf bootstrap (`HaveNoParent 71`, `PossibleParents 102` 10 dials, `BranchLevel/Root`, 15m watchdog), `PortMapper` (`portmapper.ts`, UPnP-only) on login/disconnect/port change
- `shares.ts` — `ShareDB` (`DATA_DIR/shares.json`, in-memory folders, search, `buildSharedFileListResponse 5`/`FolderContents 36/37` zlib lvl4, `shouldThrottle` 400 ms)
- `transfers.ts` — `TransferManager` (Map `id→Transfer`, queued/active, 2s `transfer:stats`, 300s `PlaceInQueue` poll, `INCOMPLETE<md5>` + atomic `downloads.json` + `GET /files/:token`)
- `spectrum.ts` — **deleted (migrated to worker)**. Was: `SpectrumManager` (sox `2000×513` Full + `500×1025` Zoom, Kaiser `-z 120`, `oxipng -o 2`, `/tmp/hub-spectrum`, 2-concurrent queue, `sha256(token:mtime:size)` etag). Now: `apps/worker/spectrals.py` (own implementation, same output semantics).
- `portmapper.ts` — UPnP-only `PortMapper` (NATPMP removed; UPnP is the homelab default): SSDP multicast `239.255.255.250:1900`, SOAP `AddPortMapping`/`DeletePortMapping`, lease 43200 s / renewal 7200 s, `setPort`/`add`/`remove` like `pynicotine/portmapper.py:PortMapper`, `status` `{active,port,ip,error,lastSuccessAt}` for diagnostics
- `portchecker.ts` — `PortChecker` external host `https://www.slsknet.org/porttest.php?port=%s` (like `pynicotine/portchecker.py`, timeout 5 s, checks `"port/tcp open"` vs `"closed"`), singleton `portChecker`, `/api/portchecker?port=` endpoint
- `server.ts` — `Bun.serve` (`/ws` zod, `/health` (plain vs `?json`), `/logs`, `/diagnostics`, `/files/:token` sanitized `Content-Disposition`, `/api/files` host-root browser, `/spectrum/*` → `410 moved to worker`, `/plugins` list only, `/portchecker` (open), `/api/upnp/status`) + token via `?token`/`Authorization`/`Sec-WebSocket-Protocol` + CORS/CSP (`getCorsHeaders`, `SECURITY_HEADERS`) + 1 MB WS guard + 5-min `browseCache` (search cache disabled). No audio tooling, no external fetch (SLSK-only).
- `plugins/manager.ts` (+ `builtin/core_commands`, `builtin/spamfilter`, `builtin/leech_detector`) — `PluginManager` (`plugins.json` `installed/enabled`, `PLUGININFO/metasettings`, `returncode.zap/break/pass`, `core_commands` ships only `/help` + `/plugin`) — WS `plugin:list/toggle/reload/uninstall` + `plugin:settings/resetSettings`. `install*` (zip/URL/GitHub-TS) are disabled — builtins only (`ponytail: re-add if user plugins needed`).

## Env (full)

| Env | Default | Notes |
|-----|---------|-------|
| `PORT` | `8787` | WS port (`apps/bridge/src/server.ts:196`) |
| `LISTEN_PORT` | `60754` | Peer listener — **default 60754** (`DEFAULT_LISTEN_PORT` `apps/web/src/lib/config/defaults.ts:210`). Editable via `server.portrange` in Settings → Network (`NetworkSection.tsx:82`), persists to `DATA_DIR/listen_port` (env `LISTEN_PORT` wins on boot), triggers `SetWaitPort 2` + `PortMapper.setPort` + reconnect. `compose.yaml` maps `${LISTEN_PORT:-60754}:${LISTEN_PORT:-60754}` TCP+UDP (no `network_mode` key — bridge ports). |
| `UPNP_ENABLED` | `1` | `0` disables UPnP at boot (overridden by `DATA_DIR/upnp_enabled` persisted from Settings → Network toggle `server.upnp`, default true; UPnP-only lease 43200 / renew 7200). |
| `DATA_DIR` | `/data` | Volume (`/data` in compose; dev falls back to `./data` or `/tmp/nicotine-hub` if `/data` not writable) |
| `BRIDGE_TOKEN` | *(open)* | `?token` / `Bearer` / `Sec-WebSocket-Protocol` → 401 on `/ws`, `/files/:token`, `/api/files`, `/spectrum/*`, `/logs`, `/diagnostics`, `/plugins`, `/upnp/status`, `/interfaces` (`/portchecker` stays open; `/health?json` returns limited fields without token) |
| `SHARED_DIRS` | *(unset)* | `:` list auto-scanned via `ShareDB.scanFsShares` (falls back to `DATA_DIR/shared` when unset) |
| `SHARES_DIR` | `DATA_DIR` | Persist path for `shares.json` |
| `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT` | `0` | KB/s (`0` = unlimited), aliases `UPLOADLIMIT`/`DOWNLOADLIMIT`; TokenBucket shaping split per active transfer + `DOWNLOAD_LIMIT` stored in `transfer:stats` 2 s |
| `ENABLE_SERVER_PING` | `1` | `0` disables `ServerPing 32` fallback |
| `ALLOWED_ORIGINS` | *(open)* | CSV — if set, `getCorsHeaders` (`server.ts:336`) only allows listed `Origin` (homelab lock-down) |
| `NEXT_PUBLIC_BRIDGE_URL` | `ws://host:8787/ws` | Build-time WS override; runtime `localStorage.nicotineHub.bridgeUrl` wins |
| `WORKER_TOKEN` | *(open)* | `Bearer` / `?token` → 401 on worker routes except `/health` (`hmac.compare_digest`) |
| `NEXT_PUBLIC_WORKER_URL` | `http://host:8789` | Build-time worker override; runtime `localStorage.nicotineHub.workerUrl` wins |
| `DISCOGS_TOKEN` / `QOBUZ_APP_ID` / `TIDAL_TOKEN` | *(unset)* | Optional scraper tokens (worker env); Qobuz/Tidal scrape returns a clear error without theirs |
| `QOBUZ_USER_AUTH_TOKEN` / `TIDAL_COUNTRY` | *(unset)* | Qobuz `X-User-Auth-Token` header; Tidal `countrycode` (default `US`) |
| `DATA_DIR/worker.json` | *(absent)* | Same tokens via Settings → Worker (write-only, `0600`, never shown back). Env wins when both set. `GET /health` reports `auth:{discogs,tidal,qobuz}` booleans only. |

## Worker (`apps/worker` — FastAPI `:8789`, `python:3.11-slim`)

Keeps CPU/IO-heavy work off the SLSK event loop. Own code throughout (scraper *pattern* only guided by smoked-salmon `BaseScraper`).

- `GET /health` (open) → `{ok, ts, uptime, version, sources:[discogs,bandcamp,apple,qobuz,tidal,musicbrainz,deezer,beatport], queueDepth}`
- `POST /scrape {url}` → `{artist, album, year, track_count, query, source, confidence, url}` (`422` no-scraper/unreachable, SSRF private-IP reject, 10 s timeout, random UA, Qobuz/Tidal need env tokens). Web `SearchBar` paste-link calls this, then `search:global` on `query`.
- `POST /spectrum/request {fileName, size?, token?}` → `{etag, hash, urls:{full,zoom}, fromCache}`; `GET /spectrum/{stem}/full|zoom` (PNG, `ETag`, `If-None-Match` → 304); `GET /spectrum/{stem}` (JSON). Reads `bridge-data:/data` RO, writes shared `spectrum-cache:/tmp/hub-spectrum`. See `docs/spectrum.md`.
- `POST /tag {fileName}` → `{tags, coverArtApplied, tracklist}` (mutagen read, preview only).
- `POST /verify {fileName}` → `{flacOk, upconvert, mqa, logScore, logChecksum, durationMismatch}` (honest subset today: `flacOk` + MQA tag sniff; the rest `null` until spectral checks land).
- `POST /analyze {fileName}` → `{bitrate, vbr, sampleRate, bitDepth, cutoffHz, likelyTranscode, confidence}` (mutagen + ffmpeg-snippet FFT knee when `numpy` present, else `null`s).
- All routes except `/health`: `WORKER_TOKEN` Bearer, 1 MB JSON cap.

## Tests

- `soulseek.test.ts` — login 72B hex, 54/56/110 empty, 1001, 121, caps, UserSearch 42 / RoomSearch 120 / Wishlist 103 framing, 51 vs 44 distinction
- `portmapper.test.ts` — UPnP constants (multicast host/port), missing port/ip, `0.0.0.0` reject, PortMapper setPort/status/renewal timer
- `transfers.test.ts` — queue/place, `Getting status` token register, `File not shared`, streaming (download + resume + upload shared)
- `apps/worker/tests/test_worker.py` (`pytest`) — health/sources, scrape validation + SSRF reject + auth, spectrum units + `sox` end-to-end (Full+Zoom, 304, cache) + tag/verify/analyze when `sox` present
