// SPDX-FileCopyrightText: 2020-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/plugins/leech_detector/__init__.py

/**
 * LeechDetector — port of pynicotine/plugins/leech_detector/__init__.py
 * Detects leechers (users sharing too few files/folders) and messages them after upload.
 * Extended with Anti-Leecher-for-Nicotine-ProveIt upstream:
 * suspicious-pattern detector + ProveIt chat-captcha gate before uploads.
 */

import { BasePlugin, returncode } from "../types.ts";

export const manifest = {
  Name: "Leech Detector",
  Version: "2020-08-16r00",
  Authors: ["Nicotine+", "quinox"],
  Description: "Detect leechers and send a message after they finish downloading from you.",
  apiVersion: 1,
  entry: "leech_detector.ts",
};

type LeechState = "okay" | "requesting_stats" | "requesting_shares" | "pending_leecher" | "processed_leecher";

export class Plugin extends BasePlugin {
  static PLACEHOLDERS: Record<string, string> = {
    "%files%": "num_files",
    "%folders%": "num_folders",
  };

  private probedUsers = new Map<string, LeechState>();
  private statsCache = new Map<string, { files: number; dirs: number }>();
  private proveitLastPrompt = new Map<string, number>();
  private proveitPendingUploads = new Map<string, string[]>();
  private proveitPendingShareVerify = new Set<string>();

  constructor() {
    super();
    this.settings = {
      message: "Please consider not being a leecher. Thanks",
      hide_plugin_messages: false,
      open_private_chat: true,
      num_files: 1010,
      num_folders: 51,
      send_message_to_leechers: false,
      ban_leechers: true,
      ignore_leechers: true,
      ban_block_ip: false,
      enable_sus_detector: true,
      sus_pattern_500_25: true,
      sus_pattern_1000_50: true,
      sus_pattern_1500_75: true,
      sus_pattern_2000_100: true,
      auto_unban: true,
      detected_leechers: [] as string[],
      enable_proveit: true,
      proveit_first_message:
        'ProveIt: To prove you are a human downloading these files, please type "download" in this chat to be added to my whitelist.',
      proveit_success_message:
        "ProveIt: You are verified. I will now retry your queued downloads automatically. If they do not auto-restart, please retry manually.",
      proveit_captcha_word: "download",
      proveit_cooldown_seconds: 300,
      proveit_auto_retry_uploads: true,
      proveit_verified_users: [] as string[],
      proveit_require_minimum_shares: true,
      proveit_fail_message:
        "ProveIt: Your share counts do not meet this host's minimum files/folders requirement. You cannot be whitelisted until you share enough.",
      proveit_verifying_shares_message: "",
    };
    this.metasettings = {
      message: {
        description: "Anti-Leecher: private chat message to send to leechers.",
        type: "textview",
      },
      hide_plugin_messages: {
        description:
          "ProveIt / Anti-Leecher: hide plugin-triggered PM tabs and zap incoming captcha replies (disable this if private chats seem missing or empty).",
        type: "bool",
      },
      open_private_chat: {
        description: "Open chat tabs when sending private messages to leechers",
        type: "bool",
      },
      num_files: {
        description: "Anti-Leecher: minimum shared files",
        type: "int",
        minimum: 0,
      },
      num_folders: {
        description: "Anti-Leecher: minimum shared folders",
        type: "int",
        minimum: 1,
      },
      send_message_to_leechers: { description: "Anti-Leecher: send PM to leechers", type: "bool" },
      ban_leechers: { description: "Anti-Leecher: ban leechers", type: "bool" },
      ignore_leechers: { description: "Anti-Leecher: ignore leechers", type: "bool" },
      ban_block_ip: { description: "Anti-Leecher: block leecher IP (if known)", type: "bool" },
      enable_sus_detector: { description: "Anti-Leecher: detect suspicious sharing patterns", type: "bool" },
      sus_pattern_500_25: { description: "Anti-Leecher: suspicious pattern 500 files / 25 folders", type: "bool" },
      sus_pattern_1000_50: { description: "Anti-Leecher: suspicious pattern 1000 files / 50 folders", type: "bool" },
      sus_pattern_1500_75: { description: "Anti-Leecher: suspicious pattern 1500 files / 75 folders", type: "bool" },
      sus_pattern_2000_100: { description: "Anti-Leecher: suspicious pattern 2000 files / 100 folders", type: "bool" },
      auto_unban: {
        description: "Anti-Leecher: automatically unban/unignore users when they share enough",
        type: "bool",
      },
      detected_leechers: {
        description: "Anti-Leecher: detected leechers",
        type: "list string",
      },
      enable_proveit: {
        description: "ProveIt: require a simple chat captcha before allowing uploads (buddies are exempt)",
        type: "bool",
      },
      proveit_first_message: {
        description:
          "ProveIt: private message sent when a non-verified user queues a download (subject to cooldown). Each line is sent as a separate message.",
        type: "textview",
      },
      proveit_success_message: {
        description:
          "ProveIt: private message sent after the user sends the captcha word. Each line is sent as a separate message.",
        type: "textview",
      },
      proveit_captcha_word: {
        description: "ProveIt: word users must type in private chat to verify (case-insensitive)",
        type: "str",
      },
      proveit_cooldown_seconds: {
        description: "ProveIt: minimum seconds between sending the first-download message to the same user",
        type: "int",
        minimum: 0,
      },
      proveit_auto_retry_uploads: {
        description:
          "ProveIt: automatically re-queue denied uploads after captcha verification. If disabled, users must retry manually.",
        type: "bool",
      },
      proveit_require_minimum_shares: {
        description:
          "ProveIt: require Anti-Leecher minimum files/folders before whitelisting after captcha (recommended). When enabled, users below your minimum are banned like other leechers instead of being added to the whitelist.",
        type: "bool",
      },
      proveit_fail_message: {
        description:
          "ProveIt: PM sent when captcha is correct but share counts are below your minimum (when proveit_require_minimum_shares is enabled).",
        type: "textview",
      },
      proveit_verifying_shares_message: {
        description:
          "ProveIt: optional PM while waiting for Soulseek share stats after captcha (leave empty to skip).",
        type: "textview",
      },
      proveit_verified_users: {
        description: "ProveIt: users who completed the captcha (whitelist)",
        type: "list string",
      },
    };
  }

