# Settings Port — Mapping from Nicotine+ to Web/Mobile

This document maps the Nicotine+ desktop settings system to the `nicotine_mobile` web/mobile
client. It is the authoritative reference for porting preferences. Every ported screen should
trace back to one of the 15 preference pages below.

Reference sources (local clone of `nicotine-plus`):

- `pynicotine/config.py` — all config `defaults` (section → key → value) and types
- `pynicotine/gtkgui/dialogs/preferences.py` — page classes, `page_ids` order, `options` dicts
  (widget ↔ setting), and `get_settings()` value conversion
- `pynicotine/gtkgui/ui/settings/*.ui` — per-page layout and boundary/step values

## Data model

Nicotine+ stores configuration as a **two-level dictionary**: `section` → `key` → value.

```
"sections": {
    "server":     { "portrange": (62904,62904), "auto_connect_startup": True, ... },
    "transfers":  { "downloaddir": "...", "uploadslots": 3, ... },
    "searches":   { "maxresults": 300, ... },
    ...
}
```

The browser port uses the same shape, merged over `defaults` (mirroring Nicotine+'s
`defaults` dict) at read time, and persisted client-side.

## Preferences pages and their config

Order follows `preferences.py` `page_ids`: network, user-interface, shares, downloads,
uploads, searches, user-profile, chats, now-playing, logging, banned-users, ignored-users,
url-handlers, plugins. (`url-handlers` is hidden in isolated mode.)

### 1. Network (`network.ui`) → section `server`

| Config key         | Default                     | Type                | Web/mobile component                              |
|--------------------|-----------------------------|---------------------|---------------------------------------------------|
| `server`           | `("server.slsknet.org",2242)` | host:port tuple    | Text field + port input                           |
| `login`            | `""`                        | string              | Text field (username)                             |
| `passw`            | `""`                        | string (plaintext)  | Password field — **omit in browser** (no store)   |
| `interface`        | `""`                        | string              | Text field (opt.)                                 |
| `autosearch`       | `[]`                        | list[string]        | List editor (future)                              |
| `autoreply`        | `""`                        | string              | Multi-line text                                   |
| `portrange`        | `(62904,62904)`             | (min,max) ints → single-ended `[port,port]` in `defaults.ts:207` | Number input **implemented** — Settings → Network «Listening port» (`NetworkSection.tsx:82`) persists to `DATA_DIR/listen_port` and triggers `SetWaitPort 2` + `PortMapper.setPort` + reconnect; compose maps `${LISTEN_PORT:-62904}:${LISTEN_PORT:-62904}` |
| `upnp`             | `True`                      | bool                | **Implemented** — Toggle `NetworkSection.tsx:109` → bridge `PortMapper` (NAT-PMP → UPnP fallback, lease 43200 / renew 7200) per `docs/architecture.md:57`; disable for manual forward |
| `auto_connect_startup` | `True`                  | bool                | Toggle                                            |
| `userlist`         | `[]`                        | list[string]        | List editor (future)                              |
| `banlist`          | `[]`                        | list[string]        | (see Banned Users page)                           |
| `ignorelist`       | `[]`                        | list[string]        | (see Ignored Users page)                          |
| `ipignorelist`     | `{}`                        | dict                | (see Ignored Users page)                          |
| `ipblocklist`      | `{}`                        | dict                | (see Banned Users page)                           |
| `autojoin`         | `[]`                        | list[string]        | List editor (future, rooms)                       |
| `autoaway`         | `15`                        | int (min 1, step 5, max 10000) | Number input                    |
| `away`             | `False`                     | bool                | Toggle (runtime, not persist dialog)              |
| `private_chatrooms`| `False`                     | bool                | (see Chats page — room invitations toggle)        |

### 2. User Interface (`userinterface.ui`) → sections `ui`, `notifications`

UI section:

