# Settings — Full Phased Plan (status vs next)

> History + roadmap for the 14 Nicotine+ preference pages.
> Ground truth: `~/projects/nicotine-plus/pynicotine/config.py:156` (`defaults`), `pynicotine/gtkgui/dialogs/preferences.py:3764` (`page_ids` + page classes), `pynicotine/gtkgui/ui/settings/*.ui`, and `docs/settings-mapping.md`. Every setting below traces to one of those sources.

## Current state — `76e27a5` (`fix/settings-audit-p0p1` — PR #55, 2026-08-30)

`apps/web/src/app/settings/page.tsx:27` now exposes **15 tabs** (`network | appearance | shares | downloads | uploads | searches | user-profile | chats | now-playing | logging | banned-users | ignored-users | url-handlers | plugins | notifications`) in grouped nav (`TAB_GROUPS`) with `?tab=` + `#tab` deep-link (`page.tsx:82`). Order matches `preferences.py:3764` (`network → user-interface → shares → downloads → uploads → searches → user-profile → chats → now-playing → logging → banned-users → ignored-users → url-handlers → plugins`) plus `notifications` (co-hosted with UI in Nicotine+ `userinterface.ui`).

`apps/web/src/lib/config/defaults.ts:27` is **no longer stubbed** — full `Settings` type + `defaults` for `server, ui, notifications, searches, transfers, userinfo, words, logging, privatechat, players, urls, plugins, ctcp` (browser-relevant subset). `docs/settings-audit.md` audit closed — all P0/P1/P2 wired, 0 open bugs.

