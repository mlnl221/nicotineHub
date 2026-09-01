# Architecture & Protocol

This doc holds the technical details removed from `README.md` for brevity.

## Bridge

The browser cannot open raw TCP; the bridge is the only SLSK speaker. JSON over `ws://host:8787/ws` is translated to Soulseek binary framing `[uint32 len][uint32 code][payload]` (little-endian).

```
[ Browser ] --WS JSON--> [ Bun bridge ] --TCP--> server.slsknet.org:2242
                                        --P--> peers (messages)
                                        --F--> file (raw bytes)
                                        --D--> distrib (leaf only)
```

Reference: [nicotine-plus `doc/SLSKPROTOCOL.md`](https://github.com/nicotine-plus/nicotine-plus) (GPL-3.0-or-later) and `apps/bridge/src/soulseek.ts` (76 server / 18 peer / 6 distrib / 2 file codes, 1:1 parity). See `ATTRIBUTION.md` and `COPYING` — this bridge is a port of `pynicotine/slskmessages.py`/`slskproto.py` under GPL-3.0-or-later.

## Login

1. `Login` (1): `string username`, `string password`, `uint32 major=177`, `string md5_hex(username+password)`, `uint32 minor=1`
2. `SetWaitPort` (2): `uint32 port` + `SharedFoldersFiles 35` (`dirs/files` from `ShareDB`) after success (nicotine parity).  
   Response `Login` (1): `bool success` → on success `string banner`, `uint32 ip`, `string checksum`, `bool isSupporter`; on fail `string reason` ∈ {`INVALIDUSERNAME`,`EMPTYPASSWORD`,`INVALIDPASS`,`INVALIDVERSION`,`SVRFULL`,`SVRPRIVATE`} + detail.

## Search

- Modes: `FileSearch 26` (global), `UserSearch 42`, `RoomSearch 120`, `WishlistSearch 103` / `WishlistInterval 104`, `ExcludedSearchPhrases 160` gated.
- Flow: browser `search:start {query,mode}` → bridge allocates `uint32` token (`allowedSearchTokens` gate, incr wrapping at `2^32`) → `FileSearch` to server → server floods via `DistribSearch 3` → peers connect back over `P` and send `FileSearchResponse 9`.
- `FileSearchResponse 9` over `P`: `[len][code 9][zlib(payload)]`, two-stage inflate 16M compressed / 128M decompressed, flat file list (`\`-split for folder grouping, sorted by name when `n>1`), `>2GiB` NS sentinel fix, private block (≤10000), `slotFree`/`avgspeed`/`inQueue` header, token-matched then `MAX_DISPLAYED_RESULTS 2500` cap + per-user dedup.
- Query hygiene: split on space, drop bare `-word` before transmit (reapplied client-side as `excluded_words`), preserve `"exact phrase"`/`*partial`, `min_search_chars 3`. Attributes: `0 bitrate kbps`, `1 duration s`, `2 VBR`, `4 sampleRate Hz`, `5 bitDepth bits` (combos `{0,1,2}` lossy, `{1,4,5}` FLAC/WAV, `{0,1,4,5}` WV).
- Filters (live, nicotine parity, `docs/settings-mapping.md` defilter): `filterin/filterout` regex on path+username, `filtersize` (`< <= == != >= >`, bare `= → ==`, `k/m/g` binary, `MiB`/`B` decimal, `>10.5m <1g`), `filterbr` kbps, `filterlength` sec or `HH:MM:SS` (`>6:00 <12:00`), `filtertype` `flac wav` / `!mp3` / generic `audio/image/video/document/text/archive/executable`, `filtercc` `US !DE` / `,`/`;`/`-` split, `filterslot` (free slot only), `filterpublic` (hide private). Live on keystroke, clear/restore toggle, history 50.
- Connect-back: direct `PeerInit 1` (`string user`+`string type P`+`uint32 0`, framing `[len][u8 code][payload]`) vs indirect `ConnectToPeer 18` relay + `PierceFireWall 0` (`uint32 token`). `P`/`S` framing `[len][uint32 code][payload]`, `D`/`PeerInit` `[len][uint8 code][payload]`.

## Transfers (F) + Spectrum

- `ConnectToPeer 18` / `CantConnectToPeer 1001` — direct + indirect `PierceFireWall 0` race 45s (30s indirect + 15s grace, `GetPeerAddress 3` cache 30m single-flight)
- `QueueUpload 43` → `TransferRequest 40` (`direction 1` upload) → `FileTransferInit` (4B token) + `FileOffset` (8B LE) → raw bytes
- `PlaceInQueueRequest 51` → `PlaceInQueueResponse 44` (real place via `TransferManager.getQueuePlace`), `UploadDenied 50`/`UploadFailed 46`
- Incomplete: `DATA_DIR/incomplete/INCOMPLETE<md5(username+path)>` + resume offset, `SendUploadSpeed 121` on finish, limiter `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT` (KB/s, adaptive `max(4096,sent*1.25/dt)` + pause/resume throttle, env aliases `UPLOADLIMIT`/`DOWNLOADLIMIT`)
- Persistence: `DATA_DIR/downloads.json` (atomic tmp→rename) + `transfers.json` compat, `Finished` served via `GET /files/:token` (`Content-Disposition`)
- **Spectrum** (port of [`smoked-salmon`](https://github.com/smokin-salmon/smoked-salmon) `src/salmon/uploader/spectrals.py`, Apache-2.0 — `sox` + `oxipng`, no `spek`): on `spectrum:request {id}` for a Finished audio transfer the bridge resolves `DATA_DIR/downloads/<file>` via `TransferManager.getFilePathForToken`, stats `mtime`/`size`, probes `duration` via `music-metadata`, then `sox --multi-threaded <in> --buffer 128000 -n remix 1 spectrogram -x 2000 -y 513 -z 120 -w Kaiser -o Full.png remix 1 spectrogram -x 500 -y 1025 -z 120 -w Kaiser -S <zoomStart> -d 0:02 -o Zoom.png` where `zoomStart = duration>5 ? floor(duration/2) : 0`. Both PNGs are `oxipng -o 2 --strip all` compressed (best-effort) and stored as `/tmp/hub-spectrum/<token>-<hash>-Full.png` + `-Zoom.png` (`hash = sha256(token:mtime:size)[0..16]`, `ETag = "hash"`). `/tmp` is ephemeral — wiped on `docker restart`. Bridge caps at 2 concurrent `sox` (queue), 90 s timeout, LRU prune >100 files. Served via `GET /spectrum/:token/full|zoom` (image/png, `private, max-age=3600`, `ETag`, `If-None-Match` → 304) and `GET /api/spectrum/:token` (JSON). See `docs/spectrum.md`.

## Browse / Shares

- `SharedFileListRequest 4` → `SharedFileListResponse 5` (zlib lvl4 sorted), `FolderContentsRequest 36` → `FolderContentsResponse 37`, 0.4s throttle per peer (`ShareDB.shouldThrottle`), `ExcludedSearchPhrases` gated, FS scanner `ShareDB.scanFsShares` via `SHARED_DIRS` colon list + `music-metadata` attrs.

## Chat / Rooms / Privileges

- `SayChatroom 13`, `MessageUser 22`+`MessageAcked 23`/`MessageUsers 149`, `JoinRoom 14`/`LeaveRoom 15`/`UserJoined/Left 16/17`/`RoomList 64`/`RoomMembers 133`/`Add/RemoveMember 134/135`/`RoomTickers 113-116`/`GlobalRoom 150-152`
- `WatchUser 5`/`Unwatch 6`/`GetUserStatus 7`/`GetUserStats 36`/`UserInterests 57`/`Recommendations 54/56`/`SimilarUsers 110`/`ItemRecommendations 111`/`ItemSimilarUsers 112`/`GivePrivileges 123`/`CheckPrivileges 92`/`ChangePassword 142`
- `UserInfo` `descr/pic/totalupl/queuesize/slotsavail/uploadallowed` via `UserProfileSection.tsx`: `userinfo: {action:"setProfile", profile: {descr,pic,totalupl,queuesize,slotsavail,uploadallowed}}` → `buildSetUploadSpeed` + `UserInfoResponse` (`server.ts:106`, `session.ts` `setProfile`); debounced 800 ms when `useSession` `connected`, base64 `pic` 5 MB guard + WebP 512 px resize

## WebSocket JSON bridge (`apps/bridge/src/server.ts`)

Browser ↔ bridge JSON (all `zod` validated, 1 MB frame guard):

```
login {type:"login", username,password, host?,port?} → {type:"login:result", ok}
search {type:"search", searchId, query} | {type:"search:user", username,query} | {type:"search:room", room,query} | {type:"search:wishlist"} → {type:"search:start",token} + {type:"search:result",rows} + {type:"search:end"}
search:stop / search:page / browse:page (5-min `searchCache`/`browseCache`, `bridgeCaches` 5m LRU 100)
browse {type:"browse", action:"shares"|"folder", username,folder?,token?} → {type:"browse:shares"|"browse:folder"}
chat:room {action:"join"|"leave"|"say"|"ticker"|"setTicker"|...} + chat:private {action:"send"|"ack"} → {type:"chat:event"|"room:event"}
download:request {username,virtualPath,size,fileName?} + download:control/upload:control {id,action} → {type:"transfer:update/stats/queue/finished"}
spectrum:request {id} + spectrum:status {id} → {type:"spectrum:status"/"spectrum:ready" {id, token, etag, hash, urls:{full,zoom}}} + GET /spectrum/:token/full|zoom (image/png, ETag, /tmp ephemeral) + /api/spectrum/:token (JSON)
userinfo {action:"watch"|"unwatch"|"get"|"peerAddress"|"recommendations"|...} → {type:"userinfo:event"}
plugin:list / toggle / reload / uninstall / install{fileName,data} / installUrl{url} + plugin:settings / resetSettings → {type:"plugin:list"|"plugin:installed"|"plugin:toggled"|...} (bridge `PluginManager`)
 config:update {section,key,value} / wishlist:update {terms} + statistics:request / reset + ping→pong
 diagnostics + /health?json: {ok, ts, uptime, port, listenPort, dataDir, tokenAuth, upnp:{enabled, active, port, ip, error, lastSuccessAt}} (gated via `BRIDGE_TOKEN` if set) + /api/upnp/status + /interfaces
 ```

## Distributed (leaf-only, `stage` `d395cc6`+)

Bridge is **leaf-only** (no child aggregation — matches nicotine leaf mode): sends `HaveNoParent 71` + `BranchLevel 126/Distrib 4` (+1) + `BranchRoot 127/5` + server notify on login, handles `PossibleParents 102` (10 parallel `D` dials, `_adoptParent` on `DistribSearch 3`), `ParentMinSpeed 83`/`Ratio 84` → `maxChildren = min(speed//ratio//100,10)`, forwards `DistribSearch 3`/`EmbeddedMessage 93` (`DistribSearch` again), ignores `DistribPing 0`, re-bootstraps on `ResetDistributed 130` + `AcceptChildren 100` toggle (uploadSpeed). `D` framing is `[len][uint8 code]` vs `P`/`S` `[len][uint32 code]`; `server.ts:185` `Bun.listen` advertises `LISTEN_PORT` via `SetWaitPort 2` + `PortMapper`.

## Bridge files

- `soulseek.ts` — framing/packing, builders/parsers for all codes (76 server / 18 peer / 6 distrib / 2 file)
- `session.ts` — server socket + `Bun.listen` (`P` vs `F` demux via `pendingFileTokens` + heuristic), peer states (`buf/initDone/isFileConn/fileToken`), idle sweep (2s init, 10s ghost, 60s max), `GetPeerAddress` cache 30m single-flight, search/browses, distributed leaf bootstrap (`HaveNoParent 71`, `PossibleParents 102` 10 dials, `BranchLevel/Root`), `PortMapper` (`portmapper.ts` NAT-PMP → UPnP) on login/disconnect/port change
- `shares.ts` — `ShareDB` (`DATA_DIR/shares.json`, in-memory folders, search, `buildSharedFileListResponse 5`/`FolderContents 36/37` zlib lvl4, `shouldThrottle` 400 ms)
- `transfers.ts` — `TransferManager` (Map `id→Transfer`, queued/active, 2s `transfer:stats`, 300s `PlaceInQueue` poll, `INCOMPLETE<md5>` + atomic `downloads.json` + `GET /files/:token`)
- `spectrum.ts` — `SpectrumManager` (sox spectrogram `2000×513` Full + `500×1025` Zoom, Kaiser `-z 120`, `remix 1`, `oxipng -o 2`, ported from `smoked-salmon` `uploader/spectrals.py`, `/tmp/hub-spectrum` ephemeral, 2-concurrent queue, `sha256(token:mtime:size)` etag)
- `portmapper.ts` — `NATPMP` (RFC6886 UDP 5351 → gateway from `/proc/net/route`+`netstat`/`ip route` fallback, lease 43200 s / renewal 7200 s, 2 attempts 250 ms doubling, TCP only) + `UPnP` (SSDP multicast 239.255.255.250:1900 5 targets, device desc fetch with controlURL validation vs python ElementTree, SOAP AddPortMapping/DeletePortMapping with 725 permanent lease fallback) + `PortMapper` orchestrator (NAT-PMP fallback UPnP, `setPort`/`add`/`remove` like `pynicotine/portmapper.py:PortMapper`, `status`{active,port,ip,error,lastSuccessAt} for diagnostics)
- `portchecker.ts` — `PortChecker` external host `https://www.slsknet.org/porttest.php?port=%s` (like `pynicotine/portchecker.py`, timeout 5 s, checks `"port/tcp open"` vs `"closed"`), singleton `portChecker`, `/api/portchecker?port=` endpoint
- `server.ts` — `Bun.serve` (`/ws` zod, `/health`→`listenPort`, `/logs`, `/diagnostics`, `/files/:token` sanitized `Content-Disposition`, `/spectrum/:token/full|zoom` + `/api/spectrum/:token`, `/plugins` + `/plugins/install`, `/api/portchecker`, `/api/upnp/status`) + token via `?token`/`Authorization`/`Sec-WebSocket-Protocol` + CORS/CSP (`getCorsHeaders`, `SECURITY_HEADERS`) + 1 MB WS guard + 5-min `browseCache` (search cache disabled per fix/port-search-browse)
- `plugins/manager.ts` (+ `builtin/core_commands`, `builtin/spamfilter`) — `PluginManager` (`plugins.json` `installed/enabled`, `PLUGININFO/metasettings`, `returncode.zap/break/pass`, 32 `core_commands` cmds) — WS `plugin:list/toggle/reload/uninstall/install{fileName,data}` + `installUrl` (GitHub-only, 20 MB zip / 1 GiB unzip + path-traversal guard)

## Env (full)

| Env | Default | Notes |
|-----|---------|-------|
| `PORT` | `8787` | WS port (`apps/bridge/src/server.ts:186`) |
| `LISTEN_PORT` | `60754` | Peer listener — **default 60754** (VPN-forwarded, was `62904` in early docs; `DEFAULT_LISTEN_PORT` `apps/web/src/lib/config/defaults.ts:210`). Editable via `server.portrange` in Settings → Network (`NetworkSection.tsx:82`), persists to `DATA_DIR/listen_port` (env `LISTEN_PORT` wins on boot), triggers `SetWaitPort 2` + `PortMapper.setPort` + reconnect. Compose default is `network_mode: host` (host-direct, no port map); bridge mode maps `${LISTEN_PORT:-60754}:${LISTEN_PORT:-60754}` TCP+UDP. Gluetun users: remove host → use `compose.gluetun.yaml` (`network_mode: service:gluetun`). |
| `UPNP_ENABLED` | `1` | `0` disables UPnP/NAT-PMP at boot (overridden by `DATA_DIR/upnp_enabled` persisted from Settings → Network toggle `server.upnp`, default true, `portmapper.ts` NAT-PMP fallback UPnP lease 43200 renew 7200). |
| `DATA_DIR` | `/data` | Volume (`/data` in compose, `/tmp` fallback in tests) |
| `BRIDGE_TOKEN` | *(open)* | `?token` / `Bearer` / `Sec-WebSocket-Protocol` → 401 on `/ws`, `/files/:token`, `/logs`, `/diagnostics`, `/plugins/*` |
| `SHARED_DIRS` | `/data/shared` | `:` list auto-scanned via `ShareDB.scanFsShares` + `music-metadata` attrs `0/1/4/5` |
| `SHARES_DIR` | `DATA_DIR` | Persist path for `shares.json` |
| `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT` | `0` | KB/s (`0` = unlimited), aliases `UPLOADLIMIT`/`DOWNLOADLIMIT`; adaptive throttle + `DOWNLOAD_LIMIT` stored in `transfer:stats` 2 s |
| `ENABLE_SERVER_PING` | `1` | `0` disables `ServerPing 32` fallback |
| `ALLOWED_ORIGINS` | *(open)* | CSV — if set, `getCorsHeaders` (`server.ts:265`) only allows listed `Origin` (homelab lock-down) |
| `NEXT_PUBLIC_BRIDGE_URL` | `ws://host:8787/ws` | Build-time WS override; runtime `localStorage.nicotineHub.bridgeUrl` wins |

## Tests

- `soulseek.test.ts` — login 72B hex, 54/56/110 empty, 1001, 121, caps, UserSearch 42 / RoomSearch 120 / Wishlist 103 framing, 51 vs 44 distinction
- `portmapper.test.ts` — NATPMP/UPnP constants, missing port/ip, controlURL relative/absolute/base validation, gateway detection, PortMapper setPort/hasPort/status/error/renewal timer
- `transfers.test.ts` — queue/place, `Getting status` token register, `File not shared`, streaming (download + resume + upload shared)
- `spectrum.test.ts` — `calculateZoomStartpoint`, `getSpectrumHash`, `getSpectrumPaths` (`/tmp/hub-spectrum`), + `sox` integration (1 s sine → Full+Zoom) when `sox` present
