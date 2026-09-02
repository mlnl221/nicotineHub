# Plan — fix/demo-files-banner-explorer

> Worktree: `/home/magnus/projects/nicotine_mobile-fix-demo-files` branch `fix/demo-files-banner-explorer` from `stage` @ `bdbcd6b`
> Created: 2026-09-02 | Updated: 2026-09-03 — Phases A–C implemented, verified `bun test 119 pass` + `next build` success
> Status: **IN PROGRESS — Phases A–C done (demo banner + files hover + browse root); Phases D–U pending**

## 1. User Intent (verbatim + corrections)

**Round 1:**
* IN DEMO MODE, start demo header hidden — html quoted `data-demo-banner="true" data-testid="demo-banner"` sticky `bg-tertiary-fixed`. **Correction:** `Hide forever until user presses the demo button.` + default hidden.
* In both prod and demo, box on `/files` → informational on-hover button — html quoted `mt-3 rounded-xl bg-surface-container-low ... This is the browser replacement for nautilus /data ... sandboxed to /data ... BRIDGE_TOKEN same as /ws /logs`. **Correction:** `Yes update the banner info` + `hover-info text yes update the text.` + file browser `should always start at /data`.
* In `/files`, include back button so we can explore up from `/data`, now only `/data`, allow up to `/`.
* ON DEMO on `/downloads`, remove `UPLOADING (1)` — production shows only downloads.

**Round 2 (this update — still no code edits):**
* In `/downloads` **completely remove** the `Uploading (1)` section **from prod and demo** — quoted html `section data-testid="uploads-section" class="hidden xl:flex ...">Uploading (1) ... data-transfer-id="vinyl_hunter::C:\Users\demo\Shares\Summer Rain ... Finished ...` — reason: we have separate `/uploads` tab.
* For both `/uploads` and `/downloads` on demo and prod, move box higher to touch top of graph — quoted html `div class="pointer-events-auto w-fit max-w-full rounded-xl bg-surface/60 dark:bg-surface-container-lowest/60 backdrop-blur-sm shadow-sm ghost-border px-3 py-2.5 md:px-4 md:py-3 ml-3 md:ml-6"><h3>Network Throughput</h3><div>Real-time Bandwidth</div>... ↓ — ↑ — 60 samples 10 KB/s max ...`
* In `/chat`, list out public chatrooms — go explore `~/projects/nicotine-plus` to see how dropdown is populated with most joined public chatrooms first. Add dropdown to join or create for user to choose chat room to join.
* IN PROD ADD: remove two demo users `jazzcat` and `vinyl_hunter` in `/buddies`, they should ONLY be in VERCEL DEMO.
* IN BOTH PROD AND DEMO: in `/browse`, use `docs/DESIGN.md`, make music rows even/odd color changes subtle, go from light grey to dark grey so easier to differentiate column order.
* IN BOTH PROD AND DEMO: on `/downloads`, right click on download file causes dual panes to show up, incorrect, combine options into one dropdown.
* IN BOTH PROD AND DEMO: on `/downloads`, when clicking bottom row, right click menu goes below screen, fix by making menu render from bottom up when halfway across screen.

**Round 3 — settings (this update — still no code edits):**
* On `https://nicotine-hub-web-phi.vercel.app/settings?tab=network` there is too much info for most settings — settings longer than 1 sentence info should be an info button hover over to describe more. Do this for **ALL** settings pages (`network`, `appearance`, `shares`, `downloads`, `uploads`, `searches`, `user-profile`, `chats`, `now-playing`, `logging`, `banned-users`, `ignored-users`, `url-handlers`, `plugins`, `notifications`, `about`).
* Settings UI — setting components rendered need padding between each other. Example `div class="opacity-100 transition-opacity duration-150"><section class="overflow-hidden rounded-2xl bg-surface-container-low shadow-sm ...">Connection<header>...<div class="divide-y divide-surface-container-high px-5">... ToggleControl ... TextFieldControl ... NumberControl Listening port ... UPnP ... Network interface ...</section><section>Auto-join & watched users</section><section>Auto-reply</section></div>` are way too close and touching each other.

**Round 4 — username + mobile gaps (this update — still no code edits) ON DEMO AND PROD:**
* When I click my username `<div class="font-label text-sm font-semibold text-primary dark:text-inverse-primary truncate" title="asdf">asdf</div>` I want to be linked to my profile as requested from the server. **Applies ON DEMO AND PROD.**
* When on mobile, there is an extra space padding under the header on `/search` make this element be at the top under the header — quoted `div class="flex flex-col gap-2 px-3 py-3 max-w-full overflow-hidden"><div class="flex flex-col gap-2.5 rounded-2xl bg-surface-container-lowest ghost-border p-2.5 sm:p-3 shadow-sm ..."><div class="flex items-center gap-1.5 sm:gap-2 ..."><div class="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-container-low px-3 sm:px-4 py-2.5 ghost-border ..."><span class="material-symbols-outlined text-outline">search</span><input placeholder="Search the Soulseek network…">...<button aria-label="Toggle filters" ...><button aria-label="Filter help" ...><button aria-label="Search" ...></div><div class="flex items-center gap-2 max-w-full min-w-0"><select id="search-mode">Global — Entire network ...` **ON DEMO AND PROD.**
* ON DEMO: On Mobile, when we click the demo pill, lets not move it to the top of the page, keep it as a floating banner that the user then closes.
* ON DEMO AND PROD: On mobile, remove the extra space under the header on `/browse` this should be under the header — quoted `div class="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 md:px-10 py-3 flex flex-col gap-3"><div class="flex gap-2"><div class="relative flex-1"><span class="material-symbols-outlined ...">search</span><input placeholder="Enter username to browse" ...><button>Browse</button></div><div class="flex gap-2 overflow-x-auto ..."><button ...>jazzcat (8) ...`

**Round 5 — search persistence, browse cache + reload, slidable folders (this update — still no code edits) ON PROD AND DEMO:**
* When we run a search `http://localhost:3000/search` we should **KEEP that tab alive until the user closes it even when the user navigates AWAY from the search page**. Right now it is clearing out the searches and removing the loaded search data.
* Also on `/browse`, when we load a users files, lets **"cache" this so that it does not have to RELOAD when the user moves away from the page**. Lets add a small **"Reload" icon button next to View Profile** so that it **REQUERIES the network to get the profile again** in case there were any updates.
* Also lets make `div class="flex-1 overflow-y-auto overscroll-contain min-h-0 p-2 space-y-1"><div class="flex w-full items-center gap-1 rounded-lg ..."><button type="button" class="flex h-7 w-7 ..."><span class="material-symbols-outlined text-[18px]">expand_more</span></button><button class="flex flex-1 items-center gap-3 ..."><span class="material-symbols-outlined text-[20px]">folder_open</span><div class="min-w-0 flex-1"><p class="truncate font-body text-sm font-medium">MUSIC</p>...` **slidable and extendable to the right** so the user can read the full foldername. Example quoted list shows `MUSIC (0 files)` parent + `+N - Plane 1994 (10 files)` etc with `padding:6px 8px 6px 24px` and `40px` for selected `D. Diggler - Nightshade (5 files)`.

**Round 6 — navigation confirm annoyance (this update — still no code edits) ON PROD AND DEMO:**
* Every time we change page, we get `This page is asking you to confirm that you want to leave — information you’ve entered may not be saved.` Warning from the browser. This is so annoying and interrupts flow, **REMOVE this UNLESS the user has not saved an edited setting ONLY**. I do not want this pop up to show up every time I change the page.
* **Clarifications answered 2026-09-02:** 1) **Any future save-gated setting should gate the dialog** (not only `Network → Listening port`). 2) **Remove dialog on every page unless they have gated settings** (no unconditional `beforeunload`). 3) **Yes** — change `defaults.ui.exitdialog` default to `0` (no confirm) so fresh installs default to no dialog (user can re-enable via `Settings → Appearance → Close dialog behavior` if desired).

## 2. Current Code Map