| Phase | Scope | Status | Code pointer |
|---|---|---|---|
| **A** Config extension | `defaults.ts` 13 sections (`transfers` `userinfo` `words` `logging` `privatechat` `players` `urls` `plugins` `ctcp`; `server` `banlist/ip*` `portrange/upnp`; `ui` additions) | ✅ Done | `apps/web/src/lib/config/defaults.ts:27` |
| **B** Tab shell + stubs | 14 pages + notifications visible, grouped nav, hash routing | ✅ Done | `apps/web/src/app/settings/page.tsx:44`, `components/settings/*Section.tsx` (16 files) |
| **C** Transfers | Shares / Downloads / Uploads — folder list, filters, rescan, bandwidth, queue, double-click, grouping | ✅ Done | `SharesSection.tsx:66`, `DownloadsSection.tsx:7`, `UploadsSection.tsx:7` |
| **D** Profile / Chats / NP | `userinfo` pic+descr publish, `words`/`logging`/`privatechat`/`ctcp`, `players` format | ✅ Done | `UserProfileSection.tsx:61`, `ChatsSection.tsx:7`, `NowPlayingSection.tsx:7` |
| **E** Logging | `log.ui` toggles + paths + `log_timestamp` + `debug/logcollapsed` | ✅ Done (browser paths are notes) | `LoggingSection.tsx:7` |
| **F** Banned / Ignored | `banlist/ipblocklist` + `geoblock`, `ignorelist/ipignorelist` | ✅ Done | `BannedUsersSection.tsx:7`, `IgnoredUsersSection.tsx:7` |
| **G** URL Handlers / Plugins | `urls.protocols` stub + bridge plugin install/toggle/reload | ✅ Done (intentional stub for URL Handlers) | `UrlHandlersSection.tsx:6`, `PluginsSection.tsx:20`, `apps/bridge/src/server.ts:153` |
| **H** Network extras | `server.interface` + list editors `autosearch/autojoin/userlist` + `autoreply` | ✅ Done (`feat/porting-parity` `a1b2c3d`) | `NetworkSection.tsx:45` — `interface` + `autoreply` + `autosearch/autojoin/userlist` wired, `session.ts:419` `handleAutoJoinAndWatch()` + `autoreply` |
| **I** Settings audit P0/P1/P2 | Sync `chatrooms/userbrowse/plugins/searches/shared` + duplicate fix; `auto_connect/host/port` gate; `shares→ShareDB.setCustomShares`; `search_results/maxResults` gating; `file_size_unit`/`usernamehotspots`/`spellcheck`/`tabclosers`/`tab_select_previous`/`header_bar`/`exitdialog`; `watch_keywords` highlight; `rescan` cron | ✅ Done (`fix/settings-audit-p0p1` `0eba35a` + `76e27a5`, PR #55) | `lib/config/sync.tsx:19`, `server.ts:1036`, `session.ts:490/505/521`, `lib/format.ts:3`, `lib/chatFormat.ts:49`, `SearchTabs.tsx:25` etc |
| **J** Appearance polish P2+ | `ui.buddylistinchatrooms` sidebar in Chat (`chatrooms`/`always` → buddies panel in `app/chat/page.tsx:392`), `ui.reverse_file_paths` full-path vs short-name swap in `TransferCard.tsx:99` + `BrowseView.tsx:392`, `ui.language` expanded to 5 locales (en/de/fr/es/pt + system) `UiSection.tsx:12` stored locally (English-only rendering, cosmetic) | ✅ Done (`fix/settings-audit-p0p1` `302aeca`→`HEAD`, PR #55) | `app/chat/page.tsx:392` (buddies panel), `TransferCard.tsx:99` (reverse), `BrowseView.tsx:392` (reverse), `UiSection.tsx:12` (languages) |
| **K** Search polish | `searches.filters_visible` default drives FilterBar (`SearchScreen.tsx:29` `useState` + `useEffect` sync) — filter bar collapsed vs expanded now respects Settings | ✅ Done (`fix/settings-audit-p0p1` `HEAD`, PR #55) | `SearchScreen.tsx:29` |
| **L** Language i18n | `ui.language` 5 locales (en/de/fr/es/pt + system) now actually switches UI via `lib/i18n.ts` `useI18n()` hook (`Sidebar`/`BottomNav` `t()` for nav labels, system fallback via `navigator.language`) — was stored cosmetic, now live; remaining screens stay English-only by design (30+ `po/` locales not fully ported) | ✅ Done (`fix/settings-audit-p0p1` `HEAD`, PR #55) | `lib/i18n.ts`, `Sidebar.tsx:24`, `BottomNav.tsx:6`, `UiSection.tsx:12` |
| **M** Polish | `private-chat` hotspot wiring (`app/private-chat/page.tsx:166` `usernameHotspotClass`), `searches.filters_visible` toggle persistence (`SearchScreen.tsx:158` `setOption`), dead `getUiSettings()` removal (`lib/chatFormat.ts`) | ✅ Done (`fix/settings-audit-p0p1` `HEAD`, PR #55) | `app/private-chat/page.tsx:166`, `SearchScreen.tsx:158`, `lib/chatFormat.ts` |
| **N** Window (PWA) | `ui.width/height/maximized` (800×600, -1/-1, `true`) now stored (`defaults.ts:252`) + Appearance → Window controls (`UiSection.tsx:121` `NumberControl` width/height + `ToggleControl` maximized) + `WindowGeometrySync.tsx` (PWA viewport resize → `ui.width/height/maximized` via 800ms debounce) — was desktop-only `width/height/xposition/yposition/maximized` omitted as responsive, now browser-mapped; `xposition/yposition` stay -1 (PWA centered) | ✅ Done (`fix/settings-audit-p0p1` `HEAD`, PR #55) | `defaults.ts:46/252`, `UiSection.tsx:121`, `WindowGeometrySync.tsx`, `layout.tsx:16` |

## Conventions for all phases

- Follow `AGENTS.md` workflow: git worktree per feature, `bun test && bun run build` before PR, `gh pr create --fill`.
- Each new setting key added to `defaults.ts` must stay in sync with `docs/settings-mapping.md` and `pynicotine/config.py`.
- Desktop-only keys are omitted per `docs/settings-mapping.md:310` (password, tray/window geometry, `filemanager`, `urls.protocols` handlers, OS now-playing backends, `afterfinish`/`afterfolder` shell commands, colors/fonts, `youtube_info` plugin, English-only i18n, MAX_SOCKETS adaptive — see `docs/DESIGN.md` Omitted Controls + `docs/plugins.md`). `portrange`/`upnp` are **not** omitted — `NetworkSection.tsx:82` + `portmapper.ts` now handle them; `interface` remains browser-stored only (no raw socket bind in browser).
- Browser constraints are surfaced in-app with a callout rather than hiding tabs silently — see `docs/settings-mapping.md:123` for File System Access API, localStorage/IndexedDB, `mediaSession` notes.
- Controls live in `apps/web/src/components/settings/controls.tsx` — available: `ToggleControl`, `NumberControl`, `SelectControl`, `RadioGroupControl`, `TextFieldControl`, `SectionCard`. Extend with `ListEditorControl`/`ColorControl` only when needed.

## Phase A — Config extension ✅ Done

**Was:** extend `apps/web/src/lib/config/defaults.ts:24` `Settings` + `defaults` to mirror full `config.py:156` browser-relevant defaults.

**Now:** done at `defaults.ts:27-391`:
- `transfers` — `shared/buddyshared/trustedshared` (`[name,path][]`), `share_filters`, `rescanonstartup/rescan_shares_daily/rescan_shares_hour/reveal_buddy_shares/reveal_trusted_shares`, `incompletedir/downloaddir/uploaddir`, `uploadbandwidth/use_upload_speed_limit/uploadlimit/uploadlimitalt/useupslots/uploadslots`, `use_download_speed_limit/downloadlimit/downloadlimitalt`, `fifoqueue/limitby/queuelimit/filelimit/friendsnolimits/preferfriends`, `group* / expand_* / autoclear_* / remotedownloads / uploadallowed / enablefilters / downloadfilters / *_doubleclick / usernamesubfolders / geoblock* / usecustom*` — omit `afterfinish/afterfolder`.
- `userinfo` — `descr/picture_visible` + `pic` (data URL).
- `words` — `tab/dropdown/characters/roomnames/buddies/roomusers/commands/keywords/censored/censorwords/replacewords/autoreplaced/watch_keywords`.
- `logging` — `privatechat/privatelogsdir/chatrooms/roomlogsdir/transfers/transferslogsdir/debug_file_output/debuglogsdir/log_timestamp/rooms_timestamp/private_timestamp/readroomlines/readprivatelines/logcollapsed/debug`.
- `privatechat` — `store`.
- `players` — `npplayer/npformat/npothercommand/npformatlist`.
- `notifications` — 11 keys incl. `notification_tab_colors`.
- `server` — `banlist/ignorelist/ipblocklist/ipignorelist/portrange/upnp` (added; `interface` deferred to H).
- `ui` — `spellcheck` + `modes_visible/modes_order` etc.
- `plugins` / `ctcp` / `urls.protocols` stub.

**Files:** `apps/web/src/lib/config/defaults.ts`, `lib/config/provider.tsx:16`.
**Verify:** `bun run build` typecheck, `bun test`.

## Phase B — Settings tab shell + stub sections ✅ Done

**Was:** make every Nicotine+ page visible, even before controls wired.

**Now:** `apps/web/src/app/settings/page.tsx:44` `TABS` with icons `dns/palette/folder/download/upload/search/person/chat/music_note/article/block/person_off/link/extension/notifications`, grouped via `TAB_GROUPS` (`Connection`, `Interface`, `Transfers`, `Search & Users`, `Chat & Playback`, `System`), deep-link `?tab=`/`#tab` (`page.tsx:82`). 16 section components in `components/settings/` each render `SectionCard` and at least one bound control via `useConfig().setOption`. Isolated mode hides `url-handlers` future (currently always shown; `preferences.py:3784` parity noted in `UrlHandlersSection.tsx`).

**Verify:** `bun test && bun run build`; Playwright `/settings` — all tabs render, localStorage round-trip per tab.

## Phase C — Transfers: Shares / Downloads / Uploads ✅ Done

**Shares (`shares.ui`, `preferences.py:647`, `config.py:182`) — `SharesSection.tsx:66`:**
- Folder list `virtual_name/folder/accessible_to` → Add/Edit/Remove dialogs with virtual-name sanitizing (`getNormalizedVirtualName`) + `PermissionLevel` mapping (`public/shared`, `buddy/buddyshared`, `trusted/trustedshared`). `showDirectoryPicker` → `webkitdirectory` → manual dialog fallback, `+` header button, advanced bulk `virtualName|/path` editor.
- Filters `share_filters` one-per-line with Reset to `defaults.transfers.share_filters`.
- Rescan: `ToggleControl(rescanonstartup,rescan_shares_daily)` + `SelectControl(rescan_shares_hour 0–23)` via deterministic `hourLabel` (UTC en-US).
- Visibility 4-way `SelectControl` (`none/buddy/trusted/both` → `reveal_buddy_shares/reveal_trusted_shares`).

**Downloads (`downloads.ui`, `preferences.py:307`) — `DownloadsSection.tsx:7`:**
- Speed radio `use_download_speed_limit` + `NumberControl(downloadlimit=1000, downloadlimitalt=100)` 1–1 000 000.
- Filter list `downloadfilters` (`pattern|escaped` lines) with regex validity check (`new RegExp("(" + pat + ")")` like `preferences.py:526`) + error banner.
- Dir inputs `downloaddir/incompletedir/uploaddir` as text + `autoclear_downloads/remotedownloads/usernamesubfolders/enablefilters` toggles; `uploadallowed` Select(0/2/3); `download_doubleclick`, `groupdownloads` etc. Omit `afterfinish/afterfolder`.

**Uploads (`uploads.ui`, `preferences.py:1128`) — `UploadsSection.tsx:7`:**
- `uploadbandwidth`%, `useupslots` toggle + `uploadslots` NumberControl(min 1), speed radio `use_upload_speed_limit` + limits, `fifoqueue` Select(Round Robin/FIFO), `limitby` Radio(size/count) + `queuelimit/filelimit`, `friendsnolimits/preferfriends`, `groupuploads/expand_uploads`, `upload_doubleclick`, `autoclear_uploads`.

## Phase D — User Profile + Chats + Now Playing ✅ Done

**User Profile (`userinfo.ui`, `preferences.py:1254`) — `UserProfileSection.tsx:61`:**
- `TextAreaControl(descr)` (`repr()`-ish `'...'` stored; UI strips quotes), `FilePicker` `<input type=file accept=image/*>` → WebP 512px `resizeToWebp` + preview + Remove, `ToggleControl(picture_visible)`. Auto-publishes via `userinfo: setProfile` (`send` debounced 800 ms, `extractBase64` guard 5 MB) when `useSession` connected.

**Chats (`chats.ui`, `preferences.py:1734`, `config.py:249`) — `ChatsSection.tsx:7`:**
- Toggles `private_chatrooms/store/spellcheck/ctcp.enable/words.tab|dropdown|roomnames|buddies|roomusers|commands|watch_keywords|censorwords|replacewords`.
- Numbers `readroomlines/readprivatelines` ≤10 000, `characters` 1–10.
- Timestamps `rooms_timestamp/private_timestamp` inputs + format-codes help link. Three ListEditors: `keywords`, `censored`, `autoreplaced` (`from=to` lines) via `TextFieldControl` multiline.

**Now Playing (`nowplaying.ui`, `preferences.py:3206`) — `NowPlayingSection.tsx:7`:**
- Radio `npplayer` 5 options (`mpris/lastfm/librefm/listenbrainz/other`) + token legend (`$n/$t/$a/$b/$l/$r/$c/$k/$y/$f/$p`), `TextField(npformat)` + defaults, `TextField(npothercommand)` + history `npformatlist` (one-per-line). `mpris/other` kept as stored-only (browser note referencing `mediaSession`).

## Phase E — Logging ✅ Done

**Logging (`log.ui`, `preferences.py:2743`, `config.py:272`) — `LoggingSection.tsx:7`:**
- Toggles `privatechat/chatrooms/transfers/debug_file_output` + `debug/logcollapsed`.
- Folder paths `privatelogsdir/roomlogsdir/transferslogsdir/debuglogsdir` as text inputs with “browser storage — no folder access” note (`settings-mapping.md:266`).
- `log_timestamp` text + format-codes link. Browser logs remain in `localStorage/IndexedDB`; `diagnostics.log` ring 500/2000 is separate (`DiagnosticsPage`).

## Phase F — Banned Users / Ignored Users ✅ Done

**Banned (`ban.ui`, `preferences.py:1507`) — `BannedUsersSection.tsx:7`:**
- `server.banlist` (string[] one-per-line) + `server.ipblocklist` (`ip | user` dict) with `isIpLike` wildcard `*` validation (`is_ip_address` parity), Remove via empty-line filtering.
- `usecustomban/customban, geoblock/geoblockcc` (single CC `toUpperCase`, stored as `[cc]` array) + `usecustomgeoblock/customgeoblock`.

**Ignored (`ignore.ui`, `preferences.py:1305`) — `IgnoredUsersSection.tsx:7`:**
- `ignorelist/ipignorelist` only, same `isIpLike` pattern.

## Phase G — URL Handlers / Plugins ✅ Done

**URL Handlers (`urlhandlers.ui`, `preferences.py:3001`) — `UrlHandlersSection.tsx:6`:**
- Hidden in isolated mode in Nicotine+ (`preferences.py:3784`); browser renders info card “Browser handles URLs natively” + editable `urls.protocols` (`protocol=command` lines) as local stub + `ui.filemanager` note. No shell execution.

**Plugins (`plugin.ui`, `preferences.py:3414`) — `PluginsSection.tsx:20`:**
- `ToggleControl(plugins.enable)` + install via `.zip` (base64 → `plugin:install`) or GitHub URL (`plugin:installUrl`), list `plugin:list` with `enabled/isInternal/metasettings/settings`, toggle/reload/uninstall, `metasettings` → type-aware editors (`bool/integer/float/dropdown/textview/list string`). Bridge: `PluginManager` `plugins.json` + builtins `spamfilter` + `core_commands` 32 cmds (`PluginManager` `zod` WS, `DATA_DIR/plugins`). Caps: 20 MB zip, GitHub-only URL (SSRF), 1 GiB unzip.

## Phase H — Network extras ✅ Done (`feat/porting-parity` `a1b2c3d`)

**Goal:** finish `Network (network.ui)` → `server` parity. Only remaining gap from Phases A–G.

**Was:** `server.interface`/`autoreply`/`autosearch`/`userlist`/`autojoin` missing; `NetworkSection.tsx` only `server/portrange/upnp/autoaway`.

**Now:** `defaults.ts:28` extended with `interface:string`, `autoreply:string`, `autosearch:string[]`, `autojoin:string[]`, `userlist:string[]` + `chatrooms.user_list_visible` + `userbrowse.expand_folders` (mirrors `config.py:156` + `chatrooms`/`userbrowse` sections). `NetworkSection.tsx:45` now has `interface` text field (note browser-stored only, bridge `env INTERFACE`), `autoreply` multiline, three multiline list editors for `autojoin/userlist/autosearch` (one-per-line, like `BannedUsersSection`), plus `autoaway` already present. `ConfigBridgeSync` & `server.ts:984` forward all 5 keys to bridge; bridge `session.ts:419-436` stores them and on login runs `handleAutoJoinAndWatch()` (auto-join rooms, watch userlist, run autosearch 20 terms) + `autoreply` via `maybeAutoreply()` when `away` + `autoaway` timer (`SetStatus 28`) every 60s (nicotine `autoaway 15 → SetStatus 28` parity).

**Files:** `apps/web/src/lib/config/defaults.ts`, `components/settings/NetworkSection.tsx`, `lib/config/sync.tsx`, `apps/bridge/src/server.ts:984`, `apps/bridge/src/session.ts:419-436, 653, 2088`.

**Verify:** `bun test && bun run build`; manual: add `autosearch` entry → persists to `localStorage nicotineHub.settings` → survives reload; `autojoin` rooms joined after login; `autoreply` sent when away.

## Out-of-scope / intentionally omitted

- `server.passw` (plaintext — security, `README` forbids storing), tray/`startup_hidden`/`xposition/yposition` (desktop position, PWA centered as -1), `ui.filemanager` command, `urls.protocols` wiring/execution, **Now Playing `lastfm/librefm/listenbrainz` scrobblers** (`ws.audioscrobbler.com` polling — intentionally omitted per user request; `npformat`+`mediaSession` kept, `mpris/other` stored-only), **global font pickers** `globalfont/...` (Alexandria `Noto Serif/Inter/Public Sans` fixed per `docs/DESIGN.md` + user request: no global font changes), window `width/height/maximized` now done via `WindowGeometrySync.tsx` (PWA viewport), `xposition/yposition` stay -1; OS `MPRIS` live capture/speech beyond stored format, `afterfinish`/`afterfolder` shell commands, desktop plugins beyond TS `PluginManager` — **`youtube_info` intentionally not ported** (`www.googleapis.com` + API key, not homelab; see `docs/plugins.md`); `leech_detector` *is* ported. All tracked in `docs/settings-mapping.md:310`.
- **Colors/fonts/tab positions** (`chatme/.../tab_changed`, `globalfont/...`, `tabmain/...`) — intentional omit per `docs/DESIGN.md` Omitted Controls (2026-08-30 Phase A/B) + user request to keep editorial palette/typography.
- **Language — English-only** — 30+ `po/` locales intentionally not ported; app is English-only by design (`UiSection.tsx` fixed note).
- **MAX_SOCKETS adaptive** — fixed `512` homelab-sufficient, not `ulimit` adaptive (intentional).
- **Diagnostics docked pane** — stays routed `/diagnostics` vs MainWindow bottom pane; mobile uses separate route with scope/level filters.

## Sequencing / PR plan (actual history)

1. **PR A+B together** — config + shell stubs. ✅ Merged (covers `NetworkSection`/`UiSection`/`SearchesSection`/`NotificationsSection` + 10 stubs).
2. PR C — Transfers (Shares/Downloads/Uploads). ✅ Merged.
3. PR D — User Profile/Chats/Now Playing. ✅ Merged.
4. PR E — Logging. ✅ Merged.
5. PR F — Banned/Ignored. ✅ Merged.
6. PR G — URL Handlers/Plugins polish. ✅ Merged (plugins live on bridge, URL handlers as parity stub).
7. **PR H — Network extras** (`interface/autosearch/autojoin/userlist/autoreply`) — ✅ Done in `feat/porting-parity` (`a1b2c3d`) together with Shares privacy + Search/Browse + Chat/PrivateChat + Interests/Profiles/Diagnostics/Stats/Plugins/NowPlaying polish (all P0+P1+P2 gaps closed).
8. **PR I — Settings audit P0/P1/P2** (`fix/settings-audit-p0p1` PR #55 `76e27a5`) — ✅ Done — sync `chatrooms/userbrowse/plugins/searches/shared` + duplicate fix; `auto_connect/host/port` gate; `shares→ShareDB.setCustomShares`; `search_results/maxResults` gating; `file_size_unit`/`usernamehotspots`/`spellcheck`/`tabclosers`/`tab_select_previous`/`header_bar`/`exitdialog`; `watch_keywords` highlight; `rescan` cron.

> **Previous `feat/porting-parity` closes the full porting-status audit:** Shares `PermissionLevel` leak fixed (`shares.ts:384` split PUBLIC/BUDDY/TRUSTED + `reveal_*` gating + `virtual2real` + `check_shares_available` + async `music-metadata` rescan), Search `RoomSearch` scoped validation + `country` eager via `GetPeerAddress` batch + `user_grouping` `partial` + `FilterHelp` popover `preferences.py:2903` + `Wishlist` auto-tab for `WishlistInterval 104`, Browse `expand_folders` + multi-folder note + `slsk://` copy, Chat `RoomTicker` global wall + `user_list_visible` toggle + `Completion` `Tab/dropdown` `words.tab` + private `autoreply/autoaway` + CTCP 1s throttle + offline queue + typing `TYPING` + `MessageAcked` ordering, Buddies `flag_XX` emoji, Interests expiry 12m + wishlist tie-in + label split, Profiles `slotsFull` grey + `UserInterests 57` self sync + `SimilarUsers` shortcut, Diagnostics `log_timestamp` strftime + `readroomlines` truncate + `logcollapsed` grouping, Statistics humanized `fmtSince`, Plugins `metasettings` grouped cards, Now Playing `Test` preview + `mpris/other` stored-only (`lastfm` omitted), `MAX_SOCKETS` env-aware. Each: worktree → `bun test && bun run build` → `gh pr create --fill` → merge to `stage`.

## Definition of Done (every phase)

1. Work done in a git worktree, never on `main` directly.
2. `bun test` and `bun run build` pass.
3. New/changed keys present in both `docs/settings-mapping.md` and `apps/web/src/lib/config/defaults.ts`.
4. Per-phase PR opened and merged.
5. Any correction appended to `mistakes.md` per `AGENTS.md`.
