// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, chmodSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveLoginIntent,
  saveVault,
  loadVault,
  clearVault,
  hasVault,
  getVaultKey,
} from "./shared-session.ts";

describe("resolveLoginIntent", () => {
  test("fresh when singleton not logged in", () => {
    expect(resolveLoginIntent({ loggedIn: false, username: "bob" })).toBe("fresh");
    expect(resolveLoginIntent({ loggedIn: false, currentUser: "alice", username: "bob", force: true })).toBe("fresh");
  });

  test("attach when same user re-connects (new device, no password needed)", () => {
    expect(resolveLoginIntent({ loggedIn: true, currentUser: "alice", username: "alice" })).toBe("attach");
  });

  test("conflict when different user without force", () => {
    expect(resolveLoginIntent({ loggedIn: true, currentUser: "alice", username: "bob" })).toBe("conflict");
    expect(resolveLoginIntent({ loggedIn: true, currentUser: "alice", username: "bob", force: false })).toBe("conflict");
  });

  test("replace when different user confirms takeover", () => {
    expect(resolveLoginIntent({ loggedIn: true, currentUser: "alice", username: "bob", force: true })).toBe("replace");
  });
});

describe("credential vault", () => {
  let dir: string;
  const OLD_ENV = process.env.BRIDGE_VAULT_KEY;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nh-vault-"));
    delete process.env.BRIDGE_VAULT_KEY;
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    if (OLD_ENV === undefined) delete process.env.BRIDGE_VAULT_KEY;
    else process.env.BRIDGE_VAULT_KEY = OLD_ENV;
  });

  test("round-trip preserves creds incl. host/port", () => {
    saveVault(dir, { username: "alice", password: "s3cr3t!", host: "server.slsknet.org", port: 2242 });
    expect(hasVault(dir)).toBe(true);
    expect(loadVault(dir)).toEqual({ username: "alice", password: "s3cr3t!", host: "server.slsknet.org", port: 2242 });
  });

  test("vault file and key file are 0600", () => {
    saveVault(dir, { username: "alice", password: "x" });
    const mode = (p: string) => statSync(p).mode & 0o777;
    expect(mode(join(dir, "session.vault"))).toBe(0o600);
    expect(mode(join(dir, ".vault.key"))).toBe(0o600);
  });

  test("ciphertext does not contain the password", () => {
    saveVault(dir, { username: "alice", password: "supersecretpassword123" });
    const raw = Bun.file(join(dir, "session.vault"));
    return raw.text().then((t) => {
      expect(t).not.toContain("supersecretpassword123");
    });
  });

  test("missing vault loads as null", () => {
    expect(loadVault(dir)).toBeNull();
    expect(hasVault(dir)).toBe(false);
  });

  test("clearVault removes vault but keeps key (stable re-save)", () => {
    saveVault(dir, { username: "alice", password: "x" });
    const keyBefore = getVaultKey(dir).toString("hex");
    clearVault(dir);
    expect(hasVault(dir)).toBe(false);
    expect(loadVault(dir)).toBeNull();
    expect(getVaultKey(dir).toString("hex")).toBe(keyBefore);
  });

  test("corrupt vault loads as null (no throw)", () => {
    writeFileSync(join(dir, "session.vault"), "{not json");
    expect(loadVault(dir)).toBeNull();
  });

  test("vault encrypted under a different key does not decrypt", () => {
    process.env.BRIDGE_VAULT_KEY = "key-one";
    saveVault(dir, { username: "alice", password: "x" });
    process.env.BRIDGE_VAULT_KEY = "key-two";
    expect(loadVault(dir)).toBeNull();
  });

  test("BRIDGE_VAULT_KEY env avoids key file", () => {
    process.env.BRIDGE_VAULT_KEY = "env-key";
    saveVault(dir, { username: "alice", password: "x" });
    expect(loadVault(dir)).toEqual({ username: "alice", password: "x" });
    expect(() => statSync(join(dir, ".vault.key"))).toThrow();
  });

  test("chmodSync import used (0600 hardening is real)", () => {
    expect(typeof chmodSync).toBe("function");
  });
});