| Config key          | Default          | Type              | Web/mobile component                       |
|---------------------|------------------|-------------------|--------------------------------------------|
| `dark_mode`         | `False`          | bool              | Toggle (theme)                             |
| `header_bar`        | `True`           | bool              | Toggle (widget style)                      |
| `language`          | `""`             | string (locale)   | Combobox (select)                          |
| `icontheme`         | `""`             | string            | **Omit** (system icons)                    |
| `chatme/chatcommand/chathilite/urlcolor/useronline/useraway/useroffline` | hex  | string (hex) | Color input (Gtk color button → native color input) |
| `chatremote/chatlocal/textbg/search/inputcolor` | `""` | string (hex) | Color input (empty = default)   |
| `tab_default/tab_hilite/tab_changed` | hex          | string (hex)      | Color input                            |
| `usernamehotspots`   | `True`           | bool              | Toggle                                     |
| `usernamestyle`      | `"bold"`         | string enum       | Select (bold/.../hyperlinks)               |
| `spellcheck`         | `True`           | bool              | Toggle (browser-native)                    |
| `exitdialog`         | `1`              | int enum          | Select — **reduced** (no desktop close)    |
| `tabmain/tabrooms/...tabsearch` | `"Top"` | string enum      | Select (tab position) — **omit/mobile**    |
| `globalfont/.../browserfont` | `""`   | string (font)     | Font picker (opt.)                         |
| `tabclosers`         | `True`           | bool              | Toggle (opt.)                              |
| `tab_select_previous`| `True`           | bool              | Toggle (opt.)                              |
| `last_tab_id`        | `""`             | string            | Runtime, not persisted via dialog          |
| `modes_visible`      | dict             | dict[page_id]bool | Toggle list (which tabs visible)           |
| `modes_order`        | list             | list[string]      | Draggable order (opt.)                     |
| `buddylistinchatrooms`| `"tab"`         | string enum       | Select (buddy list placement)              |
| `trayicon`           | `True`           | bool              | **Omit** (no desktop tray in browser)      |
| `startup_hidden`     | `False`          | bool              | **Omit** (no desktop window)               |
| `filemanager`        | `""`             | string            | **Omit** (desktop file manager)            |
| `speechenabled/speechprivate/speechrooms/speechcommand` | (deprecated) | — | **Omit** (removed in 3.4.0) |
| `width/height/xposition/yposition/maximized` | window geom | — | **Omit** (responsive web) |
| `reverse_file_paths` | `True`           | bool              | Toggle                                     |
| `file_size_unit`     | `""`             | string (`"B"`/`""`)| Toggle (exact sizes ↔ dynamic)             |

Notifications section (from same page):

| Config key                          | Default | Type | Web/mobile component        |
|-------------------------------------|---------|------|-----------------------------|
| `notification_window_title`         | `True`  | bool | Toggle (document title)     |
| `notification_tab_colors`           | `False` | bool | Toggle                      |
| `notification_popup_sound`          | `False` | bool | Toggle (audio)              |
| `notification_popup_file`           | `True`  | bool | Toggle                      |
| `notification_popup_folder`         | `True`  | bool | Toggle                      |
| `notification_popup_queued_upload`  | `True`  | bool | Toggle                      |
| `notification_popup_private_message`| `True`  | bool | Toggle      |
| `notification_popup_private_mention`| `True`  | bool | Toggle      |
| `notification_popup_chatroom`       | `False` | bool | Toggle      |
| `notification_popup_chatroom_mention`| `True` | bool | Toggle      |
| `notification_popup_wish`           | `True`  | bool | Toggle      |

### 3. Shares (`shares.ui`) → section `transfers`

| Config key           | Default               | Type               | Web/mobile component                       |
|----------------------|-----------------------|--------------------|--------------------------------------------|
| `shared`             | `[]`                  | list[(name,path)]  | Folder list (File System Access API)       |
| `buddyshared`        | `[]`                  | list[(name,path)]  | Folder list                                |
| `trustedshared`      | `[]`                  | list[(name,path)]  | Folder list                                |
| `share_filters`      | defaults (folder/file patterns) | list[string] | List editor                    |
| `rescanonstartup`    | `True`                | bool               | Toggle (may be N/A in web)                 |
| `rescan_shares_daily`| `True`                | bool               | Toggle (may be N/A in web)                 |
| `rescan_shares_hour` | `0`                   | int hour enum      | Select (hour)                              |
| `reveal_buddy_shares`| `False`               | bool               | Radio (via "Visible to" dialog)            |
| `reveal_trusted_shares`| `False`             | bool               | Radio                                  |
| `limitby` (shared-size limit applies to dir listing) | `True` | bool | Toggle (indirect) |

Note: In a browser, "sharing" a large local folder has platform constraints (File System
Access API requires user gesture; no continuous background rescan). The MVP port should treat
shares as out-of-band until P2P serving is designed.

### 4. Downloads (`downloads.ui`) → section `transfers`

