// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/plugins/spamfilter/__init__.py

/**
 * Spamfilter — port of pynicotine/plugins/spamfilter/__init__.py
 * Demonstrates zap event handling + settings/metasettings.
 */

import { BasePlugin, returncode } from "../types.ts";

export const manifest = {
  Name: "Spamfilter",
  Version: "2021-05-11r00",
  Authors: ["Nicotine+"],
  Description: "Blocks ASCII art, long lines, and phrase spam.",
  apiVersion: 1,
  entry: "spamfilter.ts",
};

export class Plugin extends BasePlugin {
  constructor() {
    super();
    this.settings = {
      minlength: 200,
      maxlength: 400,
      maxdiffcharacters: 10,
      badprivatephrases: [] as string[],
    };
    this.metasettings = {
      minlength: { description: "Min length before considered ASCII spam", group: "Spam Thresholds", type: "integer" },
      maxdiffcharacters: { description: "Max different characters still considered ASCII spam", group: "Spam Thresholds", type: "integer" },
      maxlength: { description: "Max length before considered spam", group: "Spam Thresholds", type: "integer" },
      badprivatephrases: { description: "Filter chat messages containing phrase:", group: "Filtered Phrases", type: "list string" },
    };
  }

  loaded_notification(): void {
    this.log(`A line should be at least ${this.settings["minlength"]} long with max ${this.settings["maxdiffcharacters"]} diff chars before ASCII spam.`);
  }

  checkPhrases(_user: string, line: string): number | null {
    const phrases = (this.settings["badprivatephrases"] as string[]) ?? [];
    for (const phrase of phrases) {
      if (line.toLowerCase().includes(phrase.toLowerCase())) {
        this.log(`Blocked spam from ${_user}: ${line}`);
        return returncode.zap;
      }
    }
    return null;
  }

  incoming_public_chat_event(room: string, user: string, line: string): number | null | undefined {
    if (line.length >= (this.settings["minlength"] as number) && new Set(line).size < (this.settings["maxdiffcharacters"] as number)) {
      this.log(`Filtered ASCII spam from "${user}" in room "${room}"`);
      return returncode.zap;
    }
    if (line.length > (this.settings["maxlength"] as number)) {
      this.log(`Filtered long line (${line.length} chars) from "${user}" in room "${room}"`);
      return returncode.zap;
    }
    return this.checkPhrases(user, line) ?? undefined;
  }

  incoming_private_chat_event(user: string, line: string): number | null | undefined {
    return this.checkPhrases(user, line) ?? undefined;
  }
}
