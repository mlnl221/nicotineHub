// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/plugins/core_commands/__init__.py

/**
 * Minimal core_commands plugin — TS port of pynicotine/plugins/core_commands/__init__.py
 * Only implements /help and /plugin for now. More commands can be added as plugins.
 */

import { BasePlugin } from "../types.ts";

export const manifest = {
  Name: "Core Commands",
  Version: "1.0",
  Authors: ["Nicotine+"],
  Description: "Core chat commands (help, plugin management)",
  apiVersion: 1,
  entry: "core_commands.ts",
};

export class Plugin extends BasePlugin {
  constructor() {
    super();
    this.commands = {
      help: {
        aliases: ["?"],
        description: "List available commands",
        parameters: ["[query]"],
        callback: this.helpCommand.bind(this),
      },
      plugin: {
        description: "Manage plugins",
        parameters: ["<toggle|reload|info>", "<plugin name>"],
        callback: this.pluginCommand.bind(this),
      },
      // Chat
      clear: { aliases: ["cl"], description: "Clear chat window", group: "Chat", disable: ["cli"], callback: () => { return false; } },
      me: {
        description: "Say in third-person",
        group: "Chat",
        parameters: ["<message>"],
        callback: (args, ctx) => {
          const text = `* ${args}`;
          if (ctx.interface === "chatroom" && ctx.room) this.send_public(ctx.room, text);
          else if (ctx.interface === "private_chat" && ctx.user) this.send_private(ctx.user, text);
          else this.output(text);
          return true;
        },
      },
      now: {
        description: "Announce now playing (mediaSession)",
        group: "Chat",
        disable: ["cli"],
        callback: () => {
          try {
            const title = (navigator as unknown as { mediaSession?: { metadata?: { title?: string; artist?: string } } })?.mediaSession?.metadata?.title || "Unknown";
            const artist = (navigator as unknown as { mediaSession?: { metadata?: { artist?: string } } })?.mediaSession?.metadata?.artist || "";
            const out = artist ? `${artist} - ${title}` : title;
            this.send_message(out);
          } catch { this.output("No media playing"); }
          return true;
        },
      },
      // ChatRooms
      join: {
        aliases: ["j"],
        description: "Join chat room",
        group: "Chat Rooms",
        parameters: ["<room>"],
        callback: (args) => { if (args) this.output(`Join /join ${args} — use the Chat Rooms UI or type /join ${args}`); else this.output("Usage: /join <room>"); return true; },
      },
      leave: {
        aliases: ["l"],
        description: "Leave chat room",
        group: "Chat Rooms",
        parameters: ["[room]"],
        callback: (args, ctx) => { this.output(args ? `Leave ${args}` : `Leave ${ctx.room || "current room"}`); return true; },
      },
      say: {
        description: "Say in room",
        group: "Chat Rooms",
        parameters: ["<room>", "<message>"],
        callback: (args) => {
          const [room, ...rest] = args.split(/\s+/);
          const msg = rest.join(" ");
          if (!room || !msg) { this.output("Usage: /say <room> <message>"); return true; }
          this.send_public(room, msg); return true;
        },
      },
      // Private chat
      pm: {
        description: "Open private chat",
        group: "Private Chat",
        parameters: ["<user>"],
        callback: (args) => { if (args) this.output(`Open PM with ${args} — switch to Private Chat and start conversation.`); else this.output("Usage: /pm <user>"); return true; },
      },
      close: {
        aliases: ["c"],
        description: "Close private chat",
        group: "Private Chat",
        parameters: ["[user]"],
        callback: (args, ctx) => { this.output(`Close ${args || ctx.user || "chat"}`); return true; },
      },
      msg: {
        aliases: ["m"],
        description: "Send private message",
        group: "Private Chat",
        parameters: ["<user>", "<message>"],
        callback: (args) => {
          const [user, ...rest] = args.split(/\s+/);
          const msg = rest.join(" ");
          if (!user || !msg) { this.output("Usage: /msg <user> <message>"); return true; }
          this.send_private(user, msg); return true;
        },
      },
      ctcp: {
        description: "Request client info (CTCP)",
        group: "Chat",
        parameters: ["<user>", "<query>"],
        callback: (args) => { this.output(`CTCP ${args} — not yet supported over bridge`); return true; },
      },
      // Users
      add: {
        aliases: ["buddy"],
        description: "Add buddy",
        group: "Users",
        parameters: ["<user>"],
        callback: (args) => { if (args) this.output(`Add buddy ${args} — use Buddies page.`); else this.output("Usage: /add <user>"); return true; },
      },
      rem: {
        aliases: ["unbuddy"],
        description: "Remove buddy",
        group: "Users",
        parameters: ["<user>"],
        callback: (args) => { this.output(`Remove buddy ${args}`); return true; },
      },
      browse: {
        aliases: ["b"],
        description: "Browse files",
        group: "Users",
        parameters: ["<user>"],
        callback: (args) => { if (args) this.output(`Browse ${args} — open /browse?user=${args}`); else this.output("Usage: /browse <user>"); return true; },
      },
      whois: {
        aliases: ["info", "w"],
        description: "Show user info",
        group: "Users",
        parameters: ["<user>"],
        callback: (args) => { if (args) this.output(`Whois ${args} — open /profile/${args}`); else this.output("Usage: /whois <user>"); return true; },
      },
      // Network filters
      ip: {
        description: "Show IP",
        group: "Network Filters",
        parameters: ["<user or ip>"],
        callback: (args) => { this.output(`IP ${args} — ask server for peer address via /whois`); return true; },
      },
      ban: {
        description: "Block user/IP",
        group: "Network Filters",
        parameters: ["<user or ip>"],
        callback: (args) => { this.output(`Ban ${args} — use Banned Users in Settings.`); return true; },
      },
      unban: {
        description: "Unblock",
        group: "Network Filters",
        parameters: ["<user or ip>"],
        callback: (args) => { this.output(`Unban ${args}`); return true; },
      },
      ignore: {
        description: "Silence user/IP",
        group: "Network Filters",
        parameters: ["<user or ip>"],
        callback: (args) => { this.output(`Ignore ${args}`); return true; },
      },
      unignore: {
        description: "Unsilence",
        group: "Network Filters",
        parameters: ["<user or ip>"],
        callback: (args) => { this.output(`Unignore ${args}`); return true; },
      },
      // Shares
      share: {
        description: "Add share",
        group: "Shares",
        parameters: ["<public|buddy|trusted>", "<folder path>"],
        callback: (args) => { this.output(`Share ${args} — use Shares in Settings.`); return true; },
      },
      unshare: {
        description: "Remove share",
        group: "Shares",
        parameters: ["<virtual name or folder path>"],
        callback: (args) => { this.output(`Unshare ${args}`); return true; },
      },
      shares: {
        aliases: ["ls"],
        description: "List shares",
        group: "Shares",
        parameters: ["[public|buddy|trusted]"],
        callback: () => { this.output("Shares — use Shares in Settings or Diagnostics."); return true; },
      },
      rescan: {
        description: "Rescan shares",
        group: "Shares",
        parameters: ["[force|rebuild]"],
        callback: () => { this.output("Rescan triggered — use Shares > Rescan."); return true; },
      },
      // Search files
      search: {
        aliases: ["s"],
        description: "Start global search",
        group: "Search Files",
        parameters: ["<query>"],
        callback: (args) => { if (args) this.output(`Search ${args} — use Search page.`); else this.output("Usage: /search <query>"); return true; },
      },
      rsearch: {
        aliases: ["rs"],
        description: "Search joined rooms",
        group: "Search Files",
        parameters: ["<query>"],
        callback: (args) => { this.output(`Room search ${args}`); return true; },
      },
      bsearch: {
        aliases: ["bs"],
        description: "Search buddies",
        group: "Search Files",
        parameters: ["<query>"],
        callback: (args) => { this.output(`Buddy search ${args}`); return true; },
      },
      usearch: {
        aliases: ["us"],
        description: "Search user",
        group: "Search Files",
        parameters: ["<user>", "<query>"],
        callback: (args) => { this.output(`User search ${args}`); return true; },
      },
      // App
      connect: { description: "Connect to server", group: "Application", callback: () => { this.output("Reconnect — toggle connection in header."); return true; } },
      disconnect: { description: "Disconnect", group: "Application", callback: () => { this.output("Disconnect — use Logoff in sidebar."); return true; } },
      away: { aliases: ["a"], description: "Toggle away status", group: "Application", callback: () => { this.output("Away — use Network settings autoaway."); return true; } },
      quit: { aliases: ["q", "exit"], description: "Quit", group: "Application", parameters: ["[force]"], callback: () => { this.output("Quit — close browser tab."); return true; } },
    };
  }