| Config key            | Default              | Type          | Web/mobile component               |
|------------------------|----------------------|---------------|------------------------------------|
| `autoclear_downloads`  | `False`             | bool          | Toggle                             |
| `remotedownloads`      | `False`             | bool          | Toggle (accept sent files)         |
| `uploadallowed`        | `3`                 | int enum (0=None,2=Buddies,3=Trusted)| Select |
| `incompletedir`        | data/incomplete     | string (folder)| Path input (browser downloads dir) |
| `downloaddir`          | data/downloads      | string (folder)| Path input                        |
| `uploaddir`            | data/received       | string (folder)| Path input                        |
| `enablefilters`        | `False`             | bool          | Toggle                             |
| `downloadfilters`      | default list        | list[[pattern,escaped]] | Filter list editor        |
| `downloadlimit`        | `1000`              | int (KB/s)    | Number/slider                      |
| `downloadlimitalt`     | `100`               | int (KB/s)    | Number/slider                      |
| `use_download_speed_limit` | `"unlimited"`  | enum (primary/alternative/unlimited) | Radio |
| `usernamesubfolders`   | `False`             | bool          | Toggle                             |
| `afterfinish`          | `""`                | string (command)| **Omit** (desktop command)        |
| `afterfolder`          | `""`                | string (command)| **Omit** (desktop command)        |
| `download_doubleclick` | `6` (isolated)/`2`  | int enum      | Select (nothing/open/search/pause/remove/resume/browse) |
| `groupdownloads`       | `"folder_grouping"` | string enum   | Select (grouping mode)             |
| `expand_downloads`     | `"all"`             | string enum   | Select (expand state)              |
| `friendsnolimits`      | `False`             | bool          | (see Uploads — no buddy limits)    |
| `preferfriends`        | `False`             | bool          | (see Uploads — prioritize buddies) |
| `usecustomban/customban/usecustomgeoblock/customgeoblock/geoblock/geoblockcc` | | bool/string | (see Banned Users page) |

### 5. Uploads (`uploads.ui`) → section `transfers`

| Config key            | Default          | Type          | Web/mobile component               |
|------------------------|------------------|---------------|------------------------------------|
| `autoclear_uploads`    | `False`         | bool          | Toggle                             |
| `uploadbandwidth`      | `50`            | int (% of bandwidth)| Number/slider                 |
| `useupslots`           | `True`          | bool          | Radio (fixed slots ↔ auto)         |
| `uploadslots`          | `3`             | int (min 1)   | Number/slider                      |
| `uploadlimit`          | `1000`          | int (KB/s)    | Number/slider                      |
| `uploadlimitalt`       | `100`           | int (KB/s)    | Number/slider                      |
| `use_upload_speed_limit` | `"unlimited"` | enum          | Radio                              |
| `fifoqueue`            | `False`         | bool          | Toggle (queue type)                |
| `limitby`              | `True`          | bool          | Radio (limit by size ↔ count)      |
| `queuelimit`           | `10000`         | int (MB)      | Number/slider                      |
| `filelimit`            | `100`           | int (files)   | Number/slider                      |
| `friendsnolimits`      | `False`         | bool          | Toggle (no buddy limits)           |
| `preferfriends`        | `False`         | bool          | Toggle (prioritize buddies)        |
| `upload_doubleclick`   | `6`/`2`         | int enum      | Select                             |
| `groupuploads`         | `"folder_grouping"` | string enum | Select                          |
| `expand_uploads`       | `"all"`         | string enum   | Select (expand state)              |

### 6. Searches (`search.ui`) → section `searches`

| Config key              | Default       | Type            | Web/mobile component         |
|--------------------------|---------------|-----------------|------------------------------|
| `maxresults`             | `300`         | int             | Number input                 |
| `max_displayed_results`  | `2500`        | int (100–25000) | Number/slider               |
| `min_search_chars`       | `3`           | int (≤50)       | Number input                 |
| `enablefilters`          | `False`       | bool            | Toggle (default filters)     |
| `defilter`               | `[]`          | list[9]         | Structured filter form       |
| `filtercc`               | `[]`          | list[string]    | Filter history (runtime)     |
| `filterin/filterout/filtersize/filterbr/filtertype/filterlength` | `[]` | list | Filter history (runtime) |
| `filters_visible`        | `False`       | bool            | Toggle                    |
| `enable_history`         | `True`        | bool            | Toggle (search history)     |
| `history`                | `[]`          | list[string]    | History data                 |
| `search_results`         | `True`        | bool            | Toggle (respond to searches) |
| `private_search_results` | `False`       | bool            | Toggle                       |
| `expand_results`         | `"all"`       | string enum     | Select (expand state)        |
| `group_searches`         | `"folder_grouping"` | string enum | Select (grouping)         |

`defilter` list order (0-indexed): include, exclude, file size, bitrate, free slots (bool),
country, file type, length, public files (bool).

### 7. User Profile (`userinfo.ui`) → section `userinfo`

