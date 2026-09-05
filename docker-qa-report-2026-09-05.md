# Docker re-verification report — browse timeout + QA sweep
Date (UTC): 2026-09-05 ~02:44. No code changed this run (read-only + live WS probes via /tmp scripts).

## Environment (docker, just now)
- `nicotine_mobile-bridge-1` — `ghcr.io/mlnl221/nicotinehub-bridge:latest`, `Up 28 minutes (healthy)`, ports `8787/tcp, 40598/tcp, 40598/udp`. Env: `PORT=8787 LISTEN_PORT=40598 CONFIG_DIR=/config DATA_DIR=/data`. Health `http://localhost:8787/health` → `ok`.
- `nicotine_mobile-web-1` — healthy, `http://localhost:3000/` → `200`.
- `nicotine_mobile-worker-1` — healthy, `/health` → `ok`, version `0.1.0`.
- Working tree: `M apps/bridge/src/session.ts` (the coalescing fix from the previous turn — under test, not re-edited here). Untracked: `.playwright-mcp/`, `test-results/` (QA leftovers, see §7).
- Bridge runs with `UPnP disabled`, `listenPort 40598` (every login line, e.g. `UPnP disabled {"listenPort":40598,...}`). No `BRIDGE_TOKEN` (open LAN bridge).

## Method
1. `docker ps / logs / inspect`, `curl` health + all 13 web routes.
2. Live Soulseek probes as `nicotineHhtest123` over `ws://localhost:8787/ws` (bun scripts in /tmp, repo untouched): `browse rup`, `browse Donald_Trump_Soulseek`, `search flac`.
3. Correlated `docker logs nicotine_mobile-bridge-1 --since 120m` for `peer address resolved / direct peer open|close / sharedFileListResponse / browse timeout / routeResult dropped`.
4. Code pointers re-read (no edits): `session.ts` browse/search paths, `BrowseView.tsx:234`, `browse-tabs.tsx:138-158`, `SearchBar.tsx:83-89`, `protocol.ts:130`, `server.ts:507` portchecker.

## Finding 0 (main): `Donald_Trump_Soulseek` browse still times out — CONFIRMED, now correctly diagnosed as peer-side, not bridge deadlock
- Live repro just now:
  - `browse rup` → `browse:shares folders=34 total=34 hasMore=false error=` (success).
  - `browse Donald_Trump_Soulseek` → `browse:shares folders=0 error="Timed out fetching shares — peer may be offline, firewalled, or your LISTEN_PORT not port-forwarded (check Diagnostics → Network)"`.
- Bridge log (same window, repeated across `02:16`, `02:20`, `02:21`):
  - `peer address resolved {"username":"Donald_Trump_Soulseek","ip":"206.223.234.60","port":63996}` → `direct peer open {...}` → ~20 s silence → `direct peer close {...}` → `browse timeout`. Never a `sharedFileListResponse recv` for this user.
  - Control `rup` (`178.148.252.143:51227`): `direct peer open` → `sharedFileListResponse recv allowed:true pending:true` → `success folders:34` within ~1 s.
- So the old deadlock signature (queueLen growing 2→6 with **no** fresh `GetPeerAddress`/`ConnectToPeer`, no `peer address resolved`) is gone: retries now start at `queueLen 1` and re-resolve the address each time. What remains is the peer opening TCP and then closing without answering the `SharedFileListRequest` (ignoring us / not sharing / busy). Outbound path is healthy (rup proves it); inbound is firewalled (see §4) but that does not block this outbound browse.
- Severity: external/peer-side. No further bridge code indicated for this user. If it must succeed, try again later or from a network with an open LISTEN_PORT in case the peer only answers peers with reachable ports.

## Finding 1: all 13 web routes return 200 — CONFIRMED healthy
`/` `/search` `/browse` `/downloads` `/uploads` `/chat` `/buddies` `/profile` `/interests` `/statistics` `/diagnostics` `/settings` `/files` → all `200` via curl just now. (SSR shell only; authenticated content is client-side over WS, covered by the Playwright mock sweep earlier which passed page-load + browse-flow.)