  loaded_notification(): void {
    const minFiles = (this.metasettings["num_files"]?.minimum as number | undefined) ?? 0;
    const minFolders = (this.metasettings["num_folders"]?.minimum as number | undefined) ?? 1;
    if (this.intSetting("num_files") < minFiles) this.settings["num_files"] = minFiles;
    if (this.intSetting("num_folders") < minFolders) this.settings["num_folders"] = minFolders;
    this.ensureList("detected_leechers");
    this.ensureList("proveit_verified_users");

    const patterns: Array<[number, number]> = [];
    if (this.boolSetting("sus_pattern_1000_50")) patterns.push([1000, 50]);
    if (this.boolSetting("sus_pattern_2000_100")) patterns.push([2000, 100]);
    if (this.boolSetting("sus_pattern_1500_75")) patterns.push([1500, 75]);
    if (this.boolSetting("sus_pattern_500_25")) patterns.push([500, 25]);
    this.settings["sus_patterns"] = patterns;

    const cd = Number(this.settings["proveit_cooldown_seconds"] ?? 300);
    this.settings["proveit_cooldown_seconds"] = Math.max(0, Number.isFinite(cd) ? Math.trunc(cd) : 300);

    this.log(`Require users have a minimum of ${this.settings["num_files"]} files in ${this.settings["num_folders"]} shared public folders.`);
    this.log(`Suspicious patterns loaded: ${JSON.stringify(patterns)}`);
  }

  // --- small accessors ---

  private boolSetting(key: string): boolean {
    return !!this.settings[key];
  }

