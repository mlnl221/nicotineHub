<h1 align="center">Nicotine Hub</h1>

<p align="center">
  <img src="apps/web/public/logo.png" alt="Nicotine Hub logo" width="220" />
</p>

<p align="center">
  <a href="AI-DECLARATION.md"><img src="https://img.shields.io/badge/䷼%20AI--DECLARATION-pair-ffedd5?labelColor=ffedd5" alt="AI-DECLARATION: pair" /></a>
</p>

<p align="center">
  A <strong>mobile-first</strong> web client for the <a href="https://www.slsknet.org/">Soulseek</a> network.<br/>
  <em>This port is built predominantly with AI assistance under human review — see <a href="AI-DECLARATION.md">AI-DECLARATION.md</a>.</em>
</p>

## Demo

<p align="center">
  <strong>Try before you install → <a href="https://nicotine-hub-web-phi.vercel.app/">https://nicotine-hub-web-phi.vercel.app/</a></strong><br/>
  No bridge required. Enter any username/password to explore search, chat, profiles &amp; browse with mocked data.<br/>
  <em>Downloads/uploads are disabled in the demo.</em>
</p>

This is an almost 1:1 port of the [nicotine-plus](https://nicotine-plus.org/) project ([GitHub](https://github.com/nicotine-plus/nicotine-plus)) to a modern Next.js web app that is mobile friendly. Built on the protocol from [Nicotine+](https://github.com/nicotine-plus/nicotine-plus) (`doc/SLSKPROTOCOL.md`).

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
compose.yaml — web:3000 + bridge:8787/62904 → bridge-data:/data
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
docker compose up --build  # http://localhost:3000 (build from source)
```

### Docker (GHCR — no build required)

Images are published to GHCR on every `main` push and on version tags (`v*.*.*`). Both services are versioned together and shipped via one `compose.yaml`.

```bash
# latest (default)
docker compose pull
docker compose up -d
# http://localhost:3000 + bridge ws://localhost:8787/ws

# pinned release — both services locked to the same version
TAG=v0.2.0 docker compose pull
TAG=v0.2.0 docker compose up -d

# pinned commit (per-build reproducibility)
TAG=sha-abc1234 docker compose pull
TAG=sha-abc1234 docker compose up -d
```

Images:

- `ghcr.io/mlnl221/nicotinehub-bridge` — Bun bridge (`:latest`, `:sha-<short>`, `:<semver>` e.g. `:0.2.0`, `:0.2`, `:0`)
- `ghcr.io/mlnl221/nicotinehub-web` — Next.js PWA (same tags)

Manual pulls:

```bash
docker pull ghcr.io/mlnl221/nicotinehub-bridge:latest
docker pull ghcr.io/mlnl221/nicotinehub-web:latest
docker pull ghcr.io/mlnl221/nicotinehub-bridge:0.2.0
```

> First publish requires making each GHCR package **Public** (GitHub → Packages → Settings → Change visibility) so `docker pull` works without `docker login ghcr.io`.

### Branching & promotion

Default branch is **`stage`**. All feature PRs target `stage`.

```
feature/*  →  stage  (PR, dry-run docker build)  →  main  (promotion, builds & pushes GHCR)
```

- **Feature → stage:** open PR against `stage`. CI runs `docker.yml` as dry-run (`push: false`) for both images (`linux/amd64,linux/arm64`, `cache: gha`) — validates Dockerfiles without pushing. Merge to `stage` does **not** publish images.
- **Stage → main:** promotion only. Either:
  - **Scheduled:** `.github/workflows/promote.yml` runs `cron: 0 2 * * 1` (Mondays 02:00 UTC) and via `workflow_dispatch` — if `stage` is ahead of `main` and no open `stage→main` PR exists, it auto-creates `chore: promote stage → main`.
  - **Manual:** `gh pr create --base main --head stage --title "chore: promote stage → main"` or via GitHub UI (base `main`, compare `stage`).

  Merging the promotion PR (push to `main`) triggers GHCR publish: `ghcr.io/mlnl221/nicotinehub-bridge|web:latest` + `sha-<short>` and on `v*.*.*` tags `0.2.0`/`0.2`/`0` + `latest` + `sha-`. Both services are versioned together; `compose.yaml` pins them via `${TAG:-latest}`.

```bash
# contributor flow
git checkout -b feat/my-change
git push -u origin feat/my-change
gh pr create --base stage --title "feat: ..."   # targets stage

# weekly promotion (auto or manual)
gh workflow run promote.yml                      # or wait for Monday schedule
# then merge the auto-created stage→main PR on GitHub
```

> Tags `v*.*.*` should be cut from `main` after promotion (e.g. `git tag v0.2.0 && git push origin v0.2.0`).
```

Bridge URL: `NEXT_PUBLIC_BRIDGE_URL` (build) or `localStorage.nicotine.bridgeUrl` (runtime).

| Env | Default | Purpose |
|-----|---------|---------|
| `BRIDGE_TOKEN` | *(open)* | Token auth for `/ws` |
| `DATA_DIR` | `/data` | Volume for downloads / incomplete |
| `LISTEN_PORT` | `62904` | Peer listener (port-forward TCP+UDP; editable in Settings → Network → Listening port, writes `DATA_DIR/listen_port` and reconnects — also set `LISTEN_PORT` env + `docker compose up -d` to update host mapping) |

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

## Porting status

Stage `d395cc6` — almost 1:1, mobile-friendly. See **[docs/porting-status.md](docs/porting-status.md)** for the full domain-by-domain matrix and intentionally omitted features.

## Docs

- `docs/architecture.md` — bridge, search & protocol details
- `docs/DESIGN.md` — UI tokens
- `docs/settings-mapping.md` — Nicotine+ settings reference (authoritative)
- `docs/settings-plan.md` — remaining settings phases
- `AGENTS.md` — agent conventions
