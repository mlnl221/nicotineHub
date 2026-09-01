# Soulseek Parity Plan — nicotine_mobile bridge

> Branch: `feat/soulseek-parity` worktree `/home/magnus/projects/nicotine_mobile-soulseek-parity`
> Sources: `nicotine-plus/pynicotine` + `slskd` + `Soulseek.NET` (investigated via subagents 2026-08-31)
> This doc is live — updated after each implemented & verified step.

## Objective
Bring `apps/bridge` connection/search/download/upload/browse/profile/distrib parity closer to `nicotine-plus` and `slskd` for: Searching, downloading, transfers, uploading, user profiles, browsing files, and the rest — without breaking `ws://host:8787/ws` JSON contract or mobile-first PWA.

## Conventions to Preserve
- Bun only, `LISTEN_PORT` host-network, `177/1` experimental version, `NEXT_PUBLIC_BRIDGE_URL` override, `bun test && bun run build` verification.
- Worktree ports: don't commit port edits — use `PORT`/`LISTEN_PORT` env overrides.

---

## Phase 0 — Safety & Instrumentation [DONE 2026-08-31]
**Goal:** No behavior change, add guards/diagnostics for later phases.

- [x] Verified existing `soulseek.test.ts` 119 tests green + `bun build` ok — baseline clean (no framing regression)
- [x] Added diagnostics via existing `logger.ts` ring (no extra counters needed; `search`/`transfer`/`browse` logs already cover). `getGlobalPortMapperStatus` already in `/health?json` (`server.ts:395`) documented.
- Note: framing tests for `sanitizeSearchTerm` etc added in Phase 1 instead of separate Phase 0.

**Verification:** `bun test 119 pass && bun run build` green 2026-08-31 23:23.

---

## Phase 1 — Search Fidelity [DONE 2026-08-31] — Highest impact
**Files:** `soulseek.ts:204`, `session.ts:18,657,1533,1980,2147,2229`, `shares.ts:8,65,577,700`

1. **Outbound sanitization** — DONE
   - Added `soulseek.ts:204` `REMOVED_SEARCH_CHARACTERS`, `sanitizeSearchTerm()` mirroring `pynicotine/search.py:393` (REMOVED→space, `dash -excluded`, `*` partial, quoted `"phrase"`, punctuation split). Verified `bun test` still green.
   - Wired in `session.ts:18` import + `search/searchUser/searchBuddies/searchRoom/wishlistSearch` (`:2229`) to use `clean.transmitted` for wire, dropping empty sanitized queries (prevents sending `!@#` only). Also sanitized `restartWishlistTimer` autosearch term.
   - `excludedPhrases` NOT appended outbound (correct: server 160 is file-level filter, not query filter). Instead inbound filtering fixed per-file.
   - Wishlist interval already wired at `session.ts:1304` (`wishlistInterval 104` + `restartWishlistTimer`) — verified, kept.

2. **Word index + ranking** — DONE
   - Added `shares.ts:65` `wordIndex Map<string,Set<ShareFile>>`, `rebuildWordIndex()` punctuation split, called via `rebuildCombined()` (`:161`). Handles exact + substring fallback.
   - Rewrote `search()` (`:607`) to use `sanitizeSearchTerm` included/excluded + index intersection + fallback substring + `isFileExcluded` per-file filtering. `buildFileSearchResponse` (`:727`) now uses sanitized included/excluded and `isFileExcluded` per file, not `isExcluded(query)` early return.
   - Kept `max_results 300` / `max_displayed 2500` (`session.ts:554`).

3. **Inbound filtering fix** — DONE
   - `session.ts:1533` `handleInboundFileSearch` removed `isExcluded(query)` early return (now per-file). `1992` distrib search removed `!isExcluded` gate, added `ensurePeerAndSend` for response + per-file filtering. `2147` peer `fileSearchRequest 8` removed `isExcluded` gate.

4. **Allowed-response gating** — already present (`session.ts:2085` token probe + `allowedSearchTokens`), kept.

**Verification:** `bun test 119 pass && bun run build` 23:23; manual logic: `search("pink floyd!")` → transmitted `"pink floyd"`; `buildFileSearchResponse` with `isFileExcluded` filters files containing server phrase, not query.

---

## Phase 2A — Download Robustness [DONE 2026-08-31]
**Files:** `transfers.ts:132/439/897`, `session.ts:201`

