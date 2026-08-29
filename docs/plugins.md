# Plugins

TS-only plugin system — parity with `pynicotine/pluginsystem.py`.

## Overview

Plugins run on the **bridge** (`apps/bridge/src/plugins/`), not in the browser. The browser is a thin client over `ws://host:8787/ws`. This mirrors nicotine-plus where plugins run in the core process, not the GTK UI.

- `BasePlugin` (`apps/bridge/src/plugins/types.ts:14`) mirrors `pynicotine/pluginsystem.py:31` — `settings`/`metasettings`, `commands`, lifecycle, 40+ hook methods, `returncode.{break,zap,pass}`.
- `PluginManager` (`apps/bridge/src/plugins/manager.ts:126`) mirrors `PluginHandler` — discovery (`DATA_DIR/plugins` + builtins), `enable/disable/toggle/reload`, zip install (1 GiB cap), persistence `DATA_DIR/plugins.json`, command registration, event chain with zap/break.
- `spamfilter` (`plugins/builtin/spamfilter.ts`) is a full port of `pynicotine/plugins/spamfilter` demonstrating `returncode.zap` on `incoming_public_chat_event` / `incoming_private_chat_event`.
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

## Installing

**From .zip (like nicotine-plus `Preferences → Plugins → Install…`):**
- Zip a folder containing `plugin.json` (or `PLUGININFO`) + `index.js` (must export `export class Plugin extends BasePlugin {}`).
- In Settings → Plugins → *From .zip* → choose file, or `curl -X POST --data-binary @myplugin.zip http://host:8787/plugins/install`.
- Zip layout handling matches `pluginsystem.py:514` — strips top prefix, 1 GiB limit, rejects `=` in name, refuses to overwrite builtins.

**From URL (GitHub index):**
- Settings → *From URL* → paste raw zip URL (e.g. `https://github.com/user/repo/archive/main.zip` or a release asset).
- Or `send {type:"plugin:installUrl", url}` over WS.
- Bridge `fetch`es to `DATA_DIR/plugins/.dl_*.zip` then extracts same as zip path. No allow-list — you host the index (e.g. a GitHub repo with a `plugins.json` index is not yet implemented; v1 is just direct URLs).

**Toggling:** `plugin:toggle` / `plugin:reload` / `plugin:uninstall` over WS, or `/plugin toggle myplugin` in any chat input (handled by `core_commands` via `PluginManager.triggerChatroomCommand`).

## Authoring

```ts
// myplugin/plugin.json
{ "Name": "My Plugin", "Version": "1.0", "Description": "Demo", "entry": "index.js" }

// myplugin/index.js
import { BasePlugin, returncode } from "../types.js";

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

- **WS inbound** `plugin:list` / `plugin:toggle` / `plugin:reload` / `plugin:uninstall` / `plugin:settings` / `plugin:resetSettings` / `plugin:install` (base64) / `plugin:installUrl` (see `protocol.ts:552`).
- **WS outbound** `plugin:list {plugins: PluginInfo[]}` / `plugin:installed` / `plugin:toggled` / `plugin:reloaded` / `plugin:uninstalled` / `plugin:output {plugin,text}`.
- **HTTP** `GET /plugins` (list) and `POST /plugins/install` (raw zip or JSON `{url}`/`{data:base64}`).

## Do we need all 30 core_commands?

No. The bridge already exposes the underlying operations as typed WS messages (`search`, `chat:room join/say`, `browse`, `userinfo`, etc.). The 30 slash commands in `pynicotine/plugins/core_commands/__init__.py:25` are mostly thin wrappers (`/join`, `/leave`, `/msg`, `/search`, `/ban`, …) that make sense in a desktop text input. The web has dedicated UI for those (buttons, dialogs). Shipping only `/help` and `/plugin` is intentional — keeps parity of the *system*, not the command list. Any missing command can be added as a plugin without touching core (see `manager.ts:getCommandGroupsData` for `/help` parity).
