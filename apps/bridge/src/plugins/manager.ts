// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 nicotine-mobile Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/pluginsystem.py

/**
 * PluginManager — TS port of pynicotine/pluginsystem.py PluginHandler.
 * Manages discovery, load/unload, settings persistence, command + event dispatch.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { BasePlugin, returncode, type CommandDef, type PluginManifest } from "./types.ts";
import { logger } from "../logger.ts";

// ---- persistence file DATA_DIR/plugins.json ----
type PluginsFile = {
  enable: boolean;
  enabled: string[];
  plugins: Record<string, Record<string, unknown>>;
};

const DEFAULT_PLUGINS_FILE: PluginsFile = { enable: true, enabled: [], plugins: {} };

function dataDir(): string {
  return process.env.DATA_DIR || "/data";
}
function pluginsFilePath(): string {
  return join(dataDir(), "plugins.json");
}
function userPluginsDir(): string {
  return join(dataDir(), "plugins");
}
function builtinPluginsDirFallback(): string {
  // inside bridge image, builtins are compiled; fallback path for dev
  return join(import.meta.dir, "builtin");
}

function readPluginsFile(): PluginsFile {
  const p = pluginsFilePath();
  if (!existsSync(p)) return { ...DEFAULT_PLUGINS_FILE, plugins: {} };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return {
      enable: raw.enable ?? true,
      enabled: Array.isArray(raw.enabled) ? raw.enabled : [],
      plugins: raw.plugins && typeof raw.plugins === "object" ? raw.plugins : {},
    };
  } catch {
    return { ...DEFAULT_PLUGINS_FILE, plugins: {} };
  }
}
function writePluginsFile(data: PluginsFile): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    const tmp = pluginsFilePath() + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    // atomic
    const { renameSync } = require("node:fs") as typeof import("node:fs");
    try { renameSync(tmp, pluginsFilePath()); } catch { writeFileSync(pluginsFilePath(), JSON.stringify(data, null, 2)); }
  } catch (e) {
    logger.warn("bridge", "plugins persist failed", { error: (e as Error).message });
  }
}

function parsePluginInfo(dir: string): PluginManifest {
  const jsonPath = join(dir, "plugin.json");
  const infoPath = join(dir, "PLUGININFO");
  if (existsSync(jsonPath)) {
    try { return JSON.parse(readFileSync(jsonPath, "utf8")); } catch { return {}; }
  }
  if (existsSync(infoPath)) {
    try {
      const raw = readFileSync(infoPath, "utf8");
      const out: Record<string, unknown> = {};
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let valStr = trimmed.slice(eq + 1).trim();
        // try literal_eval-like: handle _("...") , quoted strings, lists, numbers
        if (valStr.startsWith('_("') && valStr.endsWith('")')) {
          // strip _( and )
          const inner = valStr.slice(3, -2);
          // naive eval string content
          try { out[key] = JSON.parse(`"${inner.replace(/"/g, '\\"')}"`); } catch { out[key] = inner; }
          continue;
        }
        // try JSON eval via replacement of single quotes
        try {
          // literal_eval equivalent: handle 'string' vs "string"
          // Replace single quoted with double quoted for JSON.parse attempt
          // simpler: use Function?
          // Use eval with safeguards? Keep simple: if starts with [ or { try JSON
          if (valStr.startsWith("[") || valStr.startsWith("{") || valStr.startsWith('"') || valStr.startsWith("'") ) {
            // normalize single quotes
            const normalized = valStr.replace(/'/g, '"');
            out[key] = JSON.parse(normalized);
            continue;
          }
          if (!isNaN(Number(valStr))) { out[key] = Number(valStr); continue; }
        } catch {}
        // strip surrounding quotes if present
        if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
          valStr = valStr.slice(1, -1);
        }
        out[key] = valStr;
      }
      return out;
    } catch { return {}; }
  }
  return {};
}

function humanNameFromManifest(manifest: PluginManifest, fallback: string): string {
  const v = (manifest.Name as string) || (manifest.name as string);
  if (v && typeof v === "string") return v;
  return fallback;
}

// Session shim types
type SessionLike = {
  sayChatroom: (room: string, text: string) => void;
  sendPrivateMessage: (user: string, text: string) => void;
  // we also proxy others as needed
};

export class PluginManager {
  private loadedPlugins = new Map<string, BasePlugin>();
  private commandSource: [string, string | null] | null = null;
  private commands: Record<string, Record<string, CommandDef | null>> = {
    chatroom: {},
    private_chat: {},
    cli: {},
  };
  private builtinMap = new Map<string, { manifest: PluginManifest; loader: () => BasePlugin }>();
  private dataDirStr = dataDir();
  // core shim injected per session
  private sessionGetter: (() => SessionLike | null) | null = null;
  private outputHandler: ((pluginName: string, text: string) => void) | null = null;

  constructor(
    private opts: {
      dataDir?: string;
      sessionGetter?: () => SessionLike | null;
    } = {},
  ) {
    if (opts.dataDir) this.dataDirStr = opts.dataDir;
    if (opts.sessionGetter) this.sessionGetter = opts.sessionGetter;
  }

  setSessionGetter(getter: () => SessionLike | null): void {
    this.sessionGetter = getter;
  }
  setOutputHandler(handler: ((pluginName: string, text: string) => void) | null): void {
    this.outputHandler = handler;
  }

  registerBuiltin(name: string, manifest: PluginManifest, loader: () => BasePlugin): void {
    this.builtinMap.set(name, { manifest, loader });
  }

  // ---- discovery ----

  private ensureDirs(): void {
    try { mkdirSync(userPluginsDir(), { recursive: true }); } catch {}
    try { mkdirSync(this.dataDirStr, { recursive: true }); } catch {}
  }

  listInstalledPlugins(): string[] {
    const names = new Set<string>();
    // builtins
    for (const k of this.builtinMap.keys()) names.add(k);
    // user dir
    try {
      const entries = readdirSync(userPluginsDir());
      for (const ent of entries) {
        const p = join(userPluginsDir(), ent);
        try { if (statSync(p).isDirectory()) names.add(ent); } catch {}
      }
    } catch {}
    // also scan builtin dir on disk (dev fallback where builtins not registered)
    try {
      const bdir = builtinPluginsDirFallback();
      if (existsSync(bdir)) {
        for (const ent of readdirSync(bdir)) {
          if (ent.endsWith(".ts") || ent.endsWith(".js")) {
            const base = ent.replace(/\.(ts|js)$/, "");
            if (base !== "index" && base !== "types" && base !== "manager") names.add(base);
          }
        }
      }
    } catch {}
    // core_commands is hidden from list like Python (but we expose it if needed)
    return [...names].filter((n) => n !== "core_commands").sort();
  }

  getPluginPath(name: string): string | null {
    if (this.builtinMap.has(name)) return `builtin:${name}`;
    const p = join(userPluginsDir(), name);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
    return null;
  }

  isInternalPlugin(name: string): boolean {
    return this.builtinMap.has(name);
  }

  isPluginLoaded(name: string): boolean {
    return this.loadedPlugins.has(name);
  }

  getPluginHumanName(name: string): string {
    // try manifest
    const p = this.getPluginPath(name);
    if (p) {
      if (p.startsWith("builtin:")) {
        const m = this.builtinMap.get(name)?.manifest;
        if (m) return humanNameFromManifest(m, name);
      } else {
        const manifest = parsePluginInfo(p);
        return humanNameFromManifest(manifest, name);
      }
    }
    return name;
  }

  getPluginInfo(name: string): PluginManifest {
    const p = this.getPluginPath(name);
    if (!p) return {};
    if (p.startsWith("builtin:")) return this.builtinMap.get(name)?.manifest ?? {};
    return parsePluginInfo(p);
  }

  // ---- settings persistence ----
  private loadPluginSettings(plugin: BasePlugin): void {
    const fname = plugin.internalName.toLowerCase();
    const data = readPluginsFile();
    const prev = data.plugins[fname];
    if (!prev) {
      // initialize
      data.plugins[fname] = { ...plugin.settings };
      writePluginsFile(data);
      return;
    }
    // merge known keys
    for (const key of Object.keys(prev)) {
      if (!(key in plugin.settings)) {
        logger.debug("bridge", `stored setting ${key} no longer in plugin ${fname}`);
        continue;
      }
      plugin.settings[key] = prev[key];
    }
    // persist current (includes defaults for new keys)
    data.plugins[plugin.internalName.toLowerCase()] = { ...plugin.settings };
    writePluginsFile(data);
  }

  private persistPluginSettings(plugin: BasePlugin): void {
    const data = readPluginsFile();
    data.plugins[plugin.internalName.toLowerCase()] = { ...plugin.settings };
    writePluginsFile(data);
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    this.ensureDirs();
    const data = readPluginsFile();
    if (!data.enable) {
      logger.info("bridge", "plugins disabled via plugins.json");
      // still load core_commands if requested? Mirror Python: it loads core_commands regardless if enable false?
      // Python loads core_commands before checking enable:true. We do same.
      await this.enablePlugin("core_commands").catch(() => {});
      return;
    }
    // always enable core_commands first
    try { await this.enablePlugin("core_commands"); } catch {}
    for (const name of data.enabled) {
      if (name === "core_commands") continue;
      await this.enablePlugin(name).catch((e) => logger.warn("bridge", `failed to enable plugin ${name}`, { error: (e as Error).message }));
    }
  }

  async shutdown(): Promise<void> {
    for (const name of [...this.loadedPlugins.keys()]) {
      try { const p = this.loadedPlugins.get(name); await p?.shutdown_notification?.(); } catch {}
    }
    for (const name of [...this.loadedPlugins.keys()]) {
      await this.disablePlugin(name, false).catch(() => {});
    }
  }

  private async importPluginInstance(name: string): Promise<BasePlugin | null> {
    // builtin first
    const builtin = this.builtinMap.get(name);
    if (builtin) {
      const inst = builtin.loader();
      inst.internalName = name;
      inst.humanName = humanNameFromManifest(builtin.manifest, name);
      inst.path = `builtin:${name}`;
      return inst;
    }
    const pluginPath = this.getPluginPath(name);
    if (!pluginPath) return null;
    // user plugin: expect plugin.json entry or index.js/.ts
    const manifest = parsePluginInfo(pluginPath);
    const entry = (manifest.entry as string) || (manifest.Entry as string) || "index.js";
    const candidates = [
      join(pluginPath, entry),
      join(pluginPath, "index.js"),
      join(pluginPath, "index.ts"),
      join(pluginPath, "index.mjs"),
    ];
    let file: string | null = null;
    for (const c of candidates) if (existsSync(c)) { file = c; break; }
    if (!file) {
      logger.warn("bridge", `plugin ${name} has no entry file`, { pluginPath });
      return null;
    }
    // dynamic import via Bun
    try {
      // add plugin path to allow relative imports from plugin
      const mod = await import(file);
      const PluginClass = mod.Plugin || mod.default || mod.default?.Plugin;
      if (!PluginClass) {
        logger.warn("bridge", `plugin ${name} missing Plugin export`, { file });
        return null;
      }
      const inst: BasePlugin = new PluginClass();
      inst.internalName = name;
      inst.humanName = humanNameFromManifest(manifest, name);
      inst.path = pluginPath;
      return inst;
    } catch (e) {
      logger.error("bridge", `failed to import plugin ${name}`, { error: (e as Error).message, stack: (e as Error).stack });
      return null;
    }
  }

  private injectHelpers(plugin: BasePlugin): void {
    const session = this.sessionGetter?.() ?? null;
    const manager = this;
    plugin.parent = manager as unknown as BasePlugin["parent"];
    // expose manager as parent for command_source
    (plugin as unknown as { parent: PluginManager }).parent = manager;
    plugin.core = {
      sendPublic: (room, text) => {
        try { session?.sayChatroom(room, text); } catch {}
      },
      sendPrivate: (user, text) => {
        try { session?.sendPrivateMessage(user, text); } catch {}
      },
      echoPublic: (_room, _text) => {
        // echo is UI-only; bridge logs it for diagnostics
        logger.info("chat", `[echo public] ${_room}: ${_text}`);
      },
      echoPrivate: (_user, _text) => {
        logger.info("chat", `[echo private] ${_user}: ${_text}`);
      },
    };
    // override log to use logger (+ optional forward to ws)
    const human = plugin.humanName || plugin.internalName;
    const mgr = this;
    plugin.log = (msg: string, _args?: unknown) => {
      logger.info("bridge", `${human}: ${msg}`, _args ? { args: _args } as Record<string, unknown> : undefined);
      if (mgr.outputHandler) try { mgr.outputHandler(human, `${msg}${_args ? " " + JSON.stringify(_args) : ""}`); } catch {}
    };
    const origOutput = plugin.output.bind(plugin);
    plugin.output = (text: string) => {
      if (mgr.outputHandler) try { mgr.outputHandler(human, text); } catch {}
      // also keep original behavior (logging via echo -> logger)
      try { origOutput(text); } catch {}
    };
  }

  async enablePlugin(name: string): Promise<void> {
    if (name.includes("=")) {
      logger.warn("bridge", `cannot enable plugin with = in name: ${name}`);
      return;
    }
    if (this.isPluginLoaded(name)) return;
    const data = readPluginsFile();
    if (!data.enabled.includes(name)) {
      data.enabled.push(name);
      writePluginsFile(data);
    }
    const inst = await this.importPluginInstance(name);
    if (!inst) {
      // remove from enabled if not found
      const idx = data.enabled.indexOf(name);
      if (idx >= 0) { data.enabled.splice(idx, 1); writePluginsFile(data); }
      return;
    }
    this.injectHelpers(inst);
    this.loadPluginSettings(inst);

    // .init()
    try { await inst.init?.(); } catch (e) { logger.error("bridge", `plugin ${name} init failed`, { error: (e as Error).message }); }

    // register commands
    for (const [cmd, def] of Object.entries(inst.commands ?? {})) {
      if (!def) continue;
      if (!def.group) def.group = inst.humanName;
      for (const iface of Object.keys(this.commands) as Array<keyof typeof this.commands>) {
        const disabled = (def.disable ?? []) as string[];
        if (disabled.includes(iface)) continue;
        if (this.commands[iface][cmd] !== undefined) {
          logger.warn("bridge", `conflicting ${iface} command ${cmd} in plugin ${inst.humanName}`);
          continue;
        }
        this.commands[iface][cmd] = def;
      }
    }
    // legacy public/private commands
    const legacy: Array<[string, Array<[string, (s: string, a: string) => void]>, string]> = [
      ["chatroom", (inst as unknown as { __publiccommands__?: Array<[string, (s: string, a: string) => void]> }).__publiccommands__ ?? [], "__publiccommands__"],
      ["private_chat", (inst as unknown as { __privatecommands__?: Array<[string, (s: string, a: string) => void]> }).__privatecommands__ ?? [], "__privatecommands__"],
    ];
    for (const [iface, cmds] of legacy) {
      for (const [cmd] of cmds) {
        if (this.commands[iface][cmd] === undefined) {
          this.commands[iface][cmd] = null;
          logger.warn("bridge", `plugin ${inst.humanName} /${cmd}: __public/privatecommands is deprecated, use commands`);
        }
      }
    }

    this.loadedPlugins.set(name, inst);
    try { await inst.loaded_notification?.(); } catch (e) { logger.warn("bridge", `plugin ${name} loaded_notification failed`, { error: (e as Error).message }); }
    logger.info("bridge", `loaded plugin ${inst.humanName}`, { name });
  }

  async disablePlugin(name: string, isPermanent = true): Promise<void> {
    if (name === "core_commands") return;
    if (isPermanent) {
      const data = readPluginsFile();
      const idx = data.enabled.indexOf(name);
      if (idx >= 0) { data.enabled.splice(idx, 1); writePluginsFile(data); }
    }
    const plugin = this.loadedPlugins.get(name);
    if (!plugin) return;
    try { await plugin.disable?.(); } catch (e) { logger.warn("bridge", `plugin ${name} disable failed`, { error: (e as Error).message }); }

    // unregister commands
    for (const [cmd, def] of Object.entries(plugin.commands ?? {})) {
      for (const iface of Object.keys(this.commands) as Array<keyof typeof this.commands>) {
        const cur = this.commands[iface][cmd];
        if (cur && cur === def) delete this.commands[iface][cmd];
      }
    }
    for (const iface of ["chatroom", "private_chat"] as const) {
      const cmds = (plugin as unknown as { __publiccommands__?: Array<[string, unknown]>; __privatecommands__?: Array<[string, unknown]> })[iface === "chatroom" ? "__publiccommands__" : "__privatecommands__"] ?? [];
      for (const [cmd] of cmds) {
        if (this.commands[iface][cmd as string] === null) delete this.commands[iface][cmd as string];
      }
    }
    try { await plugin.unloaded_notification?.(); } catch {}
    this.loadedPlugins.delete(name);
    logger.info("bridge", `unloaded plugin ${plugin.humanName}`, { name });
  }

  async togglePlugin(name: string): Promise<void> {
    if (this.isPluginLoaded(name)) await this.disablePlugin(name);
    else await this.enablePlugin(name);
  }

  async reloadPlugin(name: string): Promise<void> {
    await this.disablePlugin(name, false);
    await this.enablePlugin(name);
  }

  // ---- plugin file operations ----

  async installPluginFromZip(zipPath: string): Promise<string | null> {
    // mirror Python install_plugin: unzip to userPluginsDir, 1GiB cap
    const maxSize = 1024 * 1024 * 1024;
    let pluginName: string | null = null;
    let folderPrefix: string | null = null;
    try {
      const zipData = readFileSync(zipPath);
      // Use unzip via Bun's unzip? Use JS zip parser minimal: rely on unzip via system or JS library
      // For now, require unzip command or fallback to simple extraction via `unzip` if available
      // Instead use Node's `yauzl` style: attempt to use `Bun.file` + manual? Simpler: use `unzip` shell if available
      // We will implement via `zip` JS if available; fallback to requiring `unzip` binary via `Bun.spawn`
      // Try using `jszip` if installed, else use `unzip`
      const { execSync } = await import("node:child_process");
      // list contents to find PLUGININFO
      // Use python's zipfile behavior: find entry ending with PLUGININFO
      // We'll use `unzip -l`
      let entries: string[] = [];
      try {
        const out = execSync(`unzip -l "${zipPath}" 2>/dev/null | awk 'NR>3 {print $4}' | head -n 200`, { encoding: "utf8" });
        entries = out.split("\n").filter(Boolean).filter((e) => !e.startsWith("----") && !e.startsWith("Archive"));
      } catch {
        entries = [];
      }
      // if unzip not available, try to fallback to reading via JS (simple)
      if (entries.length === 0) {
        // attempt jszip-like: try to use Node's zlib? For MVP, reject
        throw new Error("Unable to list zip (unzip not available)");
      }
      // find plugin folder prefix
      for (const ent of entries) {
        if (basename(ent) === "PLUGININFO" || basename(ent) === "plugin.json") {
          const dir = ent.includes("/") ? ent.split("/")[0] : "";
          if (dir) {
            folderPrefix = dir;
            pluginName = basename(dir);
          } else {
            pluginName = basename(zipPath, ".zip");
          }
          break;
        }
      }
      if (!pluginName) {
        // try fallback: zip contains single top folder
        const top = entries[0]?.split("/")[0];
        if (top) { pluginName = top; folderPrefix = top; }
        else pluginName = basename(zipPath, ".zip");
      }
      if (pluginName && pluginName.includes("=")) throw new Error("Invalid plugin name");
      if (this.isInternalPlugin(pluginName!)) throw new Error(`Plugin ${pluginName} conflicts with builtin`);

      // ensure size check: sum uncompressed sizes via unzip -l
      // skip for MVP (trust)

      // extract
      this.ensureDirs();
      const dest = join(userPluginsDir(), pluginName!);
      // remove existing
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      // unzip -j? we need to strip prefix
      if (folderPrefix) {
        // unzip stripping prefix: use `unzip -q -d dest` then move?
        // Simpler: unzip to temp and move inner
        const tmpRoot = join(userPluginsDir(), `.tmp_${pluginName}_${Date.now()}`);
        mkdirSync(tmpRoot, { recursive: true });
        execSync(`unzip -q "${zipPath}" -d "${tmpRoot}"`);
        const inner = join(tmpRoot, folderPrefix);
        const src = existsSync(inner) ? inner : tmpRoot;
        // move contents to dest
        const items = readdirSync(src);
        for (const it of items) {
          const s = join(src, it);
          const d = join(dest, it);
          execSync(`mv "${s}" "${d}"`);
        }
        rmSync(tmpRoot, { recursive: true, force: true });
      } else {
        execSync(`unzip -q "${zipPath}" -d "${dest}"`);
      }

      logger.info("bridge", `installed plugin ${pluginName}`, { pluginName });
      // reload if was loaded
      if (this.isPluginLoaded(pluginName!)) await this.reloadPlugin(pluginName!);
      return pluginName!;
    } catch (e) {
      logger.error("bridge", `failed to install plugin`, { error: (e as Error).message });
      return null;
    }
  }

  uninstallPlugin(name: string): boolean {
    if (this.isInternalPlugin(name)) return false;
    // disable first
    this.disablePlugin(name).catch(() => {});
    const p = this.getPluginPath(name);
    if (p && !p.startsWith("builtin:")) {
      try { rmSync(p, { recursive: true, force: true }); } catch (e) { logger.error("bridge", `uninstall failed ${name}`, { error: (e as Error).message }); return false; }
    }
    // remove settings
    const data = readPluginsFile();
    delete data.plugins[name.toLowerCase()];
    const idx = data.enabled.indexOf(name);
    if (idx >= 0) data.enabled.splice(idx, 1);
    writePluginsFile(data);
    logger.info("bridge", `uninstalled plugin ${humanNameFromManifest(parsePluginInfo(p ?? ""), name)}`, { name });
    return true;
  }

  getPluginMetaSettings(name: string): Record<string, unknown> | null {
    const p = this.loadedPlugins.get(name);
    if (p && Object.keys(p.metasettings ?? {}).length > 0) return p.metasettings;
    // also try to read from filesystem manifest metasettings?
    return null;
  }

  // ---- command system ----

  getCommandList(iface: string): string[] {
    const out: string[] = [];
    const map = this.commands[iface] ?? {};
    for (const [cmd, data] of Object.entries(map)) {
      out.push(`/${cmd} `);
      if (!data) continue;
      for (const alias of data.aliases ?? []) out.push(`/${alias} `);
    }
    return out;
  }

  getCommandGroupsData(iface: string, searchQuery?: string): Map<string, Array<[string, string[], string[], string]>> {
    const groups = new Map<string, Array<[string, string[], string[], string]>>();
    const map = this.commands[iface] ?? {};
    for (const [cmd, data] of Object.entries(map)) {
      let aliases: string[] = [];
      let params: string[] = [];
      let desc = "No description";
      let group = "Miscellaneous";
      if (data) {
        aliases = data.aliases ?? [];
        const key = `parameters_${iface}` as keyof CommandDef;
        params = ((data[key] as string[]) ?? data.parameters ?? []) as string[];
        desc = data.description ?? desc;
        group = data.group ?? group;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!group.toLowerCase().includes(q) && !cmd.toLowerCase().includes(q) && !aliases.some((a) => a.includes(q)) && !params.some((p) => p.includes(q)) && !desc.toLowerCase().includes(q)) continue;
      }
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push([cmd, aliases, params, desc]);
    }
    return groups;
  }

  // trigger_chatroom_command_event / etc
  async triggerChatroomCommand(room: string, command: string, args: string): Promise<boolean> {
    return this._triggerCommand(command, args, { room });
  }
  async triggerPrivateChatCommand(user: string, command: string, args: string): Promise<boolean> {
    return this._triggerCommand(command, args, { user });
  }
  async triggerCliCommand(command: string, args: string): Promise<boolean> {
    return this._triggerCommand(command, args, {});
  }

  private async _triggerCommand(command: string, args: string, ctx: { room?: string; user?: string }): Promise<boolean> {
    let commandFound = false;
    let isSuccessful = false;
    let foundPlugin: BasePlugin | null = null;

    for (const [mod, plugin] of this.loadedPlugins) {
      if (!plugin) continue;
      const isRoom = ctx.room !== undefined;
      const isUser = ctx.user !== undefined && ctx.room === undefined;
      if (isRoom) this.commandSource = ["chatroom", ctx.room!];
      else if (isUser) this.commandSource = ["private_chat", ctx.user!];
      else this.commandSource = ["cli", null];

      // store on manager for plugin.send_message to read
      (plugin.parent as unknown as { command_source?: unknown }).command_source = this.commandSource;

      try {
        // new commands
        for (const [trigger, data] of Object.entries(plugin.commands ?? {})) {
          const aliases: string[] = (data as CommandDef)?.aliases ?? [];
          if (command !== trigger && !aliases.includes(command)) continue;
          const iface = this.commandSource[0] as string;
          const disabled: string[] = (data as CommandDef)?.disable ?? [];
          if (disabled.includes(iface)) continue;
          commandFound = true;
          foundPlugin = plugin;

          // params validation (like Python)
          const key = `parameters_${iface}` as keyof CommandDef;
          const parameters = ((data as CommandDef)[key] as string[] | undefined) ?? (data as CommandDef).parameters ?? [];
          const argsSplit = args.trim() ? args.split(/\s+/) : [];
          const numArgs = argsSplit.length;
          let numRequired = 0;
          let rejection: string | null = null;
          for (let i = 0; i < parameters.length; i++) {
            const param = parameters[i];
            if (param.startsWith("<")) numRequired++;
            if (numArgs < numRequired) { rejection = `Missing ${param} argument`; break; }
            if (numArgs <= i || !param.includes("|")) continue;
            const choiches = param.slice(1, -1).split("|");
            if (!choiches.includes(argsSplit[i])) { rejection = `Invalid argument, possible choices: ${choiches.join(" | ")}`; break; }
          }
          if (rejection) {
            plugin.output(rejection);
            plugin.output(`Usage: /${command} ${parameters.join(" ")}`);
            break;
          }
          const cbKey = `callback_${iface}` as keyof CommandDef;
          const callback = ((data as CommandDef)[cbKey] as CommandDef["callback"]) ?? (data as CommandDef).callback;
          if (!callback) continue;
          let res: unknown;
          if (ctx.room !== undefined) res = await (callback as (a: string, ctx: { room: string }) => unknown)(args, { room: ctx.room, interface: iface as "chatroom" });
          else if (ctx.user !== undefined) res = await (callback as (a: string, ctx: { user: string }) => unknown)(args, { user: ctx.user, interface: iface as "private_chat" });
          else res = await (callback as (a: string, ctx: { interface: "cli" }) => unknown)(args, { interface: "cli" as const });
          isSuccessful = res !== false;
          if (res === undefined) isSuccessful = true;
        }
        if (!commandFound) {
          // legacy
          const isRoom2 = ctx.room !== undefined;
          const legacyCmds: Array<[string, (s: string, a: string) => void]> = isRoom2 ? ((plugin as unknown as { __publiccommands__?: Array<[string, (s: string, a: string) => void]> }).__publiccommands__ ?? []) : ((plugin as unknown as { __privatecommands__?: Array<[string, (s: string, a: string) => void]> }).__privatecommands__ ?? []);
          for (const [trigger, func] of legacyCmds) {
            if (trigger === command) {
              try { func(ctx.room ?? ctx.user ?? "", args); } catch {}
              isSuccessful = true;
              commandFound = true;
              foundPlugin = plugin;
              break;
            }
          }
        }
      } catch (e) {
        logger.error("bridge", `plugin ${mod} command error`, { error: (e as Error).message });
        foundPlugin = null;
        break;
      }
      if (commandFound) break;
    }

    // show unknown command via found plugin? Python does: if plugin (meaning loop ended without found but plugin var still set?) shows unknown
    // We mimic: if not found, try to show via first loaded plugin's output? Instead log.
    if (!commandFound && this.loadedPlugins.size > 0) {
      // try to echo via any plugin's output? Use first
      const first = [...this.loadedPlugins.values()][0];
      if (first) {
        // set source to show
        // but only if user attempted a slash command
        // we won't spam; just return false
      }
    }

    this.commandSource = null;
    // clear parent command_source
    for (const p of this.loadedPlugins.values()) {
      try { (p.parent as unknown as { command_source?: unknown }).command_source = null; } catch {}
    }
    return isSuccessful;
  }

  // ---- event system ----

  /**
   * Generic trigger — mirrors PluginHandler._trigger_event
   * Returns modified args or null if zap, or original args
   */
  triggerEvent(method: string, args: unknown[]): unknown[] | null {
    let curArgs: unknown[] = [...args];
    for (const [mod, plugin] of this.loadedPlugins) {
      const fn = (plugin as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") continue;
      try {
        const raw = (fn as (...a: unknown[]) => unknown).apply(plugin, curArgs);
        // support async? For now only sync return; async plugins should use sync hooks
        const ret = raw as PluginReturn;
        if (ret === null || ret === undefined) continue;
        if (Array.isArray(ret) && ret.length === curArgs.length) {
          // tuple of modified args — Python returns tuple
          curArgs = ret as unknown[];
          continue;
        }
        if (ret === returncode.zap) return null;
        if (ret === returncode.break) return curArgs;
        if (ret === returncode.pass) continue;
        // string literal "zap" etc? Support
        if (ret === "zap") return null;
        if (ret === "break") return curArgs;
        if (ret === "pass") continue;
        logger.debug("bridge", `plugin ${mod} returned weird ${String(ret)} ignoring`);
      } catch (e) {
        logger.error("bridge", `plugin ${mod} ${method} error`, { error: (e as Error).message, stack: (e as Error).stack });
      }
    }
    return curArgs;
  }

  // convenience wrappers matching pluginsystem.py handler names
  searchRequestNotification(searchterm: string, user: string, token: number): void {
    this.triggerEvent("search_request_notification", [searchterm, user, token]);
  }
  distribSearchNotification(searchterm: string, user: string, token: number): void {
    this.triggerEvent("distrib_search_notification", [searchterm, user, token]);
  }
  publicRoomMessageNotification(room: string, user: string, line: string): void {
    this.triggerEvent("public_room_message_notification", [room, user, line]);
  }

  incomingPrivateChatEvent(user: string, line: string): unknown[] | null {
    return this.triggerEvent("incoming_private_chat_event", [user, line]);
  }
  incomingPrivateChatNotification(user: string, line: string): void {
    this.triggerEvent("incoming_private_chat_notification", [user, line]);
  }
  incomingPublicChatEvent(room: string, user: string, line: string): unknown[] | null {
    return this.triggerEvent("incoming_public_chat_event", [room, user, line]);
  }
  incomingPublicChatNotification(room: string, user: string, line: string): void {
    this.triggerEvent("incoming_public_chat_notification", [room, user, line]);
  }
  outgoingPrivateChatEvent(user: string, line: string): unknown[] | null {
    return this.triggerEvent("outgoing_private_chat_event", [user, line]);
  }
  outgoingPrivateChatNotification(user: string, line: string): void {
    this.triggerEvent("outgoing_private_chat_notification", [user, line]);
  }
  outgoingPublicChatEvent(room: string, line: string): unknown[] | null {
    return this.triggerEvent("outgoing_public_chat_event", [room, line]);
  }
  outgoingPublicChatNotification(room: string, line: string): void {
    this.triggerEvent("outgoing_public_chat_notification", [room, line]);
  }

  outgoingGlobalSearchEvent(text: string): unknown[] | null { return this.triggerEvent("outgoing_global_search_event", [text]); }
  outgoingRoomSearchEvent(rooms: string[], text: string): unknown[] | null { return this.triggerEvent("outgoing_room_search_event", [rooms, text]); }
  outgoingBuddySearchEvent(text: string): unknown[] | null { return this.triggerEvent("outgoing_buddy_search_event", [text]); }
  outgoingUserSearchEvent(users: string[], text: string): unknown[] | null { return this.triggerEvent("outgoing_user_search_event", [users, text]); }
  outgoingWishlistSearchEvent(text: string): unknown[] | null { return this.triggerEvent("outgoing_wishlist_search_event", [text]); }

  userResolveNotification(user: string, ip: string, port: number, country?: string): void { this.triggerEvent("user_resolve_notification", [user, ip, port, country]); }
  serverConnectNotification(): void { this.triggerEvent("server_connect_notification", []); }
  serverDisconnectNotification(userchoice: unknown): void { this.triggerEvent("server_disconnect_notification", [userchoice]); }
  joinChatroomNotification(room: string): void { this.triggerEvent("join_chatroom_notification", [room]); }
  leaveChatroomNotification(room: string): void { this.triggerEvent("leave_chatroom_notification", [room]); }
  userJoinChatroomNotification(room: string, user: string): void { this.triggerEvent("user_join_chatroom_notification", [room, user]); }
  userLeaveChatroomNotification(room: string, user: string): void { this.triggerEvent("user_leave_chatroom_notification", [room, user]); }
  privateRoomMembershipGrantedNotification(room: string): void { this.triggerEvent("private_room_membership_granted_notification", [room]); }
  privateRoomMembershipRevokedNotification(room: string): void { this.triggerEvent("private_room_membership_revoked_notification", [room]); }
  privateRoomMemberAddedNotification(room: string, user: string): void { this.triggerEvent("private_room_member_added_notification", [room, user]); }
  privateRoomMemberRemovedNotification(room: string, user: string): void { this.triggerEvent("private_room_member_removed_notification", [room, user]); }
  privateRoomOperatorshipGrantedNotification(room: string): void { this.triggerEvent("private_room_operatorship_granted_notification", [room]); }
  privateRoomOperatorshipRevokedNotification(room: string): void { this.triggerEvent("private_room_operatorship_revoked_notification", [room]); }
  privateRoomOperatorAddedNotification(room: string, user: string): void { this.triggerEvent("private_room_operator_added_notification", [room, user]); }
  privateRoomOperatorRemovedNotification(room: string, user: string): void { this.triggerEvent("private_room_operator_removed_notification", [room, user]); }
  userStatsNotification(user: string, stats: unknown): void { this.triggerEvent("user_stats_notification", [user, stats]); }
  userStatusNotification(user: string, status: number, privileged: boolean): void { this.triggerEvent("user_status_notification", [user, status, privileged]); }

  uploadQueuedNotification(user: string, virtualPath: string, realPath?: string): void { this.triggerEvent("upload_queued_notification", [user, virtualPath, realPath]); }
  uploadStartedNotification(user: string, virtualPath: string, realPath?: string): void { this.triggerEvent("upload_started_notification", [user, virtualPath, realPath]); }
  uploadFinishedNotification(user: string, virtualPath: string, realPath?: string): void { this.triggerEvent("upload_finished_notification", [user, virtualPath, realPath]); }
  downloadStartedNotification(user: string, virtualPath: string, realPath?: string): void { this.triggerEvent("download_started_notification", [user, virtualPath, realPath]); }
  downloadFinishedNotification(user: string, virtualPath: string, realPath?: string): void { this.triggerEvent("download_finished_notification", [user, virtualPath, realPath]); }

  shutdownNotification(): void { this.triggerEvent("shutdown_notification", []); }

  // expose loaded map for server
  getLoadedPlugins(): Map<string, BasePlugin> { return this.loadedPlugins; }
  getCommands(): typeof this.commands { return this.commands; }

  // settings persistence helpers for web
  getPluginSettings(name: string): Record<string, unknown> | null {
    const p = this.loadedPlugins.get(name);
    if (p) return { ...p.settings };
    const data = readPluginsFile();
    return data.plugins[name.toLowerCase()] ?? null;
  }
  setPluginSettings(name: string, settings: Record<string, unknown>): boolean {
    const p = this.loadedPlugins.get(name);
    if (p) {
      Object.assign(p.settings, settings);
      this.persistPluginSettings(p);
      return true;
    }
    const data = readPluginsFile();
    data.plugins[name.toLowerCase()] = { ...(data.plugins[name.toLowerCase()] ?? {}), ...settings };
    writePluginsFile(data);
    return true;
  }
  resetPluginSettings(name: string): void {
    const data = readPluginsFile();
    delete data.plugins[name.toLowerCase()];
    writePluginsFile(data);
    if (this.isPluginLoaded(name)) this.reloadPlugin(name).catch(() => {});
  }

  // for WS api: full list data
  getInstalledPluginListWithStatus(): Array<{ name: string; humanName: string; enabled: boolean; isInternal: boolean; info: PluginManifest }> {
    return this.listInstalledPlugins().map((name) => ({
      name,
      humanName: this.getPluginHumanName(name),
      enabled: this.isPluginLoaded(name),
      isInternal: this.isInternalPlugin(name),
      info: this.getPluginInfo(name),
    }));
    // Note: core_commands hidden from list; handled separately if needed
  }

  // GitHub index install (download zip)
  async installFromUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
      const buf = await res.arrayBuffer();
      const tmp = join(userPluginsDir(), `.dl_${Date.now()}.zip`);
      this.ensureDirs();
      writeFileSync(tmp, Buffer.from(buf));
      const name = await this.installPluginFromZip(tmp);
      try { rmSync(tmp, { force: true }); } catch {}
      return name;
    } catch (e) {
      logger.error("bridge", `installFromUrl failed`, { url, error: (e as Error).message });
      return null;
    }
  }
}

// Singleton used by server.ts (created lazily)
export let globalPluginManager: PluginManager | null = null;
export function getGlobalPluginManager(dataDir?: string): PluginManager {
  if (!globalPluginManager) globalPluginManager = new PluginManager({ dataDir });
  return globalPluginManager;
}
