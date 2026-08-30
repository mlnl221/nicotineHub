# Plugins

TS/JS-only plugin system — parity with `pynicotine/pluginsystem.py` (but **only TypeScript/JavaScript — Python `.py` and other languages are explicitly forbidden**).

## Overview

Plugins run on the **bridge** (`apps/bridge/src/plugins/`), not in the browser. The browser is a thin client over `ws://host:8787/ws`. This mirrors nicotine-plus where plugins run in the core process, not the GTK UI. Unlike nicotine-plus (`pynicotine/pluginsystem.py:473` installs any `__init__.py`), this bridge **only allows `.ts`/`.js` (`.mts`/`.mjs` too) — any `.py` or non-TS/JS is rejected**.

- `BasePlugin` (`apps/bridge/src/plugins/types.ts:14`) mirrors `pynicotine/pluginsystem.py:31` — `settings`/`metasettings`, `commands`, lifecycle, 40+ hook methods, `returncode.{break,zap,pass}`. **TS/JS-only.**
- `PluginManager` (`apps/bridge/src/plugins/manager.ts:126`) mirrors `PluginHandler` — discovery (`DATA_DIR/plugins` + builtins), `enable/disable/toggle/reload`, zip install (1 GiB cap + **TS/JS-only check**), persistence `DATA_DIR/plugins.json`, command registration, event chain with zap/break. Zip handling mirrors `pluginsystem.py:473` `install_plugin` but adds `isAllowedPluginFile` (only `.ts`/`.js`/`.json`/`.md`) and `validateTsJsContent` (no Python, must have `export class Plugin extends BasePlugin` + `from "../types.js"`).
- `spamfilter` (`plugins/builtin/spamfilter.ts`) is a full port of `pynicotine/plugins/spamfilter` demonstrating `returncode.zap` on `incoming_public_chat_event` / `incoming_private_chat_event`.
- `leech_detector` (`plugins/builtin/leech_detector.ts`) is a full port of `pynicotine/plugins/leech_detector` — `num_files`/`num_folders` thresholds, `detected_leechers` list, `upload_queued_notification`/`user_stats_notification`/`upload_finished_notification` with `REQUESTING_STATS→requesting_shares→pending_leecher` state machine + buddy exempt + `open_private_chat` toggle + `%files%`/`%folders%` placeholders.
- `core_commands` (`plugins/builtin/core_commands.ts`) provides `/help` and `/plugin <toggle|reload|info>` — minimal set. The full 30 nicotine-plus commands are not shipped because most are UI shortcuts already handled by the web (join, leave, search, etc.). The command system is generic; any plugin can add the remaining commands via `this.commands` (see `pynicotine/plugins/core_commands/__init__.py:25` for reference).

## Security — are plugins dangerous?

**Yes.** Like nicotine-plus, plugins have **unrestricted** Node access: they can `import("node:fs")`, `fetch(...)`, open sockets, etc. There is no VM or permission prompt — only `try/catch` around each hook (see `manager.ts:742`). The bridge runs as a single OS user (usually in Docker).

Mitigations:
- Only install trusted zips. The UI shows a warning (`PluginsSection.tsx: security notice`).
- Review code before installing — user plugins are plain JS/TS in `DATA_DIR/plugins/<name>/index.js`.
- HTTP `POST /plugins/install` and `WS plugin:install` / `plugin:installUrl` require `BRIDGE_TOKEN` if enabled.
- Future: `plugin.json` `"permissions": ["fs:read","net:fetch"]` gating + `Bun.Worker` per plugin + `vm` sandbox. Not in v1 — keep parity with nicotine-plus (which also has no sandbox).

If you need isolation now, run the bridge in Docker with a read-only root and a dedicated `bridge-data` volume — same advice as nicotine-plus portable mode.

## What you can do (parity)

All nicotine-plus hook names are supported as optional methods on `BasePlugin`:

- **Chat** `incoming/outgoing_private_chat_event(notification)`, `incoming/outgoing_public_chat_event(notification)`, `public_room_message_notification` — return `returncode.zap` to drop, `break` to consume, `pass` to continue, or `[modifiedArgs]` tuple to rewrite.
- **Search** `search_request_notification`, `distrib_search_notification`, `outgoing_global/room/buddy/user/wishlist_search_event`
- **Server/user** `server_connect/disconnect_notification`, `user_resolve/status/stats_notification`, `join/leave_chatroom_notification`, `user_join/leave_chatroom_notification`, `private_room_*` (8)
- **Transfers** `upload_queued/started/finished_notification`, `download_started/finished_notification`
- **Commands** `this.commands = { name: { aliases, description, group, parameters, disable, callback } }` — validated like `pluginsystem.py:993`, supports `callback_chatroom` etc, legacy `__publiccommands__/__privatecommands__` still works but warns.
- **Settings** `this.settings` + `this.metasettings` (`type: integer|bool|dropdown|radio|string|textview|list string|file`, with `minimum/maximum/options/group`) → auto-rendered in `PluginsSection.tsx` and persisted in `DATA_DIR/plugins.json`.
- **Helpers** `this.log`, `this.send_public(room,text)`, `this.send_private(user,text)`, `this.echo_public/private`, `this.output(text)`, plus `ResponseThrottle` (port of `pluginsystem.py:304`).

## Installing — only TS/JS (Python `.py` blocked) — mirrors `pynicotine/pluginsystem.py:473` but for TS/JS

**Requirements (strict, both zip and GitHub):**

| Requirement (nicotine-plus) | Bridge TS/JS mirror |
|---|---|
| Folder `<name>/` with `PLUGININFO` (`Name`/`Version`/`Description` via `literal_eval` `pluginsystem.py:870`) + `__init__.py` with `class Plugin(BasePlugin):` `pluginsystem.py:602` | Folder `<name>/` with `plugin.json` (or legacy `PLUGININFO`) containing `Name`/`Version`/`Description` (`manager.ts:67` `parsePluginInfo`) **and** `index.ts` **or** `index.js` (`.mts`/`.mjs` too) with `export class Plugin extends BasePlugin` + `from "../types.js"` (`manager.ts:544` `validateTsJsContent`). **Only `.ts`/`.js` allowed — `.py` and any non-TS/JS is rejected** (`manager.ts:504` `FORBIDDEN_EXTS`). `plugin.json` may be replaced by inline `export const manifest = {Name:"...", Version:"..."}` in the entry file (fallback per user request). |
| `install_plugin` checks: `=` in name blocked `pluginsystem.py:658`, builtin conflict `pluginsystem.py:501`, 1 GiB cap `pluginsystem.py:476` | Same plus `isAllowedPluginFile` (only `.ts`/`.js`/`.json`/`.md`/`.txt`/images allowed), `hasCode` check (at least one `.ts`/`.js`), and `validateTsJsContent` (Python markers `def ` + `pynicotine`, `print(`, `__init__.py`) via `manager.ts:531` `isPythonContent`). |

**From .zip (like nicotine-plus `Preferences → Plugins → Install…` but TS/JS-only):**
- Zip a folder containing `plugin.json` (or `PLUGININFO`) + `index.ts` **or** `index.js` (`.mts`/`.mjs` too) — **must be `.ts`/`.js`, `.py` is blocked**. Must export `export class Plugin extends BasePlugin {}` and `import { BasePlugin } from "../types.js"` (checked via `manager.ts:544`). Inline `export const manifest = {Name:"...", Version:"1.0"}` is allowed as fallback to `plugin.json` (per confirmed requirement).
- In Settings → Plugins → *From .zip* → choose file, or `curl -X POST --data-binary @myplugin.zip http://host:8787/plugins/install`.
- Zip layout handling matches `pluginsystem.py:514` — strips top prefix, 1 GiB limit, rejects `=` in name, refuses to overwrite builtins, **plus TS/JS-only** (`manager.ts:487` `isSafeZipEntry` + `isAllowedPluginFile` + zip-slip/symlink guards).