| Concern | Key files:lines | Current behavior |
|---|---|---|
| Demo banner | `apps/web/src/components/DemoBanner.tsx:8` , `apps/web/src/app/layout.tsx:51,57,72` , `apps/web/src/app/globals.css:195` , `apps/web/src/lib/demo.ts:1` | `isDemo=NEXT_PUBLIC_DEMO==="true"` . `useState(false)` visible. `STORAGE_KEY="nicotineHub.demoBannerDismissed"` . `=== "1"` => `dismissed=true` => `html --demo-banner-h 0px` + pill `data-testid="demo-banner-restore" fixed bottom right`. Else `32px` sticky banner + inline `<html style="--demo-banner-h:32px">` + script anti-flash `if==="1" set 0`. `globals.css` pushes `header.fixed, nav.fixed, .sticky.top-0` by `var(--demo-banner-h)`. |
| Files page + explorer | `apps/web/src/app/files/page.tsx:8,53,82` , `apps/web/src/components/files/FileExplorer.tsx:34,88,115,132,270` | `FilesPage` renders `FileExplorer initialPath="/" title="Explorer — /data"` + static `mt-3` info box (quoted). `FileExplorer` fetches `GET /api/files?path=` via `bridgeFetchUrl`, demo => `mockFileExplorerResponse`. Breadcrumbs `⌂ /data` for `"/"`; `parent===null` hides Up. Footer note duplicates security text. |
| Bridge FS | `apps/bridge/src/files.ts:26,56,101` , `apps/bridge/src/server.ts:588` , `apps/bridge/src/files.test.ts` | `getDataDir()=resolve(DATA_DIR\|\|"/data")`. `resolveSafePath` containment `startsWith(DATA_DIR+sep)` + `realpath` symlink escape. `listDirectory(path, DATA_DIR)`. `GET /api/files` → `listDirectory(rawPath, DATA_DIR)` token-gated. |
| Demo fixtures | `apps/web/src/lib/demo/fixtures.ts:402,483` | `DEMO_FILE_TREE` where `"/"` is `/data` root (Music/Downloads/Shares/Incoming...). `mockFileExplorerResponse` normalizes path. |
| Downloads | `apps/web/src/app/downloads/page.tsx:124,136,153,230` , `apps/web/src/lib/transfers.tsx:278` , `apps/web/src/app/uploads/page.tsx:86` , `apps/web/src/components/transfers/ThroughputChart.tsx:44,135` | Downloads renders `isDemo` banner + `ThroughputChart` + `DownloadStats` + mobile `tab` switcher + `grid xl:grid-cols-2` with `downloads-section` (`flex/hidden`) + `uploads-section` (`hidden xl:flex`). `mockDemoTransfers()` seeds 1 dl +1 ul + finished spectrum. `ThroughputChart` is `section h-56 md:h-64 relative overflow-hidden` with header `div relative z-10 flex flex-1 flex-col justify-between p-5 md:p-6 pointer-events-none` inner `div pointer-events-auto w-fit ... ml-3 md:ml-6` quoted. |
| Chat rooms | `apps/web/src/app/chat/page.tsx:23,35,99,183,221` , `apps/web/src/lib/rooms.tsx:29,45` , `~/projects/nicotine-plus/pynicotine/gtkgui/dialogs/roomlist.py:50,60,64,237` , `pynicotine/chatrooms.py:243,499` | `useRooms` `roomList: {name,users}[]` from `room:event type room-list data.rooms`. `ChatRoomsPage` has `joinInput` text + `Join` button + `Private room` checkbox + `filter` input + `filteredRooms.slice(0,50).map` public list. No dropdown, no sort indicator. Nicotine+ `roomlist.py:50-65` columns `room` + `users` with `default_sort_type descending` on `users_data` (numeric), `is_private_data` offsets `PRIVATE_USERS_OFFSET=10_000_000` to sort private rooms first, bold/underline for private/owner. `room_list()` iterates `rooms_owner`→`rooms_member`→`rooms` (private owner/member first, then public). Server `RoomList` message `pynicotine/slskmessages.py:1728,4270` type 64. |
| Buddies | `apps/web/src/lib/buddies.tsx:44,54` , `apps/web/src/lib/demo/fixtures.ts:236,244` , `apps/web/src/app/buddies/page.tsx` | `useBuddies` loads `localStorage nicotineHub.buddies` (no demo filtering). `useEffect if isDemo && connected && buddies.length===0 seed mockBuddies()` (2 entries jazzcat/vinyl_hunter from `DEMO_BUDDY_USERS`). No prod purge; prod with `isDemo=false` currently keeps whatever is in storage, including seeded demo buddies if user previously visited demo build. No `!isDemo` cleanup. |
| Browse rows | `apps/web/src/components/browse/BrowseView.tsx:391,397` , `docs/DESIGN.md:6` | `BrowseView` file list `ul divide-y divide-surface-container-highest/30` `li` `flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low/60` uniform. No even/odd. `DESIGN.md` north star: surface tiers `surface-container-lowest → surface-dim` for hierarchy, ghost-border, no 1px borders. |
| Context menus | `apps/web/src/components/ui/ContextMenu.tsx:88,94` , `apps/web/src/lib/context-menu/menus.ts:118,184,211` , `apps/web/src/app/downloads/page.tsx:267` | `ContextMenu` `fixed z-[100]` `x,y` + `useLayoutEffect` adjust `left+width > innerWidth ? left=innerWidth-width-pad` + `top+height > innerHeight ? top=innerHeight-height-pad`. No halfway bottom-up logic. `transferMenu` builds 15+ items with submenus `Clear All`, `Copy & Search`, `User Actions` (which embeds `userMenu`). `downloads/page.tsx` has single `menuAnchor {x,y,transfer,isUpload}` → `ContextMenu items={transferMenu(...)}` . Dual panes symptom: likely `transferMenu` + `userMenu` + `submenu` nesting creates two visible panels (main + `left-full top-0` submenu) when hover opens, perceived as dual panes; also `onContextMenu` on `TransferCard` inside `div` vs card itself may trigger two menus. Need to combine into single flat dropdown. |
| Settings info + layout | `apps/web/src/app/settings/page.tsx:240,241` , `apps/web/src/components/settings/controls.tsx:10,36,68,134,207,242,288` , `apps/web/src/components/settings/NetworkSection.tsx:177,205,260,313` , `all *Section.tsx` | `SettingsPage` `div opacity-100` renders `NetworkSection` etc fragments with `SectionCard` `overflow-hidden rounded-2xl bg-surface-container-low` + `header border-b px-5 py-4` + `div divide-y px-5` per card, but outer wrapper no `gap` — cards touch. Each control `Row`/`TextFieldControl`/`NumberControl` renders `description` inline `mt-0.5 font-body text-xs text-on-surface-variant` (often 2-4 sentences, 120-300 chars, e.g. `Listening port ... Requires port-forward of TCP+UDP 60754 ... Save triggers fresh connect ...` , `UPnP ... Falls back ... renews every 2h ...` , `Network interface ... Bind Soulseek peer listener ... Default 0.0.0.0 ... For VPN (tun0 10.8.0.6) use network_mode: host ...`). Same pattern across all 15 sections. All long descriptions currently always visible inline, cluttering. |
| Username link | `apps/web/src/components/Sidebar.tsx:76,92` , `apps/web/src/components/mobile/TopBar.tsx:48` , `apps/web/src/lib/session.tsx` | Sidebar username `div.font-label.text-sm.font-semibold.text-primary.truncate` inside `button onClick setAboutOpen` (AboutDialog). `displayUser=state.user ?? "System Administrator"`. TopBar shows title only. No link to `/profile/{username}`. Request: both prod+demo should link to own profile via server `userinfo:get`. |
| Search mobile gap | `apps/web/src/app/search/page.tsx:31` , `apps/web/src/components/search/SearchScreen.tsx:102,125` , `apps/web/src/components/search/SearchBar.tsx` | `main pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0` + sticky `top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-low/95` with inner `flex flex-col gap-2 px-3 py-3` + `rounded-2xl p-2.5 sm:p-3` search box. On mobile extra `py-3` padding pushes search box down, not flush under `TopBar fixed top-0`. |
| Browse mobile gap | `apps/web/src/app/browse/page.tsx:96-97` | Sticky `top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-lowest/80 backdrop-blur-xl` with `mx-auto w-full max-w-screen-2xl px-4 sm:px-6 md:px-10 py-3 flex flex-col gap-3` input+tabs. On mobile `py-3` leaves visible gap under `TopBar`; should be `py-2` flush. |
| Demo pill floating | `apps/web/src/components/DemoBanner.tsx:61` , `apps/web/src/app/globals.css:195` | Pill `fixed bottom-[calc(76px+...)] right-2` when dismissed; clicking sets `--demo-banner-h 32px` and renders sticky `top-0` banner which pushes `TopBar` via `globals.css html[data-demo] header.fixed.top-0 {top: var(--demo-banner-h)}`. On mobile moves whole page down; request: keep floating banner, don't move to top. |
| Search keep-alive | `apps/web/src/app/search/page.tsx:31` , `apps/web/src/components/search/SearchScreen.tsx:102` , `apps/web/src/lib/search.tsx:51` | `SearchProvider` is per-page inside `SearchPage` (`<SearchProvider><SearchScreen/></SearchProvider>`). Holds `tabs:SearchTab[]` in `useState` + demo seeds `DEMO_SEARCH_QUERIES`. Unmount on `router.push("/browse")` → `tabs` lost, data cleared. |
| Browse cache + Reload | `apps/web/src/app/browse/page.tsx:96,168` , `apps/web/src/lib/browse-tabs.tsx:56` , `apps/web/src/components/browse/BrowseView.tsx:203` | `BrowseProvider` also per-page (`<BrowseProvider><BrowseInner/></BrowseProvider>`), though `browse-tabs.tsx` persists `id,username` via `localStorage nicotineHub.browseTabs`, not `folders/currentFiles`. `BrowseView` header has `View Profile` + download/sort, no `Reload`; `retry(tab.id)` exists but only on error. Navigating away → remount forces `loading:true` + re-fetch. |
| Browse slidable | `apps/web/src/components/browse/BrowseView.tsx:240` | Folder list `div.flex-1.overflow-y-auto.overscroll-contain.min-h-0.p-2.space-y-1` with rows `div.flex.w-full.items-center.gap-1.rounded-lg` `style padding:6px 8px 6px ${8+depth*16}px` and `p.truncate`. No `overflow-x-auto`, long names truncated, not slidable right. |
| Navigation confirm | `apps/web/src/components/ExitDialogHandler.tsx:11`, `apps/web/src/lib/config/defaults.ts:243`, `apps/web/src/lib/config/provider.tsx:29`, `apps/web/src/app/layout.tsx:87` | `ExitDialogHandler` mounted globally, `mode=settings.ui.exitdialog ??1` default `1` → always `window.addEventListener("beforeunload", handler)` with `e.returnValue=""`. `defaults.ui.exitdialog=1` + `ConfigProvider` auto-saves on every `setOption`, but `ExitDialogHandler` does not check dirty — so every SPA `history.pushState` triggers `beforeunload` dialog `This page is asking you to confirm...`. `NetworkSection` has only save-gated `pendingPort` dirty (`dirty = pendingPort !== listenPort`), but handler never reads it. Playwright MCP verified: `page.goto('/browse')` after `/settings?tab=network` triggers `beforeunload` dialog (type `beforeunload`, message `This page is asking you to confirm...`) even with no dirty. `localStorage nicotineHub.settings ui.exitdialog=1`. |

