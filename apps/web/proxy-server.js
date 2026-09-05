"use strict";
// Entry wrapper: single-origin front door for the web app.
//
// - HTTP (incl. /api/bridge/*, /api/worker/*) → inner Next.js server.
// - WebSocket upgrade on /ws → piped raw to the bridge (Next.js rewrites
//   and route handlers cannot proxy WS upgrades, so we do it here with
//   plain TCP piping — zero dependencies, token subprotocols pass through
//   untouched). Other upgrade paths (dev HMR) go to the inner server.
//
// This is what lets bridge :8787 and worker :8789 live on the compose
// network only: browsers reach everything through web:3000.
//
// Env:
//   PORT (outer, default 3000), HOSTNAME (outer bind, default 0.0.0.0)
//   INNER_PORT (default PORT+1 — override in worktrees to avoid collision)
//   BRIDGE_INTERNAL_URL (default http://localhost:8787; compose sets http://bridge:8787)
//   PROXY_DEV=1 (or --dev) → inner is `next dev` instead of standalone server.js

const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const OUTER_PORT = parseInt(process.env.PORT || "3000", 10);
const OUTER_HOST = process.env.HOSTNAME || "0.0.0.0";
const INNER_PORT = parseInt(process.env.INNER_PORT || String(OUTER_PORT + 1), 10);
const DEV = process.argv.includes("--dev") || process.env.PROXY_DEV === "1";

const bridgeTarget = new URL(process.env.BRIDGE_INTERNAL_URL || "http://localhost:8787");
const BRIDGE_HOST = bridgeTarget.hostname;
const BRIDGE_PORT = parseInt(bridgeTarget.port || "80", 10);

function spawnInner() {
  const env = { ...process.env, PORT: String(INNER_PORT), HOSTNAME: "127.0.0.1" };
  let child;
  if (DEV) {
    const nextBin = require.resolve("next/dist/bin/next");
    child = spawn(
      process.execPath,
      [nextBin, "dev", "--turbopack", "--port", String(INNER_PORT), "--hostname", "127.0.0.1"],
      { cwd: __dirname, env, stdio: "inherit" }
    );
  } else {
    child = spawn(process.execPath, [path.join(__dirname, "server.js")], { env, stdio: "inherit" });
  }
  const shutdown = () => {
    try { child.kill("SIGTERM"); } catch {}
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[proxy] inner server exited with code ${code}`);
      process.exit(code);
    }
  });
  return child;
}

// Wait until the inner server accepts connections (it boots slower than us).
function waitForInner(done) {
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    const probe = net.connect({ host: "127.0.0.1", port: INNER_PORT }, () => {
      probe.end();
      done();
    });
    probe.on("error", () => {
      if (attempts > 150) {
        console.error("[proxy] inner server never became ready");
        process.exit(1);
      }
      setTimeout(tick, 200);
    });
  };
  tick();
}

function proxyHttp(req, res) {
  const attempt = (left) => {
    const proxyReq = http.request(
      {
        host: "127.0.0.1",
        port: INNER_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${INNER_PORT}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err) => {
      // Inner still booting (or restarting in dev) — retry briefly.
      if (left > 0 && (err.code === "ECONNREFUSED" || err.code === "ECONNRESET")) {
        setTimeout(() => attempt(left - 1), 250);
        return;
      }
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("proxy: inner server unavailable");
    });
    req.pipe(proxyReq);
  };
  attempt(40);
}

function pipeUpgrade(req, socket, head, target) {
  const upstream = net.connect({ host: target.host, port: target.port });
  const cleanup = () => {
    try { socket.destroy(); } catch {}
    try { upstream.destroy(); } catch {}
  };
  upstream.on("connect", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === "host") {
        lines.push(`host: ${target.host}:${target.port}`);
      } else if (Array.isArray(v)) {
        for (const item of v) lines.push(`${k}: ${item}`);
      } else if (v !== undefined) {
        lines.push(`${k}: ${v}`);
      }
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", cleanup);
  socket.on("error", cleanup);
  socket.on("close", () => {
    try { upstream.destroy(); } catch {}
  });
}

spawnInner();

const outer = http.createServer(proxyHttp);
outer.on("upgrade", (req, socket, head) => {
  const isBridgeWs = (req.url || "").split("?")[0] === "/ws";
  if (isBridgeWs) {
    pipeUpgrade(req, socket, head, { host: BRIDGE_HOST, port: BRIDGE_PORT });
  } else {
    // Dev HMR and friends belong to the inner Next server — retry until ready.
    const tryInner = (left) => {
      const probe = net.connect({ host: "127.0.0.1", port: INNER_PORT }, () => {
        probe.end();
        pipeUpgrade(req, socket, head, { host: "127.0.0.1", port: INNER_PORT });
      });
      probe.on("error", () => {
        if (left > 0) setTimeout(() => tryInner(left - 1), 250);
        else try { socket.destroy(); } catch {}
      });
    };
    tryInner(40);
  }
});

waitForInner(() => {
  outer.listen(OUTER_PORT, OUTER_HOST, () => {
    console.log(
      `[proxy] listening on http://${OUTER_HOST}:${OUTER_PORT} → inner 127.0.0.1:${INNER_PORT}, /ws → ${BRIDGE_HOST}:${BRIDGE_PORT}`
    );
  });
});
