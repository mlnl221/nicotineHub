# AGENTS.md — nicotine-hub

> **Before starting ANY task, read `mistakes.md` in the repo root (local-only, gitignored — never commit it). After any mistake or user correction, append an entry to `mistakes.md` immediately using the format inside it. Never repeat a recorded mistake.**

Mobile-first Soulseek web client. Monorepo (Bun workspaces `apps/*`):

- `apps/bridge` — Bun: Soulseek TCP client (`server.slsknet.org:2242`) + WS `/ws` + `/health` + `/files/:token`. Entrypoint `src/server.ts`, protocol framing in `src/soulseek.ts` (`[uint32 len][uint32 code][payload]`).
- `apps/web` — Next.js 15 (App Router) + Tailwind v4 PWA. Dev/prod run behind `proxy-server.js`: same-origin `/ws` piped raw to bridge, `/api/bridge/*` + `/api/worker/*` proxied. Browsers never touch `:8787`/`:8789` directly.
- `apps/worker` — Python FastAPI (scrape/spectrum/tag; `app.py`). Keeps CPU/IO-heavy work off the SLSK event loop.
- `compose.yaml` — only `web:3000` + peer `LISTEN_PORT` published; bridge/worker stay on the compose network.

## Commands

```bash
bun install
bun run dev [OFFSET] [LISTEN_PORT]  # web:3000+N, bridge:8787+N, listen:62904+N (e.g. `bun run dev 3`)
make dev OFFSET=3                   # same via Makefile; make verify = typecheck + test + build
bun test                            # bridge unit tests only (e2e/ excluded in bunfig.toml)
bun run build                       # typecheck + prod builds (both apps)
docker compose up --build           # full stack
```

Worker (optional): run from `apps/worker` — `PORT=8789 CONFIG_DIR=./config DATA_DIR=./data uvicorn app:app --host 0.0.0.0 --port 8789`.
Single bridge test: `bun test src/<name>.test.ts` (from `apps/bridge`).
Live protocol e2e: `bun run --cwd apps/bridge test:soulfind` — needs `SOULFIND_E2E=1` + soulfind binary (see `README.md` Testing); without the env var the file self-skips. Local-only test server, never production.
Playwright UI e2e: `e2e/` runs via `playwright.config.ts` (spawns bridge+web itself).

Bridge URL override: `NEXT_PUBLIC_BRIDGE_URL` (build-time) or `localStorage.nicotineHub.bridgeUrl` (runtime). Same pattern for worker (`...workerUrl`, tokens `...bridgeToken`/`...workerToken`).

## Conventions

- **Bun only** — `bun`, never `npm`/`yarn`/`npx`. `bun.lock` committed, `packageManager: bun@1.4.0`.
- **Branches: `stage` is the dev base (repo default).** Branch off `stage`, PRs target `stage` (`gh pr create --base stage`). `main` is release-only via `stage → main` promotion. Conventional Commits (`feat:`, `fix:` …) — they drive the changelog.
- **Worktrees/ports:** always use an `OFFSET` (`bun run dev 3` → web:3003/bridge:8790) so worktrees never collide. Never commit port changes; for docker use untracked `compose.override.yaml`.
- **Stop dev servers before `bun run build`/`make clean`** — a running dev server corrupts `.next` (Makefile warns).
- Verify before pushing: `bun test && bun run build` (CONTRIBUTING.md requires it; CI also runs `docker compose config --quiet`).
- Mobile-first UI: touch targets, safe-area insets, PWA `manifest.webmanifest`.

## Soulseek gotchas

- Client version `165/1` (unreserved). `160/3` belongs to Nicotine+ — never reuse (unrelated project; see issue #181, `ATTRIBUTION.md` pins `nicotine-plus@8d81e66`).
- No password persistence: plaintext protocol, one shared login encrypted in `CONFIG_DIR/session.vault` (`0600`), cleared on sign-out.
- Search needs a reachable inbound peer port: `LISTEN_PORT` TCP+UDP forwarded on the router. Docker mapping must stay interpolated (`${LISTEN_PORT:-60754}:${LISTEN_PORT:-60754}` in `compose.yaml`) — never hardcode the env value or the UI-chosen port is discarded on recreate. Changing it in Settings → Network hot-swaps `Bun.listen` + reconnects (SetWaitPort); host mapping needs socket self-recreate (`/var/run/docker.sock` + `ALLOW_CONTAINER_RESTART=1`) or `LISTEN_PORT=NEW docker compose up -d`.
- `CONFIG_DIR` (`/config`: `worker.json` 0600, `shares.json`, `downloads.json`, …) vs `DATA_DIR` (`/data`: `downloads/`, `incomplete/`, `uploads/`). In dev they fall back to `./config`/`./data` when `/config` isn't writable. Share paths must `existsSync` on the bridge FS; Docker shares need the host path mounted first.
- Protocol reference: `apps/bridge/src/soulseek.ts` + `ATTRIBUTION.md` (upstream `doc/SLSKPROTOCOL.md`).
