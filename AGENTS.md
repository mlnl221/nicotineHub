# AGENTS.md — nicotine-hub

> **Before starting ANY task, read `mistakes.md` in the repo root. After any mistake or user correction, append an entry to `mistakes.md` immediately using the format inside it. Never repeat a recorded mistake.**

This file is for AI coding agents working in this repo. See https://agents.md for the spec.

## Project

Mobile-first / browser-first Soulseek web client (beyond MVP — full 1:1 bridge). Monorepo with Bun workspaces.

- `apps/bridge` — Bun: Soulseek 1:1 bridge over raw TCP (`server.slsknet.org:2242`, P/F/D leaf) + WebSocket at `ws://host:8787/ws` + `/health` + `/files/:token` + volume `DATA_DIR`
- `apps/web` — Next.js 15 (App Router) + Tailwind v4 PWA, mobile shell `TopBar`/`BottomNav`, pages for search (multi-mode), downloads/uploads (F streaming), browse, chat, buddies, interests, profiles
- `compose.yaml` — `web:3000` + `bridge:8787/62904` (no reverse proxy; `LISTEN_PORT` default 62904, editable in Settings → Network)

Reference protocol: [nicotine-plus `doc/SLSKPROTOCOL.md`](https://github.com/nicotine-plus/nicotine-plus) and `apps/bridge/src/soulseek.ts` (framing: `[uint32 len][uint32 code][payload]`).

## Commands

```bash
bun install                          # install workspace deps
bun run dev                          # run bridge + web concurrently
bun run --cwd apps/bridge dev        # bridge only -> ws://localhost:8787/ws
bun run --cwd apps/web dev           # web only -> http://localhost:3000
bun test                             # bridge unit tests (hex vs protocol doc)
bun run build                        # typecheck + prod builds (both apps)
docker compose up --build            # full stack: localhost:3000 + localhost:8787
```

Bridge URL override: `NEXT_PUBLIC_BRIDGE_URL` (build-time) or `localStorage.nicotine.bridgeUrl` (runtime).

## Conventions

- **Bun only** — use `bun`, not `npm`/`yarn`/`npx`. `bun.lock` is committed.
- No password persistence (`README` security note). Search results require a reachable inbound peer listener; `LISTEN_PORT` (default 62904, `server.portrange`) must be port-forwarded TCP+UDP on the homelab. Changing via Settings → Network triggers bridge reconnect and writes `DATA_DIR/listen_port`; Docker host mapping uses `${LISTEN_PORT:-62904}:${LISTEN_PORT:-62904}` so also `LISTEN_PORT=... docker compose up -d`.
- Client version is experimental `177/1` — do not reuse reserved major versions.
- Mobile-first UI: touch targets, safe-area insets, PWA `manifest.webmanifest`.
- Verify after changes: `bun test && bun run build`.
- Browser/UI testing uses the Playwright MCP server (configured in opencode). Before driving the UI, always copy the env file into place (e.g. `cp apps/web/.env.example apps/web/.env`) so the `PLAYWRIGHT_MCP_EXTENSION_TOKEN` and other vars are present for the Playwright MCP browser session.

## Git Worktrees — per-worktree ports (avoid overlap)

Every `git worktree` must run on its own ports so it never collides with `main` or other worktrees (see `mistakes.md 2026-08-28 — Port conflict`). Do not commit port changes.

- **Defaults (main):** `web:3000`, `bridge:8787` (`PORT`), peer `LISTEN_PORT:62904` — see `compose.yaml:8` / `apps/bridge/src/server.ts:185` / `apps/web/package.json:6` (`portrange` `[62904,62904]`).
- **On `git worktree add`:** pick the next free triplet (e.g. `3001/8788/62905`, `3002/8789/62906`, …). Check availability first: `ss -tlnp | grep -E '3000|8787|62904'` or `lsof -i :3000 -i :8787 -i :62904` and `curl -sf http://localhost:<port>/health`.
- **Override locally only (gitignored, never commit `compose.yaml`/`package.json` port edits):**
  ```bash
  # bridge (Bun) — PORT and LISTEN_PORT are read from env in apps/bridge/src/server.ts:185
  PORT=8788 LISTEN_PORT=62905 bun run --cwd apps/bridge dev   # -> ws://localhost:8788/ws

  # web (Next.js) — PORT env overrides the -p 3000 in apps/web/package.json:6
  PORT=3001 NEXT_PUBLIC_BRIDGE_URL=ws://localhost:8788/ws bun run --cwd apps/web dev  # -> http://localhost:3001
  # or: echo "NEXT_PUBLIC_BRIDGE_URL=ws://localhost:8788/ws" > apps/web/.env  (.env is gitignored)

  # docker — use an untracked compose.override.yaml instead of editing compose.yaml
  # compose.override.yaml (gitignored):
  # services:
  #   bridge: { ports: ["8788:8788", "62905:62905", "62905:62905/udp"], environment: { PORT: "8788", LISTEN_PORT: "62905" } }
  #   web: { ports: ["3001:3000"], environment: { PORT: "3000", NEXT_PUBLIC_BRIDGE_URL: "ws://localhost:8788/ws" } }
  ```
- **Verify before starting worktree services:** `ps aux | grep -E "next|bun"` + `curl -sf http://localho