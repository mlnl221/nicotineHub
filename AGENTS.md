# AGENTS.md — nicotine-mobile

> **Before starting ANY task, read `mistakes.md` in the repo root. After any mistake or user correction, append an entry to `mistakes.md` immediately using the format inside it. Never repeat a recorded mistake.**

This file is for AI coding agents working in this repo. See https://agents.md for the spec.

## Project

Mobile-first / browser-first Soulseek web client (MVP: login only). Monorepo with Bun workspaces.

- `apps/bridge` — Bun: Soulseek login over raw TCP (`server.slsknet.org:2242`) + WebSocket bridge at `ws://host:8787/ws` + `/health`
- `apps/web` — Next.js 15 (App Router) + Tailwind v4 PWA, connects directly to bridge
- `compose.yaml` — `web:3000` + `bridge:8787` (no reverse proxy)

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
- Keep login MVP minimal: no password persistence (`README` security note). Search results require a reachable inbound peer listener; `LISTEN_PORT` (default 2242/2234) must be port-forwarded on the homelab.
- Client version is experimental `177/1` — do not reuse reserved major versions.
- Mobile-first UI: touch targets, safe-area insets, PWA `manifest.webmanifest`.
- Verify after changes: `bun test && bun run build`.

## Repo layout

```
apps/bridge/src/{soulseek.ts,session.ts,server.ts,soulseek.test.ts}
apps/web/src/{app/{layout.tsx,page.tsx,search/page.tsx},components/{LoginForm.tsx,Sidebar.tsx,SearchHeader.tsx,SearchBar.tsx,ResultCard.tsx},lib/{session.tsx,protocol.ts}}
compose.yaml  .dockerignore  README.md
```

## Mistakes Log

- Every agent must read `mistakes.md` before starting work (see header). It separates historical failures from base rules in this file.
- After any error, failed tool call, or user correction, append to `mistakes.md` within 30 seconds using its `What happened / Why / How to avoid` format. Keep entries messy and chronological — do not try to be perfect.
- Monthly: review `mistakes.md` and prune fixed items.
