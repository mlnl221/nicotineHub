# Settings Audit — Full Report & Fix Plan

> Source: `apps/web/src/app/settings/page.tsx:27` (15 tabs), `apps/web/src/lib/config/defaults.ts:27` (13 sections), `apps/bridge/src/server.ts:984` (`config:update`), `apps/web/src/lib/config/sync.tsx:11` (`ConfigBridgeSync`).
> Ground truth: `~/projects/nicotine-plus/pynicotine/config.py:156` defaults + `pynicotine/gtkgui/dialogs/preferences.py:3764` page_ids + `pynicotine/gtkgui/ui/settings/*.ui`.
> Mapping reference: `docs/settings-mapping.md`, `docs/settings-plan.md`, `docs/architecture.md`, `docs/porting-status.md`.
> Date: 2026-08-29 — branch `fix/settings-audit-p0p1`.

## Methodology

For every control rendered on `/settings`, checked:
1. What nicotine-plus does with the key (`config.py` default, `.ui` widget, `preferences.py` `get_settings()` conversion + `has_option_changed` side-effects like `core.reconnect()`, `portmapper`, `shares.rescan`).
2. Where web stores it (`defaults.ts` + `lib/config/provider.tsx:16` `localStorage nicotineHub.settings` via `deepMerge`).
3. Whether it reaches the bridge (`sync.tsx` `config:update` per-key WS) and what `server.ts:985` does with it.
4. Whether a consumer actually reads it (grep for `settings.xxx`).

Verdict buckets:
- **✅ Correct** — persists + changes runtime as in nicotine-plus.
- **⚠️ Stored-only / intentionally limited** — persists but no browser effect by design (see `settings-mapping.md:310`). Left with callout.
- **❌ Wrong / silent no-op** — persists but never read / never synced, toggle appears to do nothing.
- **🐛 Bug** — code intended to sync but doesn't (e.g. missing loop).

---

## Inventory by tab (15 tabs, 16 `*Section.tsx` files — `AboutSection.tsx` has no settings)