## 3. Target Behavior

### 3.1 Demo banner hidden forever until restore
- Fresh demo (`localStorage` miss): `html --demo-banner-h:0px`, no `data-demo-banner`, only pill `fixed bottom-[calc(76px+env(safe-area-inset-bottom,0px))] right-2` `science Demo` `data-testid="demo-banner-restore"`.
- Pill click → `setItem(STORAGE_KEY,"0")`, `setDismissed(false)`, `html --demo-banner-h = measured h` (`32px` fallback), render sticky banner `data-testid="demo-banner"` + `data-testid="demo-banner-dismiss"` close.
- Close click → `setItem("1")`, `dismissed=true`, `--demo-banner-h 0px`, pill again.
- Prod: `DemoBanner` returns null regardless.
- Anti-flash: demo build `<html style="--demo-banner-h:0px">`, script only sets `32px` if `getItem==="0"`.

### 3.2 Files info hover button (prod+demo) — updated text
- Replace static `mt-3` box in `apps/web/src/app/files/page.tsx:82`.
- New: `button data-testid="files-info" aria-label="About Explorer" aria-describedby="files-info-tooltip"` with `material-symbols-outlined info` + `Info` label; tooltip `div data-testid="files-info-tooltip" role="tooltip"` `absolute z-[70] rounded-xl bg-surface-container-highest shadow-lg ghost-border p-3 max-w-sm`.
- Interaction: `onMouseEnter/Leave` (desktop), `onClick` toggle (touch), `Escape`/`blur`/`outside click` closes, `focus-visible` ring.
- **Updated text** (per `Yes update`): `This is the browser replacement for nautilus /data / explorer /data / xdg-open /data. The container has no display server; this web UI is the Explorer. You start at /data but can navigate up to / (host root) — traversal outside / is blocked and symlink escapes are rejected. If BRIDGE_TOKEN is set, the bridge requires it for /api/files (same gate as /ws, /logs, /diagnostics, /plugins).` Keep `font-mono` for paths/tokens.
- Position below explorer or inline next to `Explorer — /data` title.

### 3.3 Browse up to `/`, always start at `/data`
- `FilesPage` `initialPath="/data"` (was `"/"`).
- Backend `GET /api/files`: `listDirectory(rawPath, "/")` (host root) not `DATA_DIR`. So `"/data"` lists `DATA_DIR`, `"/"` lists host `/`. `getParentPath("/data")==="/"`, `Up` visible at `/data`.
- Frontend breadcrumbs: `"/"` → `⌂ /`, `"/data"` → `⌂ /data`, children `"/data/Music"` → `⌂ /data / Music` etc.
- Demo fixtures: move existing `"/"` entry to `"/data"`; new `"/": [data dir → /data, home, tmp, etc]` synthetic host root. `mockFileExplorerResponse` handles `/data` prefix and alias fallback for old `/Music` → `/data/Music`.

### 3.4 `/downloads` — remove Uploading entirely (prod+demo)
- **Before:** `grid xl:grid-cols-2` with `downloads-section` + `uploads-section hidden xl:flex`.
- **After:** single `section data-testid="downloads-section"` full-width (`grid-cols-1` or no grid), no `uploads-section` in DOM at all (remove `230-262` block). `activeCount`, `totalUp`, `ulCount` still computed but not displayed; `TopBar subtitle` `dlCount downloading • ulCount uploading` maybe keep `dlCount`-only or update to `dlCount downloading` (prod). Mobile `tab` state `"downloads"|"uploads"` becomes unnecessary — remove or keep but only show downloads (no uploads pane). `DownloadStats` stays.
- Separate `/uploads` page (`apps/web/src/app/uploads/page.tsx`) remains sole place for uploads; no change there.

### 3.5 Throughput header — touch top of graph (prod+demo, both pages)
- **Current:** `ThroughputChart.tsx:135` `div relative z-10 flex flex-1 flex-col justify-between p-5 md:p-6 pointer-events-none` inner `div pointer-events-auto w-fit ... ml-3 md:ml-6` with offset, not touching top.
- **After:** header flush to top: `flex-col justify-start` (not `between`), `p-0 pt-0` → inner `ml-0 mt-0 rounded-b-none` or `rounded-xl rounded-t-none border-t-0` so ghost-border touches chart top. Keep `backdrop-blur` but remove `ml-3 md:ml-6` gap. Verify both `apps/web/src/app/downloads/page.tsx:131` and `apps/web/src/app/uploads/page.tsx:93` embed same `ThroughputChart` component once — single fix covers both.
- Ensure Y bars (`w-12` left/right) and SVG grid still behind header via `absolute inset-0` layer; header `z-10` backdrop ensures readability.

