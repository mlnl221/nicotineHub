# Mistakes Log

> Per `AGENTS.md`: read this file before starting any task. It separates historical failures
> from base rules in `AGENTS.md`. After any error, failed tool call, or user correction, append
> an entry within 30 seconds using the format below. Keep entries messy and chronological — do
> not try to be perfect. Monthly: review and prune fixed items.

## Format

```
## YYYY-MM-DD — <short title>

What happened: ...
Why: ...
How to avoid: ...
```

---

## 2026-08-28 — Playwright MCP --extension fails without Chrome extension

What happened: Ran `playwright_browser_navigate` to test search worktree but got `Playwright Extension not found in "/home/magnus/.config/google-chrome"`. `~/.config/opencode/opencode.jsonc` was configured as `["npx","@playwright/mcp@latest","--extension"]` which requires Chrome extension and `google-chrome` installed — neither present in WSL.
Why: Assumed MCP would launch its own browser; didn't check `opencode.jsonc` command and `--extension` docs before testing. Tried `playwright_browser_*` tools without verifying browser path, wasted time patching config incorrectly (broke JSON with trailing comma).
How to avoid: Before UI testing, `cat ~/.config/opencode/opencode.jsonc` and `npx @playwright/mcp --help`. If `--extension` is set, either install Chrome + extension or reconfigure to `["npx","@playwright/mcp@latest"]` for headless, or bypass MCP entirely and use `playwright@1.62.1` with `chromium` directly (`npx playwright install chromium` + `import { chromium } from 'playwright/index.mjs'`). Always verify `lsof -i :8787 -i :3000` and `curl /health` before browser nav.

## 2026-08-28 — Worktree Turbopack symlink panic

What happened: `bun run --cwd apps/web dev` in worktree `nicotine_mobile-feat_search-page` panicked: `Symlink apps/web/node_modules is invalid, it points out of the filesystem root` — Next.js 15.5.24 Turbopack. Worktree `apps/web/node_modules -> /mnt/c/.../nicotine_mobile/apps/web/node_modules` and root `node_modules -> .../nicotine_mobile/node_modules` are symlinks to main repo.
Why: `bun install` was not run in worktree; Turbopack resolves `find_package` and rejects symlinks outside filesystem root on WSL `/mnt/c`. Original `package.json` dev script uses `--turbopack`.
How to avoid: After `git worktree add`, immediately `rm apps/web/node_modules node_modules ; bun install` in worktree to materialize real dirs, or run `bun --cwd apps/web next dev -p 3000` without `--turbopack`. Document in `AGENTS.md`: browser/UI testing requires `cp apps/web/.env.example apps/web/.env` and `bun install` in worktree.

## 2026-08-28 — Mock WebSocket missing WebSocket.OPEN breaks search silently

What happened: Playwright mock `class MockWS { constructor(){...} send(){...}}` replaced `window.WebSocket` but didn't define `MockWS.OPEN=1`. `apps/web/src/lib/session.tsx:140` does `if (!ws || ws.readyState !== WebSocket.OPEN) return;` so `search("pink floyd")` silently returned, no `ws.send`, no `search:start`. Tests showed `Enter` did nothing, spent many iterations thinking `SearchBar.tsx:30` `onKeyDown` was broken.
Why: Didn't read `session.tsx:138-144` guard before writing mock. `WebSocket.OPEN` is static (1), mock needs `MockWS.OPEN=1`, `CONNECTING=0`, `CLOSING=2`, `CLOSED=3`.
How to avoid: Always `read apps/web/src/lib/session.tsx` before mocking. Define `MockWS.OPEN=1` and assert `window.__events` after `input.press('Enter')`. Verify via `page.evaluate(() => document.querySelector('input').__reactProps.onKeyDown({key:'Enter',preventDefault:()=>{}}))` + check `ws.send` was called.

## 2026-08-28 — Bridge allows search after failed login

What happened: WS flow `login {username:"testuser12345",password:"badpass"} → {"type":"login:result","ok":false,"error":"Login rejected: INVALIDPASS"}` then `search {"query":"pink floyd"} → {"type":"search:start","token":1}` instead of `{"type":"error","error":"Not logged in."}`. `apps/bridge/src/server.ts:83-88` creates `new SoulseekSession` and `ws.data.session=session` before login resolves; `server.ts:111` only checks `if (!session)` not `session.loggedIn`.
Why: Didn't guard search with auth state. Manual `ws` test (`/tmp/test-search.mjs` TEST 7) exposed it.
How to avoid: Add `isLoggedIn`/`loggedIn` check in `server.ts:111` and `session.ts:search()` (`if (!this.loggedIn) throw`). Add `bun test` case for unauthenticated search. Verify with `new WebSocket('ws://localhost:8787/ws')` → search without login → expect error, then login fail → search → expect error.