  helpCommand(args: string, _ctx: { interface: string; room?: string; user?: string }): void {
    const pm = this.parent as unknown as {
      getCommandGroupsData: (iface: string, q?: string) => Map<string, Array<[string, string[], string[], string]>>;
      getCommandList: (iface: string) => string[];
    };
    if (!pm) return;
    const iface = (_ctx.interface as string) || "chatroom";
    const normalizedIface = iface === "chatroom" ? "chatroom" : iface === "private_chat" ? "private_chat" : "cli";
    const q = args.toLowerCase().trim();
    const groups = pm.getCommandGroupsData(normalizedIface, q || undefined);
    let total = 0;
    for (const v of groups.values()) total += v.length;
    let out = "";
    if (!q) out += `Listing ${total} available commands:`;
    else out += `Listing ${total} commands matching "${q}":`;
    for (const [group, cmds] of groups) {
      out += `\n\n${group}:`;
      for (const [cmd, aliases, params, desc] of cmds) {
        const all = [cmd, ...aliases].join(", /");
        out += `\n\t/${all} ${params.join(" ")}  -  ${desc}`;
      }
    }
    if (!q) out += "\n\nType /help [query] to filter";
    else if (total === 0) out += "\nType /help to list all";
    this.output(out);
  }

  pluginCommand(args: string): boolean {
    const pm = this.parent as unknown as {
      getPluginPath: (n: string) => string | null;
      listInstalledPlugins: () => string[];
      isPluginLoaded: (n: string) => boolean;
      togglePlugin: (n: string) => Promise<void>;
      reloadPlugin: (n: string) => Promise<void>;
      getPluginInfo: (n: string) => Record<string, unknown>;
    };
    const parts = args.trim().split(/\s+/);
    const action = parts[0];
    const name = parts.slice(1).join(" ").trim();
    if (!action || !name) {
      this.output("Usage: /plugin <toggle|reload|info> <plugin name>");
      return false;
    }
    if (!pm.getPluginPath(name)) {
      let msg = "Installed plugins:\n";
      for (const b of pm.listInstalledPlugins().sort()) msg += `${pm.isPluginLoaded(b) ? "‣" : "•"} ${b}\n`;
      msg += `No plugin with name "${name}"`;
      this.output(msg);
      return false;
    }
    if (action === "toggle") pm.togglePlugin(name).then(() => this.output(`Toggled ${name}`)).catch((e) => this.output(String(e)));
    else if (action === "reload") pm.reloadPlugin(name).then(() => this.output(`Reloaded ${name}`)).catch((e) => this.output(String(e)));
    else if (action === "info") {
      const info = pm.getPluginInfo(name);
      let out = "";
      for (const [k, v] of Object.entries(info)) out += `• ${k}: ${String(v)}\n`;
      this.output(out || `No info for ${name}`);
    } else this.output(`Unknown action ${action}`);
    return true;
  }
}
