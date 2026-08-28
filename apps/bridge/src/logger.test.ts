import { describe, test, expect, beforeEach } from "bun:test";
import { diagLog, diagTail, diagClear, diagSubscribe } from "./logger.ts";

describe("diagnostics logger", () => {
  beforeEach(() => {
    diagClear();
  });

  test("tail returns last 500 and preserves order", () => {
    for (let i = 0; i < 600; i++) diagLog("info", "system", `msg ${i}`);
    const tail = diagTail(500);
    expect(tail.length).toBe(500);
    expect(tail[0].msg).toBe("msg 100");
    expect(tail[499].msg).toBe("msg 599");
  });

  test("level filter debug < info < warn < error", () => {
    diagLog("debug", "system", "d");
    diagLog("info", "system", "i");
    diagLog("warn", "system", "w");
    diagLog("error", "system", "e");
    expect(diagTail(10, "debug").length).toBe(4);
    expect(diagTail(10, "info").length).toBe(3);
    expect(diagTail(10, "warn").length).toBe(2);
    expect(diagTail(10, "error").length).toBe(1);
  });

  test("scope preserved and meta redacted", () => {
    diagLog("info", "auth", "login attempt", { username: "bob", password: "secret123" });
    const e = diagTail(1)[0];
    expect(e.scope).toBe("auth");
    expect(e.meta?.password).toBe("***");
    expect(e.meta?.username).toBe("bob");
  });

  test("subscribe receives new entries", () => {
    const received: string[] = [];
    const unsub = diagSubscribe((entry) => received.push(entry.msg));
    diagLog("info", "bridge", "hello");
    diagLog("info", "bridge", "world");
    unsub();
    diagLog("info", "bridge", "ignored");
    expect(received).toEqual(["hello", "world"]);
  });

  test("clear empties ring", () => {
    diagLog("info", "system", "a");
    diagLog("info", "system", "b");
    diagClear();
    expect(diagTail(10).length).toBe(0);
  });

  test("msg truncated at 800", () => {
    const long = "x".repeat(1000);
    diagLog("info", "system", long);
    expect(diagTail(1)[0].msg.length).toBe(801); // 800 + …
    expect(diagTail(1)[0].msg.endsWith("…")).toBe(true);
  });

  test("meta string truncated at 500", () => {
    const long = "y".repeat(600);
    diagLog("info", "system", "hi", { big: long });
    expect((diagTail(1)[0].meta?.big as string).length).toBe(501);
  });
});
