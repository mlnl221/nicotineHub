# Nicotine Mobile

A **mobile-first / browser-first** web client for the [Soulseek](https://www.slsknet.org/) peer-to-peer network.

**This is an MVP: logging in (and nothing else).** It authenticates with the Soulseek server and
reports success/failure. No search, chat, or sharing yet — that comes later.

Built on top of the protocol reverse-engineered and documented by the
[Nicotine+](https://github.com/nicotine-plus/nicotine-plus) project
(`doc/SLSKPROTOCOL.md`).

---

## Why a bridge?

The browser cannot open raw TCP sockets. Nicotine+ exposes **no web/REST/HTTP API** — it is a
desktop GUI/CLI client that speaks the proprietary **Soulseek (SLSK) binary protocol** directly
over TCP. So we implement that protocol (just the login subset) in a small **Bun WebSocket
bridge**, which the browser reaches over a WebSocket:

```
[ Browser (Next.js PWA) ]
        │  WebSocket (JSON)
        ▼
[ Bun bridge :8787 ]  ── raw TCP ──►  server.slsknet.org:2242
```

The bridge does the TCP handshake; the browser just sends `{type:"login", username, password}`
and receives a success/failure result.

## Protocol (login subset)

- **Server**: `server.slsknet.org:2242`, plain TCP (no TLS), `TCP_NODELAY` + keep-alive.
- **Framing** (both directions): `[uint32 len][uint32 code][payload]`, where `len = payload_len + 4`.
- **Send on connect**:
  1. `Login` (code `1`): `string username`, `string password`,
     `uint32 major_version` (experimental `177`), `string md5_hex(username+password)`,
     `uint32 minor_version` (`1`).
  2. `SetWaitPort` (code `2`): `uint32 port` (placeholder; no inbound listener in the MVP).
- **Receive `Login` (code `1`)**:
  - `bool success`
  - on success: `string banner`, `uint32 own_ip`, `string md5(password)`, `bool is_supporter`
  - on failure: `string rejection_reason` ∈ {`INVALIDUSERNAME`,`EMPTYPASSWORD`,`INVALIDPASS`,
    `INVALIDVERSION`,`SVRFULL`,`SVRPRIVATE`}, plus `string rejection_detail` for `INVALIDUSERNAME`.

See `apps/bridge/src/soulseek.ts` for the implementation and `soulseek.test.ts` for verification
against the protocol doc's literal hex example.

> **Security note:** Soulseek sends the password plaintext over an unencrypted socket. Only use
> credentials you trust, and this app does **not** store passwords.

---

## Repo layout

```
apps/
  bridge/    # Bun WebSocket + Soulseek login (Node-free JSON protocol)
    src/
      soulseek.ts     # framing, packing, Login/SetWaitPort/FileSearch, peer + result parsing
      session.ts      # persistent session: server conn + inbound peer listener + search
      server.ts       # /ws WebSocket endpoint + /health
      soulseek.test.ts
  web/       # Next.js 15 (App Router) + Tailwind v4, mobile-first PWA
    src/app/          # layout (viewport/PWA metas), login + /search pages
    src/components/   # LoginForm, Sidebar, SearchHeader, SearchBar, ResultCard
    src/lib/          # session (WS client/context) + protocol types
compose.yaml          # bridge (8787) + web (3000)
```

---

## Local development

Requirements: [Bun](https://bun.sh) (the bridge and web are Bun-first).

```bash
bun install            # install all workspace deps

# Terminal 1: bridge
bun run --cwd apps/bridge dev     # http://localhost:8787/ws

# Terminal 2: web
bun run --cwd apps/web dev        # http://localhost:3000
```

Run everything at once:

```bash
bun run dev
```

Verify the protocol:

```bash
bun test                # bridge unit tests (packing vs protocol doc hex)
bun run build           # typecheck + production builds
```

In development the web app connects directly to the bridge at `ws://localhost:8787/ws`
(its `SessionProvider` context handles login + search automatically). Override with the localStorage key
`nicotine.bridgeUrl` or the `NEXT_PUBLIC_BRIDGE_URL` build-time env var.

---

## Docker

`compose.yaml` runs two containers:

| Service | Role                           | Host port |
|---------|--------------------------------|-----------|
| `web`   | Next.js standalone server      | 3000      |
| `bridge`| Bun WebSocket + Soulseek login | 8787      |

```bash
docker compose up --build
```

Then open `http://localhost:3000`. The web app connects directly to the bridge at
`ws://<host>:8787/ws` (override via `NEXT_PUBLIC_BRIDGE_URL` or the `nicotine.bridgeUrl`
localStorage key).

---

## Roadmap (post-MVP)

- Persistent session handling, reconnects, keep-alive.
- Search / browse / user info / chat rooms / transfers over the same bridge.
- Peer (P2P) connection handling for downloads & uploads.
- Store credentials in the OS keychain (client-side) — not in plaintext.
- OAuth/self-hosted account store if we ever add our own backend.
