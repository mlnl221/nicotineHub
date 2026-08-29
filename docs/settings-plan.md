# Settings — Full Phased Plan (missing tabs)

> Record of all missing Settings tabs and how they will be restored.
> Ground truth: `~/projects/nicotine-plus/pynicotine/config.py:156` (`defaults`), `pynicotine/gtkgui/dialogs/preferences.py:3764` (`page_ids` + page classes), `pynicotine/gtkgui/ui/settings/*.ui`, and `docs/settings-mapping.md`. Each phase below traces to one of those sources.

## Current state

`apps/web/src/app/settings/page.tsx:11` exposes 4 tabs (`network | appearance | searches | notifications`). `preferences.py:3764` defines 14 pages in order:

`network → user-interface → shares → downloads → uploads → searches → user-profile → chats → now-playing → logging → banned-users → ignored-users → url-handlers → plugins`

10 are still missing in the mobile client: **shares, downloads (settings), uploads, user profile, chats, now playing, logging, banned users, ignored users, url handlers, plugins**. Downloads exists as a route (`/downloads`) but not as a Settings tab.

`apps/web/src/lib/config/defaults.ts:68` is stubbed — only `server/ui/notifications/searches` exist. The rest (`transfers, userinfo, words, logging, privatechat, players, urls, plugins, ctcp`) are `TODO`.

## Conventions for all phases

- Follow `AGENTS.md` workflow: git worktree per phase, `bun test && bun run build` before PR, `gh pr create --fill`.
- Each new setting key added to `defaults.ts` must stay in sync with `docs/settings-mapping.md` and `pynicotine/config.py`.
- Desktop-only keys are omitted per `settings-mapping.md:310` (password, `portrange`/`upnp`, tray/window geometry, `filemanager`, `urls.protocols` handlers, OS now-playing backends, `afterfinish`/`afterfolder` shell commands).
- Browser constraints are surfaced in-app with a `StubNotice`-style callout rather than hiding tabs silently — see `docs/settings-mapping.md:123` for File System Access API, localStorage/IndexedDB, `mediaSession` notes.
- Controls live in `apps/web/src/components/settings/controls.tsx` — extend with `ListEditorControl`, `ColorControl` only when needed. Existing `ToggleControl`, `NumberControl`, `SelectControl`, `RadioGroupControl`, `TextFieldControl`, `SectionCard` cover most cases.

## Phase A — Config extension (prerequisite)

**Goal:** extend `apps/web/src/lib/config/defaults.ts:24` `Settings` + `defaults` to mirror the full `config.py:156` defaults for browser-relevant sections.

**Scope (browser-relevant + persisted locally):**

- `transfers` — `shared,buddyshared,trustedshared` (`[name,path][]`), `share_filters` (string[] default `[".*",".*\\","@eaDir\\","#recycle\\","#snapshot\\","desktop.ini","Thumbs.db"]`), `rescanonstartup,rescan_shares_daily,rescan_shares_hour,reveal_buddy_shares,reveal_trusted_shares`, `incompletedir,downloaddir,uploaddir`, `uploadbandwidth,use_upload_speed_limit,uploadlimit,uploadlimitalt,useupslots,uploadslots`, `use_download_speed_limit,downloadlimit,downloadlimitalt`, `fifoqueue,limitby,queuelimit,filelimit,friendsnolimits,preferfriends`, `groupdownloads,groupuploads,expand_downloads,expand_uploads,autoclear_downloads,autoclear_uploads,remotedownloads,uploadallowed,enablefilters,downloadfilters ([pattern,escaped][]), download_doubleclick,upload_doubleclick,usernamesubfolders,geoblock,geoblockcc,usecustomban,customban,usecustomgeoblock,customgeoblock` — omit `afterfinish/afterfolder`.
- `userinfo` — `descr,pic,picture_visible`.
- `words` — `tab,dropdown,characters,roomnames,buddies,roomusers,commands,keywords,censored,censorwords,replacewords,autoreplaced,watch_keywords`.
- `logging` — `privatechat,privatelogsdir,chatrooms,roomlogsdir,transfers,transferslogsdir,debug_file_output,debuglogsdir,log_timestamp,readroomlines,readprivatelines,rooms_timestamp,private_timestamp,logcollapsed,debug`.
- `privatechat` — `store`.
- `players` — `npplayer,npformat,npothercommand,npformatlist`.
- `notifications` already done; add `notification_tab_colors` (bool, desktop tab-color notification — keep for parity, maps to `notification_tab_colors=False` in `config.py:420`).
- `server` additions — `banlist,ignorelist,ipblocklist,ipignorelist` live in `server` section.
- `ui` additions — `spellcheck` (already implicit), plus any missing toggles needed by Chats.
- `plugins` — `enable` (omit `enabled` list — no desktop plugin system).
- `ctcp` — `enable`.
- `urls` — `protocols` kept only as empty stub if URL Handlers tab is shown; otherwise omit.
- Keep `server.passw,portrange,upnp,interface` omitted (security / no P2P inbound in MVP).

