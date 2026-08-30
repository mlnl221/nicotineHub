// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/pluginsystem.py

/**
 * Plugin types — mirrors pynicotine/pluginsystem.py BasePlugin surface.
 * TS/JS-only — Python (.py) and any non-TS/JS language is explicitly forbidden.
 * See apps/bridge/src/plugins/manager.ts: TS/JS-only enforcement (allowed .ts/.mts/.js/.mjs + .json/.md).
 */

export const returncode = {
  break: 0, // don't give other plugins the event, do let core process it
  zap: 1,   // don't give other plugins/intercept
  pass: 2,  // continue to next plugin
} as const;

export type ReturnCode = (typeof returncode)[keyof typeof returncode];
export type PluginReturn =
  | ReturnCode
  | void
  | null
  | undefined
  | [unknown, ...unknown[]] // tuple = modified args (compat with Python)
  | unknown; // weird -> ignored

export interface MetaSetting {
  description: string;
  group?: string;
  type: "integer" | "int" | "float" | "bool" | "radio" | "dropdown" | "string" | "str" | "textview" | "list string" | "file";
  minimum?: number;
  maximum?: number;
  stepsize?: number;
  decimals?: number; // derived
  options?: string[];
  chooser?: "file" | "folder" | "image";
}

export interface CommandDef {
  aliases?: string[];
  description?: string;
  group?: string;
  parameters?: string[];
  parameters_chatroom?: string[];
  parameters_private_chat?: string[];
  parameters_cli?: string[];
  disable?: Array<"chatroom" | "private_chat" | "cli">;
  callback?: (args: string, ctx: { room?: string; user?: string; interface: "chatroom" | "private_chat" | "cli" }) => boolean | void | Promise<boolean | void>;
  callback_chatroom?: (args: string, ctx: { room?: string; user?: string; interface: "chatroom" }) => boolean | void;
  callback_private_chat?: (args: string, ctx: { user?: string; room?: string; interface: "private_chat" }) => boolean | void;
  callback_cli?: (args: string, ctx: { interface: "cli" }) => boolean | void;
}

export interface PluginManifest {
  Name?: string;
  name?: string;
  Version?: string;
  version?: string;
  Authors?: string[];
  authors?: string[];
  Description?: string;
  description?: string;
  // bridge extensions
  apiVersion?: number;
  entry?: string;
  // any other PLUGININFO keys
  [k: string]: unknown;
}

// Bridge-side shim types for what plugins can call
export interface PluginCoreShim {
  sendPublic(room: string, text: string): void;
  sendPrivate(user: string, text: string, showUI?: boolean, switchPage?: boolean): void;
  echoPublic(room: string, text: string, messageType?: string): void;
  echoPrivate(user: string, text: string, messageType?: string): void;
}

export abstract class BasePlugin {
  // --- attributes plugins may override ---
  public commands: Record<string, CommandDef> = {};
  // legacy compat
  public __publiccommands__: Array<[string, (source: string, args: string) => void]> = [];
  public __privatecommands__: Array<[string, (source: string, args: string) => void]> = [];

  public settings: Record<string, unknown> = {};
  public metasettings: Record<string, MetaSetting> = {};

  // --- injected on load (do not modify) ---
  public internalName: string = "";
  public humanName: string = "";
  public path: string = "";
  public parent: unknown = null; // PluginManager
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public config: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public core: PluginCoreShim | null = null;

  // --- lifecycle ---
  init?(): void | Promise<void>;
  loaded_notification?(): void | Promise<void>;
  disable?(): void | Promise<void>;
  unloaded_notification?(): void | Promise<void>;
  shutdown_notification?(): void | Promise<void>;

  // --- chat events (may return zap/break/pass) ---
  public_room_message_notification?(room: string, user: string, line: string): PluginReturn;
  search_request_notification?(searchterm: string, user: string, token: number): PluginReturn;
  distrib_search_notification?(searchterm: string, user: string, token: number): PluginReturn;
  incoming_private_chat_event?(user: string, line: string): PluginReturn;
  incoming_private_chat_notification?(user: string, line: string): PluginReturn;
  incoming_public_chat_event?(room: string, user: string, line: string): PluginReturn;
  incoming_public_chat_notification?(room: string, user: string, line: string): PluginReturn;
  outgoing_private_chat_event?(user: string, line: string): PluginReturn;
  outgoing_private_chat_notification?(user: string, line: string): PluginReturn;
  outgoing_public_chat_event?(room: string, line: string): PluginReturn;
  outgoing_public_chat_notification?(room: string, line: string): PluginReturn;
  outgoing_global_search_event?(text: string): PluginReturn;
  outgoing_room_search_event?(rooms: string[], text: string): PluginReturn;
  outgoing_buddy_search_event?(text: string): PluginReturn;
  outgoing_user_search_event?(users: string[], text: string): PluginReturn;
  outgoing_wishlist_search_event?(text: string): PluginReturn;