### 3.6 Chat — public rooms dropdown sorted by users desc
- **Nicotine+ parity:** `roomlist.py:60,64` `users` column `default_sort_type descending` on `users_data` (numeric), `is_private_data` adds `10_000_000` to sort private rooms first, bold for private, underline for owner. `chatrooms.py:499 _room_list` orders private owner/member then public. Web currently shows `filteredRooms.slice(0,50)` unsorted except server order.
- **Target:** mirror sorting: `roomList` sorted descending by `users` (numeric) with private rooms first if `is_private` flag present (server may send `is_private`). If not, sort purely by `users` desc. Show count badge.
- **UI:** Next to `Join or create room...` input + `Join` button, add `select` / dropdown `data-testid="public-room-dropdown"` populated `roomList` sorted. On change, set `joinInput` to selected room or directly `joinRoom(selected)`. Keep `filter` input to filter dropdown list. Both desktop `aside` (Chat `page.tsx:99`) and mobile picker (`page.tsx:221`) get the dropdown (desktop dropdown below input, mobile inside `p-3 md:hidden` block).
- Demo: if `roomList` empty (demo offline), show `DEMO_ROOMS` from `fixtures.ts:43` (Jazz 842 etc) sorted same way as fallback.

### 3.7 Buddies — prod purge demo users
- **Current:** `mockBuddies()` always creates `jazzcat`+`vinyl_hunter` when `isDemo && connected && empty`.
- **Target prod:** when `!isDemo`, never seed `mockBuddies`; additionally purge any persisted `localStorage nicotineHub.buddies` entries with those usernames (and stale `__demoBuddiesSeeded` sessionStorage). On app start (`useBuddies` initial load or `useEffect` guard), if `!isDemo` and `buddies` contains those two, filter them out + `saveBuddies` remainder, remove `sessionStorage __demoBuddiesSeeded`.
- **Target demo:** unchanged (seed 2 buddies, clear on `idle`).
- Ensure migration: user who previously visited demo build then visits prod build gets buddies cleaned.

### 3.8 Browse — even/odd subtle grey per DESIGN.md
- **Current:** `BrowseView.tsx:397` `li hover:bg-surface-container-low/60` uniform, `divide-y`.
- **Target:** per `DESIGN.md:8` surface tiers (`surface-container-lowest → surface-dim`) for elevation, not borders. Make rows alternating: `even:bg-surface-container-lowest` / `odd:bg-surface-container-low` (light grey → slightly darker grey) with hover `hover:bg-surface-container-high/40`. Keep `divide-y` maybe remove or soften to `divide-surface-container-highest/20`. Ensure dark mode counterparts `dark:even:bg-surface-container-low` `dark:odd:bg-surface-container-high` subtle.
- Apply to file `li` only (folder tree in `aside` keep distinct selected state). Use `index %2` or CSS `even:` with `ul` class `*:even:`.

### 3.9 Downloads — combine dual panes into one dropdown (prod+demo)
- **Symptom:** right click on download file shows dual panes (likely main `transferMenu` + nested `userMenu` submenu rendered as absolute `left-full top-0` second panel, or two `ContextMenu` portals from `TransferCard` vs parent `div`).
- **Target:** single `ContextMenu` per right click, flatten to one level: include `Resume/Pause/Remove`, `View User Profile/Browse Folder`, `Copy & Search` as section headers not nested `left-full`, or keep submenus but ensure only one portal mounts. Ensure `transferMenu(..., isUpload=false)` does not duplicate `userMenu` as separate pane — either inline `userMenu` items directly under `User Actions` as flat list or keep submenu but not auto-open; require click to open nested panel (existing `hasSub` click toggle already). Verify only one `div min-w-[220px] max-w-[320px]` renders at a time.

### 3.10 Downloads — menu bottom-up when halfway (prod+demo)
- **Current:** `ContextMenu.tsx:94 useLayoutEffect` does `if left+width>innerWidth-pad left=...; if top+height>innerHeight-pad top=innerHeight-height-pad`. This clamps to stay inside viewport but still renders top-down, may overflow below when clicked near bottom (menu measured after mount, but top still below click, clipped).
- **Target:** when `y > window.innerHeight/2` (halfway across screen), render from bottom up: `top = y - rect.height` (with `-8` pad) instead of `y`. If still `< pad` clamp to `pad`. Similarly, if `x > innerWidth/2` consider right-align (`left = x - rect.width`). Implement in `useLayoutEffect` branch: `const halfH = window.innerHeight/2; if (y > halfH) top = y - rect.height - 8; else top = y; then clamp`.
- Keep existing `pad 8` and `left+width` clamp.

### 3.11 Settings — long descriptions → info hover (ALL pages, prod+demo)
- **Current:** `controls.tsx:10 Row label+description inline` + `TextFieldControl:124`/`NumberControl:172` `mb-2 font-body text-xs text-on-surface-variant` `description` always visible inline. Network example: `Connect on startup` 1 sentence (short) vs `Listening port` 3 sentences 210 chars (`Inbound peer port ... Requires port-forward ... Save triggers fresh connect ... Default 60754`), `UPnP` 3 sentences, `Network interface` 5 sentences (`Bind Soulseek peer listener ... name stored ... Server-side only ... Default 0.0.0.0 ... For VPN (tun0 10.8.0.6) use network_mode: host ... Change applies immediately`). Same across all sections — `Shares` `share_filters` 2 sentences, `Downloads`/`Uploads` 2-3 sentences, etc.
- **Target:** If `description` longer than 1 sentence (heuristic: `description.length>80` **or** `description.split(/[.!?]+/).filter(s=>s.trim()).length>1`) → show **info button hover**. Inline row shows only `label` + short `(first sentence?)` OR just label; full description moves to tooltip.
- **UI:** Next to label, small circular button `button data-testid="setting-info-{key}" aria-label="More info" aria-describedby="setting-info-tooltip-{key}"` with `material-symbols-outlined info text-[16px]` `hover:bg-black/5` `rounded-full w-6 h-6`. Tooltip `div role="tooltip" id="setting-info-tooltip-{key}" data-testid="setting-info-tooltip-{key}"` `absolute z-[70] min-w-[220px] max-w-[320px] rounded-xl bg-surface-container-lowest dark:bg-surface-container-high shadow-lg ghost-border p-3 font-body text-xs leading-relaxed`.
- **Interaction:** `onMouseEnter/Leave` (desktop hover), `onClick` toggle (touch), `onBlur`/`Escape`/`outside click` close, `focus-visible:ring`. Reuse pattern from files-info tooltip. Keep `font-mono` for code snippets inside description.
- **Scope:** Apply to **every** `controls.tsx` helper (`Row` used by `ToggleControl`/`SelectControl`, plus `TextFieldControl`, `NumberControl`, `RadioGroupControl`, `SectionCard` header `description`). All `components/settings/*Section.tsx` (15 files) automatically benefit — single fix in `controls.tsx` plus `SectionCard` covers all pages. Short 1-sentence descriptions (e.g. `Auto-connect when the app opens.`) stay inline.

### 3.12 Settings — padding between components (prod+demo)
- **Current:** `settings/page.tsx:240` `<div className={isPending?"opacity-60 ...":"opacity-100 transition-opacity duration-150"}>` directly renders `<NetworkSection/>` which returns `<>` fragment with 3x `SectionCard` `overflow-hidden rounded-2xl shadow-sm`. No `gap` between siblings → cards visually touch (0px). `SectionCard` itself has `header px-5 py-4` + `div divide-y px-5` but no outer `mb-6`.
- **Target:** Add vertical spacing: outer tab content wrapper → `flex flex-col gap-6` (or `space-y-6`), inner section wrappers also `gap-6`. So `Connection` / `Auto-join & watched users` / `Auto-reply` each have `24px` gap. Keep `max-w-6xl mx-auto px-4 md:px-8` unchanged. Verify mobile + desktop.
- **Files:** `apps/web/src/app/settings/page.tsx:240` add `flex flex-col gap-6` (or `space-y-6`) to opacity wrapper; each `*Section.tsx` fragment → wrap in `<div className="flex flex-col gap-6">` if not already (most return `<>` + multiple `SectionCard`s). Keep `SectionCard` `rounded-2xl` with shadow.