**Add from GitHub — single file (.ts/.js) (NEW):**
- Settings → Plugins → *Add from GitHub — single file (.ts/.js)* → paste raw GitHub URL: `https://raw.githubusercontent.com/user/repo/main/plugins/myplugin/index.ts` **or** `https://github.com/user/repo/blob/main/plugins/myplugin/index.ts` (auto-normalized to raw). **Only `.ts`/`.js` (`.mts`/`.mjs` too) — `.py` blocked.**
- Or `send {type:"plugin:installGithubTs", url}` over WS, or `curl -X POST -H "Content-Type: application/json" -d '{"githubTsUrl":"https://raw.githubusercontent.com/.../index.ts"}' http://host:8787/plugins/install`.
- Bridge `fetch`es single file (200 KB / 10 s, vs 20 MB zip) → `validateTsJsContent` (must be TS/JS, no Python, has `Plugin` class, imports `types.js`) → derives `pluginName` from sibling `plugin.json`/`PLUGININFO` fetched from same base URL **or** inline `export const manifest` **or** file basename → writes `DATA_DIR/plugins/<name>/index.ts` (or `.js`) + `plugin.json` → `manager.ts:958` `installFromGithubTs`.
- If sibling `plugin.json` missing and no inline `manifest`, a minimal `{Name: "<derived>", Version:"1.0"}` is created — still strict, but allows single-file gist installs.

**From URL — GitHub zip (legacy, still TS/JS-only):**
- Settings → *From URL — GitHub zip* → paste raw zip URL (e.g. `https://github.com/user/repo/archive/main.zip` or a release asset).
- Or `send {type:"plugin:installUrl", url}` over WS.
- Bridge `fetch`es to `DATA_DIR/plugins/.dl_*.zip` (20 MB / 10 s, GitHub allow-list `github.com`/`*.githubusercontent.com`, `https:` only, SSRF IP block `manager.ts:969`) then extracts via same TS/JS-only path. **Python `.py` inside zip is now rejected** (was previously just “failed to import”).

> **Only TS/JS:** Every entry in zip and every GitHub single file is checked: extension must be `.ts`/`.mts`/`.js`/`.mjs` (or data `.json`/`.md`/`.txt`/images), `.py`/`.pyc`/`.rb`/`.go`/etc are forbidden with error `Only TypeScript/JavaScript plugins allowed (.ts/.js) — Python (.py) is blocked`. Content is also checked for Python markers (`def `, `pynicotine`, `__init__.py`) and must pass `Bun.Transpiler` TS syntax + have `export class Plugin extends BasePlugin`.

**Toggling:** `plugin:toggle` / `plugin:reload` / `plugin:uninstall` over WS, or `/plugin toggle myplugin` in any chat input (handled by `core_commands` via `PluginManager.triggerChatroomCommand`).

## Authoring — TS/JS-only (mirrors `pluginsystem.py:31` `BasePlugin` + `plugins/spamfilter/__init__.py` but in TS/JS)

```ts
// myplugin/plugin.json  — required (or inline manifest below) — mirrors PLUGININFO Name/Version/Description
{ "Name": "My Plugin", "Version": "1.0", "Description": "Demo", "entry": "index.ts" }
// OR inline in index.ts: export const manifest = { Name: "My Plugin", Version: "1.0", Description: "Demo" };

// myplugin/index.ts  — only .ts/.js (.mts/.mjs) allowed, .py blocked — mirrors __init__.py class Plugin(BasePlugin)
import { BasePlugin, returncode } from "../types.js"; // must import from ../types.js (checked)

export const manifest = { Name: "My Plugin", Version: "1.0", Description: "Demo" }; // optional if plugin.json exists

export class Plugin extends BasePlugin {
  constructor() {
    super();
    this.settings = { greet: "hi" };
    this.metasettings = { greet: { description: "Greeting", type: "string" } };
    this.commands = {
      hello: {
        description: "Say hi",
        callback: (args, ctx) => { this.output(`hi ${args} from ${ctx.interface}`); return true; }
      }
    };
  }
  loaded_notification() { this.log(`loaded, greet=${this.settings.greet}`); }
  incoming_public_chat_event(room, user, line) {
    if (line.includes("spam")) return returncode.zap; // block
  }
}
```

