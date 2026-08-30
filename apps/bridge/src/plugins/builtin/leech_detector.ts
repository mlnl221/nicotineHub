// SPDX-FileCopyrightText: 2020-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/plugins/leech_detector/__init__.py

/**
 * LeechDetector — port of pynicotine/plugins/leech_detector/__init__.py
 * Detects leechers (users sharing too few files/folders) and messages them after upload.
 */

import { BasePlugin } from "../types.ts";

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
  private probedUsers = new Map<string, LeechState>();

  constructor() {
    super();
    this.settings = {
      message: "Please consider sharing more files if you would like to download from me again. Thanks :)",
      open_private_chat: true,
      num_files: 1,
      num_folders: 1,
      detected_leechers: [] as string[],
    };
    this.metasettings = {
      message: {
        description:
          "Private chat message to send to leechers. Each line is sent as a separate message, too many message lines may get you temporarily banned for spam!",
        group: "Automatic Message",
        type: "textview",
      },
      open_private_chat: {
        description: "Open chat tabs when sending private messages to leechers",
        group: "Automatic Message",
        type: "bool",
      },
      num_files: {
        description: "Require users to have a minimum number of shared files:",
        group: "Limits",
        type: "int",
        minimum: 0,
      },
      num_folders: {
        description: "Require users to have a minimum number of shared folders:",
        group: "Limits",
        type: "int",
        minimum: 1,
      },
      detected_leechers: {
        description: "Detected leechers",
        group: "Detected Leechers",
        type: "list string",
      },
    };
  }

  loaded_notification(): void {
    const minFiles = (this.metasettings["num_files"]?.minimum as number | undefined) ?? 0;
    const minFolders = (this.metasettings["num_folders"]?.minimum as number | undefined) ?? 1;
    if ((this.settings["num_files"] as number) < minFiles) this.settings["num_files"] = minFiles;
    if ((this.settings["num_folders"] as number) < minFolders) this.settings["num_folders"] = minFolders;
    this.log(`Require users have a minimum of ${this.settings["num_files"]} files in ${this.settings["num_folders"]} shared public folders.`);
  }

  private checkUser(user: string, numFiles: number, numFolders: number, source = "server"): void {
    if (!this.probedUsers.has(user)) return;
    const state = this.probedUsers.get(user)!;
    if (state === "okay") return;
    if (state === "requesting_shares" && source !== "peer") return;

    const needFiles = this.settings["num_files"] as number;
    const needFolders = this.settings["num_folders"] as number;
    const isAccepted = numFiles >= needFiles && numFolders >= needFolders;

    // Buddy exempt — bridge has no buddy list in core shim; check via isBuddy if available, else false.
    // In web, buddies are managed client-side and usually exempt; in bridge we treat buddies as okay if we can detect.
    const isBuddy = (this.core as unknown as { isBuddy?: (u: string) => boolean })?.isBuddy?.(user) ?? false;
    const detected = this.settings["detected_leechers"] as string[];

    if (isAccepted || isBuddy) {
      const idx = detected.indexOf(user);
      if (idx >= 0) detected.splice(idx, 1);
      this.probedUsers.set(user, "okay");
      if (isAccepted) this.log(`User ${user} is okay, sharing ${numFiles} files in ${numFolders} folders.`);
      else this.log(`Buddy ${user} is sharing ${numFiles} files in ${numFolders} folders. Not complaining.`);
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
      // Try to request shares via core shim if available
      const reqShares = (this.core as unknown as { requestUserShares?: (u: string) => void })?.requestUserShares;
      if (reqShares) {
        try {
          reqShares.call(this.core, user);
        } catch {}
      }
      return;
    }

    const hasMessage = !!((this.settings["message"] as string) || "").trim();
    if (hasMessage) this.log(`Leecher detected, ${user} is only sharing ${numFiles} files in ${numFolders} folders. Going to message leecher after transfer…`);
    else this.log(`Leecher detected, ${user} is only sharing ${numFiles} files in ${numFolders} folders. Going to log leecher after transfer…`);
    this.probedUsers.set(user, "pending_leecher");
  }

  upload_queued_notification(user: string, _virtualPath: string, _realPath?: string): void {
    if (this.probedUsers.has(user)) return;
    this.probedUsers.set(user, "requesting_stats");
    // Try to request stats via core shim
    const reqStats = (this.core as unknown as { requestUserStats?: (u: string) => void })?.requestUserStats;
    if (reqStats) {
      try {
        reqStats.call(this.core, user);
      } catch {}
    }
    // If no shim, we wait for user_stats_notification that server will emit when stats arrive (watchUser flow)
  }

  user_stats_notification(user: string, stats: unknown): void {
    // stats shape from server: { username, avgspeed, files, dirs, ... } or { files, dirs, source }
    const s = stats as Record<string, unknown> | null;
    if (!s) return;
    // Normalize: nicotine stats["files"] / ["dirs"] or ["files"] / ["dirs"] with source
    const files = (s["files"] as number | undefined) ?? (s["files"] as number | undefined) ?? 0;
    const dirs = (s["dirs"] as number | undefined) ?? (s["dirs"] as number | undefined) ?? 0;
    const source = (s["source"] as string | undefined) ?? "server";
    // Other fields like s["username"] may be present but we already have user param
    this.checkUser(user, Number(files) || 0, Number(dirs) || 0, source);
  }

  // Also handle peer share response as folder count verification
  // Bridge emits browse events, but plugin can also hook via user_stats with source peer when shares arrive
  // For simplicity, if we requested shares and get browse-shares equivalent stats, treat as peer source.

  upload_finished_notification(user: string, _virtualPath: string, _realPath?: string): void {
    if (!this.probedUsers.has(user)) return;
    if (this.probedUsers.get(user) !== "pending_leecher") return;
    this.probedUsers.set(user, "processed_leecher");
    const msg = (this.settings["message"] as string) || "";
    if (!msg.trim()) {
      this.log(`Leecher ${user} doesn't share enough files. No message is specified in plugin settings.`);
      return;
    }
    const openChat = this.settings["open_private_chat"] as boolean;
    const placeholders: Record<string, string> = {
      "%files%": String(this.settings["num_files"] as number),
      "%folders%": String(this.settings["num_folders"] as number),
    };
    for (const rawLine of msg.split("\n")) {
      let line = rawLine;
      for (const [ph, val] of Object.entries(placeholders)) line = line.split(ph).join(val);
      if (!line.trim()) continue;
      try {
        this.send_private(user, line, openChat, false);
      } catch {}
    }
    const detected = this.settings["detected_leechers"] as string[];
    if (!detected.includes(user)) detected.push(user);
    this.log(`Leecher ${user} doesn't share enough files. Message sent.`);
  }
}