| Config key     | Default  | Type    | Web/mobile component            |
|----------------|----------|---------|---------------------------------|
| `descr`        | `"''"`   | string  | Multi-line text area            |
| `pic`          | `""`     | string  | **Omit/upload** (image input)   |
| `picture_visible` | `True` | bool  | Toggle                          |

### 8. Chats (`chats.ui`) → sections `server`, `logging`, `privatechat`, `words`, `ui`, `ctcp`

Top (server/chatroom/privatechat/logging):

| Config key          | Default | Type      | Web/mobile component   |
|---------------------|---------|-----------|------------------------|
| `server.private_chatrooms` | `False` | bool | Toggle (room invitations) |
| `logging.readroomlines`  | `200`  | int (≤10000) | Number input        |
| `logging.readprivatelines`| `200` | int (≤10000) | Number input        |
| `logging.rooms_timestamp`| `"%X"`| string (strftime) | Text input + format help |
| `logging.private_timestamp`|`"%x %X"`| string | Text input       |
| `privatechat.store`      | `True` | bool    | Toggle (reopen private chats) |

Words/Mentions (completion, watching, censoring, replacement):

| Config key          | Default          | Type          | Web/mobile component         |
|---------------------|------------------|---------------|------------------------------|
| `words.tab`         | `True`           | bool          | Toggle (tab completion)      |
| `words.dropdown`    | `False`          | bool          | Toggle (completion dropdown) |
| `words.characters`  | `3`              | int (1–10)    | Number input                 |
| `words.roomnames`   | `False`          | bool          | Toggle (complete room names) |
| `words.buddies`     | `True`           | bool          | Toggle (complete buddy names)|
| `words.roomusers`   | `True`           | bool          | Toggle (complete usernames)  |
| `words.commands`    | `True`           | bool          | Toggle (complete commands)   |
| `words.keywords`    | `[]`             | list[string]  | Keyword list editor          |
| `words.watch_keywords` | `False`       | bool          | Toggle (highlight mentions)  |
| `words.censored`    | `[]`             | list[string]  | Censor list editor           |
| `words.censorwords` | `False`          | bool          | Toggle (censor patterns)     |
| `words.autoreplaced`| defaults dict    | dict[from,to] | Replacement list editor      |
| `words.replacewords`| `False`          | bool          | Toggle (auto-replace)        |
| `ui.spellcheck`     | `True`           | bool          | Toggle (browser spellcheck)  |
| `ctcp.enable`       | `True`           | bool          | Toggle (client-to-client protocol) |

### 9. Now Playing (`nowplaying.ui`) → section `players`

| Config key     | Default  | Type       | Web/mobile component              |
|----------------|----------|------------|-----------------------------------|
| `npformat`     | `""`     | string     | Combobox + format tokens (`$n $t $a $b ...`) with help |
| `npothercommand` | `""`   | string     | Text input (custom command)     |
| `npplayer`      | `"mpris"`| string enum| Radio (lastfm/librefm/listenbrainz/mpris/other) |
| `npformatlist`  | `[]`    | list[string]| Saved custom formats            |

**Browser limitation:** MPRIS/Last.fm/Libre.fm/ListenBrainz are desktop/cloud integrations.
For the web client, keep the Now Playing *format* model (`npformat`) for when a soundtrack
source exists (e.g., `navigator.mediaSession`), but **omit** the desktop player-specific
backends initially.

### 10. Logging (`log.ui`) → section `logging`

| Config key          | Default             | Type          | Web/mobile component         |
|---------------------|---------------------|---------------|------------------------------|
| `logging.privatechat`| `True`             | bool          | Toggle (log private chats)   |
| `logging.privatelogsdir` | `.../logs/private` | folder string | Path input            |
| `logging.chatrooms` | `True`              | bool          | Toggle (log chatrooms)       |
| `logging.roomlogsdir`| `.../logs/rooms`   | folder string | Path input             |
| `logging.transfers` | `False`             | bool          | Toggle (log transfers)       |
| `logging.transferslogsdir` | `.../logs/transfers` | folder string | Path input        |
| `logging.debug_file_output` | `False`     | bool          | Toggle (debug to file)       |
| `logging.debuglogsdir` | `.../logs/debug` | folder string | Path input           |
| `logging.log_timestamp` | `"%x %X"`      | string        | Text input + format help     |
| `logging.debug`     | `False`             | bool          | Toggle (runtime debug)       |
| `logging.logcollapsed` | `True`           | bool          | Toggle (collapse)            |

Browser note: logs are client-side (localStorage/IndexedDB); "folder path" maps to a log
retention/storage toggle rather than a filesystem path.

### 11. Banned Users (`ban.ui`) → sections `server`, `transfers`

