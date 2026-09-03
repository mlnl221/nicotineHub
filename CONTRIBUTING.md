# Contributing to Nicotine Hub

Thanks for your interest in contributing! This project is a mobile-first Soulseek web client (Bun bridge + Next.js PWA), derived from [nicotine-plus](https://github.com/nicotine-plus/nicotine-plus). See [`ATTRIBUTION.md`](./ATTRIBUTION.md).

> **License:** all contributions are under [`GPL-3.0-or-later`](./COPYING). By opening a PR you agree your work is original (or compatibly licensed) and may be distributed under the GPL. No CLA to sign.

## Ground rules

- **Discuss first.** For anything beyond a trivial bug fix, open an issue before a PR so it can be checked against the project direction. Unannounced large PRs will likely be rejected (same policy as upstream).
- **One maintainer approves everything.** [@mlnl221](https://github.com/mlnl221) is the sole code owner (`CODEOWNERS`). Expect review latency; rebasing on `stage` speeds things up.
- **Soulseek rules apply.** By connecting you agree to the [Soulseek rules](https://www.slsknet.org/news/node/681) and [Terms](https://www.slsknet.org/news/node/682). Never commit credentials — the app never stores passwords (Soulseek sends them in plaintext), and neither should you.
- **Be kind.** See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## AI-assisted contributions

Unlike upstream nicotine-plus (which bans them), AI-assisted contributions are **allowed** here — this repo itself is AI-built, see [`AI-DECLARATION.md`](./AI-DECLARATION.md). Conditions:

1. **Disclose it** in the PR description (tool + what it produced).
2. **You must fully understand and have tested every line.** You answer review questions about the logic.
3. No secrets/keys in AI output; check diffs for leaked credentials.

## Workflow

Default branch for work is **`stage`**. `main` is release-only (see [`docs/deployment.md`](./docs/deployment.md)).

```bash
git checkout stage && git pull
git checkout -b feat/my-change
# ... make changes ...
bun test && bun run build   # required before pushing
git push -u origin feat/my-change
gh pr create --base stage --title "feat: ..."
```

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:` …) — they drive the changelog and releases.
- Keep PRs small and focused; one concern per PR.
- PR template checklist must be filled in or the PR may be closed.

## Local dev

```bash
bun install
bun run dev              # bridge ws://localhost:8787/ws + web http://localhost:3000
bun test                 # bridge unit tests
bun run build            # typecheck + prod builds (both apps)
docker compose up --build
```

Conventions: **Bun only** (no npm/yarn/npx), mobile-first UI with safe-area insets, experimental Soulseek client version `177/1` (do not change). Full details in [`AGENTS.md`](./AGENTS.md) and [`docs/architecture.md`](./docs/architecture.md).

## Reporting bugs / suggesting features

Use the issue templates (bug report / feature request). Include: app version or commit, browser + OS, bridge logs (`/diagnostics`), and steps to reproduce. **Never post passwords or tokens.** Security issues → see [`SECURITY.md`](./SECURITY.md), do not open public issues.

## Releases

Maintainer-only: `stage → main` promotion, then release-please opens a version PR; merging it tags and publishes. Details in [`docs/deployment.md`](./docs/deployment.md).
