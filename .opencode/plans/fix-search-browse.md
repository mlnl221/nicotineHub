# Plan: Fix Search & Browse No-Results (host network, plain IP)

**Worktree:** `/home/magnus/projects/nicotine_mobile-fix-search-browse` branch `fix/search-browse-noresults` from `stage` (`fdf1cb2`)

**Issue:** Docker `network_mode: host` with `LISTEN_PORT 60754` reachable locally (`ss *:60754`, inbound storms) but global search `tiesto/dj splash` and user browse `kutiz` timeout 0 results; profiles work. Health: `upnp {active:null, error:"No UPnP devices found", ip:192.168.86.83, hasPort:true}` plain IP, `portchecker` not yet verified. Logs show only `code 18 ConnectToPeer` flood + `peer inbound open {remote}` storms, zero `search:result`/`sharedFileListResponse`/`FileSearchResponse`.

## Steps

- [x] 0. Env setup — `rm -rf node_modules apps/**/node_modules; bun install` + `cp apps/web/.env.example apps/web/.env` (worktree per mistakes.md). Use ports `3001/8788/60755` locally `PORT=8788 LISTEN_PORT=60755 bun --cwd apps/bridge dev` + `PORT=3001 NEXT_PUBLIC_BRIDGE_URL=ws://localhost:8788/ws bun --cwd apps/web dev`. Do not commit port changes.
- [x] 1. Diagnostics logging — add lifecycle logs: `search request {searchId, query, sanitized, transmitted, token}` `server.ts:989`; `FileSearchResponse received {tokenProbe, allowed, payloadLen}` `session.ts:2270`, dropped reason, `routeResult`; browse `requestSharedFileList/ensurePeerAndSend` `session.ts:2576/2621` with `hasCached/hasPending`, `connectToPeerViaAddress` direct result, `PierceFirewall` receipt `2061`, `flushPendingPeerMessages`, `allowedPeerResponses` gate, parse success/folder count. Lower noise but keep debug.
- [x] 2. Fix F heuristic — `session.ts:1733-1770` listener data: only treat raw token as `F` if `pendingFileTokens.has(token)` AND not a valid `PeerInit` frame (`code 0/1` with sane `len`). Otherwise proceed to `processPeer` init path. Prevents misclassifying `P` search response as `F` (small len probe).
- [x] 3. Fix search/browse indirect fallback — ensure `sendConnectToPeerFallback` token is tracked separately from queued `pendingPeerMessages` flush; `flushPendingPeerMessages` already filters `connType`, ensure pierced `P` socket `initDone=true` `session.ts:2069` triggers flush. Extend `DEFAULT_SEARCH_TIMEOUT_MS` handling to sliding reset `session.ts:2437` verified. Add retry for browse folder contents second chance? Already 5s retry `session.ts:2593`. Fix `requestUserInfo` vs `requestSharedFileList` parity: both use `overallTimer` 30s.
- [x] 4. Fix external port/IP detection — `session.ts:344-368` `findLocalIpAddress` picks first non-internal; ensure correct for multi-NIC host: probe via `os.networkInterfaces` fallback to dummy UDP connect to `server.slsknet.org:2242` to pick source IP, as earlier fix `038882c`. Keep `192.168.86.83` detection but ensure `SetWaitPort` advertises correctly. Expose `portchecker` result in `diagnostics:health` and UI warning if closed.
- [x] 5. Tests — `bun test` passes (soulseek framing, shares, transfers, logger, plugins, portmapper). Add regression: search token gating, browse allowed, F heuristic.
- [x] 6. Build — `bun run build` typecheck both apps.
- [x] 7. PR — push branch, open PR from `fix/search-browse-noresults` → `stage`, link issue, include compose `network_mode: host` repro, health/portchecker evidence, log before/after.

## Verification

- Repro `tiesto` global search returns rows (`search:result` frames >0) on host with port forwarded (or at least logs show `FileSearchResponse received` then `routeResult`).
- Browse `kutiz` returns `browse:shares` folders or `browse-error` with reason, not silent timeout.
- `curl /portchecker?port=60754` shows `open:true` after forward; otherwise UI explains port required.

## Risks

- Flood logs ~100 code18/s — sampling / level filter.
- `Bun.listen` host vs bridge mode `compose.override.yaml` — keep `host` for prod, `bridge` for worktree dev.
