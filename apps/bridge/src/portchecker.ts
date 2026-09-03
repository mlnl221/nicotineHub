// SPDX-FileCopyrightText: 2025-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Port of pynicotine/portchecker.py to Bun/TS — external host check via https://www.slsknet.org/porttest.php

import { logger } from "./logger.ts";

export const PORT_CHECKER_URL = "https://www.slsknet.org/porttest.php?port=%s";
export const PORT_CHECKER_TIMEOUT_MS = 5000;

export type PortCheckResult = { port: number; open: boolean | null; error?: string; raw?: string };

/**
 * Retrieve port status from external host (slsknet.org).
 * Mirrors pynicotine/portchecker.py _retrieve_status:
 *   GET https://www.slsknet.org/porttest.php?port=PORT → body contains "PORT/tcp open" or "PORT/tcp closed"
 * Returns true=open, false=closed, null=unknown/error.
 */
export async function retrievePortStatus(port: number, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  const url = PORT_CHECKER_URL.replace("%s", String(port));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PORT_CHECKER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { "User-Agent": "NicotineHub/1.0" } });
    const body = (await res.text()).toLowerCase();
    clearTimeout(t);
    if (body.includes(`${port}/tcp open`)) return true;
    if (body.includes(`${port}/tcp closed`)) return false;
    throw new Error(`Unknown response from port checker: ${body.slice(0, 500)}`);
  } catch (e) {
    clearTimeout(t);
    if ((e as Error).name === "AbortError") throw new Error("Port checker timeout");
    throw e;
  }
}

export class PortChecker {
  private _running = false;

  async checkStatus(port: number): Promise<PortCheckResult> {
    if (this._running) return { port, open: null, error: "already checking" };
    this._running = true;
    try {
      const open = await retrievePortStatus(port);
      logger.info("portchecker", `port ${port} is ${open ? "open" : "closed"} (external check)`, { port, open });
      return { port, open };
    } catch (e) {
      const msg = (e as Error).message;
      logger.debug("portchecker", `Unable to check status of port ${port}: ${msg}`, { port, error: msg });
      return { port, open: null, error: msg };
    } finally {
      this._running = false;
    }
  }
}

// Singleton for server.ts
export const portChecker = new PortChecker();
