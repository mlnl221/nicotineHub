// SPDX-FileCopyrightText: 2025-2026 nicotine-mobile Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Persistent diagnostics logger — ring buffer + file-backed.
 *
 * Requirements (hybrid spec):
 * - visible to all logged-in users
 * - persistent (survives restart) via DATA_DIR/diagnostics.log (JSONL)
 * - 500 lines shown (cap stored at 2000, tail 500)
 * - covers everything: bridge server, Soulseek session, transfers, search, WS
 * - WS broadcast throttled, file append atomic
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogScope = "bridge" | "server" | "peer" | "transfer" | "search" | "chat" | "system" | "auth";

export interface LogEntry {
  ts: string; // ISO
  level: LogLevel;
  scope: LogScope;
  msg: string;
  meta?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MAX_MEMORY = 2000;
const MAX_PERSIST = 2000;

let dataDir = process.env.DATA_DIR || "/data";
let filePath = join(dataDir, "diagnostics.log");

const ring: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();

let loaded = false;

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || !!process.env.BUN_TEST || !!process.env.CI;
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  dataDir = process.env.DATA_DIR || "/data";
  filePath = join(dataDir, "diagnostics.log");
  if (isTestEnv()) {
    // isolated in-memory only for tests; don't read/ pollute /data
    return;
  }
  try { mkdirSync(dataDir, { recursive: true }); } catch {}
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      // keep last MAX_PERSIST
      const tail = lines.slice(-MAX_PERSIST);
      for (const line of tail) {
        try {
          const e = JSON.parse(line) as LogEntry;
          if (e.ts && e.level && e.scope && e.msg) ring.push(e);
        } catch {}
      }
    }
  } catch {}
}

function persist(entry: LogEntry) {
  if (isTestEnv()) return;
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
    // trim file if > MAX_PERSIST (rewrite)
    // cheap: check ring length, if exceeds, rewrite file from ring
    if (ring.length > MAX_PERSIST) {
      const tail = ring.slice(-MAX_PERSIST);
      writeFileSync(filePath, tail.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    }
  } catch {}
}

function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "password" || k === "pass" || k === "pwd") out[k] = "***";
    else if (typeof v === "string" && v.length > 500) out[k] = v.slice(0, 500) + "…";
    else out[k] = v;
  }
  return out;
}

function truncateMsg(msg: string): string {
  if (msg.length > 800) return msg.slice(0, 800) + "…";
  return msg;
}

export function diagLog(level: LogLevel, scope: LogScope, msg: string, meta?: Record<string, unknown>) {
  ensureLoaded();
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: truncateMsg(msg),
    meta: redactMeta(meta),
  };
  ring.push(entry);
  if (ring.length > MAX_MEMORY) ring.shift();
  // persist info/warn/error always; debug also persisted but filtered on read
  persist(entry);
  for (const cb of listeners) try { cb(entry); } catch {}
  // also console for docker logs — suppress during tests (only warn/error)
  if (isTestEnv()) {
    if (level === "warn" || level === "error") {
      const line = `[${entry.ts}] ${level.toUpperCase()} [${scope}] ${msg}${meta ? " " + JSON.stringify(redactMeta(meta)) : ""}`;
      if (level === "error") console.error(line);
      else console.warn(line);
    }
  } else {
    const line = `[${entry.ts}] ${level.toUpperCase()} [${scope}] ${msg}${meta ? " " + JSON.stringify(redactMeta(meta)) : ""}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export function diagSubscribe(cb: (entry: LogEntry) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function diagTail(n = 500, minLevel: LogLevel = "debug"): LogEntry[] {
  ensureLoaded();
  const threshold = LEVEL_ORDER[minLevel];
  const filtered = ring.filter((e) => LEVEL_ORDER[e.level] >= threshold);
  return filtered.slice(-n);
}

export function diagClear() {
  ensureLoaded();
  ring.length = 0;
  try { writeFileSync(filePath, "", "utf8"); } catch {}
}

export function diagStats() {
  ensureLoaded();
  return { total: ring.length, file: filePath, dataDir };
}

// convenience
export const logger = {
  debug: (scope: LogScope, msg: string, meta?: Record<string, unknown>) => diagLog("debug", scope, msg, meta),
  info: (scope: LogScope, msg: string, meta?: Record<string, unknown>) => diagLog("info", scope, msg, meta),
  warn: (scope: LogScope, msg: string, meta?: Record<string, unknown>) => diagLog("warn", scope, msg, meta),
  error: (scope: LogScope, msg: string, meta?: Record<string, unknown>) => diagLog("error", scope, msg, meta),
};