## Finding 2: live search works end-to-end — CONFIRMED; earlier `routeResult dropped` alarm is DOWNGRADED to not-a-bug
- Just now: `search flac` → `search:start token 91721` → many `search:result` batches → `search:end reason max_results`. `SUMMARY start=true result=true end=true`.
- The `routeResult dropped — no search for token` lines (778 in the last 120 m, tokens 94231/91721) are late/duplicate peer responses arriving **after** the search hit `max_results` and was removed (`session.ts:2575-2579` deletes token + `searches` entry, then late responses hit `session.ts:2549-2552` and are dropped). That is working as designed, not data loss — the WS client already got its results + `search:end`.
- Correction to my earlier note: the first raw-WS search hiccup was my probe using a wrong message shape (`{type:"search", action:"search", ...}` is unknown to the bridge). The UI shape (`apps/web/src/lib/search.tsx:136-137` → `{type:"search", searchId, query}`) works, as re-verified.

## Finding 3: QA `search flow` failure was a mock row-shape bug, NOT a search placeholder bug — CORRECTED
- Real `SearchRow` is `protocol.ts:130-153`: field is **`user`**, not `username` (`session.ts:2995-2998 toRow()` maps `username → user`, `path/folder/filename` split on `\`).
- The QA mock sent `{username:"userA", filename:...}` so `getByText("userA")` could never match, and my probe logged `first=undefined` for the same reason. The search input placeholder (`SearchBar.tsx:83-89`, default `"Search the Soulseek network or paste a release link…"`) **does** match `/Search/i`, so the placeholder theory was wrong.
- Also `search.tsx:152` reads `r.user` for the eager country lookup — consistent with `user`, confirming the mock was at fault.

## Finding 4: browse-error UX is half-masked — CONFIRMED (partial)
- `BrowseView.tsx:234`: the amber banner renders whenever `!loading && folders.length === 0`, including on error: text says the user "shares no files or no shares are configured on the bridge… run a rescan" — misleading when the real cause is a network timeout.
- Mitigating: the header subtitle (`BrowseView.tsx:253-256`) does append `• ${error}`, the error tab state is set (`browse-tabs.tsx:148-158`), and a `Retry` button appears (`BrowseView.tsx:284-286`). So the error is not lost, but the prominent banner points at the wrong remedy. Reproducible in code on every failed browse (e.g. Finding 0's Donald error); no live erroruser exists on the real network (that name was mock-only).

## Finding 5: `LISTEN_PORT 40598` externally closed — CONFIRMED environmental, unchanged
- Last external result in logs: `02:08:24 portchecker port 40598 is closed`. A fresh `GET /portchecker?port=40598` (endpoint `server.ts:507-526`, via `portchecker.ts:19-35` → slsknet.org) timed out just now — the external checker itself is slow/flaky, so no fresh verdict, but nothing since suggests it opened (UPnP stays disabled, no router forward for 40598 in this WSL/Docker setup).
- Impact is inbound-only: outbound browse/search/downloads still work (rup + search proofs). Inbound pierce/direct-to-us and upload serving remain unavailable until 40598/tcp+udp is forwarded. `compose.yaml:10,20-23` already publishes the port; the missing piece is host/router NAT, not app code.

## Finding 6: `tester/INVALIDPASS` login failures in bridge log — CONFIRMED harmless
- Lines like `login rejected {reason:INVALIDPASS}` for `tester` are the Playwright mock runs hitting the real docker bridge with fake creds. Expected; no action.

## Finding 7: QA leftovers untracked — CONFIRMED trivial
- `git status`: `M apps/bridge/src/session.ts` (intended fix under test), untracked `.playwright-mcp/`, `test-results/`. Suggest `rm -rf test-results` and ignoring `.playwright-mcp/` if it stays local-only. No specimen QA spec file remains in `e2e/` (temp `qa.spec.ts` was removed).

## Bottom line
- Bridge deadlock fix holds in docker: fresh dial per retry, `rup` browses in ~1 s, search start→result→end healthy, all pages 200.
- `Donald_Trump_Soulseek` = reachable peer that won't answer shares (opens then closes TCP); surfacing the timeout + port-forward hint is the correct behavior today.
- Real UI bugs to fix next (not done here): (a) amber no-shares banner shows on browse errors (`BrowseView.tsx:234`) — gate it on `!error`; (b) QA mock search rows must use `user` (+ `path/folder/filename`) per `protocol.ts:130`.

## Consensus verification — 3 independent subagents (2026-09-05 ~02:50 UTC, build mode)
All verifiers ran live docker probes + log correlation + code re-reads. Unanimous: report stands, with two minor corrections.

| Finding | Verdict | Notes |
|---------|---------|-------|
| 0 — Donald browse deadlock → peer-side timeout | **CONFIRMED** | Diff at `session.ts:2793` (`reusingDial` → `isLivePending \|\| hasLiveSocketForUser`) + cleanup at `2749/2852/1933` matches report. Logs show `queueLen` now always `1`, `peer address resolved` per retry, `rup` 34 folders vs Donald open→20s→close with no `sharedFileListResponse`. Live WS repro `RUP folders=34 / DONALD timeout` reproduced 02:49. |
| 1 — 13 routes 200 | **CONFIRMED** | `curl` loop re-ran now: all `200`, `web healthy`. |
| 2 — search end-to-end | **CONFIRMED** downgraded | `session.ts:2575-2579` deletes token on `max_results`, then `2549` drops lates — 778 dropped lines are after-end lates, not loss. Fresh probe `search flac token 58229 → 13 batches → max_results` confirms. Wrong probe shape was pilot error. |
| 3 — SearchRow `user` vs `username` | **CONFIRMED** | `protocol.ts:130` + `session.ts:2995 toRow()` → `user`. QA mock bug, not placeholder. Placeholder `/Search/i` does match (`SearchBar.tsx`). Minor: report cited old placeholder wording/line numbers. |
| 4 — amber banner half-masked | **CONFIRMED (partial)** | `BrowseView.tsx:234 !loading && folders.length===0` lacks `!error`; header `253-256` + `browse-tabs.tsx:148-158` + retry `284-286` mitigate but banner misleads. |
| 5 — LISTEN_PORT closed | **CONFIRMED** environmental | `compose.yaml:10` 40598, `portchecker.ts:19` slsknet check flaky; re-check now `open:false` (02:50), logs `UPnP disabled`, impact inbound-only, no code fix needed. |
| 6 — tester INVALIDPASS | **CONFIRMED** harmless | 3 logins `tester/INVALIDPASS code:1` → `ws close 1001`, transient. |
| 7 — leftovers | **PARTIALLY** | `git status` shows `M session.ts` + `?? docker-qa-report…`; `.playwright-mcp/` + `test-results/` are **gitignored** (`.gitignore:46-47`) so not in `git status` untracked — report should have said `git status --ignored` or FS check. Trivial. |

**Agreed bug & solution (consensus)**
- **Bug:** `apps/bridge/src/session.ts:2793` `ensurePeerAndSend` coalesced all browses when any `pendingPeerMessages.length>0`, plus `pendingPeerQueue.size>0` / stale `peerAddressRequests` — a timed-out browse left a stale queue that blocked every future `GetPeerAddress`/`ConnectToPeer` for that user, growing `queueLen 2→6` and never re-dialing.
- **Solution (already in working tree, verified in docker):** Narrow `reusingDial` to live state only — `isLivePending` (created <20s ago, `PEER_ADDRESS_TIMEOUT_MS`) or `hasLiveSocketForUser` (cached <30m + live `peerStates` socket for that `username+type`). On every timeout path (`2747 browse timeout`, `2852 GetPeerAddress timeout`, `1933 idleSweep`) delete `pendingPeerMessages` for the user. Result: retries start `queueLen 1`, fresh `GetPeerAddress` + `ConnectToPeer` + direct open each time; `rup` passes, Donald correctly times out with hint instead of silent deadlock.
- **Plan update:** No change to the deadlock fix — it is consensus-correct. Next plan items remain UI-only, low-priority: `BrowseView.tsx:234` gate banner on `!error`, fix QA mock row shape, optionally clean `test-results/` leftovers. No new bridge logic required for port closed (environmental).