| Tab | Keys | Controls | Verdict summary |
|-----|------|----------|-----------------|
| **Network** `NetworkSection.tsx` | `server.auto_connect_startup`, `server.server.host/port`, `server.portrange`, `server.upnp`, `server.interface`, `server.autoaway`, `server.autojoin/userlist/autosearch`, `server.autoreply` | 11 | 7 ✅, 3 🐛/❌ (`auto_connect_startup` no gate, `host/port` never used, `interface` stored-only OK), `portrange/upnp/autoaway/autojoin/reply` ✅ |
| **Appearance** `UiSection.tsx` | `ui.dark_mode`, `ui.language`, `ui.usernamehotspots/usernamestyle`, `ui.file_size_unit/reverse_file_paths/spellcheck/header_bar/tabclosers/tab_select_previous/buddylistinchatrooms/exitdialog`, `ui.modes_visible/modes_order` | 13 | 3 ✅ (`dark_mode`, `modes_*`), 10 ❌/⚠️ (persist but no consumer yet) |
| **Shares** `SharesSection.tsx:66` | `transfers.shared/buddyshared/trustedshared`, `share_filters`, `rescanonstartup/rescan_shares_daily/hour`, `reveal_buddy_shares/reveal_trusted_shares` | 9 | 5 ✅ (`share_filters/reveal_*`), 1 ⚠️ (rescan timer not in bridge, UI only), 3 ❌ (`shared/*` never synced — local notes only) |
| **Downloads** `DownloadsSection.tsx` | `transfers.autoclear_downloads/remotedownloads/uploadallowed`, `incompletedir/downloaddir/uploaddir`, `enablefilters/downloadfilters`, `downloadlimit*`, `use_download_speed_limit`, `usernamesubfolders`, `groupdownloads/expand_downloads/download_doubleclick` | 14 | 11 ✅, 3 ⚠️ (folder paths are notes, correct per `settings-mapping.md:266`) |
| **Uploads** `UploadsSection.tsx` | `autoclear_uploads/uploadbandwidth/useupslots/uploadslots/uploadlimit*`, `fifoqueue/limitby/queuelimit/filelimit/friendsnolimits/preferfriends`, `groupuploads/expand_uploads/upload_doubleclick` | 14 | 14 ✅ (all synced to `TransferManager` or UI grouping) |
| **Searches** `SearchesSection.tsx` | `maxresults`, `max_displayed_results`, `min_search_chars`, `search_results`, `private_search_results`, `enable_history/history`, `filters_visible/enablefilters/defilter`, `expand_results/group_searches` | 13 | 3 ✅ (`min_search_chars`, `enable_history`, `defilter`), 10 ❌ (e.g. `maxresults/max_displayed/search_results` stored but never read) |
| **User Profile** `UserProfileSection.tsx` | `userinfo.descr/pic/picture_visible` | 3 | 3 ✅ (WebP 512 + `userinfo:setProfile` debounced 800ms) |
| **Chats** `ChatsSection.tsx` | `server.private_chatrooms`, `chatrooms.user_list_visible`, `privatechat.store`, `logging.readroomlines/readprivatelines/rooms_timestamp/private_timestamp`, `words.tab/dropdown/characters/roomnames/buddies/roomusers/commands`, `words.censored/censorwords`, `words.autoreplaced/replacewords`, `words.keywords/watch_keywords`, `ui.spellcheck`, `ctcp.enable` | 18 | 13 ✅, 5 ⚠️/❌ (`replacewords` ✅ in `privateChat` but rooms was only `censorText`; `watch_keywords` stored but highlight not wired; `user_list_visible` gated locally ✅ but missing sync loop) |
| **Now Playing** `NowPlayingSection.tsx` | `players.npplayer/npformat/npothercommand/npformatlist` | 4 | 4 ✅ stored-only intentionally (`lastfm` omitted per user request `settings-mapping.md:242`) |
| **Logging** `LoggingSection.tsx` | `logging.privatechat/privatelogsdir/chatrooms/roomlogsdir/transfers/transferslogsdir/debug_file_output/debuglogsdir/log_timestamp/debug/logcollapsed` | 12 | 1 ✅ (`log_timestamp` in `DiagnosticsPage`), 11 ⚠️ stored notes (browser `diagnostics.log` ring 500/2000 not gated) |
| **Banned Users** `BannedUsersSection.tsx` | `server.banlist/ipblocklist`, `transfers.usecustomban/customban/geoblock/geoblockcc/usecustomgeoblock/customgeoblock` | 8 | 8 ✅ (all synced → `networkfilter.ts` + `transfers.ts` `handleQueueUpload`) |
| **Ignored Users** `IgnoredUsersSection.tsx` | `server.ignorelist/ipignorelist` | 2 | 2 ✅ |
| **URL Handlers** `UrlHandlersSection.tsx` | `urls.protocols`, `ui.filemanager` (no control) | 1 | 1 ⚠️ intentionally stubbed (browser handles URLs natively) |
| **Plugins** `PluginsSection.tsx` | `plugins.enable`, per-plugin `enabled/settings/metasettings` via bridge | 3 | 2 ✅ (install/toggle), 1 ❌ (`plugins.enable` local-only, bridge `DATA_DIR/plugins.json` master not synced) |
| **Notifications** `NotificationsSection.tsx` | 11 `notifications.*` (+ SW) | 11 | 8 ✅ (checked in `lib/notifications.ts:16`), 3 ❌ (`notification_popup_folder/queued_upload`, `tab_colors` stored but no `Upload` notify path) |

**Totals:** ~120 keys — ~45 ✅, ~35 ⚠️ intentionally limited, ~25 ❌/🐛 to fix.

---

## 🐛 P0 bugs — toggles that *look* like they work but silently do nothing

