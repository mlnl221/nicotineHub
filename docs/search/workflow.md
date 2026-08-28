# Search — Workflow

Follow `docs/workflow.md` (git worktree first, then PR). This file records the
search-specific steps.

## 1. Branch / worktree
```bash
git worktree add ../nicotine-mobile-search -b feat/search
cd ../nicotine-mobile-search
```

## 2. Implement (done)
- Bridge: `soulseek.ts`, `session.ts`, `server.ts`, `soulseek.test.ts`.
- Web: `lib/{protocol,session,search,filter,format}.ts(x)`, `components/search/*`,
  `app/search/page.tsx`.

## 3. Verify (must be green)
```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test          # bridge wire tests — currently 18 pass
bun run build     # bridge (bun) + web (next build) — type-check + lint
```

## 4. Run locally
```bash
bun run dev                       # bridge :8787 + web :3000
# or docker:
docker compose up --build         # web :3000, bridge :8787, bridge inbound :2234
```
Open `http://localhost:3000`, log in, then go to `/search`.

## 5. Notes / gotchas
- The bridge must be reachable on `LISTEN_PORT` (default `2234`) for real P2P results.
  `compose.yaml` publishes `2234/tcp` + `2234/udp`. On a homelab, forward that port.
- `Client version` is experimental `177/1` (do not reuse reserved majors).
- Filters are client-side; `country` is wired but inert until the bridge supplies it.
- Downloads/browse-user are stubbed (toast) — out of scope for the search MVP.

## 6. PR
Push the branch and open a PR against `main` describing: scope (global only, full P2P,
full filters), the WS contract in `README.md`, and the verification output.