### 3.13 Username → my profile (demo+prod) `ON DEMO AND PROD`
- **Current:** `Sidebar.tsx:76,92` username `div.font-label.text-sm.font-semibold.text-primary.truncate` inside `button onClick={() => setAboutOpen(true)}` that opens AboutDialog. No navigation.
- **Target:** When `state.user` exists (connected), username becomes link to own profile **as requested from server**: `<Link href={`/profile/${encodeURIComponent(state.user)}`} data-testid="sidebar-username-link" aria-label="View my profile" className="font-label text-sm font-semibold text-primary dark:text-inverse-primary truncate hover:underline" title={displayUser}>`. Keep About accessible via logo `NICOTINE HUB` button (`Sidebar.tsx:53`) already. In `TopBar` mobile optional same, but Sidebar is primary place for `div` quoted. Both prod and demo.

### 3.14 Search mobile — remove extra space, flush under header `ON DEMO AND PROD`
- **Current:** `search/page.tsx:31` `main pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0` + `SearchScreen.tsx:125` `div.sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20` with inner quoted `div.flex.flex-col.gap-2.px-3.py-3.max-w-full` + `rounded-2xl p-2.5 sm:p-3`. On mobile `py-3` pushes box down ~12px below `TopBar`.
- **Target:** On mobile flush under `TopBar`: change `px-3 py-3` → `px-3 pt-2 pb-2` (or `pt-1`) and inner `p-2.5 sm:p-3` → `p-2 md:p-3`. Keep desktop `md:px-10 py-4` unchanged. Sticky `top` stays `calc(56px+env(safe-area-inset-top,0px))` but content no longer has extra vertical cushion. Both prod+demo.

### 3.15 Demo pill — keep floating, not move to top `ON DEMO` (mobile)
- **Current:** `DemoBanner.tsx:61` pill `fixed bottom-[calc(76px+...)] right-2` when dismissed; on click sets `--demo-banner-h:32px` and renders `sticky top-0 z-[60]` banner which via `globals.css` pushes `TopBar` down (`top: var(--demo-banner-h)`). On mobile moves whole page.
- **Target (mobile):** Keep pill floating; when clicked on `max-width:767px`, show **floating banner** (`fixed top-[calc(56px+env(safe-area-inset-top,0px)+8px)] left-2 right-2 rounded-xl shadow-lg z-[60]` with same text + `X`) instead of sticky top. Don't change `--demo-banner-h` on mobile (keep `0px`). On desktop keep current sticky banner with `32px` push. Implementation: media query `window.matchMedia("(max-width:767px)").matches` branch inside `DemoBanner.tsx` effect/render.

### 3.16 Browse mobile — remove extra space under header `ON DEMO AND PROD`
- **Current:** `browse/page.tsx:96` `div.sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-lowest/80 backdrop-blur-xl border-b` with inner `mx-auto w-full max-w-screen-2xl px-4 sm:px-6 md:px-10 py-3 flex flex-col gap-3` quoted. On mobile `py-3` leaves gap under `TopBar`.
- **Target:** On mobile flush under header: `px-4 py-3` → `px-3 py-2` (or `pt-2 pb-2`) e.g. `px-3 py-2 md:px-10 md:py-3`. Sticky top stays, but inner padding reduced so input `Enter username to browse` sits at top. Both prod+demo.

### 3.17 Search — keep tabs alive when navigating away `ON PROD AND DEMO`
- **Current:** `search.tsx:51 SearchProvider` `useState tabs` per-page loses data on unmount (`SearchPage` wraps provider). `SearchScreen` shows 0 tabs after return.
- **Target:** Hoist `SearchProvider` to root (`apps/web/src/app/layout.tsx:80` next to `TransfersProvider`/`WishlistProvider`) so `tabs/activeId` survive route changes. Keep `tabs` until user `closeTab` (`send search:stop` + remove) or logout clears. Optionally persist `tabs/activeId` to `sessionStorage` for reload. Both prod+demo.

### 3.18 Browse — cache shares + Reload button `ON PROD AND DEMO`
- **Current:** `BrowseProvider` per-page loses `folders/currentFiles` on nav away; re-mount triggers `loading:true` + `send browse shares` again even though data recently fetched.
- **Target:** Hoist `BrowseProvider` to root (same as search) and **cache** `folders/currentFolder/currentFiles` (keep in memory via global provider; optionally extend `persist()` to store folders shallow). Navigating away → back shows cached files instantly, no network reload.
- Add small **Reload** icon `button data-testid="browse-reload" aria-label="Reload" title="Reload from network"` next to `View Profile` in `BrowseView.tsx:203` header. On click calls existing `retry(tab.id)` / `send browse shares username` to **re-query network** for fresh shares (in case updates). Works demo (local resolve) + prod.

### 3.19 Browse folder list — slidable/extendable right `ON PROD AND DEMO`
- **Current:** `BrowseView.tsx:240` `div.flex-1.overflow-y-auto.overscroll-contain.min-h-0.p-2.space-y-1` with rows `flex w-full items-center gap-1 rounded-lg` `padding:6px 8px 6px ${8+depth*16}px` and `p.truncate font-body text-sm font-medium`. No `overflow-x-auto`, long names truncated cannot be read.
- **Target:** Make list **slidable horizontally**: change container to `overflow-y-auto overflow-x-auto overscroll-contain min-h-0 p-2 space-y-1 hide-scrollbar` + inner row `min-w-max` or remove `truncate` on hover, allow `whitespace-nowrap` + horizontal scroll/drag. Keep vertical scroll, add `snap-x` off. Keep `hide-scrollbar` but enable `overflow-x`. Verify `max-w-full overflow-hidden` parents don't clip. Both prod+demo.

### 3.20 Navigation — remove beforeunload unless gated unsaved setting `ON PROD AND DEMO`
- **Current (verified via Playwright MCP 2026-09-02):** `ExitDialogHandler.tsx:15` always `addEventListener("beforeunload", handler)` when `mode===1` (default `1` from `defaults.ts:243`). `provider.tsx:52` auto-saves every `setOption` → no unsaved state for most toggles, but `NetworkSection:87` has save-gated `pendingPort` (`dirty = pendingPort !== listenPort`). Handler never checks `dirty`, so `page.goto('/browse')` after `settings?tab=network` triggers `beforeunload` dialog `This page is asking you to confirm that you want to leave — information you’ve entered may not be saved` (captured via `page.on('dialog')` → `dialogType beforeunload` even on internal SPA nav). `evaluate` showed `dispatchEvent beforeunload` `prevented:true, dispatched:false` confirming listener active. `localStorage nicotineHub.settings ui.exitdialog=1`.
- **Target:** **Any future save-gated setting should gate the dialog** (generic `hasUnsavedChanges` in `ConfigProvider`), **remove dialog on every page unless they have gated unsaved edits**. If `mode!==1` or `!isDirty` then no listener. If `mode===1 && isDirty` then add listener (`e.returnValue=""`). Change default `defaults.ts:243` `exitdialog:1 → 0` so fresh installs default to no confirm (user can re-enable via `Appearance → Close dialog behavior`). Respects `ui.exitdialog` master switch (0=Quit,1=Show,2=Background). Both prod+demo.

## 4. File Change Plan (no edits yet)

### Phase A — Demo banner (hidden forever until pill)
- `apps/web/src/app/layout.tsx:51` `style={... "--demo-banner-h":"0px"}`.
- `apps/web/src/app/layout.tsx:72` script: `if(localStorage.getItem('nicotineHub.demoBannerDismissed')==='0') set 32 else set 0`.
- `apps/web/src/components/DemoBanner.tsx:10-24` `useState(true)`, mount `if(v==='0') setDismissed(false) else true`, restore writes `"0"`, dismiss `"1"`, keep `ResizeObserver`.