  private intSetting(key: string, fallback = 0): number {
    const n = Number(this.settings[key] ?? fallback);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  private ensureList(key: string): string[] {
    const v = this.settings[key];
    if (!Array.isArray(v)) {
      const arr: string[] = [];
      this.settings[key] = arr;
      return arr;
    }
    return v as string[];
  }

  /** Optional transport hooks (ban/ignore/deny/retry) — no-op when core shim lacks them. */
  private callCoreHook(name: string, ...args: unknown[]): unknown {
    try {
      const c = this.core as unknown as Record<string, unknown> | null;
      if (!c) return undefined;
      const fn = c[name];
      if (typeof fn === "function") return (fn as (...a: unknown[]) => unknown).apply(this.core, args);
      const nf = c["network_filter"] as Record<string, unknown> | undefined;
      const snake: Record<string, string> = {
        banUser: "ban_user",
        ignoreUser: "ignore_user",
        unbanUser: "unban_user",
        unignoreUser: "unignore_user",
        isUserBanned: "is_user_banned",
        isUserIgnored: "is_user_ignored",
      };
      const sfn = nf?.[snake[name] ?? ""];
      if (typeof sfn === "function") return (sfn as (...a: unknown[]) => unknown).apply(nf, args);
    } catch {}
    return undefined;
  }

  private isUserBanned(user: string): boolean {
    try {
      return !!this.callCoreHook("isUserBanned", user);
    } catch {
      return false;
    }
  }

  private isBuddyUser(user: string): boolean {
    try {
      return this.core?.isBuddy?.(user) ?? false;
    } catch {
      return false;
    }
  }

  // --- messaging ---

  private sendPrivateLines(user: string, text: string): void {
    if (!text) return;
    const showUI = !this.boolSetting("hide_plugin_messages");
    const openChat = this.boolSetting("open_private_chat");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        this.send_private(user, line, showUI, openChat);
      } catch (e) {
        this.log(`Failed to send PM to ${user}: ${e}`);
      }
    }
  }

  private sendPm(user: string): void {
    if (!this.boolSetting("send_message_to_leechers")) return;
    const msg = String(this.settings["message"] ?? "");
    if (!msg.trim()) return;
    let rendered = msg;
    for (const [ph, key] of Object.entries(Plugin.PLACEHOLDERS)) {
      rendered = rendered.split(ph).join(String(this.settings[key] ?? 0));
    }
    this.sendPrivateLines(user, rendered);
  }

  /** Ban / ignore / IP-block per toggles. Messaging handled by caller (immediate vs deferred). */
  private applyLeechActions(user: string, withMessage: boolean): string[] {
    const actions: string[] = [];
    if (this.boolSetting("ban_leechers")) {
      this.callCoreHook("banUser", user);
      actions.push("banned");
    }
    if (this.boolSetting("ignore_leechers")) {
      this.callCoreHook("ignoreUser", user);
      actions.push("ignored");
    }
    if (this.boolSetting("ban_block_ip")) {
      const ok = this.callCoreHook("blockIp", user);
      if (ok) actions.push("IP blocked");
      else this.log(`IP block failed: No IP for ${user}`);
    }
    if (withMessage && this.boolSetting("send_message_to_leechers")) {
      this.sendPm(user);
      actions.push("messaged");
    }
    return actions;
  }

  private unbanAndUnignoreIfOkay(user: string, numFiles: number, numFolders: number): void {
    if (!this.boolSetting("auto_unban")) return;
    const ok = numFiles >= this.intSetting("num_files") && numFolders >= this.intSetting("num_folders");
    if (!ok && !this.isBuddyUser(user)) return;
    if (this.isUserBanned(user)) {
      this.callCoreHook("unbanUser", user);
      this.log(`User '${user}' was banned but now meets requirements. Unbanned.`);
    }
    try {
      if (!!this.callCoreHook("isUserIgnored", user)) {
        this.callCoreHook("unignoreUser", user);
        this.log(`User '${user}' was ignored but now meets requirements. Unignored.`);
      }
    } catch {}
  }

  // --- leecher check ---

  private checkUser(user: string, numFiles: number, numFolders: number, source = "server"): void {
    if (!this.probedUsers.has(user)) return;
    const state = this.probedUsers.get(user)!;
    if (state === "okay") return;
    if (state === "requesting_shares" && source !== "peer") return;
    this.statsCache.set(user, { files: numFiles, dirs: numFolders });

    const needFiles = this.intSetting("num_files");
    const needFolders = this.intSetting("num_folders");
    const detected = this.ensureList("detected_leechers");

    // Suspicious exact-match detector runs before the minimum check.
    if (this.boolSetting("enable_sus_detector")) {
      const patterns = (this.settings["sus_patterns"] as Array<[number, number]> | undefined) ?? [];
      for (const [pf, pd] of patterns) {
        if (numFiles === pf && numFolders === pd) {
          const actions = this.applyLeechActions(user, true);
          this.probedUsers.set(user, "processed_leecher");
          if (!detected.includes(user)) detected.push(user);
          this.log(`Suspicious user ${user}: ${pf} files, ${pd} folders. ${actions.join(", ")}`);
          return;
        }
      }
    }

    const isAccepted = numFiles >= needFiles && numFolders >= needFolders;
    const isBuddy = this.isBuddyUser(user);

    if (isAccepted || isBuddy) {
      const idx = detected.indexOf(user);
      if (idx >= 0) detected.splice(idx, 1);
      this.probedUsers.set(user, "okay");
      if (isAccepted) this.log(`User ${user} is okay, sharing ${numFiles} files in ${numFolders} folders.`);
      else this.log(`Buddy ${user} is sharing ${numFiles} files in ${numFolders} folders. Not complaining.`);
      this.unbanAndUnignoreIfOkay(user, numFiles, numFolders);
      return;
    }

    if (!state.startsWith("requesting")) return;

    if (detected.includes(user)) {
      this.probedUsers.set(user, "processed_leecher");
      return;
    }

    if ((numFiles <= 0 || numFolders <= 0) && state !== "requesting_shares") {
      this.log(`User ${user} has no shared files according to the server, requesting shares to verify…`);
      this.probedUsers.set(user, "requesting_shares");
      try {
        this.core?.requestUserShares?.(user);
      } catch {}
      return;
    }

    const actions = this.applyLeechActions(user, false);
    this.log(`Leecher detected: ${user} — ${numFiles} files / ${numFolders} folders. ${actions.join(", ")}.`);
    this.probedUsers.set(user, "pending_leecher");
    if (!detected.includes(user)) detected.push(user);
  }

  // --- ProveIt ---

  private proveitIsExempt(user: string): boolean {
    if (!this.boolSetting("enable_proveit")) return true;
    if (this.isBuddyUser(user)) return true;
    if (this.ensureList("proveit_verified_users").includes(user)) return true;
    return false;
  }

  private proveitSendLines(user: string, text: string): void {
    this.sendPrivateLines(user, text);
  }

  private proveitMaybeSendFirstPrompt(user: string): void {
    if (this.isUserBanned(user)) return;
    const text = String(this.settings["proveit_first_message"] ?? "");
    if (!text.trim()) return;
    const cd = this.intSetting("proveit_cooldown_seconds", 0);
    const cooldown = Math.max(0, cd);
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const last = this.proveitLastPrompt.get(user);
    if (last !== undefined && now - last < cooldown) return;
    this.proveitLastPrompt.set(user, now);
    this.proveitSendLines(user, text);
  }

  private proveitRejectUpload(user: string, virtualPath: string): void {
    const pending = this.proveitPendingUploads.get(user) ?? [];
    if (!pending.includes(virtualPath)) pending.push(virtualPath);
    this.proveitPendingUploads.set(user, pending);
    this.callCoreHook("denyUpload", user, virtualPath);
    this.proveitMaybeSendFirstPrompt(user);
  }

  private proveitGrantCore(user: string): void {
    const verified = this.ensureList("proveit_verified_users");
    if (!verified.includes(user)) verified.push(user);
    if (this.boolSetting("proveit_auto_retry_uploads")) {
      const pending = this.proveitPendingUploads.get(user) ?? [];
      this.proveitPendingUploads.delete(user);
      let retried = 0;
      for (const vp of pending) {
        this.callCoreHook("retryUploads", user, vp);
        retried++;
      }
      if (pending.length) this.log(`ProveIt: retried ${retried} pending uploads for ${user}.`);
    } else {
      this.proveitPendingUploads.delete(user);
    }
  }

  private proveitGrantVerification(user: string, hideIncoming: boolean): unknown {
    this.proveitGrantCore(user);
    const ok = String(this.settings["proveit_success_message"] ?? "");
    if (ok.trim()) this.proveitSendLines(user, ok);
    this.log(`ProveIt: user ${user} verified via captcha.`);
    if (hideIncoming) return returncode.zap;
    return undefined;
  }

  private proveitApplyLeechActions(user: string, numFiles: number, numFolders: number): void {
    const actions = this.applyLeechActions(user, true);
    const detected = this.ensureList("detected_leechers");
    if (!detected.includes(user)) detected.push(user);
    this.log(`ProveIt: rejected whitelist for ${user} — ${numFiles} files / ${numFolders} folders (below minimum). ${actions.join(", ")}.`);
  }

  private proveitAttemptShareGate(user: string, hideIncoming: boolean): unknown {
    if (!this.boolSetting("proveit_require_minimum_shares")) {
      return this.proveitGrantVerification(user, hideIncoming);
    }
    const cached = this.statsCache.get(user);
    if (!cached) {
      this.proveitPendingShareVerify.add(user);
      const vm = String(this.settings["proveit_verifying_shares_message"] ?? "");
      if (vm.trim()) this.proveitSendLines(user, vm);
      try {
        this.core?.requestUserStats?.(user);
      } catch {}
      try {
        this.core?.requestUserShares?.(user);
      } catch {}
      return undefined;
    }
    if (cached.files >= this.intSetting("num_files") && cached.dirs >= this.intSetting("num_folders")) {
      return this.proveitGrantVerification(user, hideIncoming);
    }
    this.proveitPendingUploads.delete(user);
    const fail = String(this.settings["proveit_fail_message"] ?? "");
    if (fail.trim()) this.proveitSendLines(user, fail);
    this.proveitApplyLeechActions(user, cached.files, cached.dirs);
    return undefined;
  }

  private proveitResolvePendingAfterStats(user: string, numFiles: number, numFolders: number): void {
    if (!this.proveitPendingShareVerify.has(user)) return;
    this.proveitPendingShareVerify.delete(user);
    if (this.isUserBanned(user)) {
      this.proveitPendingUploads.delete(user);
      this.log(`ProveIt: cancelled pending verification for ${user} (user already banned).`);
      return;
    }
    if (numFiles >= this.intSetting("num_files") && numFolders >= this.intSetting("num_folders")) {
      this.proveitGrantCore(user);
      const ok = String(this.settings["proveit_success_message"] ?? "");
      if (ok.trim()) this.proveitSendLines(user, ok);
      this.log(`ProveIt: user ${user} verified after share stats arrived.`);
      return;
    }
    this.proveitPendingUploads.delete(user);
    const fail = String(this.settings["proveit_fail_message"] ?? "");
    if (fail.trim()) this.proveitSendLines(user, fail);
    this.proveitApplyLeechActions(user, numFiles, numFolders);
  }

  private static normalizeCaptcha(text: unknown): string {
    if (text === null || text === undefined) return "";
    const s = String(text).normalize("NFC").trim().toLowerCase();
    return s.split(/\s+/).filter(Boolean).join(" ");
  }

  private configuredCaptchaWord(): string {
    const raw = this.settings["proveit_captcha_word"];
    const first = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "download");
    return Plugin.normalizeCaptcha(first);
  }

  // --- notifications ---

  upload_queued_notification(user: string, virtualPath: string, _realPath?: string): void {
    if (!this.probedUsers.has(user)) {
      this.probedUsers.set(user, "requesting_stats");
      const cached = this.statsCache.get(user);
      if (cached) this.checkUser(user, cached.files, cached.dirs);
      try {
        this.core?.requestUserStats?.(user);
      } catch {}
    }
    if (this.boolSetting("enable_proveit") && !this.proveitIsExempt(user)) {
      this.proveitRejectUpload(user, virtualPath);
    }
  }

  user_stats_notification(user: string, stats: unknown): void {
    // stats shape from server: { username, avgspeed, files, dirs, ... } or { files, dirs, source }
    const s = stats as Record<string, unknown> | null;
    if (!s) return;
    const files = Number((s["files"] as number | undefined) ?? 0) || 0;
    const dirs = Number((s["dirs"] as number | undefined) ?? 0) || 0;
    const source = (s["source"] as string | undefined) ?? "server";
    this.checkUser(user, files, dirs, source);
    this.proveitResolvePendingAfterStats(user, files, dirs);
  }

  upload_finished_notification(user: string, _virtualPath: string, _realPath?: string): void {
    if (!this.probedUsers.has(user)) return;
    if (this.probedUsers.get(user) !== "pending_leecher") return;
    this.probedUsers.set(user, "processed_leecher");
    this.sendPm(user);
    const detected = this.ensureList("detected_leechers");
    if (!detected.includes(user)) detected.push(user);
    const msg = String(this.settings["message"] ?? "");
    if (!msg.trim()) {
      this.log(`Leecher ${user} doesn't share enough files. No message is specified in plugin settings.`);
    } else if (!this.boolSetting("send_message_to_leechers")) {
      this.log(`Leecher ${user} doesn't share enough files. Messaging disabled, logged only.`);
    } else {
      this.log(`Leecher ${user} doesn't share enough files. Message sent.`);
    }
  }

  incoming_private_chat_event(user: string, line: string): unknown {
    if (!this.boolSetting("enable_proveit")) return undefined;
    if (this.isBuddyUser(user)) return undefined;
    if (this.isUserBanned(user)) return undefined;
    if (this.ensureList("proveit_verified_users").includes(user)) return undefined;
    const word = this.configuredCaptchaWord();
    if (!word) return undefined;
    const candidate = Plugin.normalizeCaptcha(line);
    if (!candidate.includes(word)) return undefined;
    const hideIncoming = this.boolSetting("hide_plugin_messages");
    return this.proveitAttemptShareGate(user, hideIncoming);
  }
}
