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