### Phase B — Files info hover + start at /data
- `apps/web/src/app/files/page.tsx:53` `initialPath="/data"`, add `infoOpen` state, replace `mt-3` static div with button `data-testid="files-info"` + tooltip `data-testid="files-info-tooltip"` containing updated text (3.2).
- `apps/web/src/components/files/FileExplorer.tsx:90` breadcrumb `⌂ /` vs `⌂ /data` logic; ensure `parent` for `/data`→`"/"`.

### Phase C — Bridge browsing root
- `apps/bridge/src/server.ts:600` `listDirectory(rawPath, "/")` (host root).
- `apps/bridge/src/files.ts` doc comment update; keep `resolveSafePath` with root `"/"`.
- `apps/bridge/src/files.test.ts` add host-root cases, update traversal expectations.

### Phase D — Demo fixtures
- `apps/web/src/lib/demo/fixtures.ts:408` move `"/"`→`"/data"`, new `"/": [data, home, tmp, etc]` + update `mockFileExplorerResponse`.

### Phase E — Downloads remove uploads (prod+demo)
- `apps/web/src/app/downloads/page.tsx:49-54,111,124,153,230` delete `uploads` section entirely (remove `section[data-testid="uploads-section"]` plus its `ulCount` usage in subtitle/grid). Change outer `<div class="grid grid-cols-1 xl:grid-cols-2">` → `grid-cols-1`, remove `tab==="uploads"` logic or keep but only downloads renders. Update `TopBar subtitle` to `dlCount downloading`. Remove `tab` state for uploads or keep no-op. Update `e2e/transfers.spec.ts` expectation.

### Phase F — ThroughputChart touch top (both pages)
- `apps/web/src/components/transfers/ThroughputChart.tsx:82,135` change `section` header from `p-5 md:p-6 justify-between` to `justify-start p-0`, inner div from `ml-3 md:ml-6 rounded-xl` to `ml-0 mt-0 w-fit rounded-t-none rounded-b-xl border-t-0` (or `rounded-none` top), keep `backdrop-blur` and `ghost-border` bottom. Verify `h-56 md:h-64` keeps chart behind header.

### Phase G — Chat public rooms dropdown sorted
- `apps/web/src/lib/rooms.tsx` maybe add `isPrivate` to `roomList` type; ensure sorting helper `sortedRooms = [...roomList].sort((a,b)=> (b.isPrivate?1:0)-(a.isPrivate?1:0) || b.users-a.users)`.
- `apps/web/src/app/chat/page.tsx:99` desktop aside: add `<select data-testid="public-room-dropdown">` below `Join` button, options `sortedRooms.map` + `filter` applied, `onChange => setJoinInput(e.target.value) || joinRoom`. Mobile block `page.tsx:221` add same dropdown.
- Demo fallback: if `roomList.length===0 && isDemo` use `DEMO_ROOMS` sorted same.
- Keep `filteredRooms` slicing `50` for list below dropdown; dropdown shows top 50 as well.

### Phase H — Buddies prod purge
- `apps/web/src/lib/buddies.tsx:26,54` `loadBuddies()` filter out `DEMO_BUDDY_USERS` when `!isDemo` (remove jazzcat/vinyl_hunter). Add `useEffect` purge: if `!isDemo && buddies.some(b=>DEMO_BUDDY_USERS.includes(b.username))` then `setBuddies(prev=>prev.filter(...))` + `sessionStorage.removeItem("__demoBuddiesSeeded")`. Ensure `mockBuddies` import not used in prod.

### Phase I — Browse even/odd rows
- `apps/web/src/components/browse/BrowseView.tsx:390,397` change `ul className` to include `bg-surface-container-lowest` base + `li` class to `even:bg-surface-container-low odd:bg-surface-container-lowest` (and dark variants `dark:even:bg-surface-container-high dark:odd:bg-surface-container-highest/40`). Remove strong `divide-y` or soften. Verify `docs/DESIGN.md:6` tertiary not used for rows, only surface tiers.

### Phase J — Downloads dual panes combine
- `apps/web/src/lib/context-menu/menus.ts:118` `transferMenu` review: ensure no extra `ContextMenu` portal besides downloads page's `menuAnchor`. Check `apps/web/src/app/downloads/page.tsx:216` `onContextMenu` only on wrapper `div`, not also `TransferCard` internal handlers. Keep single `ContextMenu` rendering, ensure `MenuPanel` submenu `nested` only renders on click `hasSub`, not hover auto-open (already click toggle). Maybe flatten `User Actions` submenu into flat items with prefix `User: ...` to avoid second pane — but keep nested toggle to satisfy combine requirement (one dropdown, not dual simultaneous).

### Phase K — ContextMenu bottom-up halfway
- `apps/web/src/components/ui/ContextMenu.tsx:94` update `useLayoutEffect` to: `const halfH = window.innerHeight/2; let top = y > halfH ? y - rect.height - 8 : y;` then clamp `if(top+height>innerHeight-pad) top=innerHeight-height-pad; if(top<pad) top=pad;` Similarly `if(x>innerWidth/2) left = x - rect.width - 8 else left=x`.

### Phase L — Settings long descriptions → info hover (ALL pages)
- Create `apps/web/src/components/ui/InfoTooltip.tsx` (reusable button + tooltip portal, hover+click+Escape, like files-info pattern). Or inline `InfoButton` in `controls.tsx`.
- Modify `apps/web/src/components/settings/controls.tsx:10 Row` to detect long: `const isLong = description && (description.length>80 || description.split(/[.!?]+/).filter(s=>s.trim()).length>1)`; if long, render `label + <InfoTooltip text={description} id={label}>` and omit inline `div mt-0.5 text-xs`; else keep inline. Apply same to `TextFieldControl:124` (`mb-2 description` block), `NumberControl:172`, `SelectControl:207`, `RadioGroupControl:242`, `SectionCard:288` header `description`.
- Touch `NetworkSection.tsx:177,205,260,313` etc only via `controls.tsx` — no per-file copy, but verify one example (`Listening port`) shows tooltip correctly.

### Phase M — Settings padding between cards
- `apps/web/src/app/settings/page.tsx:240` wrap content `div` with `flex flex-col gap-6` (add to `opacity-100` / `opacity-60` classes).
- Each `apps/web/src/components/settings/*Section.tsx` (Network, Shares, Downloads, Uploads, Searches, UserProfile, Chats, NowPlaying, Logging, BannedUsers, IgnoredUsers, UrlHandlers, Plugins, Ui, Notifications, About) — where fragment returns multiple `SectionCard`s, wrap in `<div className="flex flex-col gap-6">` so cards have 24px gap. Single-card sections no change needed.

### Phase N — Username → profile (demo+prod)
- `apps/web/src/components/Sidebar.tsx:76,92` change username from `button onClick setAboutOpen` to conditional `Link href={`/profile/${encodeURIComponent(state.user)}`} data-testid="sidebar-username-link"` when `state.user` truthy; fallback keep non-link `System Administrator` with AboutDialog trigger. Keep `title={displayUser}` and `font-label text-sm font-semibold text-primary truncate` + `hover:underline`. Ensure About still reachable via `NICOTINE HUB` logo button.

### Phase O — Search mobile flush under header (demo+prod)
- `apps/web/src/components/search/SearchScreen.tsx:125` sticky wrapper `top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0` inner `flex flex-col gap-2 px-3 py-3` → `px-3 pt-2 pb-2 md:px-3 md:py-3`, inner `rounded-2xl p-2.5 sm:p-3` → `p-2 md:p-3`. Also verify `apps/web/src/components/search/SearchBar.tsx` not adding extra `py-3`. Keep desktop unchanged.

### Phase P — Demo pill floating on mobile (ON DEMO)
- `apps/web/src/components/DemoBanner.tsx:61` add media query branch: `const isMobile = typeof window!=="undefined" && window.matchMedia("(max-width:767px)").matches`; in `useEffect` only set `--demo-banner-h` when `!isMobile`; render `if (isMobile && dismissed) pill else if (isMobile && !dismissed) <div className="fixed top-[calc(56px+env(safe-area-inset-top,0px)+8px)] left-2 right-2 rounded-xl bg-tertiary-fixed ... z-[60]">floating banner</div>` vs desktop sticky.