### 1. `ConfigBridgeSync` never sends `chatrooms.user_list_visible` / `userbrowse.expand_folders` + `plugins.enable` (3-line fix)

`sync.tsx:64` builds `relevant = {transfers, server, chatrooms:{user_list_visible}, userbrowse:{expand_folders}}` for diffing, but `sync.tsx:76` only iterates `transfers` + `server`. `server.ts:1070` handler for `chatrooms/userbrowse` is dead. `plugins.enable` was never in `relevant` at all. Fix: add loops for those sections to `sync.tsx`, dedup the trailing duplicate `share_filters` send `sync.tsx:83`.

Web consumers read `settings` directly (`app/chat/page.tsx:52` `showUserList`, `components/browse/BrowseView.tsx:36` `expandFolders`), so the bug is masked web-side — bridge just misses the ack.

### 2. `server.auto_connect_startup` (`NetworkSection.tsx:60`) has no gate

Nicotine-plus: don't call `core.connect()` when false. Web: `lib/session.tsx:405` auto-login fires if *any* `loadCreds()` exists (sessionStorage + cookie), never reads `settings.server.auto_connect_startup`. Toggle off → reload → still auto-connects.

Fix `lib/session.tsx:417` to read `localStorage nicotineHub.settings` synchronously (or via `useConfig`) and `return` without `login(creds)` when `auto_connect_startup===false`. Also guard `visibilitychange/online` reconnect.

### 3. `server.server.host/port` (`NetworkSection.tsx:66`) stored but never used for login

`LoginForm.tsx:16` seeds local state from `settings.server.server.host/port` but `handleSubmit` only writes back to `settings` `LoginForm.tsx:32` and `lib/session.tsx:361` `login(req)` uses the per-request `req.host/port` (default `server.slsknet.org:2242` if omitted). Auto-login creds from `loadCreds()` never carry host/port. So changing host in Settings has no effect on next login unless Advanced fields also changed.

Fix: make `loadCreds()`-driven auto-login merge `settings.server.server` as fallback, and/or make login form defaults sync when settings change (effect or derive from `settings`).

### 4. Shares folder lists never reach bridge — no real file sharing

`SharesSection.tsx:66` persists `transfers.shared/buddyshared/trustedshared` to `localStorage`, but `sync.tsx:19` never sends them; `server.ts:985` has no `shared` case. `shares.ts` scans `DATA_DIR/shared` etc via `resolveSharedDirs()` `shares.ts:307` (env `SHARED_DIRS` or `/data/shared`). Peer `SharedFileList 5` / `FileSearchResponse 9` serves that FS state, not the browser's virtualName→path notes. `SharesSection.tsx:296` callout says “Browser limitation” accurately, but with “I want real file sharing” we must wire **B**: sync the three arrays to bridge → `session.ts` `shareDB.setFolders()` / `rescanAsync()`, and require host paths be mounted into the bridge container (`compose.yaml` `-v ~/Music:/data/shares:ro` or `SHARED_DIRS`).

### 5. `plugins.enable` local-only (`PluginsSection.tsx:192`)

Web stores `plugins.enable` locally; bridge master is `DATA_DIR/plugins.json` `globalEnable` (`server.ts:392` `/plugins` GET). No `config:update plugins enable` is sent. Toggle in Settings doesn't disable bridge plugins.

Fix: add `plugins:{enable}` to `sync.tsx` + `server.ts:1058` → `pluginManager.setGlobalEnable(bool)` (or `process.env` toggle).

---

## ❌ P1 search settings stored but ignored

All in `SearchesSection.tsx:19` / `defaults.ts:75` — `lib/search.tsx:168` only honors `min_search_chars/enable_history/defilter/enablefilters`:

- **`maxresults 300`** (`config.py:184` max results *sent* to others) — never sent to bridge. Bridge `session.search()` hardcodes `MAX_DISPLAYED_RESULTS 2500` `session.ts:191`. Needs `setMaxResults()` sent via `config:update searches maxresults` and respected when building `FileSearchResponse`.
- **`max_displayed_results 2500`** (max rows shown) — never read. `SearchProvider` `search:result` handler `lib/search.tsx:95` appends unbounded. Should slice to cap and surface “capped” notice.
- **`search_results true`** (respond to `FileSearch 26`) — bridge always responds if `ShareDB.search()` has hits. Need `setSearchEnabled(bool)` gated before `buildFileSearchResponse` in peer `FileSearchRequest` dispatch (`session.ts`).
- **`private_search_results false`** — should gate BUDDY/TRUSTED hits for non-buddies (already `reveal_*` gating in `ShareDB.getFoldersForPermission()` `shares.ts:237` but this flag not consulted).
- **`filters_visible / expand_results / group_searches`** — stored, never read by `SearchScreen`. Either wire (`SearchScreen` filter bar collapsed vs expanded, grouping switch) or mark stored-only with note.

`rescan*` daily/hour similarly stored but no `setInterval` daily timer in `shares.ts` — low priority, keep as note or add `shares.ts` cron.

---

## ❌ P1 words/notifications gaps

- **`words.replacewords` / `autoreplaced`** `ChatsSection.tsx:119`. `lib/privateChat.tsx:150` does apply it before send, but `lib/rooms.tsx:300` `say()` already does (`rooms.tsx:305` `replaceText`). Actually `rooms.tsx:305` already wires it — check: `lib/rooms.tsx:305` calls `replaceText(out, settings.words.replacewords ? autoreplaced : {})` — ✅. `privateChat` also — ✅. So this is now correct after Phase 4 parity — leave.

- **`words.watch_keywords/keywords`** `ChatsSection.tsx:94` — stored, `lib/notifications.ts:59` uses them to decide `Mention` vs `Message` notification, but no inline highlight in `chatFormat.ts` `censorText`-only rendering (`lib/rooms.tsx:233`). P1 to add highlight span.

- **`notifications.notification_popup_folder / queued_upload / tab_colors`** — `lib/notifications.ts:16` checks `window_title/tab_colors/popup_sound/file/wish/chatroom/private_mention` but never `folder/queued_upload`. Either emit from `transfer:queue`/`transfer:update` or remove toggles and note.

---

## ⚠️ Intentionally limited / omitted — no fix (correct)

- `server.passw` plaintext (`settings-mapping.md:310`, `README` forbids), `server.interface` browser-stored only (`NetworkSection.tsx:114` note, bridge `env INTERFACE`), tray `trayicon/startup_hidden`/window geometry `width/height/xposition/yposition/maximized`, `ui.filemanager`/`urls.protocols` shell execution (`UrlHandlersSection.tsx:15` stub), `afterfinish/afterfolder` shell, OS Now Playing `lastfm/librefm/listenbrainz` omitted intentionally (`NowPlayingSection.tsx:54` amber warning), colors/fonts `chatme/globalfont/tabmain` omitted per `DESIGN.md` + user request, `speech` deprecated `3.4.0`. `portrange/upnp` *not* omitted — `NetworkSection.tsx:84` + `portmapper.ts` correct.

---

## Implementation plan — what this branch will do (P0 + P1)

### Phase 0 — Sync bug (this PR)
- `apps/web/src/lib/config/sync.tsx:64` — add `chatrooms` + `userbrowse` + `plugins` to send loops; remove duplicate `share_filters` line `sync.tsx:83` (or keep conditional). Covers `issue #1, #5`.
- `apps/bridge/src/server.ts:985` — add handlers: `transfers.shared/buddyshared/trustedshared` → `session.shareDBInstance.setFolders()`, `plugins.enable` → `pluginManager.setGlobalEnable`, ensure `chatrooms/userbrowse` ack still.

