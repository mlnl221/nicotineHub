# Bridge 1:1 Parity — Todo Plan (DONE — archived)

> Goal: make `apps/bridge` a complete WebSocket bridge that mirrors the entire nicotine-plus wire protocol (server + peer + distributed + file) — **ACHIEVED** via PR #19 (76/18/6/2, leaf `D`) + PR #21 (`F` streaming + search modes). UI deferred at the time; now `apps/web` is also beyond MVP.

Reference: `pynicotine/slskmessages.py:4302` (76 server, 18 peer, 6 distrib codes), `pynicotine/slskproto.py`, `doc/SLSKPROTOCOL.md`, `apps/bridge/src/soulseek.ts:1`.

---

## Constraints (from issue)

1. **1:1 replica** — every nicotine-plus message/code path has a bridge equivalent (or explicit `not-supported/deferred` with reason + stub that doesn't break framing).
2. **Volume specifiable** — downloads/incomplete + peer shares persisted to a Docker volume at a configurable path (`DATA_DIR`, default `/data`, override via env). `compose.yaml` mounts `bridge-data:${DATA_DIR}` and `DATA_DIR` is respected by `TransferManager` + share DB.
3. **Token auth** — `BRIDGE_TOKEN` env. If set, `GET /ws?token=…` (or `Authorization: Bearer …` + `Sec-WebSocket-Protocol`) must match; otherwise `401`. If unset, open (dev). Validated in `server.ts:fetch` before `upgrade`. Web can set `NEXT_PUBLIC_BRIDGE_TOKEN` or `localStorage.nicotine.bridgeToken`.
4. **Defer UI** — no new `apps/web` pages this branch; only bridge + protocol types + `lib/protocol.ts` token plumbing. UI adaptation tracked separately (see `docs/NEXT_PHASES.md`).

---

## Phase 0 — Correctness Hotfixes (must ship first)

- [x] `soulseek.ts`: fix `Recommendations 54` / `GlobalRecommendations 56` / `SimilarUsers 110` send as `frameMessage(code, Buffer.alloc(0))` not `packString(username)` — nicotine `make_network_message` is `b""` (`slskmessages.py:1519/1571`).
- [x] `soulseek.ts:303` `parseConnectToPeer` + `parsePeerAddress:750` consume trailing `uint32 obfuscation_type + uint32/uint16 obfuscatedPort` instead of ignoring misaligned.
- [x] `soulseek.ts:466` `parseFileSearchResponse`: two-stage zlib with 128 MiB cap + `MAX_UNCOMPRESSED` guard, gate on `allowedResponses` token set, handle `>2GiB` NS bug via `unpackFileSize`, private-share `npriv` remaining guard.
- [x] `soulseek.ts` + `session.ts`: add `CantConnectToPeer 1001` build/parse + send on outbound `Bun.connect` failure; add `SendUploadSpeed 121` builder.
- [x] `session.ts:212` gate `SetWaitPort` after `Login success` confirmation (don't send before).
- [x] `server.ts` auth gate: check `session.loggedIn` before `search`/`userinfo`/`transfer` handlers (close `mistakes.md 2026-08-28 — Bridge allows search after failed login`).

Verify: `bun test` new cases for 54/56/110 empty, 1001 round-trip, 121. — ✅ 67 pass

## Phase 1 — Network Robustness

- [x] `soulseek.ts:201` `tryParseMessage` + `session.ts:229` `handleServerData`/`processPeer`: enforce `MAX_INCOMING_MESSAGE_SIZE` per conn type (448M peer shares, 16M search, 1M generic, 16K distrib) — close on overflow.
- [x] Keepalive: `Bun.connect`/`Bun.listen` with `socket.keepalive` or TCP_USER_TIMEOUT equivalent; fallback `ServerPing 32` 60s interval.
- [x] Timeouts/eviction: `CONNECTION_INIT_TIMEOUT 2s`, `INDIRECT_REQUEST_TIMEOUT 20s`, `CONNECTION_MAX_IDLE 60s` + `GHOST 10s`, periodic sweep `setInterval` clearing stale `peerStates` + pending `GetPeerAddress`.
- [x] Reconnect/backoff: exponential `5-15s *2 max 300s` with jitter (`slskproto.py:_set_server_timer`), expose `server:reconnect` WS event.
- [x] `peerStates` leak fix — partial init buf without `initDone` threshold → evict after timeout.
- [x] `GetPeerAddress` cache 30m TTL (`USER_ADDRESS_TTL 1800`) + single-flight `pendingInitMsgs`.

## Phase 2 — Full Server Codes + Dispatch

Add to `SERVER_MESSAGE_CODES` every entry in `slskmessages.py:4302` (76). Implement `build*`/`parse*` for each still missing; wire in `session.ts:handleServerData` emit via `onUserEvent` / new `onChatEvent`/`onRoomEvent` callbacks; expose via `server.ts` WS routes:

- **Chat/PM:** `SayChatroom 13`, `MessageUser 22` + `MessageAcked 23`, `MessageUsers 149`, `AdminMessage 66`
- **Rooms:** `JoinRoom 14`, `LeaveRoom 15`, `UserJoinedRoom 16`, `UserLeftRoom 17`, `RoomList 64`, `RoomMembers 133` + `Add/RemoveMember 134/135`, `RoomTickers 113-116`, `GlobalRoom 150-152`, `PrivilegedUsers 69` + `Privileges 92/122-125`
- **Search variants:** `UserSearch 42`, `RoomSearch 120`, `WishlistSearch 103`/`Interval 104`, `ExcludedSearchPhrases 160`
- **Distrib bootstrap:** `HaveNoParent 71`, `ParentMinSpeed 83`/`Ratio 84`, `PossibleParents 102`, `BranchLevel 126`/`BranchRoot 127`, `AcceptChildren 100`, `ResetDistributed 130`, `EmbeddedMessage 93`
- **Misc:** `SharedFoldersFiles 35` already, `SendUploadSpeed 121`, `ChangePassword 142`, `EnableRoomInvitations 141`, `CantCreateRoom 1003`

WS mapping: `type: "chat:*" | "room:*" | "privileges:*" | "search:*"` validated with `zod`.

## Phase 3 — Peer Shares/Browse Parity

- [x] `PEER_MESSAGE_CODES` fill `4,5,8,36,37,40,41,42,43,44,46,50,51,52` (`slskmessages.py:4412`)
- [x] `ShareDB` in `apps/bridge/src/shares.ts` (in-memory, persisted under `DATA_DIR/shares.json` if `SHARES_DIR` present) — respects `ExcludedSearchPhrases 160` filter before answering `FileSearch` inbound.
- [x] Implement `SharedFileListRequest 4` → respond `SharedFileListResponse 5` (zlib lvl4, sorted, `allowed_responses` gated), `FolderContentsRequest 36` → `FolderContentsResponse 37`.
- [x] Handle inbound `FileSearch 26` (user searching us) via shares DB.

## Phase 4 — Real File Transfer (F)

- [x] `FILE_MESSAGE_CODES` (`FileTransferInit` token, `FileOffset` uint64)
- [x] Demux `P` vs `F` in `Bun.listen` (`session.ts:startListener`) — F starts with `uint32 token` not `PeerInit`, no `PeerInit` prefix.
- [x] `TransferRequest 40`/`TransferResponse 41`/`QueueUpload 43`/`PlaceInQueueRequest 51`→`PlaceInQueueResponse 44`/`UploadFailed 46`/`UploadDenied 50` handling via new `TransferManager` F sockets.
- [x] Streaming: `ab+` incomplete files under `DATA_DIR/incomplete/` (`INCOMPLETE<md5>`), send `FileOffset` u64 LE, pipe raw bytes, throttle `transfer:update` 500ms, persist `downloads.json` + `uploads.json` under `DATA_DIR`.
- [x] Banner `SendUploadSpeed 121` after upload success.

## Phase 5 — Distributed Network

- [x] `DISTRIBUTED_MESSAGE_CODES` full + D framing `[len][uint8 code]` distinct from P `[len][uint32 code]`.
- [x] Bootstrap: send `HaveNoParent 71` + `BranchLevel/Root` on login success; handle `PossibleParents 102` (attempt up to 10 parallel `D` dials), `ParentMinSpeed/ Ratio` → `maxChildren`.
- [x] `DistribSearch 3` forward to children + local handler; `EmbeddedMessage 93` unpack; `ResetDistributed 130` close/re-bootstrap; `DistribPing 0` ignored.
- [x] If deferred, explicitly document leaf-only in `README.md` + return `distrib:unsupported` on `D` attempts. — implemented as leaf-forwarding; full distrib documented as leaf-only fallback in code comments

## Phase 6 — Volume + Token Auth + Compose

- [x] `DATA_DIR` env (default `/data`, fallback `./data` in dev). `TransferManager` + `shares.ts` + `session.ts` use it. `compose.yaml` adds `volumes: bridge-data:${DATA_DIR:-/data}` + `BRIDGE_TOKEN` + `DATA_DIR`.
- [x] `BRIDGE_TOKEN` check in `server.ts:fetch` before `upgrade`: `?token=` or `Authorization: Bearer` or `Sec-WebSocket-Protocol`. If mismatch → `401`. If unset → open (log warn).
- [x] `Dockerfile` ensures `mkdir -p $DATA_DIR` + `chown`.
- [x] Update `apps/web/src/lib/session.tsx` + `protocol.ts` to send token on WS connect; update `README.md` env notes.

## Deferred (now mostly done, see README Roadmap)

- ~~Web UI for chat/rooms/browse/transfers/distrib visualizations~~ → done (`/chat` `/browse` `/downloads` + leaf `D`).
- ~~Search filters/tabs beyond bridge parity~~ → done (multi-mode + nicotine-parity `FilterBar`).
- OS keychain for credentials (still deferred — no persistence).

---

## Verification Gates (each phase) — all green at merge

- `bun test` — packing/parsing vs `doc/SLSKPROTOCOL.md` hex, incl. new 54/56/110 empty, 1001, 121, zlib caps, `PlaceInQueue` 44/51, `UserSearch`/`RoomSearch`/`WishlistSearch` framing, streaming (download resume + upload).
- `bun run build` — typecheck + prod builds (bridge + web).
- Manual smoke: `PORT=8788 LISTEN_PORT=2235 DATA_DIR=/tmp/bridge-data BRIDGE_TOKEN=secret bun run --cwd apps/bridge dev` → `ws://localhost:8788/ws?token=secret` login/search/userinfo/transfer flow.
- Compose smoke: `docker compose up --build` → `/health` + `ws?token` auth 401/101.

## Worktree / PR — archived

- Worktree: `feat/bridge-1-1-parity` at `/home/magnus/projects/nicotine_mobile-bridge-1-1` — ports `3001/8788/2235` (main uses `3000/8787/2234`). Later: `feat/transfer-search-modes` at `...-transfer-search` (3002/8789/2236) → PR #21 merged as `c1946a0`.
- Branch: `feat/bridge-1-1-parity` → PR #19, `feat/transfer-search-modes` → PR #21 against `main`.
