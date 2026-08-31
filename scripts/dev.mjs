#!/usr/bin/env bun
// Usage:
//   bun run dev                 -> web:3000 bridge:8787 + prompt for LISTEN_PORT (default 62904)
//   bun run dev 3               -> web:3003 bridge:8790 + prompt for LISTEN_PORT (default 62907)
//   bun run dev 49127           -> web:3000 bridge:8787 LISTEN_PORT=49127 (no prompt)
//   bun run dev 3 49127         -> web:3003 bridge:8790 LISTEN_PORT=49127
//   LISTEN_PORT=49127 bun run dev -> uses env, no prompt
import { spawn } from "node:child_process";

const rawArgs = process.argv.slice(2).filter(a => a !== "--" && a !== "");
let offset = 0;
let listenPortArg = null;

// env LISTEN_PORT wins without prompt (explicit)
if (process.env.LISTEN_PORT && /^\d+$/.test(process.env.LISTEN_PORT)) {
  const envPort = Number(process.env.LISTEN_PORT);
  if (envPort >= 1024 && envPort <= 65535) listenPortArg = envPort;
}

for (const a of rawArgs) {
  if (!/^\d+$/.test(a)) continue;
  const n = Number(a);
  if (n < 1024) {
    // offset 0-100
    if (n >= 0 && n <= 100 && offset === 0) offset = n;
  } else if (n >= 1024 && n <= 65535) {
    listenPortArg = n;
  }
}
const N = offset;

const WEB_BASE = 3000;
const BRIDGE_BASE = 8787;
const LISTEN_BASE = 62904;

const webPort = WEB_BASE + N;
const bridgePort = BRIDGE_BASE + N;
let listenPort = listenPortArg ?? LISTEN_BASE + N;

// Prompt for LISTEN_PORT if not explicitly provided (VPN port changes each reconnect)
if (listenPortArg === null && !process.env.LISTEN_PORT) {
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  if (isTTY) {
    const def = listenPort;
    let answer = "";
    try {
      // Bun provides global prompt (sync) — fallback to empty if not available
      const maybePrompt = (globalThis as unknown as { prompt?: (m: string) => string | null }).prompt;
      if (typeof maybePrompt === "function") answer = (maybePrompt(`Listening port (VPN port) [${def}]: `) ?? "").trim();
      else answer = "";
    } catch {
      answer = "";
    }
    if (answer && /^\d+$/.test(answer)) {
      const p = Number(answer);
      if (p >= 1024 && p <= 65535) listenPort = p;
      else console.log(`Invalid port ${answer}, using default ${def}`);
    } else if (answer) {
      console.log(`Invalid input "${answer}", using default ${def}`);
    } else {
      console.log(`Using default listening port ${def} (press Enter to change)`);
    }
  }
}

const bridgeUrl = `ws://localhost:${bridgePort}/ws`;
const httpBridgeBase = `http://localhost:${bridgePort}`;

console.log(`\n┌─ Nicotine Hub dev (offset +${N}) ─────────────────────`);
console.log(`│ web:    http://localhost:${webPort} (PORT=${webPort})`);
console.log(`│ bridge: ws://localhost:${bridgePort}/ws (PORT=${bridgePort} LISTEN_PORT=${listenPort})`);
console.log(`│ health: ${httpBridgeBase}/health  |  ${httpBridgeBase}/health?json`);
console.log(`└──────────────────────────────────────────────\n`);
if (N === 0) {
  console.log(`Tip: run "bun run dev 3" for isolated ports web:3003 bridge:8790 listen:62907 (avoids collision with main worktree)\n`);
}

const bridgeEnv = { ...process.env, PORT: String(bridgePort), LISTEN_PORT: String(listenPort) };
const webEnv = { ...process.env, PORT: String(webPort), NEXT_PUBLIC_BRIDGE_URL: bridgeUrl };

// concurrently is in devDependencies — always available
const hasConcurrently = true;

if (hasConcurrently) {
  const cmd = `concurrently -n bridge,web -c blue,green "PORT=${bridgePort} LISTEN_PORT=${listenPort} bun run --cwd apps/bridge dev" "PORT=${webPort} NEXT_PUBLIC_BRIDGE_URL=${bridgeUrl} bun run --cwd apps/web dev"`;
  const child = spawn(cmd, { shell: true, stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  const bridge = spawn("bun", ["run", "--cwd", "apps/bridge", "dev"], { stdio: "inherit", env: bridgeEnv });
  const web = spawn("bun", ["run", "--cwd", "apps/web", "dev"], { stdio: "inherit", env: webEnv });
  const onExit = () => { try { bridge.kill(); } catch {}; try { web.kill(); } catch {}; };
  process.on("SIGINT", onExit);
  process.on("SIGTERM", onExit);
}