### Phase 1 — P0 reconnect/host (this PR)
- `apps/web/src/lib/session.tsx:405` — gate auto-login on `auto_connect_startup` (sync read from `localStorage` or inject `useConfig`).
- `apps/web/src/components/LoginForm.tsx:16` + `apps/web/src/lib/session.tsx:362` — make server host/port from Settings the default for auto-login and new logins (when Advanced collapsed, use `settings.server.server`).
- `apps/bridge/src/session.ts:178` — add `setShares()` helper if needed for Shares sync (B).

### Phase 2 — P1 search gating (this PR)
- `apps/web/src/lib/config/sync.tsx:19` — add `searches {maxresults, max_displayed_results, search_results, private_search_results}` to `relevant` and forward as `config:update searches ...`.
- `apps/bridge/src/session.ts:412` — add fields `searchEnabled/privateSearchEnabled/maxResults/maxDisplayed` with setters, gate `FileSearch` dispatch (return early if `!searchEnabled`), respect `maxresults` when building response; also gate `private_search_results` in `getFoldersForPermission` choice.
- `apps/web/src/lib/search.tsx:95` — cap `search:result` handler to `settings.searches.max_displayed_results` (slice + “capped” reason) and stop after `maxresults` if desired. Bridge cache still 100-entry `searchCache` `server.ts:217`.

### Phase 3 — P1 polish (this PR, low-risk)
- Verify `words.replacewords` already wired both paths (`rooms.tsx:305`, `privateChat.tsx:150`) — no change.
- `apps/web/src/lib/notifications.ts:16` — add handling for `transfer:queue` → `notification_popup_queued_upload`, and `transfer:finished` folder vs file already via `notification_popup_folder/file` (reuse).
- Docs: update `docs/porting-status.md` Settings row + `compose.yaml` comment for `SHARED_DIRS` mount example.

### Out of scope (deferred)
- `words.watch_keywords` inline highlight in `chatFormat.ts` (P2).
- Daily rescan cron `shares.ts:307` `rescan_shares_daily/hour` timer (P2).
- Appearance per-key consumers (`usernamehotspots/style/reverse_file_paths/file_size_unit/header_bar/...`) — P2, each needs `chat/page.tsx` or list component wiring.
- i18n `ui.language` — needs `react-intl` + `LANGUAGES` 30+ list.

## Verification

```bash
bun test && bun run build
# manual
# 1. Toggle Show user list → localStorage nicotineHub.settings.chatrooms.user_list_visible flips, WS config:update {section:"chatrooms",key:"user_list_visible"} seen in bridge logs, bridge acks.
# 2. Toggle auto_connect_startup off → reload with creds in sessionStorage → stays idle (no auto-login).
# 3. Change Host to localhost:2242 in Settings → Log out → Log in (default) → uses new host (Bridge logs "connecting to localhost:2242").
# 4. Add Share folder Picks → bridge shares.rescanAsync → SharedFileList 5 shows folder.
# 5. Set max_displayed_results=10 → search "flac" with many hits → tab caps at 10 rows, status "capped".
# 6. Set search_results=false → peer search from another node → no FileSearchResponse 9 (bridge logs "search disabled").
```

## File pointers for reviewers

- Web sync: `apps/web/src/lib/config/sync.tsx:19`
- Bridge sync: `apps/bridge/src/server.ts:985`, `server.ts:1070`
- Session filters/hosts: `apps/bridge/src/session.ts:398`, `session.ts:425`, `session.ts:712`
- Shares DB: `apps/bridge/src/shares.ts:66`, `shares.ts:307`
- Login/session: `apps/web/src/components/LoginForm.tsx:16`, `apps/web/src/lib/session.tsx:405`
- Search: `apps/web/src/lib/search.tsx:95`, `apps/bridge/src/session.ts:191`
- Docs: `docs/settings-mapping.md`, `docs/settings-plan.md:111` (Phase H now done)