- Built-ins live in `apps/bridge/src/plugins/builtin/` and are registered in `server.ts:133` (`pluginManager.registerBuiltin(...)`).
- User plugins live in `DATA_DIR/plugins/<name>/` and are loaded via dynamic `import()` (Bun can import TS/JS directly).
- `npm run dev` hot-reloads via `bun --watch`; run `curl -X POST http://localhost:8787/plugins/install ...` and then `plugin:reload` in UI.

## Protocol

- **WS inbound** `plugin:list` / `plugin:toggle` / `plugin:reload` / `plugin:uninstall` / `plugin:settings` / `plugin:resetSettings` / `plugin:install` (base64) / `plugin:installUrl` (zip) / `plugin:installGithubTs` (single .ts/.js, TS/JS-only, Python blocked, see `manager.ts:958` + `server.ts:153`) — `installGithubTs` normalizes `github.com/.../blob/...` → `raw.githubusercontent.com`, 200 KB / 10 s, checks `.ts`/`.js` + `export class Plugin` + `types.js` import + `Bun.Transpiler` syntax.
- **WS outbound** `plugin:list {plugins: PluginInfo[]}` / `plugin:installed` / `plugin:toggled` / `plugin:reloaded` / `plugin:uninstalled` / `plugin:output {plugin,text}`.
- **HTTP** `GET /plugins` (list) and `POST /plugins/install` (raw zip or JSON `{url}`/`{data:base64}`/`{githubTsUrl}` — `githubTsUrl` is `.ts`/`.js` single file, same checks).

## Do we need all 30 core_commands?

No. The bridge already exposes the underlying operations as typed WS messages (`search`, `chat:room join/say`, `browse`, `userinfo`, etc.). The 30 slash commands in `pynicotine/plugins/core_commands/__init__.py:25` are mostly thin wrappers (`/join`, `/leave`, `/msg`, `/search`, `/ban`, …) that make sense in a desktop text input. The web has dedicated UI for those (buttons, dialogs). Shipping only `/help` and `/plugin` is intentional — keeps parity of the *system*, not the command list. Any missing command can be added as a plugin without touching core (see `manager.ts:getCommandGroupsData` for `/help` parity).

## Intentionally NOT ported — `youtube_info`

`pynicotine/plugins/youtube_info/__init__.py` is **intentionally not ported** and will remain omitted:

- Requires a **YouTube Data v3 API key** (`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=…&key=…`) with external HTTP per chat line.
- Chat messages with `youtu.be`/`youtube.com/watch` are common; enriching them needs external `www.googleapis.com` fetch + quota + key management — not homelab-relevant.
- Bridge has no YouTube API integration; pasting links works without enrichment.
- If needed later, it can be added as a user plugin via the same `BasePlugin` API (`incoming_public/private_chat_event` + `fetch`) without core changes — no bridge HTTP allow-list needed beyond `BRIDGE_TOKEN` gate.

Other omitted plugins (`auto_buddy_rooms`, `auto_user_browse`, `multipaste`, `now_playing_*`, `anti_shout` beyond `spamfilter`, etc.) remain optional user plugins — only `spamfilter` and `leech_detector` are shipped as builtins (homelab-relevant).

## Language — English-only by design

The app is **English-only**. `pynicotine/config.py:ui.language` 30+ `po/` locales (`af,ar,ca,cs,da,de,…zh_CN`) are intentionally not ported (`docs/settings-mapping.md:310`, `docs/porting-status.md`). `UiSection.tsx` shows a fixed "English — app is English-only" note instead of a locale combobox. No i18n is planned.