### Phase Q — Browse mobile flush under header (demo+prod)
- `apps/web/src/app/browse/page.tsx:97` `mx-auto ... px-4 sm:px-6 md:px-10 py-3 flex flex-col gap-3` → `px-3 py-2 md:px-10 md:py-3` so input sits flush under `TopBar` on mobile.

### Phase R — Search keep-alive (prod+demo)
- `apps/web/src/app/layout.tsx:80` hoist `<SearchProvider>` to root level (wrap `children` alongside `TransfersProvider`/`BrowseProvider`/`WishlistProvider`). Remove per-page `<SearchProvider>` from `app/search/page.tsx:32`.
- `apps/web/src/lib/search.tsx:51` keep `tabs/activeId` in state, add `sessionStorage` persist (like `browse-tabs`) so reload also keeps; on mount restore if `tabs.length===0` and persisted exists. Ensure `isDemo` seed still works but not on every mount (guard with persisted check).

### Phase S — Browse cache + Reload (prod+demo)
- `apps/web/src/app/layout.tsx:80` hoist `<BrowseProvider>` to root (remove `app/browse/page.tsx:168` wrapper). Extend `browse-tabs.tsx:49 persist()` to keep `folders` in memory (or shallow store) so cached `folders/currentFiles` survive nav.
- `apps/web/src/components/browse/BrowseView.tsx:203` add `Reload` button: `<button data-testid="browse-reload" aria-label="Reload" title="Reload from network" onClick={()=>retry(tab.id)} disabled={loading} className="h-9 w-9 rounded-full bg-surface-container-high hover:bg-surface-variant flex items-center justify-center"><span class="material-symbols-outlined text-[18px]">refresh</span></button>` next to `View Profile`.

### Phase T — Browse slidable (prod+demo)
- `apps/web/src/components/browse/BrowseView.tsx:240` change list container to `flex-1 overflow-y-auto overflow-x-auto overscroll-contain min-h-0 p-2 space-y-1` + rows `min-w-max` / remove `truncate` forced, keep `title` for tooltip. Keep `hide-scrollbar` styling but allow drag scroll.

### Phase U — Navigation confirm gated on unsaved setting (prod+demo)
- **Verify via Playwright MCP (done 2026-09-02):** `page.goto('http://localhost:3000/browse')` from `settings?tab=network` triggered `beforeunload` dialog `This page is asking...` (captured `dialogType beforeunload`); `evaluate dispatchEvent beforeunload` `prevented:true` confirming active listener. `localStorage exitdialog=1`.
- `apps/web/src/components/ExitDialogHandler.tsx:11` change to gated: `const { settings, isDirty } = useConfig(); const mode=settings.ui.exitdialog ?? 1; useEffect(()=>{ if(mode!==1 || !isDirty) return; const handler=(e:BeforeUnloadEvent)=>{e.preventDefault(); e.returnValue=""; return "";}; window.addEventListener("beforeunload",handler); return ()=>removeEventListener(...)},[mode,isDirty])`. For generic future gating, expose `isDirty`/`hasUnsavedChanges` from `ConfigProvider` (compare `settings` vs last persisted snapshot or expose `hasNetworkDirty` now: `pendingPort !== listenPort` lifted to provider so any future save-gated section can reuse same `isDirty`).
- `apps/web/src/lib/config/provider.tsx:29` add `isDirty` state: store `lastSavedRef` on hydrate + after `setSettings` persist; `isDirty = JSON.stringify(settings) !== JSON.stringify(lastSavedRef.current)` **or** narrow `hasUnsaved = hasNetworkPending` (lift `pendingPort` to context) — broad generic preferred per your “any future save-gated setting” (use deep-equal snapshot).
- `apps/web/src/lib/config/defaults.ts:243` change `exitdialog:1 → 0` (default no confirm).
- `apps/web/src/components/settings/UiSection.tsx:113` no code, but verify `SelectControl exitdialog` still shows 0=Quit,1=Show (when dirty),2=Background. No default dialog on fresh install.

## 5. Risks & Mitigations
- **Host root exposure** `/api/files?path=/` lists `/etc` etc LAN-open if `BRIDGE_TOKEN` unset. Mitigate: token gate already, cap 5000, traversal outside `/` impossible, but still disclose.
- **Banner flash** inline `0px` vs component default must match; test fresh profile.
- **Downloads removal** breaks `e2e/transfers.spec.ts` expecting `uploads-section` visible — update test to expect absence.
- **Browse odd/even** must stay subtle per DESIGN.md tonal layering, not high contrast.
- **Chat dropdown** must not duplicate `filteredRooms` list — dropdown for selection, list below for display; keep both but sorted same.
- **ContextMenu bottom-up** need to measure `rect` before positioning; `useLayoutEffect` already does measure, but must account for half-height threshold before clamp.
- **Settings info hover** long-description heuristic must not hide short 1-sentence help (e.g. `Auto-connect when the app opens.`) — keep those inline. Ensure tooltip is accessible (`aria-describedby`, focusable, Escape). Mobile tap must work.
- **Settings padding** adding `gap-6` may double-gap if both outer wrapper and inner `*Section` wrappers add gap — need single source (outer `gap-6` on page wrapper + inner `gap-6` on multi-card sections only).
- **Username link** must handle `state.user` undefined (guest) — don't render broken link; keep AboutDialog fallback. Ensure `suppressHydrationWarning` stays.
- **Search/Browse mobile flush** `py-3` → `py-2` change must not clip `min-h-11` inputs (`py-2.5` inside input already); keep `min-h-11` touch target.
- **Demo pill floating** must not be obscured by `BottomNav` (`z-[60]` vs `z-40` TopBar) and must handle `env(safe-area-inset-top)` on iOS.
- **Search hoist** moving `SearchProvider` to root may duplicate `tabs` if per-page provider not removed; ensure single provider only.
- **Browse hoist** caching `folders` (potentially 5000 files) in `localStorage` may exceed quota — keep in-memory only, not persisted, or shallow persist ids only.
- **Slidable** `overflow-x-auto` inside `overflow-y-auto` must not break vertical scroll; test `overscroll-contain` with both axes.
- **Navigation confirm** generic `isDirty` via `JSON.stringify` may be expensive on large `settings` (15 sections) on every render — use ref comparison or shallow dirty flag set only when save-gated section sets `hasUnsaved` (e.g. `Network pendingPort`). Default `0` changes behavior for existing users whose `localStorage exitdialog=1` already persists — they will keep `1` until they toggle, so fresh-install default `0` does not retroactively fix them unless we also migrate (optional `if stored exitdialog===1 && not explicitly set by user then keep, else respect`). Broad `isDirty` must be reset after `Save` (e.g. `NetworkSection` `handleSave` clears).

## 6. Verification Checklist (after implementation)
- `bun test` — `files.test.ts` host-root cases + buddies purge.
- `bun run build` typechecks.
- Demo fresh: banner hidden pill visible, click pill→banner, Esc→pill, reload persists, `/files` starts at `/data` breadcrumbs `⌂ /data`, Up→`/` shows `data` folder, hover `info` tooltip updated text in prod+demo.
- `/downloads` prod+demo: no `uploads-section`, single column, `ThroughputChart` header flush to top (no gap), right-click download row single dropdown, bottom row menu opens upwards (no overflow).
- `/uploads` same header flush.
- `/chat` dropdown shows public rooms sorted users desc (most joined first), selecting fills join input; mobile dropdown works.
- `/buddies` prod with `!isDemo` shows no `jazzcat`/`vinyl_hunter` even if previously persisted; demo still shows both.
- `/browse` file rows alternating `surface-container-low` vs `lowest` subtle.
- `/settings` prod+demo: `?tab=network` long descriptions (Listening port, UPnP, Network interface) now show `ⓘ` info button with hover tooltip, short 1-sentence still inline; all other tabs same. Cards have `gap-6` padding between sections (Connection / Auto-join / Auto-reply no longer touch) on desktop + mobile.
- Username click (prod+demo): `Sidebar` `asdf` links to `/profile/asdf` (data-testid `sidebar-username-link`) and loads server profile.
- Mobile search: `/search` search bar flush under `TopBar` (no extra `py-3` gap); demo pill on mobile stays floating (`fixed top=TopBar+8px`) not pushing page; `/browse` input flush under header on mobile.
- Search keep-alive (prod+demo): `http://localhost:3000/search` tabs persist after navigating away until closed; `Browse` cache shows cached files instantly, `Reload` icon next to `View Profile` re-queries network; folder list slidable right to read full names like `Abul Mogard & Rafael Anton Irisarri - Where Light Pauses...` (quoted `padding 6px 8px 6px 24px` list).
- Navigation (prod+demo, verified Playwright MCP): navigating `settings?tab=network → browse` no longer shows `beforeunload` dialog unless unsaved gated setting (e.g. `Listening port 62904→62905` dirty) and `ui.exitdialog===1`; fresh default `0` no dialog anywhere.

