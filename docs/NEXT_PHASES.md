# Next Phases — Roadmap after Search

> **Search is done.** `feat/search-page` (PR #4) shipped full global P2P search via the bridge (`FileSearch` 26 → `FileSearchResponse` 9 over `P`/`F` + `ConnectToPeer` 18 relay) with nicotine-parity filters and tabs. `bun test` 30 pass, `bun run build` green. This doc is the plan for what comes next.

Source of truth for each phase: `docs/TRANSFERS.md` (phases 2–7), `docs/USER_PROFILES.md` (Phase 5), `docs/search/*` (done), `docs/workflow.md` (worktree → PR).

---

## Phase 2 — Transfers: Downloads & Uploads (bridge proxy FS)

**Why first:** search without downloads has no payoff. This is the biggest bridge change.

**Spec:** `docs/TRANSFERS.md:1` is canonical. `docs/Downloads_uploads.html:1` is visual guideline only; `docs/DESIGN.md:1` is canonical for spacing/radii/no-borders.

**Bridge (`apps/bridge`):**
- New `src/transfers.ts` — `TransferManager` mirroring `pynicotine/{transfers,downloads,uploads}.py` but simplified: `Map<id,Transfer>` + `queued/active/failed`, `total_bandwidth` rolling 2s, `downloads.json`/`uploads.json` under `DATA_DIR=/data` (Docker volume `bridge-data:/data` in `compose.yaml`), `INCOMPLETE<md5(path+user)>` resume files in `data/incomplete/`.
- Wire missing peer/server codes in `soulseek.ts:19` (`ConnectToPeer 18`, `CantConnectToPeer 1001`, `SendUploadSpeed 121`, `PrivilegedUsers 69`, peer 40/41/43/44/46/50/51, `FileTransferInit`/`FileOffset`), builders `buildQueueUpload`, `buildTransferRequest/Response`, `buildPlaceInQueue*`, `packUint64`.
- `session.ts:1` — demux `P` vs `F` in `Bun.listen` (F starts with raw `u32 token`, no `PeerInit`), handle `ConnectToPeer → PierceFirewall`, `GetPeerAddress` cache 60s, delegate 40/43/44/50/51 to `TransferManager`. `F` streaming: open `ab+` incomplete, send `FileOffset` u64 LE, pipe raw bytes, throttle 500ms `transfer:update` emits.
- `server.ts:1` — WS `download:request|pause|resume|cancel|retry|clear` + `transfer:update|queue|finished|stats` (2s tick) and `GET /files/:token` for finished files.

**Web (`apps/web`):**
- `lib/protocol.ts` + `lib/session.tsx` extended with `Transfer` types/status unions (Queued/Transferring/Paused/Finished/User logged off/Connection closed…)
- `components/transfers/TransferCard.tsx` + `TransfersHeader.tsx` (speed pills, `primary` down / `tertiary` up)
- `app/downloads/page.tsx` + `app/uploads/page.tsx` — guarded `status!==connected → /` like `search/page.tsx:52`, desktop `xl:grid-cols-2` / mobile tab switcher, throughput placeholder (no live chart yet)

**Verify:** enqueue small file from `/search` → `Queued → Getting status (45s timer) → Transferring → Finished` + file in `data/downloads/` + `GET /files/:token` download.

---

## Phase 3 — Browse Shares & Folder Downloads

- Peer 36/37 `FolderContentsRequest/Response` (zlib), `GetShareFileList` 4/5 already partially in bridge.
- Bridge: `requestFolder(user, folder)` → 5s retry, parse `FolderContentsResponse` → auto-enqueue each file via `TransferManager`.
- Web: `app/browse/[user]/page.tsx` tree view, `Browse` action in `SearchScreen` sheet (`account_tree` toast today) → real browse.

---

## Phase 4 — Chat

- Server: `SayChatroom 14`, `JoinRoom 14`, `LeaveRoom 16`, `RoomList 64`, `MessageUser 22` (private) per `SLSKPROTOCOL.md`.
- Bridge: room/message handlers, `server.ts` WS `room:join|leave|say` + `private:message`.
- Web: `app/chat/page.tsx` + `app/chat/[room]/page.tsx`, mobile bottom sheet + desktop sidebar list. Use `docs/chat.html:1` as visual guideline.

---

## Phase 5 — User Profiles, Interests & Privileges

**Spec:** `docs/USER_PROFILES.md:1` + `docs/user_profiles.html:1` + existing `session.ts:512` stubs (`watchUser`, `requestUserInterests`, etc.).

- Server: `WatchUser 5`, `UnwatchUser 6`, `GetUserStatus 7`, `GetUserStats 36`, `UserInterests 57`, `Recommendations 54/56/110/111`, `SimilarUsers 110/112`, `AddThingILike 51` etc. already added as `SERVER_MESSAGE_CODES` but not fully wired.
- Bridge: cache + `onUserEvent` → WS `userinfo:event` (already in `server.ts:136`), `requestUserInfo` peer 15/16 via direct `P` + `GetPeerAddress`.
- Web: `app/user/[username]/page.tsx` (avatar, descr, stats, interests, recommendations), privileges `givePrivileges 123`.

---

## Phase 6 — Settings Completeness & Notifications

**Spec:** `docs/settings-mapping.md:1` + `docs/settings-implementation.md:1` + `apps/web/src/lib/config/defaults.ts:68`.

- Finish `transfers` section keys (11 downloads + 13 uploads): `uploadslots` (mobile default 2 vs 3), `queuelimit`, `fifoqueue`, `preferfriends`, `autoclear`, `downloadfilters`, etc. Wire to bridge via `settings:update`.
- Notifications: map `notifications.notification_popup_*` to Web `Notification` API.
- Finish `groups` (`groupdownloads/uploads`), `expand_*`, `remotedownloads`/`uploadallowed`.

---

## Phase 7 — Hardening & Parities

- Reconnect + keep-alive, relogged (41) handling, `CantConnectToPeer 1001` fallback.
- Persistence hardening: atomic `downloads.json` writes, `Aborted → Paused` migration, stale `INCOMPLETE*` sweep.
- Bandwidth shaping (`SetDownloadLimit/SetUploadLimit`, adaptive `4096` chunk from `slskproto.py`), throughput chart live (Phase 6 placeholder → Recharts canvas, 60-point ring buffer).
- Shares rescan (`shares.json` manual → `showDirectoryPicker()` where available).
- Folder grouping, auto-clear, `afterfinish` hooks omitted per `TRANSFERS.md:491`.

---

## Workflow for each phase

Per `docs/workflow.md:1` and `AGENTS.md:40`:

```bash
git worktree add -b feat/<phase> ../nicotine_mobile-<phase>   # never edit main directly
cp apps/web/.env.example apps/web/.env
export PATH="$HOME/.bun/bin:$PATH"
bun test && bun run build   # must be green
# Playwright MCP with MockWS.OPEN=1 (see mistakes.md)
gh pr create --fill
# merge via PR, then: git checkout main && git pull && git worktree remove ../nicotine_mobile-<phase> --force
```

**Do NOT:** commit `compose.yaml`/`package.json` port edits (use `compose.override.yaml`), store passwords, reuse reserved version `160/157`.

## Risks (carry from TRANSFERS.md:501)

- `LISTEN_PORT 2234` must be port-forwarded for direct `P`; Phase 1 indirect via `PierceFirewall` mitigates but not fully.
- Browser `localStorage` transfers is mirror only; bridge JSON is truth — clearing site data does not delete server files.
- Files >2GB: guard `offset > size → Local file error`.
- One active `P` per peer.

*Next step after this doc:* `feat/transfers` Phase 0 shims (protocol codes) → Phase 1 indirect connectivity — branch off `main` now that `feat/search-page` is merged.
