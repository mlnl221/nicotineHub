# Bug Plan — Nicotine Hub (real, non-demo) end-to-end test

**How tested:** bridge (`ws://localhost:8787/ws`, open) + web (`http://localhost:3000`) running locally.
Logged in with the real Soulseek account `test123mlnl` (login **succeeded** against `server.slsknet.org:2242`).
Driven via Playwright (bundled Chromium) using **client-side navigation** (sidebar clicks), because direct URL
loads are broken (see P0-1). Account provided by the user; **no demo mode used**.

**Environment (2026-08-31 update):** Windows 11 + ProtonVPN (WireGuard `10.2.0.2:49127` forwarded) + WSL (`172.24.172.238`).
- **Bun listener verified:** `Bun.listen` on `49127` binds `0.0.0.0` and is reachable while a WS session is logged in (`127.0.0.1:49127 OPEN` and `172.24.172.238:49127 OPEN` while `ws` alive; `CLOSED` after `ws` close — expected lifecycle). Minimal `Bun.listen` probe on `41234` also succeeded, so `Bun 1.4.0` is **not** the issue.
- **Windows→WSL chain verified:** User confirmed `Test-NetConnection 172.24.172.238:49127 TcpTestSucceeded: True` and `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=49127 connectaddress=172.24.172.238` in admin PowerShell. `portproxy show all` lists `0.0.0.0  49127  172.24.172.238  49127`. This hop is **working** (no Windows Firewall allow rule added — correct, only forwarding).
- **Remaining hop:** `ProtonVPN (10.2.0.2:49127) → Windows` still needs validation: `Test-NetConnection 10.2.0.2 -Port 49127` **while bridge is logged in** (WS open) should succeed; currently live search `armin van buuren` still returns `search:end reason timeout` with `0` results (`2` frames: start+end, `0` result frames), so peers cannot yet connect back via ProtonVPN's forwarded port. Verify also external checker via ProtonVPN exit IP:49127 if available.
- **Note:** peer listener only lives while a WS is connected & logged in (per-session `session.ts:1078` `startListener` after `login success`). Probes that showed `CLOSED` after `ws close` are expected — keep the web page/WS alive during tests.

---

## P0 — Critical (fixed 2026-08-31)

### P0-1. Redirect/auth-gate race: refresh or deep-link to any authenticated route lands on `/search` — FIXED
- **Evidence:** `page.goto('/buddies')`, `/private-chat`, `/profile/Donald_Trump_Soulseek`, `/browse/Donald_Trump_Soulseek` all ended with `url === /search` and the **Search screen rendered**. Client-side navigation (sidebar clicks) works fine — so the bug only hits full page loads / refresh / URLs.
- **Root cause:** every protected page did `if (state.status !== "connected") router.replace("/")` (`buddies`, `private-chat`, `profile`, `browse`, `chat`, …). `app/page.tsx` does `if (state.status === "connected") router.replace("/search")`. On a full reload `SessionProvider` starts `idle`; the protected page bounces to `/` *before* the cookie auto-login completes, then `/` bounces to `/search`. This also breaks the explicit request "view Donald_Trump_Soulseek user profile" via URL.
- **Fix applied (2026-08-31):**
  - In protected pages, only `router.replace("/")` on `failed` (not on `idle`/`connecting`); render a spinner while connecting (`idle`/`connecting`) instead of bouncing. Files fixed: `search`, `buddies`, `private-chat`, `profile/[username]`, `browse/[username]`, `profile`, `browse`, `chat`, `chat/[room]`, `downloads`, `uploads`, `interests`. `profile/[username]` and `browse/[username]` and `chat/[room]` also early-return on idle/connecting before redirect.
  - `diagnostics` and `statistics` already had correct idle guard; left as-is.

### P0-2. Invalid nested `<button>` in private-chat list → React hydration error — FIXED
- **Evidence:** console error `In HTML, <button> cannot be a descendant of <button>`. The conversation list item in `app/private-chat/page.tsx` is a `<button>` (line ~152) and contains a nested close `<button>` (line ~172).
- **Fix applied:** outer item changed to `<div role="button" tabIndex={0} onKeyDown>` with `cursor-pointer`, closing `</div>`; inner close button remains a `<button>`.

---

## P1 — Connectivity / robustness (partially environmental, partially fixed)