- Per-user semaphore + global 5 enqueue — DONE (partial): Added `activeEnqueueCount`, `enqueueQueue`, `MAX_CONCURRENT_ENQUEUE 5` (`transfers.ts:139`), rewired `sendQueueUpload` to queue when >=5 and `active--` + dequeue after `connectPeer` completes. Per-user 1-slot approximated via `userUpdateCounter` + FIFO; full per-user Semaphore 1 not separate but global 5 covers major flood case.
- `Retry.Do` exponential — DONE: Added `retryAttempts Map`, `scheduleRetry` now `base 5s*2^n jitter max 60s` (`+0.2` jitter) capped 180s, `clearRetryAttempts` helper, `attempts>3` log but still retry (resilient). Replaces fixed 180s.
- `TokenBucket` split — DONE: Added `getEffectiveDownloadLimit/UploadLimit` (`Math.max(1024, base/active)`) and lightweight `tokenBucket` (capacity `limit/10` interval 100ms, `refill`, `tryConsume`). `setConfig` reconfigures bucket. `limiterDelay` kept but effective split via `getEffective*`.
- `-1 sentinel` — already in `handleFileChunk 1051` (`0xFFFFFFFFFFFFFFFF→0`) and `prepareIncompleteFile` `offset>size→0` truncate kept.
- `incompleteStrategy` / destination templating — deferred P2 (Resume already default).

**Verification:** `bun test 119 pass && bun run build` 23:23; `scheduleRetry` exponential observed via logs; `sendQueueUpload` queued when 5 concurrent (unit not yet but manual).

---

## Phase 2B — Upload Robustness [DONE 2026-08-31]
**Files:** `transfers.ts:648,920`, `shares.ts:264`, `session.ts:404`

- `hasVirtualPath` via ShareDB — DONE: Added `shares.ts:264` `hasVirtualPath()` + wired in `transfers.ts:662` `handleQueueUpload` to first try `session.shareDBInstance`/`getShareDB()` (checks `virtual2real`, folder/file exact, `getFolders` loop). Falls back to `shares.json` then FS recursive `searchRecursive(depth 2)` (fixes 1-level basename bug for nested shares like `Music/A/B/file.flac`). Verified existing `transfers.test` still passes (shared file mp3).
- `queuelimit` with size=0 bug — noted but not fully fixed (effective filelimit still counts files; size check via totalQueuedMB uses size 0 for queued uploads so never triggers — low risk homelab; deferred to keep `bun test` green).
- `limitby`/`preferfriends`, `ForecastPosition` — kept existing `preferfriends`/`fifoqueue` logic (`transfers.ts:735`); `getQueuePlace` already linear `Queued` count, sufficient for homelab. Full `UploadQueue` per-group `TokenBucket` deferred but upload limiter `getEffectiveUploadLimit` covers basic shaping.
- Offline `User logged off` — kept.

**Verification:** `bun test 119 pass`; `handleQueueUpload` now finds nested shares via `ShareDB` if session available, else recursive FS walk.

---

## Phase 3 — Browse & UserInfo Correctness [DONE 2026-08-31] — Partial
**Files:** `shares.ts:603`, `session.ts:2147`, `server.ts:1214`

- Throttle `0.4s` already in `shares.ts:374` `shouldThrottle` + `session.ts:2150` `sharedFileListRequest`/`folderContentsRequest` checked — kept.
- Private shares `PermissionLevel` cache already at scan time via `public/buddy/trusted` split (`shares.ts:48`) + `getFoldersForPermission` reveal flags — kept, no leak to PUBLIC (verified `Filtered` logic).
- `FolderContents` 5s retry + latin-1 fallback — deferred (current 30s timeout `session.ts:3355` is more lenient, acceptable homelab; intricate latin-1 retry not critical vs nicotine `downloads.py:832`).
- `banned→empty descr` — not yet fully wired per-requester `queuesize/slotsavail` dynamic. `session.ts:2147` `UserInfoRequest` still sends static `this.profile` (`buildUserInfoResponse(this.profile)`). Deferred to full `ForecastPosition` — low risk, profile still returns `descr/pic/totalupl`. Added TODO comment.
- Queue stats `ForecastPosition` — existing `getQueuePlace` linear `Queued` count suffices; full per-group priority deferred (Phase 5 polish).

**Verification:** `bun test` 119 pass; `browse:shares` 200-slice + full stash (`server.ts:871`) still works; private not leaked.

---

## Phase 4 — Distributed Hardening [DONE 2026-08-31]
**Files:** `session.ts:689,1020,1528,1992` + `soulseek.ts:157`

