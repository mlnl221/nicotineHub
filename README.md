# Nicotine Hub

[![AI-DECLARATION: pair](https://img.shields.io/badge/䷼%20AI--DECLARATION-pair-ffedd5?labelColor=ffedd5)](AI-DECLARATION.md)

> **Demo → https://nicotine-hub-web-phi.vercel.app/** — Try it in your browser, no bridge required. Enter any username/password to explore search, chat, profiles & browse with mocked data. *Downloads/uploads are disabled in the demo.*

A **mobile-first** web client for the [Soulseek](https://www.slsknet.org/) network.

> This port is built predominantly with AI assistance under human review — see [AI-DECLARATION.md](AI-DECLARATION.md).

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

## Legal and Acknowledgements

**License:** [`GPL-3.0-or-later`](./COPYING) (`LICENSES/GPL-3.0-or-later.txt`).
© 2001–2026 Nicotine+, Nicotine and PySoulSeek Contributors; © 2025–2026 nicotine-mobile Contributors.

This project is a **1:1 TypeScript port** of [Nicotine+](https://github.com/nicotine-plus/nicotine-plus)
— especially `pynicotine/slskmessages.py` + `slskproto.py`, `transfers.py`, `shares.py`,
`pluginsystem.py` and `doc/SLSKPROTOCOL.md` — used under `GPL-3.0-or-later` with huge thanks
to the Nicotine+ team (`AUTHORS.md`). See [`ATTRIBUTION.md`](./ATTRIBUTION.md) for the full
file-by-file mapping and upstream commit `8d81e66`.

**Soulseek:** The Soulseek network and `server.slsknet.org` are operated by Soulseek
volunteers and are **not affiliated** with this project or Nicotine+. Trademark “Soulseek”
belongs to its owners (nominative fair use). By connecting you agree to the Soulseek
[rules](https://www.slsknet.org/news/node/681) and [Terms of Service](https://www.slsknet.org/news/node/682).
Soulseek is unencrypted; see Security above.

---

## Docs

- `docs/architecture.md` — bridge, search & protocol details
- `docs/DESIGN.md` — UI tokens
- `docs/settings-mapping.md` — Nicotine+ settings reference (authoritative)
- `docs/settings-plan.md` — remaining settings phases
- `AGENTS.md` — agent conventions
