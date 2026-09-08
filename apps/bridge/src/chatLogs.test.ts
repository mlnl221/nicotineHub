// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logRoomMessage, logPrivateMessage, logRoomSystem, parseChatLogLine, readChatLogTail } from "./chatLogger.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chatlogs-"));
  process.env.CONFIG_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CONFIG_DIR;
});

describe("parseChatLogLine", () => {
  test("parses [user] message with timestamp", () => {
    const row = parseChatLogLine("2026-09-06 12:34:56 [jazzcat] hello room");
    expect(row).not.toBeNull();
    expect(row!.username).toBe("jazzcat");
    expect(row!.message).toBe("hello room");
    expect(row!.isAction).toBe(false);
    expect(row!.timestamp).toBe(new Date(2026, 8, 6, 12, 34, 56).getTime());
  });
  test("parses * action line and restores prefix", () => {
    const row = parseChatLogLine("2026-09-06 12:34:56 * jazzcat waves");
    expect(row!.username).toBe("jazzcat");
    expect(row!.message).toBe("* waves");
    expect(row!.isAction).toBe(true);
  });
  test("strips global-feed prefix", () => {
    const row = parseChatLogLine("2026-09-06 12:34:56 Jazz | [dj] hi", "Jazz");
    expect(row!.username).toBe("dj");
    expect(row!.message).toBe("hi");
  });
  test("skips system lines and garbage", () => {
    expect(parseChatLogLine("2026-09-06 12:34:56 jazzcat joined the room.")).toBeNull();
    expect(parseChatLogLine("not a log line")).toBeNull();
    expect(parseChatLogLine("")).toBeNull();
  });
});

describe("readChatLogTail", () => {
  test("room round-trip returns last N newest-last", () => {
    logRoomMessage("Jazz", "a", "one");
    logRoomMessage("Jazz", "b", "two");
    logRoomMessage("Jazz", "c", "three");
    const rows = readChatLogTail("rooms", "Jazz", 2);
    expect(rows.map((r) => r.message)).toEqual(["two", "three"]);
    expect(rows[0].username).toBe("b");
  });
  test("private round-trip keeps tags", () => {
    logPrivateMessage("peer", "peer", "hey");
    logPrivateMessage("peer", "me", "yo");
    const rows = readChatLogTail("private", "peer", 10);
    expect(rows.map((r) => r.username)).toEqual(["peer", "me"]);
  });
  test("system lines are skipped, actions kept", () => {
    logRoomSystem("Jazz", "someone joined the room.");
    logRoomMessage("Jazz", "a", "waves", { isAction: true });
    const rows = readChatLogTail("rooms", "Jazz", 10);
    expect(rows.length).toBe(1);
    expect(rows[0].message).toBe("* waves");
  });
  test("reads across daily files newest-first", () => {
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const ydir = join(dir, "logs", "rooms", "Jazz");
    mkdirSync(ydir, { recursive: true });
    writeFileSync(join(ydir, `${y}.log`), "2026-01-01 10:00:00 [old] yesterday\n");
    logRoomMessage("Jazz", "new", "today");
    const rows = readChatLogTail("rooms", "Jazz", 10);
    expect(rows.map((r) => r.message)).toEqual(["yesterday", "today"]);
  });
  test("clamps and rejects traversal", () => {
    logRoomMessage("Jazz", "a", "one");
    expect(readChatLogTail("rooms", "Jazz", 0)).toEqual([]);
    expect(readChatLogTail("rooms", "Jazz", 100000).length).toBe(1);
    expect(readChatLogTail("rooms", "../../etc", 10)).toEqual([]);
    expect(readChatLogTail("private", "..", 10)).toEqual([]);
  });
  test("multiline messages collapse to one line and round-trip whole", () => {
    logPrivateMessage("peer", "peer", "line one\nline two\r\nline three");
    logRoomMessage("Jazz", "a", "room\nsplit");
    const pm = readChatLogTail("private", "peer", 10);
    expect(pm.length).toBe(1);
    expect(pm[0].message).toBe("line one line two  line three");
    const room = readChatLogTail("rooms", "Jazz", 10);
    expect(room.length).toBe(1);
    expect(room[0].message).toBe("room split");
  });
  test("unknown key returns empty", () => {
    expect(readChatLogTail("rooms", "Nope", 10)).toEqual([]);
  });
});