### P1-1. No inbound-port warning; search returns 0 results silently — FIXED (UX)
- **Evidence:** bridge log `search end reason timeout` with 0 results; `UPnP: Failed … No UPnP devices found`; Search screen showed empty state with no explanation. `search:result` frames never arrived (0 in capture) before portproxy fix.
- **Fix applied (SearchScreen):** when `activeTab.status === "ended"` and `visibleRows.length === 0`, show contextual empty state:
  - if `reason === "timeout" && total === 0` → "No results — check your listening port (49127)" + explanation that Soulseek returns results peer-to-peer to your listening port + link to `Settings → Network` + ProtonVPN/portproxy hint + "timeout" badge + "Search again" button.
  - otherwise → "No results" / filtered-out hints.
- **Still needs (env):** outbound port check banner in Settings → Network using bridge's port-reachability, and `10.2.0.2:49127` verification while logged in.

### P1-2. `DATA_DIR` (`/data`) not writable → plugins/transfers can't persist — FIXED
- **Evidence:** bridge logs `plugins persist failed EACCES: permission denied, mkdir '/data'`; `/data` does not exist in this sandbox, so downloads would fail to save.
- **Fix applied (server.ts:251):** `DATA_DIR` changed from `const` to `let`; `mkdirSync(DATA_DIR)` now falls back to `./data` then `os.tmpdir()/nicotine-hub` on failure, tests writability via `.writetest`, sets `DATA_DIR` to fallback and warns.

### P1-3. Search empty state is silent/confusing — FIXED (see P1-1)

---

## P2 — Minor / verify

### P2-1. `404` resource on load
- **Evidence:** one `Failed to load resource: 404` during normal navigation. Identify source (likely PWA `sw.js`/avatar). Low priority but should be clean.

### P2-2. Duplicate browse tabs across sessions
- **Evidence:** browse showed `2/10 tabs` for the same user (tab state persists in localStorage and was re-opened). Dedupe by username on `openBrowse`.

### P2-3. Browse loading has no timeout/error path for unreachable peers
- **Evidence:** "Fetching shares … up to 30s if the peer is behind NAT" with no failure UI if it never responds. Add an error/timeout state.

---

## Verified 2026-08-31 (with portproxy)

- **Listener lifecycle:** login via `ws://localhost:8787/ws` succeeds (`ip 112.86.27.81`); while WS alive, `49127` `OPEN` on both loopback and WSL IP; after WS close, `CLOSED` (expected `listener.stop()` on `ws close`). So `Bun.listen` works.
- **Windows→WSL:** `Test-NetConnection 172.24.172.238:49127` succeeded; `portproxy` `0.0.0.0:49127 → 172.24.172.238:49127` confirmed.
- **Still 0 search results:** `search "armin van buuren"` → `search:start` + `search:end timeout` (0 `search:result` frames) even with proxy. Indicates `ProtonVPN 10.2.0.2:49127 → Windows` hop not yet reaching the WSL listener. Needs `Test-NetConnection 10.2.0.2:49127` while logged in (and optionally external port checker via ProtonVPN exit IP).

## Not fully verified (needs reachable `LISTEN_PORT` via ProtonVPN→Windows→WSL)

- **Download:** could not test (no search results, no inbound port end-to-end). Audit `lib/transfers.tsx` `requestDownload` + bridge `transfers.ts`/`session.ts` download negotiation; test once ProtonVPN→Windows verified.
- **Browse/PM/Buddy/Profile:** outbound flows verified earlier (profile view `Donald_Trump_Soulseek` description/interests/IP, Add Buddy persisted, PM send, browse loading state) — all work even without inbound.

---

## Suggested deeper protocol audit (vs `~/projects/nicotine-plus`)
- Search result forwarding schema (`SearchRow`) vs nicotine-plus `SearchResults`/file attributes.
- Wishlist / room / user search modes (untested live).
- Download peer negotiation, browse, user-info parity (`slotsavail`/`queuesize`/`uploadallowed` mapping).
- Chat-room join/post, interests like/hate, uploads/shares config.

## Recommended re-test plan (after ProtonVPN→Windows verified)
1. Keep web page open (WS alive) → `Test-NetConnection 10.2.0.2 -Port 49127` from Windows PowerShell should be `True`.
2. Login → search "armin van buuren" → expect results → click a row → **Download** → verify transfer in `/downloads` and file saved under fallback `DATA_DIR`.
3. Deep-link `/profile/Donald_Trump_Soulseek` → should load (not bounce to `/search`) → **Add Buddy** → verify in `/buddies` → **Send Message** → verify in `/private-chat` → **Browse** → verify files listed.
4. Refresh any authenticated page → should stay on the same route (no bounce to `/search`).
5. No console errors / hydration warnings.
