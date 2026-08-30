# Settings Audit — Completed

> Source: `apps/web/src/app/settings/page.tsx:27` (15 tabs), `apps/web/src/lib/config/defaults.ts:27` (13 sections), `apps/bridge/src/server.ts:984` (`config:update`), `apps/web/src/lib/config/sync.tsx:11` (`ConfigBridgeSync`).
> Ground truth: `~/projects/nicotine-plus/pynicotine/config.py:156` + `pynicotine/gtkgui/dialogs/preferences.py:3764` + `pynicotine/gtkgui/ui/settings/*.ui`.
> Mapping: `docs/settings-mapping.md`, `docs/settings-plan.md`, `docs/architecture.md`.
> **Status: 2026-08-30 — all P0/P1/P2 fixes shipped on `fix/settings-audit-p0p1` (PR #55). This doc is the closed audit.**

## Inventory after fixes (15 tabs, ~120 keys)

| Tab | Keys | Result |
|-----|------|--------|
| **Network** `NetworkSection.tsx` | `server.auto_connect_startup`, `server.server.host/port`, `portrange`, `upnp`, `interface`, `autoaway`, `autojoin/userlist/autosearch`, `autoreply` | ✅ Done — `auto_connect_startup` gates `session.tsx:405`, `host/port` authoritative via `LoginForm.tsx:16` + `session.tsx:361`, `portrange/upnp/autoaway/autojoin/reply` already wired, `interface` browser-stored (bridge `env INTERFACE`) as documented |
| **Appearance** `UiSection.tsx` | `dark_mode`, `language`, `usernamehotspots/usernamestyle`, `file_size_unit/reverse_file_paths/spellcheck/header_bar/tabclosers/tab_select_previous/buddylistinchatrooms/exitdialog`, `modes_visible/modes_order` | ✅ Done — `dark_mode`/`modes_*` already, plus `file_size_unit` (`lib/format.ts:3`), `usernamehotspots/style` + `watch_keywords` highlight (`lib/chatFormat.ts:49`), `spellcheck` on search/chat inputs, `tabclosers` hide `×`, `tab_select_previous` previous/next, `header_bar` hide `TopBar`, `exitdialog` `beforeunload` (`ExitDialogHandler.tsx`) |
| **Shares** `SharesSection.tsx` | `shared/buddyshared/trustedshared`, `share_filters`, `rescanonstartup/daily/hour`, `reveal_*` | ✅ Done — `shared/*` now syncs `sync.tsx:21` → `server.ts:1044` → `session.ts:505` `ShareDB.setCustomShares` (container-mounted paths, `SHARED_DIRS`), `share_filters`/`reveal_*` already, plus `rescanonstartup/daily/hour` cron `session.ts:521` (60s UTC check, `unref`) |
| **Downloads / Uploads** | 28 keys combined | ✅ Done — 11 + 14 already; `file_size_unit` now also affects `TransferCard` sizes |
| **Searches** `SearchesSection.tsx` | `maxresults`, `max_displayed_results`, `min_search_chars`, `search_results`, `private_search_results`, `enable_history/history`, `filters_visible`, `defilter`, `expand_results/group_searches` | ✅ Done — `min_search_chars/enable_history/defilter` already; plus `maxresults/max_displayed/search_results` now gate bridge `session.ts:490` `ShareDB.buildFileSearchResponse(..., maxResults)` and web `lib/search.tsx:95` capping; `group_searches/expand_results` already drive `ResultsList` |
| **User Profile** `UserProfileSection.tsx` | `descr/pic/picture_visible` | ✅ Done |
| **Chats** `ChatsSection.tsx` | `private_chatrooms`, `chatrooms.user_list_visible`, `privatechat.store`, `logging.read*`, `words.*`, `ui.spellcheck`, `ctcp` | ✅ Done — `user_list_visible`/`expand_folders` now sync `sync.tsx:69`, `replacewords`/`censorwords` already, plus `watch_keywords` highlight and tab prefs |
| **Now Playing** | 4 keys | ✅ Stored-only intentionally (`lastfm` not ported) |
| **Logging** | 12 keys | ✅ `log_timestamp` drives `DiagnosticsPage`; folder paths browser notes as documented |
| **Banned / Ignored** | 10 keys | ✅ Done |
| **URL Handlers** | 1 key | ✅ Intentionally stubbed (browser) |
| **Plugins** | 3 keys | ✅ Done — `plugins.enable` now syncs `sync.tsx:81` → `server.ts:1144` → `PluginManager.setGlobalEnable` |
| **Notifications** | 11 keys | ✅ Done — all 11 now drive `lib/notifications.ts:16` (`folder` + `queued_upload` via `transfer:queue` added) |

**Totals:** ~120 keys — **~85 wired ✅, ~35 intentionally limited/stubbed as documented in `settings-mapping.md:310`, 0 open bugs.**

## Fixes shipped (PR #55 `fix/settings-audit-p0p1`)

- `0eba35a` — **P0/P1**: sync `chatrooms/userbrowse/plugins/searches/shared` + duplicate removal; bridge `shared→ShareDB.setCustomShares`, `searchResults→setSearchConfig` gating `FileSearch 26/8/distrib 3` + `maxResults` slice, `plugins.enable→setGlobalEnable`; web `auto_connect_startup` gate `session.tsx:405`, `host/port` authoritative `LoginForm` + `session.login` merge, `max_displayed` cap `lib/search.tsx:95`, `transfer:queue` notify, `compose.yaml` `SHARED_DIRS` docs.
- `76e27a5` — **P2**: `transfers.rescan*` sync + `session.setRescanConfig` cron (`restartRescanTimer` 60s UTC, `login success` startup rescan); `ui.file_size_unit` exact vs humanized `lib/format.ts` + `BrowseView`/`TransferCard`; `usernamehotspots/style` + `watch_keywords` `<mark>` highlight (`lib/chatFormat.ts`); `spellCheck` on search/chat inputs; `tabclosers` hide `×`, `tab_select_previous` previous/next on close for search/browse/profile/privateChat; `header_bar` hide `TopBar`, `exitdialog` `beforeunload` via `ExitDialogHandler.tsx`.

## Intentionally not wired (correct, per `settings-mapping.md:310` + `DESIGN.md`)

- `server.passw` plaintext (security), `server.interface` raw bind (browser only, bridge `env INTERFACE` note), tray `trayicon/startup_hidden`/window geometry, `ui.filemanager`/`urls.protocols` shell, `afterfinish/afterfolder` shell, OS Now Playing `lastfm/librefm/listenbrainz` scrobblers (`lastfm` omitted per user request), colors/fonts `chatme/globalfont/tabmain` (Alexandria palette fixed), `buddylistinchatrooms` layout `tab/chatrooms/always` stored-only (Sidebar vs Chat refactor deferred), `reverse_file_paths` helper exists but BrowseView filename-first already satisfies mobile, `ui.language` English-only, `filters_visible` as user gesture (filter bar collapsible). Verified `bun test 98 pass` + `bun run build` web 17 routes / bridge 0.97 MB.

## Verification (manual)

```bash
bun test && bun run build
# 1. Appearance → Show file sizes exactly ON → Browse /data 12,345 B shows "12,345 B" not "12.1 KiB" (BrowseView + TransferCard)
# 2. Chats → Highlight keywords ON + keywords "pink" → room "pink floyd" shows amber <mark>
# 3. Transfers → Rescan daily ON, hour = current UTC hour → bridge logs "daily rescan triggered"
# 4. Appearance → Tab close buttons OFF → Search/Browse/Profile/PrivateChat hide ×
# 5. Appearance → Restore previous tab on close ON → close middle of 3 tabs → previous active
# 6. Network → Connect on startup OFF → reload with creds stays idle; Host changed in Settings → next login uses new host
# 7. Shares → Add virtualName=/data/Music (mounted) → bridge scans → SharedFileList shows folder
# 8. Searches → search_results OFF → peer search gets no FileSearchResponse 9
# 9. Appearance → On close Show confirmation → beforeunload prompt on refresh
```

## Pointers

- Web sync: `apps/web/src/lib/config/sync.tsx:19`
- Bridge sync: `apps/bridge/src/server.ts:1036`, `server.ts:1144`
- Session: `apps/bridge/src/session.ts:490` (`setSearchConfig`), `505` (`setShareRoots`), `521` (`setRescanConfig`), `712` (login)
- Shares: `apps/bridge/src/shares.ts:66`, `285` (`setCustomShares`)
- Login/session: `apps/web/src/components/LoginForm.tsx:16`, `apps/web/src/lib/session.tsx:405`
- Search: `apps/web/src/lib/search.tsx:95`
- Format/chat: `apps/web/src/lib/format.ts:3`, `lib/chatFormat.ts:49`
- Docs: `docs/settings-mapping.md`, `docs/settings-plan.md`
