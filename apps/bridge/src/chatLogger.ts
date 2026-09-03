// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Chat log facility — nicotine-plus parity under CONFIG_DIR/logs
 *
 * Mirrors pynicotine/logfacility.py + chatrooms.py:606 and privatechat.py:466
 *  - folder_path = CONFIG_DIR/logs/rooms or logs/private (like logfacility room_folder_path)
 *  - basename = room / username (sanitized)
 *  - text = "[user] msg" or "* user msg" for /me actions, with timestamp prefix
 *  - write_log_file uses config.log_timestamp ("%x %X" default) -> we use "%Y-%m-%d %H:%M:%S" ISO
 *  - nicotine appends unlimited to <basename>.log; we split daily: <basename>/YYYY-MM-DD.log
 *    per user request (unlimited, only actively joined rooms)
 */

import { mkdirSync, appendFileSync, chmodSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

function getConfigDir(): string {
  return resolve(process.env.CONFIG_DIR || "/config");
}

function sanitizeBasename(name: string): string {
  // Mirrors safe_path_join + logfacility: replace separators, control chars, limit
  let s = String(name).replace(/[\x00-\x1f\x7f\/\\]/g, "_").trim();
  s = s.replace(/^\.+/, "_"); // no hidden
  if (!s) s = "_";
  if (s.length > 64) s = s.slice(0, 64);
  // Keep ascii safe, replace non-printable
  s = s.replace(/[^ -~]/g, "_");
  return s;
}

function ensureDir(p: string) {
  try { mkdirSync(p, { recursive: true }); } catch {}
}

function dailyPath(folderPath: string, basename: string): string {
  const safe = sanitizeBasename(basename);
  // daily split: folder/<safe>/YYYY-MM-DD.log (user requested daily, only active rooms)
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = join(folderPath, safe);
  ensureDir(dir);
  return join(dir, `${date}.log`);
}

function timestampPrefix(): string {
  // nicotine: time.strftime(config.sections["logging"]["log_timestamp"]) default "%x %X"
  // We use ISO sortable same as typical nicotine config override "%Y-%m-%d %H:%M:%S"
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function appendLogFile(filePath: string, line: string) {
  try {
    const existed = existsSync(filePath);
    appendFileSync(filePath, line + "\n", { encoding: "utf8" });
    if (!existed) {
      try { chmodSync(filePath, 0o600); } catch {}
    }
  } catch {}
}

/** Log a public room message — only call while room is joined (active rooms) */
export function logRoomMessage(room: string, username: string, message: string, opts?: { isAction?: boolean; isGlobal?: boolean; globalRoom?: string }) {
  const configDir = getConfigDir();
  const roomFolder = join(configDir, "logs", "rooms");
  const isAction = !!opts?.isAction;
  // nicotine chatrooms.py:605-608: f"* {username} {message}" else f"[{username}] {message}"
  let formatted: string;
  if (isAction) formatted = `* ${username} ${message}`;
  else formatted = `[${username}] ${message}`;
  if (opts?.isGlobal && opts.globalRoom) {
    formatted = `${opts.globalRoom} | ${formatted}`;
  }
  const ts = timestampPrefix();
  const line = `${ts} ${formatted}`;
  const filePath = dailyPath(roomFolder, room);
  appendLogFile(filePath, line);
}

/** Log a private message — both incoming and outgoing */
export function logPrivateMessage(peerUsername: string, tagUsername: string, message: string, opts?: { isAction?: boolean }) {
  const configDir = getConfigDir();
  const privateFolder = join(configDir, "logs", "private");
  const isAction = !!opts?.isAction;
  let formatted: string;
  if (isAction) formatted = `* ${tagUsername} ${message}`;
  else formatted = `[${tagUsername}] ${message}`;
  const ts = timestampPrefix();
  const line = `${ts} ${formatted}`;
  const filePath = dailyPath(privateFolder, peerUsername);
  appendLogFile(filePath, line);
}

/** Log room system events (join/leave) — optional, mirrors nicotine logfacility add() but we keep simple */
export function logRoomSystem(room: string, text: string) {
  const configDir = getConfigDir();
  const roomFolder = join(configDir, "logs", "rooms");
  const ts = timestampPrefix();
  const line = `${ts} ${text}`;
  const filePath = dailyPath(roomFolder, room);
  appendLogFile(filePath, line);
}
