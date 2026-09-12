# Soulfind local e2e plan — bridge completeness vs test server

Local-only. No CI, no prod, no `compose.yaml` changes. Worktree ports never
collide with main (`3000/8787/60754/8789`): suite uses soulfind `:2244` and
peer listeners `60756/60757`. Shared manual-test server `soulfind-e2e:2243`
is untouched by the suite — the harness starts its own container.

## Run

```bash
bun run --cwd apps/bridge test:soulfind
# verbose: SOULFIND_E2E=1 bun test src/soulfind-live.test.ts
# keep server+db for debugging: SOULFIND_KEEP=1 ...
# one-time binary fetch (used instead of docker — see Harness why):
mkdir -p ~/.cache/nicotine-hub/soulfind
curl -sfSL -o /tmp/sf.zip https://github.com/soulfind-dev/soulfind/releases/latest/download/soulfind-linux-x86_64.zip
unzip -o -q /tmp/sf.zip -d ~/.cache/nicotine-hub/soulfind && chmod +x ~/.cache/nicotine-hub/soulfind/soulfind
```

Without `SOULFIND_E2E=1` the file loads but every test is `describe.skip`,
so default `bun test` stays green with zero docker dependency.

## Harness (`apps/bridge/src/soulfind-live.test.ts`)

- `beforeAll`: spawns host-native `soulfind -d <mkdtemp>/soulfind.db -p 2244`
  (binary auto-expected at `~/.cache/nicotine-hub/soulfind/soulfind`,
  `SOULFIND_BIN` overrides; `afterAll` kills it (skipped with
  `SOULFIND_KEEP=1`). Docker is deliberately NOT used: DNAT masks every
  client source IP as the container gateway, so all peer addresses come back
  unroutable (`172.17.0.1` here) and L3 peer flows can never connect. Native
  binary sees real source IPs; loopback reporters resolve to the host LAN IP
  via soulfind's own rewrite and stay dialable.
- Unique names per run (`rid = Date.now().toString(36)`): no DB reset needed.
- Two drivers: real `SoulseekSession` (bridge path, callback collectors) and
  `RawSlsk` (raw frames via `soulseek.ts` builders — deterministic relay
  asserts, no share/peer noise).
- Isolation: per-session `dataDir` mkdtemp (ShareDB), one suite temp
  `CONFIG_DIR` (wishlist), peer listeners `60756+`.
- Server mutation (ban/priv/full/restart) edits the bind-mounted
  `soulfind.db` via python sqlite3 with the container **stopped**, then
  restarts. Schema is probed at runtime (`pragma_table_info`), not assumed.

## Levels

L0 smoke — TCP, dual login (`1` → `login:result`), `FileSearch 26` relay
(~650ms server batch), room join `14` + presence.
L1 core — room list `64`, chat `13`, leave/presence `15/16/17`, PM `22` +
ack `23` + offline backlog `149`, watch/status/stats `5/7/36`, peer address
`3`, peer relay `18` + `1001` fast-fail, interests `57`, privileges
`123/92` (clamp-to-zero), login auto-push `69/104/160`, tickers
`116/113/114/115`, private rooms + operators (`14` priv, `1003`,
`143/144`), global room `150/151`, password change `142`, directed search
relay `42/120/103` to raw observer.
L2 errors — wrong password `INVALIDPASS`, real ban via seeded admin +
`server` PM (`ban`/`unban`) → `code:BANNED`, no auto-retry;
`SVRPRIVATE`/`SVRFULL` via config edit; kill/restart → `reconnect` →
`reconnected` + working chat; search `timeout` end reason (short
`timeoutMs`); validation limits (31-char user → `INVALIDUSERNAME`,
>256-char search silently dropped).
L3 peers — A shares temp dir (`setShareRoots` + `rescanShares`), B
`search()` → `onResult` rows via peer P-9; `requestSharedFileList` →
`browse-shares`; `TransferManager.requestDownload` → byte-identical file
(same `TransferManager` + file-callback wiring as `server.ts`
`createSharedTransfers`/`sharedSessionCallbacks`).
Distrib — assert graceful degradation only: bridge sends `71/127/126/100`,
soulfind no-ops them, no `102/83-90/93` ever arrives; server search
unaffected, 15m watchdog retries, no crash loop.

## Known soulfind gaps (skipped, not failures)

PMs lost on restart (in-memory), `roominfo` returns zero users, `67`
disconnects, offline watch/stats are stale-DB, no TLS/rate-limit, file bytes
never flow through the server (L3 goes direct peer TCP). Directed searches
arrive as `FileSearch(26)` regardless of flavour (`42/120/103` never appear
on any client). No echo for `joinGlobalRoom` (members just receive `152`).
Banned logins get no response and the socket is held ~60-75s (see bridge
login watchdog below). Grants require targets to be members first AND to
have invitations enabled (default off).

## Bridge bugs found by this suite (fixed on this branch)

1. `parseRoomTickerEvent` read 3 strings; `RoomTickerRemoved(115)` carries 2
   (`soulseek.ts`). `ticker-removed` was silently dropped — also against the
   real server.
2. Server-relay search responses carried the SEARCHER name instead of the
   responder (`session.ts` `handleInboundFileSearch`). Every result showed
   under the wrong username.
3. `rebuildVirtualMaps` wiped walkDir `virtual→real` maps and never rebuilt
   them (`shares.ts`); now rebuilt from persisted custom roots. Uploads from
   custom shares always ended "File not shared."
4. F dial sent `PeerInit` twice (once in `connectPeerWithRelay`, once in
   `dialFileUpload`); the peer read the second init's length (`18`) as the
   file token. `connectPeerWithRelay` no longer inits `F` conns.
5. Uploader killed its own F conn on `FileOffset(0)` (parsed as zero-length
   init frame). Established F channels now bypass init parsing.
6. Auto-reconnect never emitted `reconnected` (only manual `reconnect()` set
   the flag) — UI stuck on "reconnecting" after server death. Plus a 60s
   client-side login watchdog (`LOGIN_TIMEOUT_MS`) so banned/hung logins
   reject with a clear message instead of hanging ~70s+.
7. No `AddRoomMember(134)` sender existed, so private-room invites were
   undrivable from the app (and operators ungrantable — grants require
   membership). Added `buildAddRoomMember` + session `addRoomMember` +
   `chat:room addMember` WS action (+ web protocol type).

Dead code noted, not changed: none remaining — `private-message-acked` was
deleted (bridge `ChatEvent`, web `protocol.ts` + `privateChat.tsx` branch +
unread test; the server consumes `MessageAcked` without relaying, so the
event could never fire). Product gap noted, not built: no interests
setter (`51/52`).

## Manual UI path (shared `:2243` server)

Open `http://localhost:3000`, login host `soulfind-e2e` port `2243`
(container name — `127.0.0.1` is unreachable from inside the bridge
container). Any credentials (auto-register). Reset:
`docker exec soulfind-e2e rm -f /data/soulfind.db*` does NOT work (scratch
image, no shell) — use `docker rm -f soulfind-e2e` + recreate, then
`docker network connect nicotine_mobile_default soulfind-e2e`.
