# Transfers — Implementation Log & Plan

> Living record of transfers work. Source of truth for sequencing remains
> `docs/TRANSFERS.md` and `docs/TRANSFERS_NEXT_PHASES.md`. This file tracks
> **what has shipped, what is in-progress, and what remains** — updated after
> each phase.

Last updated: 2026-08-28 · Branch `feat/transfers-real` · Base `bfda886` (profile merge PR #7).

---

## What shipped

### Profile view (PR #7, merged to `main` as `bfda886`)
- `apps/web/src/app/profile/[username]/page.tsx` + `apps/web/src/app/profile/page.tsx`
- `apps/web/src/lib/userinfo.tsx` (`useUserInfo` hook watching `userinfo:event`)
- `apps/web/src/lib/protocol.ts` user-info types (`UserInfoStatus`, `UserInfoStats`, `UserInfoInterests`, `UserInfoProfile`, `UserInfoEventMessage`, `UserinfoRequestMessage`)
- `apps/web/src/components/Sidebar.tsx` — User Profiles now links to `/profile`
- `apps/web/src/components/search/SearchScreen.tsx` — "View Profile" sheet action → `/profile/[user]`
- `apps/bridge/src/session.ts` — fixed swapped `recommendations`↔`itemRecommendations` routing; fixed `globalRecommendations` payload (full object → `.recommendations`); widened `routeResult` signature (`inQueue`, `uploadSpeed`) so `bun run typecheck` is clean

Verified: `bun test` 30 pass (pre-transfers) · `bun run build` green (both apps, profile routes emitted).

---

## Incident — worktree prune & tool path (2026-08-28)

The worktree `../nicotine_mobile-feat_profile-view` was pruned after PR #7 merged. Uncommitted transfers edits (soulseek Phase 0 + tests, protocol web, `transfers.ts` stub replacement, `mistakes.md`) applied in that worktree were lost. Additionally the `write`/`edit` tools initially resolved the worktree absolute path to `main`. Recovery:

- Reset `main` (`git checkout -- . && git clean -fd`) — confirmed clean.
- Recreated worktree `../nicotine_mobile-feat_transfers-real` from updated `main`.
- Verified `write` now lands in the new worktree (probe `__probe__.txt`). Rule going forward: **commit and push after each phase** so nothing is lost to a prune. Documented in `mistakes.md` (entry: worktree path/prune).

---

## In progress — Phase 0 (transfers protocol shims)

### Re-applied in `feat/transfers-real` (uncommitted on this branch)

**Bridge `apps/bridge/src/soulseek.ts`:**
- Extended `SERVER_MESSAGE_CODES` with `connectToPeer:18`, `cantConnectToPeer:1001`, `sendUploadSpeed:121`, `privilegedUsers:69`, `relogged:41`.
- Extended `PEER_MESSAGE_CODES` with `transferRequest:40`, `transferResponse:41`, `queueUpload:43`, `placeInQueueResponse:44`, `uploadFailed:46`, `uploadDenied:50`, `placeInQueueRequest:51`, `folderContentsRequest:36`, `folderContentsResponse:37`.
- Added `SlskReader#uint64()` (LE high-word = `hi * 2**32`).
- Added `packUint64LE` / `unpackUint64LE` (BigInt-safe, tested at `2^32` → `0000000001000000`).
- Added builders: `buildConnectToPeer`, `buildCantConnectToPeer`, `buildSendUploadSpeed`, `buildPrivilegedUsers`, `buildQueueUpload`, `buildTransferRequest`, `buildTransferResponse`, `buildPlaceInQueueRequest/Response`, `buildUploadFailed/Denied`, `buildFolderContentsRequest`.
- Added parsers: `parseTransferRequest/Response`, `parseQueueUpload`, `parsePlaceInQueueResponse`, `parseUploadFailed/Denied`, `parsePlaceInQueueRequest`, `parseFileTransferInit`, `parseFileOffset`.
- Fixed `routeResult` type survived from profile fix (clean `tsc`).

**Bridge `apps/bridge/src/soulseek.test.ts`:**
- New imports cover all shim builders/parsers.
- 8 new tests in `transfers — protocol shims (Phase 0)`: `packUint64LE` round-trip including `4_294_967_296`, `buildQueueUpload` exact hex `100000002b0000000800000066696c652e6d7033`, `TransferRequest` direction/size, `TransferResponse` allowed/denied, `PlaceInQueue/UploadFailed/Denied`, server relay codes (`18/1001/121`), `FileTransferInit`/`FileOffset`.

Current verify in this worktree: `bun test` 38 pass. `bun run build` **not yet green** — web protocol types for `transfer:queue`/`transfer:finished` and the `transfers.ts` engine are still stub.

---

## Plan — remaining phases (must be done in order per `TRANSFERS_NEXT_PHASES.md`)

### Phase 0 (web) — protocol types
**Why first:** All later WS handling compiles against these.
| File | Change |
|---|---|
| `apps/web/src/lib/protocol.ts` | Add `TransferQueueMessage {transfer:queue id,place}` and `TransferFinishedMessage {transfer:finished id,fileName,size,downloadUrl}` to `BridgeOutboundMessage`. |
| `apps/web/src/lib/config/defaults.ts` | Add `TODO(Phase 5): transfers section` comment only (no behavior). |

Verify: `bun run build` (typecheck) · `bun test` 38 pass.

### Phase 1 — indirect connectivity (mandatory — ~60% peers)
**Depends on:** Phase 0.
| File | Change |
|---|---|
| `apps/bridge/src/session.ts` | Server switch `case 18` `parseConnectToPeer` → `connectToPeer` / delegate `F` to `TransferManager`; handle `1001 CantConnectToPeer`, `69 PrivilegedUsers`; `GetPeerAddress` 60 s cache (`Map<user,{ip,port,expiry}>`); listener `Bun.listen` F-vs-P demux (raw `u32 token` vs `[u32 len][u8 code]`), `pendingFileTokens:Set<number>` heuristic, `connectPeer(username,type):Promise<Socket>` 45 s race (`pendingConnects` map); WS diagnostic `peer:connect` (optional). |
| `apps/bridge/src/server.ts` | Expose WS `peer:connect` for manual NAT testing (remove before release). |

Verify: `bun test` · `bun run build`; manual `ConnectToPeer → PierceFirewall → P established` log for indirect peer.

### Phase 2 — bridge transfer engine (minimal viable downloads)
**Depends on:** Phases 0–1.
| File | Change |
|---|---|
| `apps/bridge/src/transfers.ts` | Replace stub with `TransferManager` holding `Map<id,Transfer>` / `queued/active/failed`, `totalDownloadBandwidth` 2 s window. `enqueueDownload` dedup → `Queued` → `QueueUpload(43)` via `P` (`connectPeer` if needed). Handle `TransferRequest(UPLOAD,40)` → `Getting status` + 45 s timeout, `PlaceInQueueResponse(44)` → `transfer:queue`, `UploadDenied(50)` → status. Poll `PlaceInQueueRequest(51)` 300 s. **F accept:** `INCOMPLETE<md5(virtualPath+username)>+basename` via `ab+`, `offset=stat.size`, send `FileOffset(u64 LE)`, stream raw bytes throttled 500 ms, `Finished` → `moveFinished` (`(1)` collision) → `SendUploadSpeed(121)` + `transfer:finished{downloadUrl:/files/:token}`. Retries 180 s (closed/timeout) / 900 s (folder/file error). Persistence `data/downloads.json` atomic `tmp→rename`. |
| `apps/bridge/src/server.ts` | WS `download:request/control` → `transfer:update|queue|finished|stats`; `GET /files/:token` `Content-Disposition: attachment`. |
| `compose.yaml` | `bridge-data:/data` volume (`DATA_DIR=/data`, `INCOMPLETE_DIR=/data/incomplete`, `DOWNLOADS_DIR=/data/downloads`). |
| `apps/web/src/lib/transfers.tsx` & `apps/web/src/lib/session.tsx` | Reducers for `transfer:queue|finished`; actions `downloadFile(result)` from `ResultCard`. |

Verify: `bun --cwd apps/bridge dev` — enqueue a small file from `/search` → `Queued → Getting status → Transferring → Finished`, file at `data/downloads/`, `GET /files/:token` downloads. `bun test && bun run build` gate.

### Phase 3 — web hardening (no new routes)
Replace demo `TransfersProvider` timers with real reducer; wire `TransferCard` `onRetry` → `download:control retry`. Keep desktop `xl:grid-cols-2` / mobile tab switcher (`mistakes.md`).

### Phase 4–7 — deferred (out of scope for this log)
Upload serving (Phase 4), queue fairness/privilege/filters/persistence (Phase 5), throughput chart (Phase 6), shares/folder downloads (Phase 7) — per `TRANSFERS_NEXT_PHASES.md`.

---

## Verification gate (per `AGENTS.md`)

Every phase gates on `bun test && bun run build` in the worktree. For UI: `cp apps/web/.env.example apps/web/.env` before Playwright (and stop `next dev` before `next build` — see `mistakes.md`).

## Commit plan

Branch `feat/transfers-real` on top of `bfda886`. Commits:
1. `feat(transfers): Phase 0 protocol shims + hex vectors` (bridged + tests; includes this log)
2. `feat(transfers): Phase 0 web types` (protocol `transfer:queue|finished`)
3. `feat(session): Phase 1 indirect connectivity` (F demux, 18/1001, cache, connectPeer)
4. `feat(transfers): Phase 2 download engine + GET /files` (+ compose volume)
5. `feat(web): Phase 3 web wiring`

Each pushed before proceeding — so a prune cannot lose more than one phase.

---

*Next step:* commit Phase 0 + this log, then implement Phase 0 (web).
