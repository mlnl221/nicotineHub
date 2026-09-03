---
version: "0.1.2"
level: pair
processes:
  design: pair
  implementation: pair
  testing: pair
  documentation: pair
  review: assist
  deployment: hint
---

# AI Declaration

This file follows the [AI Declaration Standard v0.1.2](https://ai-declaration.md/en/0.1.2/).

## Notes

Nicotine Hub is built with **transparency as a core value**.

Nicotine Hub is a mobile-first Soulseek web client — a TypeScript/Bun + Next.js
port of [Nicotine+](https://github.com/nicotine-plus/nicotine-plus) (Python/GTK).
That conversion — porting the Soulseek framing `[len][code][payload]`,
102/18/6 message codes, `>2GiB` sentinel, `INCOMPLETE<md5>`, plugin hooks and
settings into `apps/bridge/src/soulseek.ts`, `transfers.ts`, `shares.ts`,
`plugins/*` and `apps/web` — was carried out **predominantly with AI assistance**,
under human direction and review. This document states honestly how.

The general rules we hold to:

1. Human review of what the AI produces.
2. The maintainer reads and understands the code before it lands (incl. protocol docs).
3. No secrets, keys or credentials are committed; AI output is checked for them; passwords are never persisted (Soulseek is plaintext).
4. Every build is tested via `bun test` + `bun run build` and a real bridge `curl /health` before it is considered done.

### What we use AI for

- **Muse Spark 1.2 (muse-spark-1.2-contributor) via OpenCode** — autonomous agents
  (`explore`, `Task`), sub-agents and the Playwright MCP server. The current
  development cycle uses `muse-spark-1.2-contributor` (`opencode-go/`); earlier
  sessions in this repo's history may have used other Spark snapshots or
  `opencode` sub-agents.

The AI wrote the large majority of the bridge framing/builders/parsers, the
`ShareDB`/`TransferManager`, the web search/filters, settings mapping
(`docs/settings-mapping.md`, `apps/web/src/lib/config/defaults.ts`), the
plugin system (`pluginsystem.py` → `plugins/types.ts`), and much of this
documentation. The maintainer set the scope (mobile-first, `177/1`, leaf-only `D`,
`ws://host:8787/ws`, volume `DATA_DIR`), made the product decisions, ran
`bun install`/`compose.yaml`/`Vercel` deploys, tested every WS flow, and reported
the bugs that drove the fixes (see `mistakes.md`).

### How AI is used

The declared level per process reflects how Nicotine Hub is actually built:

- **Design — pair:** Architecture and product decisions (Bun TCP+WS bridge, Next.js
  App Router PWA, `DATA_DIR` volume, `compose.yaml` `web:3000`+`bridge:8787/2234`)
  are made by the human; the AI traces `SLSKPROTOCOL.md`/`slskmessages.py`,
  proposes options and pressure-tests trade-offs (e.g. `perMessageDeflate`/`Comlink`
  worker/`zustand` vs `context`, Turbopack). The final call is human.
- **Implementation — pair (AI-authored):** The AI writes most of the code — bridge
  protocol (`soulseek.ts`), session/transfer/share/statistics/networkfilter,
  plugin manager, web UI (`SearchScreen`, `Sidebar`, `TopBar`/`BottomNav`).
  Nothing is treated as final until the human has built it (`bun run build`) and
  exercised it over WS and TCP.
- **Testing — pair:** The AI writes and runs the unit tests (`soulseek.test.ts`,
  `transfers.test.ts`, `plugins.test.ts`) and drives Playwright e2e checks;
  the human tests the running app (login, search, `P`/`F` transfers) and reports
  what breaks (see `mistakes.md: 2026-08-28 — Bridge allows search after failed login`).
- **Documentation — pair:** The README, `docs/architecture.md`, `ATTRIBUTION.md`,
  `LICENSE` notes and code comments are drafted by the AI and edited by the human
  for accuracy (codes, framing, env vars like `LISTEN_PORT`, `BRIDGE_TOKEN`).
- **Review — assist:** Review happens by the human reading diffs, checking
  `AGENTS.md` conventions, running `git diff`/`git log`, and reporting defects,
  which the AI then diagnoses and fixes.
- **Deployment — hint:** `compose.yaml`/`Dockerfile`/`Vercel` builds and releases
  are human-run; the AI helps with commands and configuration.

### Human review is non-negotiable

Regardless of how much AI wrote a change, it is not "done" until a human has
verified it:

- AI output is treated as a draft, not a commit.
- Factual claims (SLSK message codes, `slskproto.py` limits, Soulseek
  `node/681` rules / `node/682` ToS links, nicotine-plus `AUTHORS.md`) are
  verified against reality — several were caught this way (e.g. `D` framing
  `[len][u8 code]` vs `P`/`S` `[len][u32 code]`).
- Anything touching the network, the filesystem, encryption or the user's
  existing data (shares scan, incomplete `INCOMPLETE<md5>`, `DATA_DIR` volume)
  gets extra scrutiny.
- Tests and the app must actually run on the maintainer's machine (`bun test`
  + live bridge health check), not just in an AI's response.

### Why we publish this

Soulseek clients handle real network traffic, touch a user's files and shares,
and see plaintext passwords. People running Nicotine Hub deserve to know how it
was built. Being open that this is an AI-heavy port — with a human accountable
for every release under `GPL-3.0-or-later` (see `LICENSE` + `ATTRIBUTION.md`) —
is the honest thing to do, and lets others judge the code on its merits.

If the tooling, workflow or declared levels change, this file and its version
are updated to match.
