# Deployment — Docker & Release Workflow

> How images are built, published, and promoted. For protocol/env details see `docs/architecture.md#env-full`; for local dev see `AGENTS.md` and `README.md#quick-start`.

## Docker Compose (build from source)

```bash
docker compose up --build  # http://localhost:3000 (only published UI port + LISTEN_PORT)
```

`compose.yaml` builds all services from the monorepo root. Only `web:3000`
and the Soulseek peer `LISTEN_PORT` are published — bridge `:8787` and
worker `:8789` live on the compose network only; browsers reach them
through the web entrypoint (same-origin `/ws` piped + `/api/bridge/*` +
`/api/worker/*` proxied by `apps/web/proxy-server.js`):

- `bridge` — `apps/bridge/Dockerfile` → `PORT=8787`, `LISTEN_PORT`, `CONFIG_DIR=/config`, `DATA_DIR=/data`, volumes `config:/config` + `data:/data`, `ports:` = `LISTEN_PORT` TCP+UDP only (no `8787` publish, no `network_mode` key)
- `worker` — `apps/worker/Dockerfile` → `:8789`, volumes `config:/config:ro` + `data:/data`, no `ports:` block
- `web` — `apps/web/Dockerfile` → `PORT=3000` (`proxy-server.js` entry), `ports: 3000:3000`

**Network mode — internal services (default) vs direct vs host**

- **Internal (default `compose.yaml`)**: bridge/worker have no published ports. The web entrypoint proxies everything same-origin, so LAN browsers only need `:3000`. `LISTEN_PORT` host mapping is static at create time — changing the peer port in Settings → Network hot-swaps `Bun.listen` + `SetWaitPort` inside the container, but the *host* mapping needs `LISTEN_PORT=NEW docker compose up -d` to match. UPnP inside bridge-network sees the container IP — prefer manual port-forward or host mode for UPnP.
- **Direct (remote bridge/worker)**: publish `8787:8787` / `8789:8789` and set `NEXT_PUBLIC_BRIDGE_URL=ws://host:8787/ws` / `NEXT_PUBLIC_WORKER_URL=http://host:8789` (build-time) or the `localStorage` overrides — the client bypasses the proxy. Needed for split hosting (e.g. Vercel web + home bridge).
- **Host mode**: add `network_mode: host` to `bridge` (and drop its `ports:`) — it binds directly to host `8787` + `LISTEN_PORT`, UPnP sees the host LAN IP, and Settings → Network port changes apply without `docker compose up -d`.

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
# http://localhost:3000 (bridge/worker proxied same-origin — no extra ports)

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

See `AGENTS.md#git-worktrees` for per-worktree port isolation (`3000/8787/60754/8789` → `3001/8788/60755/8789` …) and `compose.override.yaml` usage for local port overrides.

## Vercel demo (frontend-only)

The public demo ([nicotine-hub-web-phi.vercel.app](https://nicotine-hub-web-phi.vercel.app/)) hosts **only `apps/web`** — the bridge (raw TCP to `server.slsknet.org:2242`) and worker (`sox`/`oxipng`, `/data` volume) cannot run on Vercel. Demo mode (`NEXT_PUBLIC_DEMO=true`) mocks both: any login works, search/chat/profiles/browse use fixtures, link-paste identifies two sample Discogs releases, and Files rename succeeds in-memory (reverts on reload).

Vercel project settings:

- **Root Directory:** `apps/web` (the repo-root `vercel.json` is ignored with this setting)
- **Production env:** `NEXT_PUBLIC_DEMO=true`; leave `NEXT_PUBLIC_BRIDGE_URL` / `NEXT_PUBLIC_WORKER_URL` empty or unset
- **Deploys from:** `main` (production URL), so `stage → main` promotion publishes the demo


