// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Shared server-held Soulseek session helpers.
 *
 * The bridge owns ONE Soulseek login (one account at a time). Any client on
 * the home network attaches to that singleton instead of opening its own
 * Soulseek TCP connection (which the Soulseek server would kick — login fight).
 *
 * This module holds the pure/testable parts:
 *  - resolveLoginIntent: conflict/takeover decision for an incoming login
 *  - encrypted credential vault (CONFIG_DIR/session.vault, 0600) so the
 *    singleton survives bridge restarts; key in CONFIG_DIR/.vault.key (0600)
 *    or derived from BRIDGE_VAULT_KEY env.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface StoredCreds {
  username: string;
  password: string;
  host?: string;
  port?: number;
}

export type LoginIntent = "fresh" | "attach" | "conflict" | "replace";

export function resolveLoginIntent(opts: {
  /** Is the singleton session currently logged in? */
  loggedIn: boolean;
  /** Username owning the singleton (when logged in). */
  currentUser?: string | null;
  /** Username of the incoming login request. */
  username: string;
  /** Explicit user-confirmed takeover from the conflict popup. */
  force?: boolean;
}): LoginIntent {
  if (!opts.loggedIn) return "fresh";
  if (opts.currentUser === opts.username) return "attach";
  return opts.force ? "replace" : "conflict";
}

const VAULT_FILE = "session.vault";
const KEY_FILE = ".vault.key";

function keyPath(configDir: string): string {
  return join(configDir, KEY_FILE);
}

function vaultPath(configDir: string): string {
  return join(configDir, VAULT_FILE);
}

/** 32-byte AES key: derived from BRIDGE_VAULT_KEY env, else a generated key file. */
export function getVaultKey(configDir: string): Buffer {
  const envKey = process.env.BRIDGE_VAULT_KEY;
  if (envKey && envKey.length > 0) {
    return createHash("sha256").update(envKey, "utf8").digest();
  }
  const kp = keyPath(configDir);
  try {
    if (existsSync(kp)) {
      const raw = readFileSync(kp);
      if (raw.length === 32) return raw;
      // Legacy/corrupt key file — warn, back up the old key AND the vault it
      // protects (unreadable under the new key, kept for manual recovery),
      // then regenerate below.
      const stamp = Date.now();
      console.warn(`[bridge] vault key ${kp} has unexpected length ${raw.length} (want 32), backing up and regenerating`);
      try {
        renameSync(kp, `${kp}.bak-${stamp}`);
      } catch {}
      try {
        const vp = vaultPath(configDir);
        if (existsSync(vp)) {
          const bak = `${vp}.bak-${stamp}`;
          renameSync(vp, bak);
          try { chmodSync(bak, 0o600); } catch {}
        }
      } catch {}
    }
  } catch {}
  const key = randomBytes(32);
  try {
    mkdirSync(configDir, { recursive: true });
    const tmp = `${kp}.tmp-${process.pid}`;
    writeFileSync(tmp, key);
    try { chmodSync(tmp, 0o600); } catch {}
    renameSync(tmp, kp);
    try { chmodSync(kp, 0o600); } catch {}
  } catch {}
  return key;
}

function encrypt(key: Buffer, plaintext: string): { iv: string; tag: string; data: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), tag: tag.toString("base64"), data: data.toString("base64") };
}

function decrypt(key: Buffer, payload: { iv: string; tag: string; data: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
}

/** Persist creds encrypted (0600). Overwrites any previous vault. */
export function saveVault(configDir: string, creds: StoredCreds): void {
  const key = getVaultKey(configDir);
  const payload = encrypt(key, JSON.stringify(creds));
  const p = vaultPath(configDir);
  const tmp = `${p}.tmp-${process.pid}`;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(tmp, JSON.stringify(payload));
  try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, p);
  try { chmodSync(p, 0o600); } catch {}
}

/** Load creds from the vault, or null when absent/unreadable (wrong key, corrupt). */
export function loadVault(configDir: string): StoredCreds | null {
  try {
    const p = vaultPath(configDir);
    if (!existsSync(p)) return null;
    const key = getVaultKey(configDir);
    const payload = JSON.parse(readFileSync(p, "utf8")) as { iv: string; tag: string; data: string };
    if (!payload?.iv || !payload?.tag || !payload?.data) return null;
    const parsed = JSON.parse(decrypt(key, payload)) as StoredCreds;
    if (!parsed?.username || !parsed?.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Delete the vault (global logout). Keeps the key file so future vaults reuse it. */
export function clearVault(configDir: string): void {
  try { rmSync(vaultPath(configDir), { force: true }); } catch {}
}

export function hasVault(configDir: string): boolean {
  try { return existsSync(vaultPath(configDir)); } catch { return false; }
}
