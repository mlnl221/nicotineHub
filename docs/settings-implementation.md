# Settings Port — Implementation Phases

Phased plan to port the Nicotine+ settings system (see `docs/settings-mapping.md`) into the
`nicotine_mobile` web/mobile client. Follow `docs/workflow.md` for every phase: **git worktree
first**, verify with `bun test && bun run build`, open a PR, merge to `main`.

## Phase 0 — Persistent config layer

**Goal:** a client-side store that mirrors Nicotine+'s two-level `section → key → value` model
with defaults.

- Create `apps/web/src/lib/config/defaults.ts` — a typed, read-only `DEFAULTS` object copied
  from the `config.py` `defaults` dict (sections: `server`, `transfers`, `searches`, `ui`,
  `notifications`, `userinfo`, `words`, `logging`, `privatechat`, `players`, `urls`,
  `interests`, `plugins`, `ctcp`, `columns`, `userbrowse`, `chatrooms`, `statistics`).
- Create `apps/web/src/lib/config/types.ts` — TS types for the settings tree (section → key →
  value) so every key is typed.
- Create `apps/web/src/lib/config/store.ts` — a thin persistence wrapper:
  - `getSections()` / `getSection(key)` / `getOption(section,key)`
  - `setOption(section,key,value)` + `setSection(section,obj)` (batch save)
  - deep-merge saved state over `DEFAULTS` at read time (mirror `config.py` `_set_config`)
  - persist via `localStorage` under `nicotine.settings` (or swap to IndexedDB when payloads
    grow large, e.g. `words.autoreplaced`, logs).
  - a `subscribe`/event emit so UI can react to changes.
- Tests: `apps/web/src/lib/config/store.test.ts` verifying default merge and persistence.

**Verify:** `bun run build` (typecheck) + `bun test`.

**PR:** `feat/config-store`.

## Phase 1 — Settings UI shell

**Goal:** a mobile-first Alexandria-styled settings screen that maps the Nicotine+ page tabs to
a paged/navigable layout, and renders typed controls.

- Create `apps/web/src/app/settings/page.tsx` + `layout.tsx`-style nav entry (PWA route).
- Create `apps/web/src/components/settings/`:
  - `SettingsLayout.tsx` — page tabs mirroring `page_ids` (network, user-interface, shares,
    downloads, uploads, searches, user-profile, chats, now-playing, logging, banned-users,
    ignored-users). Omit/hide `url-handlers` and `plugins` initially (browser N/A).
  - `controls/` — reusable typed controls that bind to the store:
    - `ToggleControl.tsx` (bool)
    - `NumberControl.tsx` / `SliderControl.tsx` (int, honoring `min`/`max`/`step` from the
      Gtk adjustments)
    - `SelectControl.tsx` (enums)
    - `RadioGroupControl.tsx`
    - `TextFieldControl.tsx` / `TextAreaControl.tsx`
    - `ListEditorControl.tsx` (add/remove rows for keywords, patterns, usernames)
    - `ColorControl.tsx` (hex via `<input type="color">`, blank = default)
  - Each control is driven declaratively by the mapping in `docs/settings-mapping.md`.
- Themes/typography follow `docs/DESIGN.md` (No-Line rule, Noto Serif headlines, Inter body,
  Public Sans labels, surface tiers, glassmorphism menus).

**Verify:** `bun test && bun run build`.

**PR:** `feat/settings-shell`.

## Phase 2 — Network/connection settings

**Goal:** port the `Network` page subset that matters in the browser.

- Bind `server.server` (host:port) and `auto_connect_startup` to the bridge connection logic
  (`apps/web/src/lib/useLogin.ts` + bridge URL override layer).
- Route connection through the config store so auto-connect honors the stored server.
- Leave `portrange`/`upnp`/`passw` out (see mapping "browser-omitted settings").
- Add `autoaway`/`away` if the bridge surfaces user status later.

**Verify:** `bun test && bun run build`; manual: change server + auto-connect, reload, confirm
auto-connect uses stored values.

