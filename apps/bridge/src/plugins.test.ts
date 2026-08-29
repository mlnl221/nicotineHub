import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginManager } from "./plugins/manager.ts";
import { BasePlugin, returncode } from "./plugins/types.ts";
import { Plugin as SpamPlugin } from "./plugins/builtin/spamfilter.ts";
import { Plugin as CorePlugin, manifest as coreManifest } from "./plugins/builtin/core_commands.ts";
import { manifest as spamManifest } from "./plugins/builtin/spamfilter.ts";

function tmpDataDir(): string {
  const d = join(tmpdir(), `nicotine-plugins-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe("PluginManager", () => {
  let dataDir: string;
  let pm: PluginManager;

  beforeEach(() => {
    dataDir = tmpDataDir();
    process.env.DATA_DIR = dataDir;
    pm = new PluginManager({ dataDir });
    pm.registerBuiltin("core_commands", coreManifest as unknown as Record<string, unknown>, () => new CorePlugin());
    pm.registerBuiltin("spamfilter", spamManifest as unknown as Record<string, unknown>, () => new SpamPlugin());
  });
  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  });

  test("enable core_commands registers help", async () => {
    await pm.start();
    expect(pm.isPluginLoaded("core_commands")).toBe(true);
    const cmds = pm.getCommandList("chatroom");
    expect(cmds.join(" ")).toContain("/help");
  });

  test("enable/disable/toggle spamfilter", async () => {
    await pm.start();
    expect(pm.isPluginLoaded("spamfilter")).toBe(false);
    await pm.enablePlugin("spamfilter");
    expect(pm.isPluginLoaded("spamfilter")).toBe(true);
    expect(pm.getInstalledPluginListWithStatus().some((p) => p.name === "spamfilter" && p.enabled)).toBe(true);
    await pm.disablePlugin("spamfilter");
    expect(pm.isPluginLoaded("spamfilter")).toBe(false);
    await pm.togglePlugin("spamfilter");
    expect(pm.isPluginLoaded("spamfilter")).toBe(true);
    await pm.togglePlugin("spamfilter");
    expect(pm.isPluginLoaded("spamfilter")).toBe(false);
  });

  test("spamfilter zaps ascii spam via incoming_public_chat_event", async () => {
    await pm.start();
    await pm.enablePlugin("spamfilter");
    const longAscii = "A".repeat(250); // 250 chars, single char -> zap
    const res = pm.incomingPublicChatEvent("room1", "spammer", longAscii);
    expect(res).toBeNull(); // zap -> null means dropped
    const normal = "hello world this is a normal message";
    const res2 = pm.incomingPublicChatEvent("room1", "user2", normal);
    expect(res2).not.toBeNull();
  });

  test("spamfilter zaps badprivatephrases", async () => {
    await pm.start();
    await pm.enablePlugin("spamfilter");
    const spam = pm.getPluginSettings("spamfilter") as Record<string, unknown>;
    // set badprivatephrases via settings
    pm.setPluginSettings("spamfilter", { ...spam, badprivatephrases: ["buy now"] });
    // reload to reflect? settings are live
    const res = pm.incomingPrivateChatEvent("spammer", "Hi buy now cheap!");
    expect(res).toBeNull();
    const res2 = pm.incomingPrivateChatEvent("user2", "hello");
    expect(res2).not.toBeNull();
  });

  test("command validation: help and unknown", async () => {
    await pm.start();
    await pm.enablePlugin("spamfilter");
    const outputs: string[] = [];
    pm.setOutputHandler((_, t) => outputs.push(t));
    const ok = await pm.triggerChatroomCommand("room1", "help", "");
    expect(ok).toBe(true);
    expect(outputs.join("\n")).toContain("Listing");
    outputs.length = 0;
    const notFound = await pm.triggerChatroomCommand("room1", "nope", "");
    expect(notFound).toBe(false);
  });

  test("command parameters validation", async () => {
    await pm.start();
    // custom plugin with required param
    class TestPlugin extends BasePlugin {
      constructor() {
        super();
        this.commands = {
          mycmd: {
            description: "test",
            parameters: ["<user>", "<choice1|choice2>"],
            callback: () => true,
          },
        };
      }
    }
    pm.registerBuiltin("testcmd", { Name: "Test" } as unknown as Record<string, unknown>, () => new TestPlugin());
    await pm.enablePlugin("testcmd");
    const outputs: string[] = [];
    pm.setOutputHandler((_, t) => outputs.push(t));
    const missing = await pm.triggerChatroomCommand("room1", "mycmd", "onlyone");
    // should have output missing arg
    expect(outputs.join(" ")).toContain("Missing");
    outputs.length = 0;
    const badChoice = await pm.triggerChatroomCommand("room1", "mycmd", "user1 bad");
    expect(outputs.join(" ")).toContain("Invalid argument");
    outputs.length = 0;
    const ok = await pm.triggerChatroomCommand("room1", "mycmd", "user1 choice1");
    expect(ok).toBe(true);
  });

  test("plugin settings persist and reload", async () => {
    await pm.start();
    await pm.enablePlugin("spamfilter");
    pm.setPluginSettings("spamfilter", { minlength: 123, maxlength: 400, maxdiffcharacters: 10, badprivatephrases: ["foo"] });
    const got = pm.getPluginSettings("spamfilter") as Record<string, unknown>;
    expect(got.minlength).toBe(123);
    expect(got.badprivatephrases).toEqual(["foo"]);
    // check file
    const raw = JSON.parse(readFileSync(join(dataDir, "plugins.json"), "utf8"));
    expect(raw.plugins["spamfilter"].minlength).toBe(123);
    // reload preserves
    await pm.reloadPlugin("spamfilter");
    const after = pm.getPluginSettings("spamfilter") as Record<string, unknown>;
    expect(after.minlength).toBe(123);
  });

  test("outgoing search event can zap", async () => {
    await pm.start();
    class ZapPlugin extends BasePlugin {
      outgoing_global_search_event(text: string) {
        if (text.includes("blocked")) return returncode.zap;
      }
    }
    pm.registerBuiltin("zapsearch", { Name: "Zap" } as unknown as Record<string, unknown>, () => new ZapPlugin());
    await pm.enablePlugin("zapsearch");
    const res = pm.outgoingGlobalSearchEvent("this is blocked query");
    expect(res).toBeNull();
    const res2 = pm.outgoingGlobalSearchEvent("allowed query");
    expect(res2).not.toBeNull();
  });

  test("list installed plugins includes builtin and user", async () => {
    // create a fake user plugin folder
    const userDir = join(dataDir, "plugins", "myuserplugin");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "plugin.json"), JSON.stringify({ Name: "My User Plugin", Version: "0.1" }));
    writeFileSync(join(userDir, "index.js"), `export class Plugin { }`);
    await pm.start();
    const list = pm.listInstalledPlugins();
    expect(list).toContain("myuserplugin");
    const enriched = pm.getInstalledPluginListWithStatus();
    const found = enriched.find((p) => p.name === "myuserplugin");
    expect(found?.humanName).toBe("My User Plugin");
  });
});