## 2026-08-28 — Port conflict between main and search worktree

What happened: `PORT=8787 bun run --cwd apps/bridge dev` failed `EADDRINUSE` because main worktree bridge (pid 523848) still held `:8787` and `:3000`. `curl` still returned 200 from main, masking that search worktree wasn't actually running. Subsequent `next dev` also failed silently.
Why: Didn't `ss -tlnp | grep 8787` or `lsof` before starting worktree. Assumed worktree ports were free.
How to avoid: Before testing worktree, `ps aux | grep -E "next|bun"` + `curl -sf http://localhost:8787/health` + `curl -sf http://localhost:3000 | grep Nicotine`. Kill stale pids (`kill 523848 523909`) before `PORT=8787 bun run --cwd apps/bridge dev > /tmp/bridge-search.log 2>&1 &` and `bun --cwd apps/web next dev -p 3000`.

## 2026-08-28 — Logout button outside viewport, mobile sidebar overflow

What happened: `page.locator('button',{hasText:'Logoff'}).click()` timed out 30s `Element is outside of the viewport` on desktop; on mobile 390×844 `nav` bbox `288×844` leaves 102px for main. `Sidebar.tsx:22` `fixed w-72` + `search/page.tsx:68` `ml-72` not responsive.
Why: Didn't check `mobile viewport` or `Sidebar` responsive behavior; `AGENTS.md` says mobile-first but search page uses desktop fixed layout.
How to avoid: For sidebar actions, `await page.evaluate(() => window.scrollTo(0,document.body.scrollHeight))` or `locator.click({force:true})` or `page.evaluate(() => document.querySelector('button').click())`. For mobile, test with `chromium.newContext({viewport:{width:390,height:844},isMobile:true})` and assert `nav` collapses or drawer.

## 2026-08-28 — Forgot to copy .env.example before Playwright

What happened: Initially `apps/web/.env` missing; `AGENTS.md` in search worktree explicitly says `cp apps/web/.env.example apps/web/.env` before driving UI (provides `NEXT_PUBLIC_BRIDGE_URL` etc for Playwright MCP browser session). Tested without it and got inconsistent `bridgeUrl()` fallback to `ws://localhost:8787/ws` which worked by luck.
Why: Didn't read worktree `AGENTS.md` fully before starting.
How to avoid: First step after `git worktree list` is `cat apps/web/.env.example && cp apps/web/.env.example apps/web/.env` per worktree AGENTS.md.

## 2026-08-28 — Playwright headless needs explicit executablePath (browser build mismatch)

What happened: `chromium.launch()` in a script failed `Executable doesn't exist at .../chromium_headless_shell-1237`. npx-cache playwright (1.62.1 and 1.63.0-alpha) expected browser build 1237, but `~/.cache/ms-playwright` only had `chromium-1234`/`chromium_headless_shell-1234`. Also `import { chromium } from "playwright"` in an ESM script failed `MODULE_NOT_FOUND` unless resolved via absolute path into an npx cache (`/home/magnus/.npm/_npx/<hash>/node_modules/playwright/index.mjs`).
Why: Playwright CLI (`npx playwright install`) and any given `bun`/`node` project resolve different browser builds; the `playwright` package isn't a project dependency, so plain `import` can't find it.
How to avoid: Either run `npx playwright install chromium` to align the build, or launch with an explicit path: `chromium.launch({ executablePath: "/home/magnus/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" })` and import via the absolute npx-cache path. Verify `lsof -i :3000 -i :8787` and `curl /health` first.

## 2026-08-28 — Running `bun run build` while `next dev` is live corrupts .next

What happened: Had `bun run dev` (next dev --turbopack + bridge) running in the worktree, then ran `bun run build` to verify before PR. Both write to `apps/web/.next`, so the build clobbered the running dev server's state → dev log ENOENT on `_buildManifest.js.tmp.*`, `/settings` returned 500, bridge went down.
Why: Ran prod build in the same `.next` directory a dev server was actively using, without stopping dev first.
How to avoid: Stop `bun run dev` (`pkill -f "next dev"`) before `bun run build`/`bun test`, or verify on a separate port/build dir. Restart dev + re-run the browser test after any build.

