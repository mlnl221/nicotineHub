# Nicotine Hub

A **mobile-first** web client for the [Soulseek](https://www.slsknet.org/) network.

Beyond MVP — login, multi-mode search, real file transfers with resume, browsing, chat, buddies, interests & profiles. Built on the protocol from [Nicotine+](https://github.com/nicotine-plus/nicotine-plus) (`doc/SLSKPROTOCOL.md`).

```
[ Browser (Next.js PWA) ] --WS JSON--> [ Bun bridge :8787 ] --TCP--> server.slsknet.org:2242
                                                         --P2P--> peers
```

The browser can't open raw TCP sockets, so the bridge translates JSON over WebSocket to Soulseek binary framing. See `docs/architecture.md` for protocol details.

> **Security:** Soulseek sends passwords in plaintext. The app never stores them — use credentials you trust.

---

## Features

- **Search** — global, user, room, wishlist & buddies; tabs + filters (size/bitrate/length/type/slot)
- **Transfers** — queue, resume (`INCOMPLETE<md5>`), `GET /files/:token`, throttled streaming
- **Browse** — shares & folders via peers
- **Chat** — rooms + private, tickers, owned/member lists
- **Social** — buddies, interests/recommendations/similar users
- **Profiles** — description, picture, stats, privileges
- **Mobile shell** — `TopBar`/`BottomNav`, safe-area, PWA, diagnostics live tail

---

## Repo layout

```
apps/bridge  — Bun bridge  (WebSocket `/ws` + `/health` + `/files/:token`)
apps/web     — Next.js 15 PWA
compose.yaml — web:3000 + bridge:8787/2234 → bridge-data:/data
```

---

## Quick start

```bash
bun install
bun run dev              # bridge + web
# or separately
bun run --cwd apps/bridge dev   # ws://localhost:8787/ws
bun run --cwd apps/web dev      # http://localhost:3000

bun test        # unit tests
bun run build   # prod builds
docker compose up --build  # http://localhost:3000
```

Bridge URL: `NEXT_PUBLIC_BRIDGE_URL` (build) or `localStorage.nicotine.bridgeUrl` (runtime).

| Env | Default | Purpose |
|-----|---------|---------|
| `BRIDGE_TOKEN` | *(open)* | Token auth for `/ws` |
| `DATA_DIR` | `/data` | Volume for downloads / incomplete |
| `LISTEN_PORT` | `2234` | Peer listener (port-forward) |

See `docs/architecture.md` for `SHARED_DIRS`, `UPLOAD_LIMIT`, `DISTRIB` etc.

---

## Docs

- `docs/architecture.md` — bridge & protocol details
- `docs/TRANSFERS.md` — transfers spec
- `docs/DESIGN.md` — UI tokens
- `AGENTS.md` — agent conventions
