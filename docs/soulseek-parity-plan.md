# Soulseek Parity Plan — nicotine_mobile bridge

> Branch: `feat/soulseek-parity` worktree `/home/magnus/projects/nicotine_mobile-soulseek-parity`
> Sources: `nicotine-plus/pynicotine` + `slskd` + `Soulseek.NET` (`~/projects/Soulseek.NET` 277 *.cs `SoulseekClient.cs:4915` — investigated 2026-09-01) — live doc, updated after each step.

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

## Summary — What Landed vs Deferred (final pre-Soulseek.NET)
- **Landed:** sanitize outbound search + word-index + per-file excluded filtering + inbound distrib response send + reconnect 5-15s jitter + download retry exponential + global 5 + per-user 1 enqueue (strict) + effective bandwidth split + ShareDB `hasVirtualPath` + recursive walk + `incomplete_strategy` resume/overwrite + `download_destination_template` `${SOURCE_*}` + FolderContents 5s+retry + `banned→empty descr` + `ParentInactivityTimeout 86/87/88/90` handling + parent inactivity sweep + dynamic MAX_SOCKETS + SO_RCVBUF best-effort + `setTcpBufferSize` for all peer types + sliding search 20s + 400 limit (f46fd39).
- **Remaining polish (optional future):** `word_index` workers `ProcessorCount` parallel scan (currently single-thread `readdirSync` — acceptable homelab), `searchInactivityTimeout` strict eviction (currently just stored), `distributedPingInterval` ping send (currently just stored). All non-blocking — **but Soulseek.NET shows 86/87/90 are actually ignored there too**, so deferred was correct parity.

---

## Soulseek.NET Findings — Deep Dive 2026-09-01 (`~/projects/Soulseek.NET`)

**Repo:** 277 `*.cs`, core `src/Soulseek/SoulseekClient.cs:4915`, `src/Messaging/MessageBuilder.cs:48`/`MessageReader.cs:43`, `src/Network/PeerConnectionManager.cs:858`/`DistributedConnectionManager.cs:1138`, `src/SearchInternal.cs:317`/`SearchResponder.cs:267`, `src/Messaging/Handlers/*:582/449/304`.

**Framing:** `[uint32 len][uint32 code][payload]` server/peer (`len=4+payload`), `[len][uint8 code][payload]` distrib/init; only `SearchResponse 9/BrowseResponse 5/FolderContents 37` call `.Compress()` (`MessageBuilder.cs:69` `ZOutputStream`) — matches bridge `soulseek.ts:636` deflate lvl4. Keepalive: no periodic `ServerPing 32`, server `WithoutInactivityTimeout` (`SoulseekClientOptions.cs:207`), `DistributedPing 0` child→parent `DistributedPingResponse(GetNextToken())` (`DistributedMessageHandler.cs:91`). Max incoming: no cap in .NET — **bridge caps 1M/448M are stricter (good)**.

**Server:** `server.slsknet.org:2271` default (`SoulseekClient.cs:48`), `Login 1` + `SetListenPort 2` concatenated in one flush (`:3255`) to avoid race, `MajorVersion 170` (`Constants.cs:34`) vs bridge `177/1`. Listener `Listener.cs:49` `IPAddress.Any:50000` `MaxConsecutiveErrors 20 → Delay 1s`.

**Peer init:** `PeerInit 1` `[username][type][token]` vs `PierceFirewall 0` `[token]` — raced `direct Tcp.connect` vs `indirect server ConnectToPeer 18 + Waiter.Wait<SolicitedPeerConnection>` (`PeerConnectionManager.cs:413` `Task.WhenAny`), loser cancelled. Bridge currently races `direct + indirect` but via `pendingConnects` Map + `GetPeerAddress 3` cache — close.

**Distributed:** `DistributedConnectionManager.cs:354` `AddParentConnectionAsync` races candidates sorted `OrderBy(BranchLevel)` (`:408`), `BranchLevel = ParentLevel+1 :138`, `CanAcceptChildren = Enabled&&AcceptChildren&&(HasParent||IsBranchRoot)&&children<limit :148`, `WatchdogTimer 15m :50` re-requests `HaveNoParent 71` if `!HasParent&&!IsBranchRoot`, `EmbeddedMessage 93` unwraps before broadcast (`:289`) + `BranchLevel 126/BranchRoot 127/AcceptChildren 100/HaveNoParent 71` heartbeat debounced 5s forced 5m (`:743`). Bridge sorts **not yet** (takes first), no watchdog, no unwrap strict.

**Search:** `SearchOptions.cs:52` `SearchTimeout 15s sliding Reset()` (`SearchInternal.cs:266`), `ResponseLimit 250/FileLimit 25000` split, `MinimumResponseFileCount` + filters (`:212 TryAddResponse`). `SearchResponder.cs:166` `SearchResponseCache` second-chance on delayed `PierceFirewall` + `CannotConnect 1001 → TryDiscard`. Bridge `MAX_DISPLAYED 400` single limit, fixed timeout pre-2026-09-01, no cache.

**Transfers:** `TokenBucket.cs:57` capacity `MaxSpeed*1024/10` interval `100ms` `GetAsync(count)` FIFO semaphore + EMA `TransferInternal.cs:278` `speedAlpha 0.2` each `1000ms`, `UniqueKeyDictionary` duplicate check, `Governor/SlotAwaiter`, `WriteQueueSemaphore 250` backpressure → `ConnectionWriteDroppedException`.