**PR:** `feat/settings-network`.

## Phase 3 — Searches settings

**Goal:** port `Search` page once the search feature lands (`feat/search-page`).

- Wire `searches.*` bindings (`maxresults`, `max_displayed_results`, `min_search_chars`,
  `enable_history`, `private_search_results`, `search_results`) into the search UI.
- Render the `defilter` structured form (include/exclude/size/bitrate/slots/country/type/
  length/public) as the filter form fields.

**Verify:** `bun test && bun run build`.

**PR:** `feat/settings-searches` (stacked after search feature).

## Phase 4 — Shares / Downloads / Uploads settings

**Goal:** port the three transfer-related pages as their features land.

- **Shares:** folder list via File System Access API (`showDirectoryPicker`) plus
  `share_filters` list editor; `rescan*` options become "rescan request" actions, not
  background timers. Document browser limitations in-app.
- **Downloads:** speed limit radios + `downloadlimit`/`downloadlimitalt`, `enablefilters` +
  `downloadfilters` list editor, `downloaddir`/`incompletedir` (as downloaded-location note),
  `autoclear_downloads`, `download_doubleclick` behavior, `usernamesubfolders`, grouping.
  Omit `afterfinish`/`afterfolder` shell commands.
- **Uploads:** `uploadbandwidth`, slot control, speed limit radios + limits, `fifoqueue`,
  `limitby` + `queuelimit`/`filelimit`, `friendsnolimits`, `preferfriends`, grouping.
  Maps to the bridge's future upload queueing design.

**Verify:** `bun test && bun run build`.

**PRs:** `feat/settings-shares`, `feat/settings-downloads`, `feat/settings-uploads`.

## Phase 5 — UI / theme / notifications settings

**Goal:** port the pure-client `User Interface` page (highest-value, no backend dependency).

- `dark_mode`, `language` (via `next-intl` or a lightweight i18n switch), `header_bar`,
  `reverse_file_paths`, `file_size_unit`, `usernamehotspots`, `usernamestyle`, `spellcheck`.
- Color controls for chat/list/status/tab colors (blank = default, reset button restores the
  `defaults` value — mirror `on_reset_color`).
- `modes_visible` toggle list + `modes_order` drag reorder for tab visibility.
- Notifications toggles → browser Notifications API + audible cues where allowed.
- Omit trayicon/startup_hidden/window geometry/fonts (desktop-only) per mapping.

**Verify:** `bun test && bun run build`; manual theme/language/notification check.

**PR:** `feat/settings-ui`.

## Phase 6 — Chats / Now Playing / Logging / Banned / Ignored

**Goal:** port remaining pages as their host features land.

- **Chats:** `words.*` completion + watch/censor/replace list editors, timestamps,
  `privatechat.store`, `server.private_chatrooms`, `ctcp.enable`, `ui.spellcheck`.
- **Now Playing:** keep `npformat` + token legend; integrate with `navigator.mediaSession`
  when a local playback source exists; omit desktop backends.
- **Logging:** log toggles + retention (client-side storage instead of folder paths),
  `log_timestamp` with the Python `strftime` format-code help link.
- **Banned / Ignored:** username + IP list editors and the ban/geo message toggles.

**Verify:** `bun test && bun run build`.

**PRs:** one per feature (chats, now-playing, logging, lists).

## Definition of Done (every phase)

1. Work done in a git worktree (never on `main` directly).
2. `bun test` and `bun run build` pass.
3. Per-phase PR opened with `--fill` and merged to `main`.
4. New/changed settings keys present in `docs/settings-mapping.md` and `config/defaults.ts`
   stay in sync.
5. Any correction → append to `mistakes.md` per `AGENTS.md`.

## Out-of-scope / deferred (tracked in `docs/settings-mapping.md`)

- Plaintext password storage, P2P port/UPnP, tray/window-state, file-manager commands, URL
  handlers, desktop plugins, OS now-playing backends, post-transfer shell commands.