  // --- user / server ---
  user_resolve_notification?(user: string, ip: string, port: number, country?: string): PluginReturn;
  server_connect_notification?(): PluginReturn;
  server_disconnect_notification?(userchoice: boolean | string): PluginReturn;
  join_chatroom_notification?(room: string): PluginReturn;
  leave_chatroom_notification?(room: string): PluginReturn;
  user_join_chatroom_notification?(room: string, user: string): PluginReturn;
  user_leave_chatroom_notification?(room: string, user: string): PluginReturn;
  private_room_membership_granted_notification?(room: string): PluginReturn;
  private_room_membership_revoked_notification?(room: string): PluginReturn;
  private_room_member_added_notification?(room: string, user: string): PluginReturn;
  private_room_member_removed_notification?(room: string, user: string): PluginReturn;
  private_room_operatorship_granted_notification?(room: string): PluginReturn;
  private_room_operatorship_revoked_notification?(room: string): PluginReturn;
  private_room_operator_added_notification?(room: string, user: string): PluginReturn;
  private_room_operator_removed_notification?(room: string, user: string): PluginReturn;
  user_stats_notification?(user: string, stats: unknown): PluginReturn;
  user_status_notification?(user: string, status: number, privileged: boolean): PluginReturn;

  // --- transfers ---
  upload_queued_notification?(user: string, virtualPath: string, realPath?: string): PluginReturn;
  upload_started_notification?(user: string, virtualPath: string, realPath?: string): PluginReturn;
  upload_finished_notification?(user: string, virtualPath: string, realPath?: string): PluginReturn;
  download_started_notification?(user: string, virtualPath: string, realPath?: string): PluginReturn;
  download_finished_notification?(user: string, virtualPath: string, realPath?: string): PluginReturn;

  // helpers (injected by manager)
  log(msg: string, msgArgs?: unknown): void {
    // default, replaced by manager per instance
    console.log(`[${this.humanName}] ${msg}`, msgArgs ?? "");
  }
  send_public(room: string, text: string): void {
    this.core?.sendPublic(room, text);
  }
  send_private(user: string, text: string, showUI = true, switchPage = true): void {
    this.core?.sendPrivate(user, text, showUI, switchPage);
  }
  echo_public(room: string, text: string, _messageType = "local"): void {
    this.core?.echoPublic(room, text, _messageType);
  }
  echo_private(user: string, text: string, _messageType = "local"): void {
    this.core?.echoPrivate(user, text, _messageType);
  }
  send_message(text: string): void {
    // handled by manager's command_source plumbing
    const pm = this.parent as { command_source?: [string, string | null] } | null;
    if (!pm?.command_source) return;
    const [iface, source] = pm.command_source;
    if (iface === "cli") return;
    if (iface === "chatroom" && source) this.send_public(source, text);
    else if (iface === "private_chat" && source) this.send_private(source, text);
  }
  echo_message(text: string, _messageType = "local"): void {
    const pm = this.parent as { command_source?: [string, string | null] } | null;
    if (!pm?.command_source) return;
    const [iface, source] = pm.command_source;
    if (iface === "cli") { console.log(text); return; }
    if (iface === "chatroom" && source) this.echo_public(source, text, _messageType);
    else if (iface === "private_chat" && source) this.echo_private(source, text, _messageType);
  }
  output(text: string): void {
    this.echo_message(text, "command");
  }
}

/**
 * Mirrors ResponseThrottle in pluginsystem.py:304
 */
export class ResponseThrottle {
  private pluginUsage: Map<string, { lastTime: number; lastRequest: string; lastNick: string }> = new Map();
  private room = "";
  private nick = "";
  private request = "";
  constructor(
    private coreAddresses: Map<string, unknown> | Record<string, unknown>,
    private pluginName: string,
    private logging = false,
  ) {}

  ok_to_respond(room: string, nick: string, request: string, secondsLimitMin = 30): boolean {
    this.room = room;
    this.nick = nick;
    this.request = request;
    let willing = true;
    let reason: string | null = null;
    const now = Date.now() / 1000; // use monotonic-like
    if (!this.pluginUsage.has(room)) this.pluginUsage.set(room, { lastTime: 0, lastRequest: "", lastNick: "" });
    const last = this.pluginUsage.get(room)!;
    const lastTime = last.lastTime;
    const lastNick = last.lastNick;
    const lastRequest = last.lastRequest;

    // simplified: we don't have network_filter ban check here, but keep throttle logic
    if ([nick, request].join("\x00") === [lastNick, lastRequest].join("\x00")) {
      if (now - lastTime < 12 * secondsLimitMin) {
        willing = false; reason = "Too soon for same nick same request";
      }
    } else if (request === lastRequest) {
      if (now - lastTime < 3 * secondsLimitMin) {
        willing = false; reason = "Too soon for same request in room";
      }
    } else {
      let recent = 0;
      for (const [r, d] of this.pluginUsage) {
        if (now - d.lastTime < secondsLimitMin) {
          recent++;
          if (r === room) { willing = false; reason = "Responded in room too recently"; break; }
        }
      }
      if (recent > 3) { willing = false; reason = "Responded in multiple rooms"; }
    }
    if (this.logging && !willing) {
      console.debug(`[${this.pluginName}] throttled room=${room} nick=${nick} reason=${reason}`);
    }
    return willing;
  }
  responded(): void {
    this.pluginUsage.set(this.room, { lastTime: Date.now() / 1000, lastRequest: this.request, lastNick: this.nick });
  }
}
