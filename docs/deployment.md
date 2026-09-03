# Deployment — Docker & Release Workflow

> How images are built, published, and promoted. For protocol/env details see `docs/architecture.md#env-full`; for local dev see `AGENTS.md` and `README.md#quick-start`.

## Docker Compose (build from source)

```bash
docker compose up --build  # http://localhost:3000 + ws://localhost:8787/ws
```

`compose.yaml` builds both services from the monorepo root:

- `bridge` — `apps/bridge/Dockerfile` → `PORT=8787`, `LISTEN_PORT=60754`, `DATA_DIR=/data`, volume `bridge-data:/data`, **`network_mode: host`** (default)
- `web` — `apps/web/Dockerfile` → `PORT=3000`

**Network mode — host (default) vs bridge vs Gluetun**

- **Host mode (default `compose.yaml`)**: `bridge` uses `network_mode: host` — it binds directly to host `8787` + `LISTEN_PORT` (no Docker port remap). UPnP/NAT-PMP sees host LAN IP (not container `172.x`) and Settings → Network port changes hot-swap via `Bun.listen` without `docker compose up -d`. This is the correct mode for homelab UPnP or manual forward or VPN-without-Gluetun.
- **Bridge mode**: if you prefer isolated bridge, comment out `network_mode: host` in `compose.yaml` and uncomment `ports:` (`8787:8787` + `${LISTEN_PORT}:${LISTEN_PORT}` TCP+UDP). Then `LISTEN_PORT` host mapping is static at create time — changing port in Settings requires `LISTEN_PORT=NEW docker compose up -d` or `scripts/sync-listen-port.sh`. UPnP inside bridge fails (`172.x` → no LAN device); forward manually.
- **Gluetun**: **remove** `network_mode: host` — it conflicts with `network_mode: service:gluetun`. Use the provided `compose.gluetun.yaml`:

```bash
docker compose -f compose.yaml -f compose.gluetun.yaml up -d
# or permanently:
cp compose.gluetun.yaml compose.override.yaml && docker compose up -d
```

No second Docker build is needed — same image, only compose network differs. See [`compose.gluetun.yaml`](../compose.gluetun.yaml) for a full `gluetun` service template. Details in [Gluetun](#gluetun) below.

Port-forwarding is parameterized: `${LISTEN_PORT:-60754}:${LISTEN_PORT:-60754}` (TCP+UDP) when in bridge mode; in host mode the port is host-direct. To use a different peer port, set `LISTEN_PORT` (see `docs/architecture.md#env-full` for `DATA_DIR/listen_port` persistence):

```bash
LISTEN_PORT=60755 docker compose up -d
```

## GHCR — prebuilt images (no build required)

Images are published to GHCR on every `main` push and on version tags `v*.*.*`. Both services are versioned together via `compose.yaml` `${TAG:-latest}`.

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

All env vars for deployment are in `docs/architecture.md#env-full`: `BRIDGE_TOKEN` (`?token`/`Bearer`/`Sec-WebSocket-Protocol` → 401 on `/ws` `/files/:token` `/logs` `/diagnostics` `/plugins`), `DATA_DIR`, `SHARED_DIRS`, `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT`, `ALLOWED_ORIGINS`, `NEXT_PUBLIC_BRIDGE_URL` (build-time) vs `localStorage.nicotineHub.bridgeUrl` (runtime).

## Branching & promotion

Default branch is **`stage`**. All feature PRs target `stage`.

```
feature/*  →  stage  (PR, dry-run docker build)  →  main  (promotion, builds & pushes GHCR)
```

- **Feature → stage:** open PR against `stage`. CI runs `docker.yml` as dry-run (`push: false`) for both images (`linux/amd64,linux/arm64`, `cache: gha`) — validates Dockerfiles without pushing. Merge to `stage` does **not** publish images.
- **Stage → main:** promotion only. Either:
  - **Scheduled:** `.github/workflows/promote.yml` runs `cron: 0 2 * * 1` (Mondays 02:00 UTC) and via `workflow_dispatch` — if `stage` is ahead of `main` and no open `stage→main` PR exists, it auto-creates `chore: promote stage → main`.
  - **Manual:** `gh pr create --base main --head stage --title "chore: promote stage → main"` or via GitHub UI (base `main`, compare `stage`).

Merging the promotion PR (push to `main`) triggers GHCR publish: `ghcr.io/mlnl221/nicotinehub-bridge|web:latest` + `sha-<short>` and on `v*.*.*` tags `0.2.0`/`0.2`/`0` + `latest` + `sha-`. Both services are versioned together; `compose.yaml` pins them via `${TAG:-latest}`.

## GitHub Releases (release-please)

Releases are automated with [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release-please.yml`, runs on pushes to `main`):

```
stage → main (promotion PR, merged)
  → GHCR :latest + :sha- published (docker.yml)
  → release-please opens/updates a "chore: release X.Y.Z" PR with changelog from Conventional Commits
  → maintainer merges the release PR
    → tag vX.Y.Z + GitHub Release created
    → docker.yml publishes semver tags (0.2.0/0.2/0) to GHCR
```

- Write Conventional Commits on feature PRs (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major) — they become the changelog.
- Do **not** cut tags manually; merging the release PR is the release.
- Prebuilt images and `TAG` pinning work exactly as in [GHCR](#ghcr--prebuilt-images-no-build-required) above; users can also follow [GitHub Releases](https://github.com/mlnl221/nicotineHub/releases) for notes.

```bash
# contributor flow
git checkout -b feat/my-change
git push -u origin feat/my-change
gh pr create --base stage --title "feat: ..."   # targets stage

# weekly promotion (auto or manual)
gh workflow run promote.yml                      # or wait for Monday schedule
# then merge the auto-created stage→main PR on GitHub
```

> Tags and GitHub Releases are created by merging the release-please PR — see [GitHub Releases](#github-releases-release-please). Do not tag manually.

See `AGENTS.md#git-worktrees` for per-worktree port isolation (`3000/8787/60754` → `3001/8788/60755` …) and `compose.override.yaml` usage for local port overrides.

## Gluetun

Gluetun ([qdm12/gluetun](https://github.com/qdm12/gluetun)) runs a VPN and exposes forwarded ports. **Do not use `network_mode: host` together with Gluetun** — Docker only allows one `network_mode` per container.

| Setup | `compose.yaml` default | Correct file | Ports defined on |
|-------|------------------------|--------------|------------------|
| Homelab LAN / manual forward / UPnP | `network_mode: host` | `compose.yaml` alone | host-direct |
| Gluetun VPN | **remove host** → `service:gluetun` | `compose.gluetun.yaml` | `gluetun` service |
| Isolated bridge (no UPnP) | comment host, uncomment `ports:` | `compose.override.example.yaml` | `bridge` |

For Gluetun, forwarded Soulseek port comes from your VPN provider (e.g. Mullvad `VPN_PORT_FORWARDING=on`). `compose.gluetun.yaml` routes bridge's `LISTEN_PORT` + `8787` through `gluetun`, so UPnP is unnecessary but Settings → Network port must match your VPN's forwarded port. No second Docker image is needed — `ghcr.io/mlnl221/nicotinehub-bridge` is identical; only compose networking changes.