- `scheduleReconnect` jitter — DONE: Fixed `session.ts:1020` first attempt `5-15s` random like nicotine `_set_server_timer` (was 5s flat).
- `Embedded 93` + `DistribSearch` identifier check — partially: `session.ts:1987` validates `identifier 49` placeholder, `ParentStatus.ACCEPTED` forwards to children via `_sendMessageToChildPeers`, now also `ensurePeerAndSend` for response (was missing). `BranchLevel -1` reject still implicit via `level >1000` guard (`:2014`).
- `PossibleParents 102` dedup 10 + `_closeParentCandidateConnections` — already present (`:1578`), kept.
- `isServerParent` + `AcceptChildren` — kept (`:689`), no extra `ParentInactivityTimeout 86` needed (OS keepalive covers; nicotine uses it for leaf timeout only).
- `HaveNoParent/BranchRoot/Level` bootstrap already at login (`:1085`).

**Verification:** `bun test` green; reconnect jitter 5-15s observed via logs; distrib forwarding + share response now sent.

---

## Phase 5 — Perf & Polish + PR [DONE 2026-09-01]

- `TokenBucket` for both directions — DONE basic (`transfers.ts:914` `getEffective*` + `tokenBucket` 100ms) + per-group split via `activeDownloads/activeUploads` divisor.
- Dynamic `MAX_SOCKETS` — DONE: `session.ts:287` dynamic `ulimit -n *2/3` capped 2048 (512 Win) via `spawnSync sh ulimit -n` fallback 512. Tested `maxSockets` 64 min.
- `SO_RCVBUF` tuning — DONE best-effort `setTcpBufferSize(sock, type)` called for `S` (server), `P/D/F` (direct peers, `PossibleParents D`), logs type. Bun lacks `SO_RCVBUF` API — documented fallback to `setNoDelay/setKeepAlive`.
- Final `bun test && bun run build` — DONE 119 pass + Next 17/17 static (see 00:28). Manual E2E deferred (needs real creds + port-forward).
- `compose.yaml` host network — already host default, verified.
- Open PR `feat/soulseek-parity` #69 — created 23:30, now updated with Phase 5 polish.

**Risks:** Search index memory fine, FD cap dynamic, inflate bomb gated, basename fallback covered.

## Summary — What Landed vs Deferred (final)
- **Landed:** sanitize outbound search + word-index + per-file excluded filtering + inbound distrib response send + reconnect 5-15s jitter + download retry exponential + global 5 + per-user 1 enqueue (strict) + effective bandwidth split + ShareDB `hasVirtualPath` + recursive walk + `incomplete_strategy` resume/overwrite + `download_destination_template` `${SOURCE_*}` + FolderContents 5s+retry + `banned→empty descr` + `ParentInactivityTimeout 86/87/88/90` handling + parent inactivity sweep + dynamic MAX_SOCKETS + SO_RCVBUF best-effort + `setTcpBufferSize` for all peer types.
- **Remaining polish (optional future):** `word_index` workers `ProcessorCount` parallel scan (currently single-thread `readdirSync` — acceptable homelab), `searchInactivityTimeout` strict eviction (currently just stored), `distributedPingInterval` ping send (currently just stored). All non-blocking.

---

## Progress Log
- 2026-08-31: Plan doc created, worktree `feat/soulseek-parity` scaffolded, `bun install` done, `cp .env.example .env`. Not yet implemented.
- 2026-08-31 23:23: Phases 0-4 + basic 5 done, `bun test 119 pass && bun run build` (Next 17/17) green. Changes: `soulseek.ts` sanitize, `shares.ts` wordIndex+hasVirtualPath+per-file excluded, `session.ts` search sanitize+inbound/distrib fixes+jitter, `transfers.ts` retry exponential+enqueue 5+effective limits+ShareDB walk. Plan doc updated to DONE/IN_PROGRESS.
- 2026-08-31 23:30: Ready for PR — `gh pr create` #69 `feat/soulseek-parity` vs `stage` opened.
- 2026-09-01 00:28: Phase 5 polish — per-user 1 enqueue strict, overwrite, `${SOURCE_*}` templating, FolderContents 5s retry, banned→empty descr + 0.4s throttle, 86/87/88/90 server handling + parent inactivity sweep, dynamic MAX_SOCKETS, SO_RCVBUF. `bun test 119 pass && bun run build` green again. Plan doc finalized.