## 7. Next Steps (out of scope for this file)
- Run `bun install` in worktree per `mistakes.md 2026-08-28` symlink panic.
- Implement Phases A–U sequentially (A–K prior + L–M settings + N–Q username/mobile + R–T search/browse persistence/slidable + U navigation confirm), `bun test && bun run build` after each, then `gh pr create` to `stage`.

## 8. Live Verification — Playwright MCP 2026-09-02 / 2026-09-03

> Verified via `localhost:3000 prod` (`testuser123` logged in, `NEXT_PUBLIC_DEMO=false`) + `https://nicotine-hub-web-phi.vercel.app` demo (`NEXT_PUBLIC_DEMO=true`). Used `page.goto`, `snapshot`, `evaluate`. User clarified 7 open questions (answers recorded).
> **2026-09-02 pre-implementation:** All 19 plan points verified not done. **2026-09-02 navigation confirm:** `page.goto('/browse')` from `settings?tab=network` triggered `dialogType beforeunload` with message `This page is asking you to confirm...` even with no dirty (`pendingPort` not dirty). `evaluate dispatchEvent beforeunload` `prevented:true`. `localStorage ui.exitdialog=1`. Confirmed need for gated fix + default `0` per user answers (any future gated setting, remove dialog unless gated, yes default 0).
> **2026-09-03 post Phases A–C:** `bun test 119 pass` + `next build` success in worktree. Demo banner + files hover + browse root implemented; live UI verification pending on next Vercel deploy.

| # | Plan point | Prod `localhost:3000` evidence | Demo `vercel` evidence | Verdict |
|---|------------|-------------------------------|------------------------|---------|
| **3.1** Demo banner hidden until pill | `html.dataset.demo=undefined`, no `data-testid` (prod ok, but code `DemoBanner.tsx:10` still `useState(false)` + inline `32px` + script `==="1"` ) | **FAIL** — `html.dataset.demo="true"`, `data-testid="demo-banner"` visible `40px`, `restore` hidden — should be `0px` + pill only | Not done |
| **3.2** `/files` info → hover | Still static `div.mt-3.rounded-xl.bg-surface-container-low` [ref f1e103] + `Security:` footer [f1e101]; no `data-testid="files-info"` / tooltip | Same (not hover) | Not done |
| **3.3** `/files` Up to `/` start `/data` | `FileExplorer` `initialPath="/"` not `/data`, breadcrumbs `⌂ /data` single, no `arrow_upward Up`; `server.ts:600` still `DATA_DIR` not `/` | `DEMO_FILE_TREE` `/` still `/data` root, no host `/` with `data/home/tmp` | Not done |
| **3.4** `/downloads` remove `Uploading` prod+demo | **FAIL** — both sections: `downloads-section flex` + `uploads-section hidden xl:flex Uploading (0) empty-uploads` + `grid xl:grid-cols-2` | Same `grid` | Not done |
| **3.5** Throughput touch top both pages | `ThroughputChart` `ml-3 md:ml-6` + parent `justify-between p-5 md:p-6` not flush | Same | Not done |
| **3.6** `/chat` dropdown sorted `users` desc | No `public-room-dropdown`; only `Filter rooms...` + `Select a room`; `filteredRooms.slice(0,50)` unsorted, no `PRIVATE_USERS_OFFSET` | Same — `No rooms yet` | Not done |
| **3.7** `/buddies` prod purge `jazzcat`/`vinyl_hunter` | Shows `0 buddies • 0 online` — trivially no demo users, but `buddies.tsx:26` missing `!isDemo` filter/purge | Demo would seed `mockBuddies` (expected) | Code not done |
| **3.8** `/browse` even/odd subtle `DESIGN.md` | `li hover:bg-surface-container-low/60` uniform + `divide-y`; no `even:bg`/`odd:bg`, `hasOverflowX yes` unrelated | Same | Not done |
| **3.9** `/downloads` dual panes → one | `transferMenu` still nested `User Actions left-full top-0`; `downloads/page.tsx` wrapper `onContextMenu` may fire two portals | Same | Not done |
| **3.10** `/downloads` menu bottom-up halfway | `ContextMenu.tsx:94` only clamp `left+width`/`top+height`, no `halfH = innerHeight/2` `y - height` | Same | Not done |
| **3.11** Settings `>1 sentence` → info hover | `settings?tab=network` still inline `mb-2 font-body text-xs` 3-sentence `Listening port ...` + `UPnP`/`Network interface` 5 sentences; `hasInfoButton false` | Same all tabs | Not done |
| **3.12** Settings `gap-6` | Outer `opacity-100 transition-opacity` no `gap`, `sections:3` touch | Same | Not done |
| **3.13** Username → profile prod+demo | `Sidebar` `div[title="testuser123"]` inside `button About`, no `data-testid="sidebar-username-link"` (`usernameLink false`) | Same | Not done |
| **3.14** `/search` mobile flush prod+demo | Still `gap-2 px-3 py-3` + `p-2.5 sm:p-3` not `pt-2 pb-2` flush | Same | Not done |
| **3.15** Demo pill floating mobile ON DEMO | Prod no pill; demo pill `fixed bottom-[calc(76px...)]` becomes sticky `top-0 40px` pushing `TopBar` via `globals.css` | Demo **FAIL** — pushes header, not `fixed top-[calc(56px+...)+8px] left-2 right-2 rounded-xl` floating | Not done |
| **3.16** `/browse` mobile flush prod+demo | Still `mx-auto ... px-4 sm:px-6 md:px-10 py-3 flex flex-col gap-3` not `px-3 py-2` | Same | Not done |
| **3.17** Search keep-alive prod+demo | `SearchProvider` still per-page `app/search/page.tsx:32`; nav away loses `tabs` (demo re-seeds) | Same | Not done |
| **3.18** Browse cache + Reload prod+demo | `BrowseProvider` per-page `app/browse/page.tsx:168`; `hasReload false`, no `browse-reload` next to `View Profile`; only `retry` on error | Same | Not done |
| **3.19** Browse slidable readable prod+demo | `flex-1 overflow-y-auto p-2 space-y-1` no `overflow-x-auto` slidable; `truncate` not scrollable horizontally | Same | Not done |

**Open questions — answered 2026-09-02:**
1. Demo env → **Vercel preview** is truth (localhost prod for prod checks).
2. Username link → **Keep both** — text links to profile, About via NH logo.
3. Throughput box → **Just remove gap** (keep `rounded-xl`).
4. Settings long desc → **First sentence inline**, rest in tooltip.
5. Search persistence → **Persist reload** (`sessionStorage`).
6. Browse cache → **Keep until manual** Reload/close.
7. Slidable → **Both + tooltip** — horizontal scroll + `title`.

Plan now reflects verified state and clarified behaviors; ready for Phases A–T implementation.

---
*Plan written 2026-09-02 per user request. Updated per round-2, round-3 settings, round-4 username/mobile, round-5 search/browse slidable, Playwright MCP live verification (rounds 1-5 all pending), round-6 navigation confirm, and 2026-09-03 Phase A–C implementation (demo banner hidden, files hover, browse root) — verified `bun test 119 pass` + `next build`. Code mutated for Phases A–C only; Phases D–U still pending.*