**Files:** `apps/web/src/lib/config/defaults.ts`, optional `types.ts`, `apps/web/src/lib/config/provider.tsx:16`, tests `apps/web/src/lib/config/merge.test.ts`.

**Verify:** `bun run build` typecheck, `bun test`.

## Phase B — Settings tab shell + stub sections

**Goal:** make every Nicotine+ preference page visible in the mobile Settings UI, even before its controls are fully wired, so navigation parity is restored.

**Scope:**

- Replace `apps/web/src/app/settings/page.tsx:11` `TabId` + `TABS:13` with the full ordered list, with icons: `network(dns), appearance(palette), shares(folder), downloads(download), uploads(upload), searches(search), user-profile(person), chats(chat), now-playing(music_note), logging(article), banned-users(block), ignored-users(person_off), url-handlers(link), plugins(extension)` — order matches `preferences.py:3764`. Keep `notifications` as its own tab or fold into UI per Nicotine+ `userinterface.ui` (which co-hosts notifications); keep separate for now and note in header.
- Tab bar: horizontal scroll, active state `bg-primary text-on-primary`, touch targets ≥44px, safe-area insets. Add hash routing (`?tab=shares` / `#shares`) so deep-links work from `Sidebar` and survive reload.
- Create `apps/web/src/components/settings/stub/` or 10 minimal section components (`SharesSection.tsx`, `DownloadsSection.tsx`, `UploadsSection.tsx`, `UserProfileSection.tsx`, `ChatsSection.tsx`, `NowPlayingSection.tsx`, `LoggingSection.tsx`, `BannedUsersSection.tsx`, `IgnoredUsersSection.tsx`, `UrlHandlersSection.tsx`, `PluginsSection.tsx`) each rendering a `SectionCard` with a short description + `StubNotice` explaining browser limitation + a single bound control as proof of wiring (e.g. Shares shows `share_filters` count, Uploads shows `uploadslots`, etc.). Wire at least one real setting per tab through `useConfig().setOption`.
- Isolated mode: hide `url-handlers` when `NEXT_PUBLIC_ISOLATED` is set, mirroring `preferences.py:3784`.

**Files:** `apps/web/src/app/settings/page.tsx`, 10 new `components/settings/*Section.tsx`, `components/StubNotice.tsx` reuse.

**Verify:** `bun test && bun run build`; Playwright open `/settings` and assert all tabs render, click each tab, confirm localStorage round-trip for one field per tab.

## Phase C — Transfers: Shares / Downloads / Uploads

**Goal:** fully wire the three transfer-related pages — the highest bridge dependency.

