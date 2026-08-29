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

Reference: [nicotine-plus `doc/SLSKPROTOCOL.md`](https://github.com/nicotine-plus/nicotine-plus) and `apps/bridge/src/soulseek.ts` (76 server / 18 peer / 6 distrib / 2 file codes, 1:1 parity).

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

## Transfers (F)

- `ConnectToPeer 18` / `CantConnectToPeer 1001` — direct + indirect `PierceFireWall 0` race 45s (30s indirect + 15s grace, `GetPeerAddress 3` cache 30m single-flight)
- `QueueUpload 43` → `TransferRequest 40` (`direction 1` upload) → `FileTransferInit` (4B token) + `FileOffset` (8B LE) → raw bytes
- `PlaceInQueueRequest 51` → `PlaceInQueueResponse 44` (real place via `TransferManager.getQueuePlace`), `UploadDenied 50`/`UploadFailed 46`
- Incomplete: `DATA_DIR/incomplete/INCOMPLETE<md5(username+path)>` + resume offset, `SendUploadSpeed 121` on finish, limiter `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT` (KB/s, adaptive `max(4096,sent*1.25/dt)` + pause/resume throttle, env aliases `UPLOADLIMIT`/`DOWNLOADLIMIT`)
- Persistence: `DATA_DIR/downloads.json` (atomic tmp→rename) + `transfers.json` compat, `Finished` served via `GET /files/:token` (`Content-Disposition`)

## Browse / Shares

- `SharedFileListRequest 4` → `SharedFileListResponse 5` (zlib lvl4 sorted), `FolderContentsRequest 36` → `FolderContentsResponse 37`, 0.4s throttle per peer (`ShareDB.shouldThrottle`), `ExcludedSearchPhrases` gated, FS scanner `ShareDB.scanFsShares` via `SHARED_DIRS` colon list + `music-metadata` attrs.

## Chat / Rooms / Privileges

- `SayChatroom 13`, `MessageUser 22`+`MessageAcked 23`/`MessageUsers 149`, `JoinRoom 14`/`LeaveRoom 15`/`UserJoined/Left 16/17`/`RoomList 64`/`RoomMembers 133`/`Add/RemoveMember 134/135`/`RoomTickers 113-116`/`GlobalRoom 150-152`
- `WatchUser 5`/`Unwatch 6`/`GetUserStatus 7`/`GetUserStats 36`/`UserInterests 57`/`Recommendations 54/56`/`SimilarUsers 110`/`ItemRecommendations 111`/`ItemSimilarUsers 112`/`GivePrivileges 123`/`CheckPrivileges 92`/`ChangePassword 142`

## Distributed (leaf-only)

Bridge is **leaf-only**: sends `HaveNoParent 71` + `BranchLevel/Root` on login, handles `PossibleParents 102` (10 parallel `D` dials), `ParentMinSpeed 83`/`Ratio 84` → `maxChildren`, forwards `DistribSearch 3`/`EmbeddedMessage 93` (`DistribSearch` again), ignores `DistribPing 0`, re-bootstraps on `ResetDistributed 130`. Does not act as parent (no child aggregation) — matches nicotine leaf mode. `D` framing is `[len][uint8 code]` vs `P`/`S` `[len][uint32 code]`.

## Bridge files

- `soulseek.ts` — framing/packing, builders/parsers for all codes
- `session.ts` — server socket + `Bun.listen` (`P` vs `F` demux via `pendingFileTokens` + heuristic), peer states (`buf/initDone/isFileConn/fileToken`), idle sweep (2s init, 10s ghost, 60s max), `GetPeerAddress` cache, search/browses
- `shares.ts` — `ShareDB` (`DATA_DIR/shares.json`, in-memory folders, search, `build*Response`)
- `transfers.ts` — `TransferManager` (Map `id→Transfer`, queued/active, 2s `transfer:stats`, 300s `PlaceInQueue` poll, `INCOMPLETE<md5>` + `downloads.json`)
- `server.ts` — `Bun.serve` (`/ws` zod, `/health`, `/logs`, `/diagnostics`, `/files/:token`) + token via `?token`/`Authorization`/`Sec-WebSocket-Protocol`

## Env (full)

| Env | Default | Notes |
|-----|---------|-------|
| `PORT` | `8787` | WS port |
| `LISTEN_PORT` | `2234` | Peer listener (port-forward) |
| `DATA_DIR` | `/data` | Volume |
| `BRIDGE_TOKEN` | *(open)* | `?token` / `Bearer` / `Sec-WebSocket-Protocol` → 401 |
| `SHARED_DIRS` | `/data/shared` | `:` list auto-scanned |
| `SHARES_DIR` | `DATA_DIR` | Persist path |
| `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT` | `0` | KB/s, aliases `UPLOADLIMIT`/`DOWNLOADLIMIT` |
| `ENABLE_SERVER_PING` | `1` | `0` disables `ServerPing 32` fallback |

## Tests

- `soulseek.test.ts` — login 72B hex, 54/56/110 empty, 1001, 121, caps, UserSearch 42 / RoomSearch 120 / Wishlist 103 framing, 51 vs 44 distinction
- `transfers.test.ts` — queue/place, `Getting status` token register, `File not shared`, streaming (download + resume + upload shared)
