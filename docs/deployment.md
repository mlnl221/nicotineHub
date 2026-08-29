# Deployment — Docker & Release Workflow

> How images are built, published, and promoted. For protocol/env details see `docs/architecture.md#env-full`; for local dev see `AGENTS.md` and `README.md#quick-start`.

## Docker Compose (build from source)

```bash
docker compose up --build  # http://localhost:3000 + ws://localhost:8787/ws
```

`compose.yaml` builds both services from the monorepo root:

- `bridge` — `apps/bridge/Dockerfile` → `PORT=8787`, `LISTEN_PORT=62904`, `DATA_DIR=/data`, volume `bridge-data:/data`
- `web` — `apps/web/Dockerfile` → `PORT=3000`

Port-forwarding is parameterized: `${LISTEN_PORT:-62904}:${LISTEN_PORT:-62904}` (TCP+UDP). To use a different peer port, set `LISTEN_PORT` both in the bridge env and the host mapping (see `docs/architecture.md#env-full` for `DATA_DIR/listen_port` persistence):

```bash
LISTEN_PORT=62905 docker compose up -d
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

All env vars for deployment are in `docs/architecture.md#env-full`: `BRIDGE_TOKEN` (`?token`/`Bearer`/`Sec-WebSocket-Protocol` → 401 on `/ws` `/files/:token` `/logs` `/diagnostics` `/plugins`), `DATA_DIR`, `SHARED_DIRS`, `UPLOAD_LIMIT`/`DOWNLOAD_LIMIT`, `ALLOWED_ORIGINS`, `NEXT_PUBLIC_BRIDGE_URL` (build-time) vs `localStorage.nicotine.bridgeUrl` (runtime).

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

See `AGENTS.md#git-worktrees` for per-worktree port isolation (`3000/8787/62904` → `3001/8788/62905` …) and `compose.override.yaml` usage for local port overrides.