| Config key            | Default                 | Type        | Web/mobile component       |
|------------------------|-------------------------|-------------|----------------------------|
| `server.banlist`       | `[]`                    | list[string]| Username list editor       |
| `server.ipblocklist`   | `{}`                    | dict        | IP list editor             |
| `transfers.usecustomban`| `False`                | bool        | Toggle (custom ban msg)    |
| `transfers.customban`  | `"Banned, don't bother retrying"` | string | Text input    |
| `transfers.geoblock`   | `False`                 | bool        | Toggle (geo block)         |
| `transfers.geoblockcc` | `[""]`                  | list[string]| Country code input         |
| `transfers.usecustomgeoblock` | `False`           | bool        | Toggle                  |
| `transfers.customgeoblock` | `"Sorry, your country is blocked"` | string | Text input |

### 12. Ignored Users (`ignore.ui`) → section `server`

| Config key      | Default | Type        | Web/mobile component       |
|-----------------|---------|-------------|----------------------------|
| `server.ignorelist`  | `[]` | list[string] | Username list editor     |
| `server.ipignorelist`| `{}` | dict         | IP list editor           |

### 13. URL Handlers (`urlhandlers.ui`) → sections `urls`, `ui`

| Config key       | Default | Type         | Web/mobile component          |
|------------------|---------|--------------|-------------------------------|
| `urls.protocols` | `{}`    | dict[proto,handler] | **Omit** (browser handles URLs natively) |
| `ui.filemanager` | `""`    | string       | **Omit** (desktop file manager) |

### 14. Plugins (`plugin.ui`) → section `plugins`

| Config key | Default | Type          | Web/mobile component |
|------------|---------|---------------|----------------------|
| `plugins.enable` | `True` | bool     | Toggle               |
| `plugins.enabled`| `[]`   | list[string]| Plugin enable list — **Omit** (no desktop plugin system) |

## Cross-concern sections (not directly a preferences tab)

- `interests` (`likes`/`dislikes`) — ratings for Soulseek "interests" matching; surfaced in
  a user profile context, not the preferences dialog itself.
- `userbrowse` (`expand_folders`) — UI state for the browse view.
- `chatrooms` (`user_list_visible`), `statistics` — runtime/statistical, not preferences UI.

## Browser-omitted settings (no meaningful web equivalent)

- Plaintext password storage (`server.passw`) — security (README already forbids storing it).
- Raw `interface` bind (`server.interface`) — stored locally but no effect without raw socket bind in browser; bridge may read env `INTERFACE` if set.
- Tray icon / startup hidden / window geometry `width/height/xposition/yposition/maximized` — desktop-only.
- File manager command (`ui.filemanager`), URL protocol handler execution (`urls.protocols` — stored as `protocol=command` lines in `UrlHandlersSection.tsx` but not executed).
- OS-level Now Playing backends (MPRIS live capture, `other` shell) — `npformat` stored + `mediaSession` later; `speech` deprecated `3.4.0`.
- Desktop plugins shell (`plugins.enabled` list beyond `plugins.enable`) is replaced by TS `PluginManager` (`plugins.json`); post-transfer shell commands (`afterfinish`/`afterfolder`).
- **Colors/fonts/tab positions** (`chatme/.../tab_changed`, `globalfont/...`, `tabmain/...`) — intentional omit per `docs/DESIGN.md` Omitted Controls (2026-08-30 Phase A/B) to keep Alexandria editorial palette/typography.
- **Diagnostics docked pane** — stays routed `/diagnostics` vs MainWindow bottom pane; mobile uses separate route with scope/level filters, not docked log view.
- Note: `portrange`/`upnp` are **not** omitted — `LISTEN_PORT` 62904 is editable in Settings → Network (`NetworkSection.tsx:82`) via `server.portrange` + bridge `PortMapper` (`portmapper.ts` NAT-PMP → UPnP, see `docs/architecture.md`).

## Legend of future-proofing notes

- "List editor": row-based list with add/edit/remove (username, keyword, pattern, replacement).
- "Folder input": in a sandboxed browser, folder *selection* is gated by the File System
  Access API (user gesture) — elsewhere render an editable path/ID field.
- "Number/slider": use the Gtk `set_range`/`set_page`/`set_step` boundary values captured from
  the `.ui` files (e.g. `_speed_adjustment` max 1000000, `_max_displayed_results_adjustment`
  100–25000, `_auto_away_adjustment` up to 10000 step 5, `_min_chars_dropdown_adjustment` 1–10,
  `_recent_private_messages_adjustment` up to 10000, `_upload_slots_adjustment` min 1).