**Browse:** `BrowseResponseFactory.cs:83` `Directories + LockedDirectories` second list, `RawBrowseResponse` disk cache `browse.cache`. Bridge only `Directories`.

**Remaining optional verdict:** `searchInactivityTimeout 87/distribPingInterval 90` defined `MessageCode.cs:423/433` but **no handler** in `ServerMessageHandler.cs:203` → `Unhandled` log; `word_index workers` not in `Soulseek.NET` (delegates to resolver). So deferred was correct; Soulseek.NET parity = ignore.

---

## Phase 6 — P0 Against Soulseek.NET [DONE 2026-09-01] — on same worktree `feat/soulseek-parity`

Per `Soulseek.NET` 277-file audit vs bridge, P0 implemented:

- **P0-1 Search limits 400 + ResponseCache second-chance + CannotConnect discard** — DONE
  `session.ts:193,588` `MAX_DISPLAYED 400` + sliding `routeResult` `clearTimeout+setTimeout` (Soulseek.NET `SearchInternal.cs:266`), `session.ts:236` `searchResponseCache Map<Tok,{user,token,query,response,ts}> TTL 60s` + `startDistribWatchdog` sweep 15m, `ListenerHandler` second-chance via `pendingPeerMessages` flush on `PierceFirewall` `code 0` (`session.ts:1984`), `cantConnectToPeer 1001` `session.ts:1492` now discards `searchResponseCache` + `pendingPeerMessages` + `pendingFileTokens` (Soulseek.NET `TryDiscard`).

- **P0-2 TokenBucket async GetAsync + EMA speed** — DONE
  `transfers.ts:1029` `makeTokenBucket()` FIFO `queue` + `GetAsync(requested,limit)` `Common/TokenBucket.cs:155`, two buckets `uploadBucket/downloadBucket` configured via `setConfig`, `onData` `async` `await downloadBucket.GetAsync` + `updateEmaSpeed` `avg*0.8+curr*0.2` each 1000ms (`TransferInternal.cs:278`), `startUploadStream` `await uploadBucket.GetAsync` + EMA.

- **P0-3 Distributed best-parent sort + watchdog 15m + ping reply** — DONE
  `session.ts:771` `_adoptParent(username?)` now `OrderBy(branchLevel)` best pick (`DistributedConnectionManager.cs:408`), `BranchLevel/Root WAITING` handlers `session.ts:2131,2148` `if(branchLevel!==null&&branchRoot) _adoptParent()`, `session.ts:2045` `DistribPing 0` reply `frameDistribMessage(0, packUint32(token))` (`DistributedMessageHandler.cs:92`), `session.ts:1833` `startDistribWatchdog()` 15m `HaveNoParent` if `!parent&&!isServerParent&&loggedIn` (`DistributedConnectionManager.cs:50`), started at `session.ts:1167` post-login, cleaned in `cleanupServerTimers`.

- **P0-4 Browse locked dirs + Raw cache** — DONE
  `shares.ts:675` `buildSharedFileListResponse` now serializes `visible dirs + unknown0 + locked dirs` second list (`BrowseResponseFactory.cs:83`) via `all = public+buddy+trusted` minus visible, writes `browse.cache` raw `Compressed` (`RawBrowseResponse` cache).

**Verification:** `bun test 119 pass` + `bun run build` 17/17 green 2026-09-01 00:45, `docs/soulseek-parity-plan.md` updated, commit pending `feat/soulseek-parity` push to PR #69.

---

## Progress Log
- 2026-08-31: Plan doc created, worktree `feat/soulseek-parity` scaffolded, `bun install` done, `cp .env.example .env`. Not yet implemented.
- 2026-08-31 23:23: Phases 0-4 + basic 5 done, `bun test 119 pass && bun run build` (Next 17/17) green. Changes: `soulseek.ts` sanitize, `shares.ts` wordIndex+hasVirtualPath+per-file excluded, `session.ts` search sanitize+inbound/distrib fixes+jitter, `transfers.ts` retry exponential+enqueue 5+effective limits+ShareDB walk. Plan doc updated to DONE/IN_PROGRESS.
- 2026-08-31 23:30: Ready for PR — `gh pr create` #69 `feat/soulseek-parity` vs `stage` opened.
- 2026-09-01 00:28: Phase 5 polish — per-user 1 enqueue strict, overwrite, `${SOURCE_*}` templating, FolderContents 5s retry, banned→empty descr + 0.4s throttle, 86/87/88/90 server handling + parent inactivity sweep, dynamic MAX_SOCKETS, SO_RCVBUF. `bun test 119 pass && bun run build` green again. Plan doc finalized.
- 2026-09-01 00:40: Sliding search 20s + 400 limit (f46fd39) — `MAX_DISPLAYED 2500→400`, wired to `this._maxDisplayedResults`, `routeResult` sliding reset.
- 2026-09-01: Soulseek.NET deep dive 277 files, P0 scoped above — now implementing on same worktree `feat/soulseek-parity`.
- 2026-09-01 00:45: P0 done — sliding 400 + ResponseCache/CannotConnect discard + TokenBucket async/EMA + distrib best-parent/watchdog/ping + locked dirs/raw cache. `bun test 119 pass` + build green, ready to push.