**Shares (`shares.ui`, `preferences.py:647`, `config.py:182`):**
- Folder list `TreeView` (`virtual_name,folder,accessible_to`) → `ListEditor` with Add/Edit/Remove dialogs: virtual name text + path text + permission `SelectControl(Public/Buddy/Trusted)` using `PermissionLevel` mapping. Persist to `transfers.shared|buddyshared|trustedshared`.
- Filters list (file vs folder via trailing `\` → `Applies to: Files/Folders`) with Add/Edit/Remove + Reset to defaults.
- Rescan: `ToggleControl(rescanonstartup,rescan_shares_daily)` + `SelectControl(rescan_shares_hour 0–23)` formatted via `toLocaleTimeString`. In browser this triggers a bridge `rescan` WS message, not a timer.
- Buddy share visibility: 4-way radio (`Only buddies / Everyone buddy shares / Everyone trusted / Everyone both`) mapping to `reveal_buddy_shares,reveal_trusted_shares` bools — show as `SelectControl`.

**Downloads (`downloads.ui`, `preferences.py:307`):**
- Speed limit radio `use_download_speed_limit (unlimited/primary/alternative)` + `NumberControl(downloadlimit=1000,downloadlimitalt=100)` with range per `.ui` adjustments.
- Filter list `downloadfilters` with regex toggle + validity icon (validate via `new RegExp("(" + pattern + ")")` — same as `preferences.py:526`).
- Dir inputs `downloaddir,incompletedir,uploaddir` as path text (browser note).
- `autoclear_downloads,remotedownloads,usernamesubfolders,enablefilters` toggles; `uploadallowed Select(0 No one/2 Buddies/3 Trusted)`; `download_doubleclick Select` (isolated mapping `preferences.py:347`); grouping selects `groupdownloads` etc. Omit `afterfinish/afterfolder`.

**Uploads (`uploads.ui`, `preferences.py:1128`):**
- Bandwidth `uploadbandwidth` slider, slot control `useupslots` radio + `uploadslots NumberControl(min 1)`, speed limit radio `use_upload_speed_limit` + limits, `fifoqueue Select(Round Robin/FIFO)`, `limitby Radio(limit by size/count)` + `queuelimit/filelimit`, `friendsnolimits,preferfriends` toggles, `groupuploads,expand_uploads` selects, `upload_doubleclick`, `autoclear_uploads`.

**Files:** the three `*Section.tsx` fleshed out, plus `controls.tsx` extensions (`ListEditorControl`).

## Phase D — User Profile + Chats + Now Playing

**User Profile (`userinfo.ui`, `preferences.py:1254`):**
- `TextAreaControl(descr)` (stored via `repr()`/`unescape` parity — keep raw string in browser, bridge handles translation), `FilePicker` for `pic` (`<input type=file accept=image/*>`) + preview + Remove button + `ToggleControl(picture_visible)`.

**Chats (`chats.ui`, `preferences.py:1734`, `config.py:249`):**
- Toggles `private_chatrooms,store,spellcheck,ctcp.enable,words.tab|dropdown|roomnames|buddies|roomusers|commands|watch_keywords|censorwords|replacewords`.
- Numbers `readroomlines,readprivatelines (≤10000)`, `characters (1–10)` (`settings-mapping.md:224`).
- Timestamps `rooms_timestamp,private_timestamp` text inputs + Reset + Python `strftime` format-codes help link (`https://docs.python.org/3/library/datetime.html#format-codes`).
- Three ListEditors: `keywords` (watch list), `censored` (patterns), `autoreplaced` (dict `pattern→replacement` two-column). Sub-tabs via inner `SectionCard` or segmented control for Mentions/Auto-Replace/Censor mirroring `preferences.py:1863`.

**Now Playing (`nowplaying.ui`, `preferences.py:3206`):**
- Radio `npplayer (lastfm/librefm/listenbrainz/mpris/other)` — hide `mpris` on non-Linux and `other` in isolated mode per `preferences.py:3226`; browser MVP shows `lastfm/librefm/listenbrainz` + legend, with note that `mpris/other` are desktop-only.
- Combobox `npformat` with editable entry + defaults `["$n","$n ($f)",…]` + custom history `npformatlist`, `TextField(npothercommand)` + token legend (`$n/$t/$a/$b/$l/$r/$c/$k/$y/$f/$p`).

## Phase E — Logging

**Logging (`log.ui`, `preferences.py:2743`, `config.py:272`):**
- Toggles `privatechat,chatrooms,transfers,debug_file_output` + `debug,logcollapsed` if surfaced.
- Folder paths `privatelogsdir|roomlogsdir|transferslogsdir|debuglogsdir` as disabled/text inputs with note “browser storage — no folder access; maps to IndexedDB/localStorage retention” (`settings-mapping.md:266`).
- `log_timestamp` text + Reset + format-codes link.

## Phase F — Banned Users / Ignored Users

**Banned (`ban.ui`, `preferences.py:1507`):**
- Two lists: `server.banlist (string[])` + `server.ipblocklist (dict ip→user)` with multiline Add dialogs (`*` wildcard allowed) and validation via IP regex + `core.network_filter.is_ip_address` parity, Remove actions.
- Toggles + fields `usecustomban|customban,geoblock|geoblockcc (country code uppercased), usecustomgeoblock|customgeoblock`.

**Ignored (`ignore.ui`, `preferences.py:1305`):**
- Same pattern as banned but two lists `ignorelist,ipignorelist` only, no messages.

## Phase G — URL Handlers / Plugins (desktop-only stubs)

**URL Handlers (`urlhandlers.ui`, `preferences.py:3001`):**
- Hidden in isolated mode (`preferences.py:3784`). Browser has no shell — render info card: “Browser handles URLs natively; protocol handlers not applicable” + show `ui.filemanager` as read-only note. Keep `urls.protocols` empty stub.

**Plugins (`plugin.ui`, `preferences.py:3414`):**
- No desktop plugin runtime. Show `ToggleControl(plugins.enable)` + empty state description; list area shows “No plugins in browser build” with link to Nicotine+ docs. Omit install/uninstall flows.

## Out-of-scope / intentionally omitted

- `server.passw` (plaintext — security, `README` forbids storing), `portrange/upnp/interface`, tray/startup_hidden/window geometry, `ui.filemanager` command, `urls.protocols` wiring, OS now-playing backends (MPRIS/Last.fm online), `afterfinish/afterfolder` shell commands, desktop plugins — all tracked in `docs/settings-mapping.md:310`.

##Sequencing / PR plan

1. **PR A+B together** (this worktree) — config + shell stubs. Restores navigation parity with minimal risk.
2. PR C — Transfers (Shares/Downloads/Uploads).
3. PR D — User Profile/Chats/Now Playing.
4. PR E — Logging.
5. PR F — Banned/Ignored.
6. PR G — URL Handlers/Plugins polish.
   Each PR: worktree → `bun test && bun run build` → `gh pr create --fill` → merge to `main`.

## Definition of Done (every phase)

1. Work done in a git worktree, never on `main` directly.
2. `bun test` and `bun run build` pass.
3. New/changed keys present in both `docs/settings-mapping.md` and `apps/web/src/lib/config/defaults.ts`.
4. Per-phase PR opened and merged.
5. Any correction appended to `mistakes.md` per `AGENTS.md`.
