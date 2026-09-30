# Proposal: Replace Bun Bridge with soulseek-rs + Rust Axum Sidecar

Status: **implementing** in `feat/bridge-rust-replacement` (`apps/bridge-rs`,
`third_party/soulseek-rs@20bd676`, `compose.override.example-rust.yaml`).
Base `compose.yaml` still defaults to the Bun bridge; the Rust bridge is
opt-in via the override until cutover.

Upstream: `michel/soulseek-rs`, investigated at `develop@20bd676`, `v19.1.0`,
MIT, 564 commits. Local mirror used for verification:
`/tmp/opencode/soulseek-rs` (not in workspace).

## 1. Verdict

Not a drop-in container swap. `soulseek-rs` is a protocol library + CLI/TUI +
JSON-RPC daemon. It exposes no HTTP REST, no WebSocket, no `/health`, no file
bytes. A full replacement means a new Docker image (Rust daemon + axum shim)
that preserves the current `/ws` + HTTP contract byte-for-byte so `apps/web`
and `apps/worker` stay mostly untouched.

## 2. Upstream facts (verified)

- Shape: single binary `soulseek-rs` + lib `soulseek_rs`, plus
  `soulseek_rs_tui` test shim (`cli.rs:1`, `main.rs:8`). No-subcommand = TUI,
  subcommand = one-shot, `daemon` = service.
- Version: crate `19.1.0` (`Cargo.toml:6`). RPC contract version `2`
  (`daemon/proto/mod.rs:16`, `soulseek-rs/docs/openrpc.json:1592`), not `1`.
  Doc handshake example `daemon_version:13.0.0` is stale. The shim must pin
  `protocol:2` + crate version and fail loudly on mismatch
  (`remote/mod.rs:215`).
- Transport: newline-delimited JSON-RPC 2.0 only. No `axum|hyper|websocket`
  in the repo. Unix `<state>/daemon.sock` (0600, token optional) or TCP
  `daemon --bind ADDR` (opt-in, token `<state>/daemon.token`, 0600, 32B OS
  random hex reused) (`daemon/mod.rs:39,72`). Line cap 1 MiB, 30s auth
  timeout, 64 conns max (`transport.rs:34,39,47`). Failed auth sleeps 1s with
  constant-time compare (`transport.rs:25`). No transport encryption: TCP on
  non-loopback leaks token and password. Keep daemon TCP on
  `127.0.0.1:5030`, compose-net only, never publish.
- Methods: 48 OpenRPC entries = 42 methods + 6 events (`openrpc.json:1600`).
  Methods: `auth, daemon.status/stop, rpc.discover,
  search.start/results/list/forget/wishlist/wishlist_interval,
  download.start/list/pause/resume/remove/remove_queued/cancel/set_dir,
  upload.list/cancel/slots, privileges.check/own,
  room.list_request/join/leave/say/members/member_stats, message.send/history,
  browse.user, user.request/info/watch/unwatch/watched, account.password,
  shares.status/files/set/reindex`. Events:
  `event.room/message/upload/download_status/browse/session_loss`
  (`hub.rs:32`, per-conn queue 1024, slow consumer disconnected, only
  `message.history` backfills).
- Config: 12 `KEYS` (`persist/config.rs:49`): `username, server,
  listener_port, disable_listener, accept_children, download_dir, shared_dirs,
  max_concurrent_downloads, search_timeout, password_cmd, daemon,
  daemon_token`, plus `wishlist[]` TOML array and legacy single `shared_dir`.
  Unknown keys ignored. Default server `server.slsknet.org:2416`
  (`client/mod.rs:253`, `config.rs:287`) — ours is `:2242`
  (`apps/bridge/src/soulseek.ts:193`); verify which is current before
  switching, default to `2416`. Listener default `2234` with ephemeral
  fallback on `AddrInUse`, advertising the bound port (`peer/listen.rs:408`,
  `run.rs:517`). Shares default = `download_dir`, empty disables.
  `accept_children` forced false when listener disabled.
- Identity: major `176`, minor `1` default / `2` reference client
  (`types.rs:40-55`). Ours is `165/1` (`soulseek.ts:187`, unreserved; never
  `160/3` which is reserved for Nicotine+). Switch to `176/x` and note it in
  docs.
- Secrets: OS keychain service `soulseek-rs`, never in `config.toml`
  (`secret.rs:4`). Precedence CLI/env > keychain > `password_cmd` shell
  trimmed (`secret.rs:83`). `account.password` crosses the socket in
  plaintext.
- State envelope `{version:0,data}` (`state.rs:17`): `downloads.json,
  searches.json, rooms.json, messages.json, unread.json`. Atomic tmp+rename;
  corrupt or newer loads as empty + `.bak`.
- Shares are flat, no tiers (`shares/mod.rs:214`). `.part` files excluded
  from the index. Resume suffix `PART_SUFFIX` = `.part` (`utils/path.rs:7`):
  stream into `.part`, resume missing tail, rename on complete, delete on
  cancel. Unreadable roots skipped, name collisions get ` (2)` suffix.
- Obsolete codes omitted by design (12): `33,40,50,55,59,67,73,122,124,125,
  129,153` (`protocol-coverage.md:81`). Known gaps (`:124-132`): locked
  results sent empty + skipped inbound, obfuscated port parsed/stored but
  never dialed, firewalled child answered `CantConnectToPeer`.
- Port mapping: UPnP then NAT-PMP best-effort, external must equal the bound
  port else warn/give up, lease renewed at half interval, failure only logs
  (`port_mapping/mod.rs:186`). UI must show the `(configured,bound)` fallback
  tuple (`run.rs:517`); the server gets the bound port via `SetWaitPort`.
- Packaging: `packaging/nfpm.yaml` (deb/rpm) + brew/cargo/install.sh only.
  No `Dockerfile`/`compose` in the repo (`**/Dockerfile*` is empty).
- License MIT (workspace + packaging + OpenRPC agree) — MIT-inside-GPL is
  fine. Keep `ATTRIBUTION.md` and record the pin.

## 3. Current contract to preserve (verified against code)

### 3.1 WebSocket incoming (client -> bridge, `apps/bridge/src/server.ts`)

`login, logout` (`:1406`, global teardown + vault clear + `session:ended`
broadcast), `session:status, ping, search, search:user/room/wishlist/buddies/
stop, search:page` (`:1529`, ack `rows:[]` no-op), `browse, browse:page`
(`:1536`, per-user stash + cache paging), `download:request/control,
upload:control, transfer:clear-many` (`:1599`, `isUpload` + `statuses`
null=all), full `userinfo` set
(watch/unwatch/get/interests/profile/privileges/password/shares),
`chat:room/private/logs` (`:1704`, scope rooms/private, lines 1-10000),
`chat:global` (`:1720`, join/leave), `peer:connect, shares:rescan/preview,
config:update, config:get` (`:2067`, returns `config:state`),
`ban:add/remove, ignore:add/remove` (triple write session + transfers +
`settings.json`, see `transfers.ts:998`, `server.ts:2087`),
`wishlist:update, statistics:request, statistics:reset` (`:2140`, returns both
`statistics:response` + `statistics:reset:ok`), `spectrum:request/status`
stub (`:2152`, returns `spectrum:error`, moved to worker, no compute),
`diagnostics:clear/subscribe/browser-log` (`:2173`, browser ingest via
`diagLog`), and 9 plugin types (`:2255,2323`:
list/toggle/reload/uninstall/settings/resetSettings/install/installUrl/
installGithubTs).

### 3.2 WebSocket outgoing (bridge -> client)

`login:result/start/conflict, session:status/ended,
search:start/result/end, browse:shares/folder,
transfer:update/removed/stats/queue/finished,
peer:transfer, room:event, chat:event, userinfo:event,
wishlist:interval/updated, server:reconnect/restarting,
config:state/updated, shares:rescanned/scan:progress/preview:result,
statistics:response, diagnostics:health/log/init,
plugin:list/toggled/output, spectrum:error, pong, error`.

### 3.3 HTTP (`Bun.serve`, same `:8787` for `/ws` + `/health`)

`/health` (`?json` detailed), `/ws` (`:1151`, 401 when `BRIDGE_TOKEN` set;
query/Bearer/subprotocol), `/upnp/status` + `/api/upnp/status`,
`/portchecker` + `/api/portchecker`, `/interfaces` + `/api/interfaces`,
`/logs, /diagnostics, /plugins` + `/plugins/install` POST (20MB cap,
zip/url/githubTs, `:1027`), `/api/files, /api/files/raw` (`:1112`, 500MB
cap, preview 25MB, traversal blocked), `/container, /restart` (202),
`/files/:token` (`:815,1222`, finished-only, manager-path-first,
containment check, auth-gated, 24h `FILE_TOKEN_MAX_AGE_MS` expiry, 404 on
expiry), `/spectrum/` + `/api/spectrum/` (410 moved to worker, `:1320`).

### 3.4 Runtime, ports, env

`CMD ["bun","run","dist/server.js"]` (`apps/bridge/Dockerfile:68`).
`EXPOSE 8787 60754` (`:67`), but compose publishes only the peer TCP+UDP —
`8787` stays internal (`compose.yaml:30`). `web:3000` is the sole browser
entrypoint. `ENV BRIDGE_INTERNAL_URL=http://bridge:8787` relies on compose
DNS (`apps/web/Dockerfile:66`); local default `http://localhost:8787`
(`apps/web/proxy-server.js:29`). `/ws` is an exact match with a raw TCP
`pipeUpgrade`, token subprotocols untouched; other upgrades go to inner Next
(`proxy-server.js:142`). `/api/bridge` strips the prefix, supports
GET/POST/HEAD, streams Range/206, falls back to `BRIDGE_TOKEN`
(`route.ts:11`). `INNER_PORT` defaults to OUTER+1 (`proxy-server.js:26`) —
worktrees must set it explicitly. `LISTEN_PORT "${LISTEN_PORT:-60754}"` is
interpolated; env wins over the `CONFIG_DIR/listen_port` file
(`compose.yaml:14`, `server.ts:302`). Never hardcode the port.

Env: `PORT` (8787), `LISTEN_PORT` (today 60754, target 2234), `CONFIG_DIR`
(`/config`), `DATA_DIR` (`/data`), `BRIDGE_TOKEN`, `ALLOWED_ORIGINS`,
`ALLOW_CONTAINER_RESTART`, `DOCKER_SOCKET`, `BRIDGE_VAULT_KEY` override.

### 3.5 State files

`CONFIG_DIR` full set (`server.ts:273-280` + `shared-session.ts:45`):
`listen_port, host.env, upnp_enabled, worker.json` (0600),
`shares.json`, `browse.cache` (raw `deflateSync` bytes, `shares.ts:1122` —
not JSON), `downloads.json` + `transfers.json` compat stub
(`transfers.ts:519,524,530`), `statistics.json`, `plugins.json` + `plugins/`
dir, `diagnostics.log` (JSONL, 2000 cap + redaction, `logger.ts:35`; UI tails
500, `logger.ts:141`), `settings.json`, `wishlist.json`,
`session.vault` + `.vault.key` (0600, AES-256-GCM), `logs/rooms` +
`logs/private` (`:273-274`). `DATA_DIR`: `dataDir + incomplete + downloads +
uploads`, auto-mkdir (`transfers.ts:316,322`; `INCOMPLETE_DIR`/
`DOWNLOADS_DIR` overrides). `ip_country_data.csv` is bundled under
`src/data/`, not `CONFIG_DIR` (`networkfilter.ts:114`) — the Rust image must
bundle it or geoblock breaks. `SPECTRUM_DIR /tmp/spectrals` is ephemeral
(`apps/worker/spectrals.py:24`, `compose.yaml:75`) — spectra 404 after
restart until regenerated; the plan must not assume persistence.

### 3.6 Consumers

`proxy-server.js` pipes `/ws`; `api/bridge/[...path]` forwards HTTP;
`api/worker/[...path]` forwards to the worker (unchanged). Web defaults to
same-origin `ws://host/ws`; override order is
`localStorage.nicotineHub.bridgeUrl` > `NEXT_PUBLIC_BRIDGE_URL`
(`session.tsx:70,91`). `bridgeFetchUrl` routes via `/api/bridge` when
proxied, else direct HTTP base (`bridgeHttp.ts:45,69`). Representative
consumers: `transfers.tsx:398` (`download:request`), `browse.tsx:51`
(`browse` shares), `player/urls.ts:34` (`/files/:token`),
`ImageHoverCard.tsx:31` (`/api/files/raw`), `FileExplorer.tsx:129`
(`/api/files`), `NetworkSection.tsx:194` (`config:update` listen port),
`SharesSection.tsx:195` (`shares:rescan`), `diagnostics/page.tsx:203`
(`diagnostics:subscribe`), `statistics.tsx:56`, `wishlist.tsx:86`. The worker
couples only via shared files: `worker.json` tokens (`tokens.py:32`) and
`DATA_DIR` audio resolve (`app.py:241`) — no socket dependency.

## 4. Target architecture

```text
browser :3000 (web, unchanged)
 |-- same-origin /ws -----------> axum shim :8787/ws (preserve 40-in/25-out shapes)
 |-- /api/bridge/* -------------> axum shim HTTP (preserve routes incl. /api/* aliases)
 |-- /api/worker/* -------------> worker :8789 (unchanged)
axum shim (Rust, new crate `shim/` in bridge image)
 |-- persistent JSON-RPC conn to 127.0.0.1:5030 (continuous read event pump,
 |   pin protocol:2 + daemon version, fail loud on mismatch)
 |-- search windowing: search.start -> poll search.results (--search-timeout
 |   10s) -> emit search:start/result/end
 |-- browse.user poll, room listen / message read / serve --follow ->
 |   room:event/chat:event/peer:transfer
 |-- file bytes via shared volume DATA_DIR/downloads (reimplement
 |   files.ts:132 Range + token registry; daemon FS only, never returns bytes)
 |-- BRIDGE_TOKEN at shim edge, translated to daemon.token; daemon TCP on
     compose net only (no TLS, never publish 5030)
soulseek-rs daemon (same image, shim boots it as child process)
 |-- TCP 127.0.0.1:5030, peer TCP+UDP 2234
 |-- SOULSEEK_CONFIG_DIR=/config/slsk-rs,
     SOULSEEK_STATE_DIR=/config/slsk-rs/state,
     SOULSEEK_DOWNLOAD_DIR=/data/downloads
```

Why axum over a Bun adapter: single image, no Bun runtime, version pin at
compile time. Cost: the WS/HTTP layer is rewritten in Rust (`tokio-
tungstenite`, `axum`, `serde_json`).

## 5. New Docker container

```dockerfile
FROM rust:1.91-bookworm AS builder
WORKDIR /src
COPY soulseek-rs/ ./soulseek-rs/
COPY shim/ ./shim/
RUN cargo build --release --locked -p soulseek-rs -p nicotine-shim
FROM debian:13-slim AS runner
RUN useradd -m slsk && mkdir -p /config /data/downloads /data/incomplete /data/uploads
COPY --from=builder /src/target/release/soulseek-rs /usr/local/bin/
COPY --from=builder /src/target/release/nicotine-shim /usr/local/bin/
ENV SOULSEEK_CONFIG_DIR=/config/slsk-rs SOULSEEK_STATE_DIR=/config/slsk-rs/state SOULSEEK_DOWNLOAD_DIR=/data/downloads PORT=8787 LISTEN_PORT=2234
EXPOSE 8787 2234
HEALTHCHECK CMD ["nicotine-shim","healthcheck"]
ENTRYPOINT ["nicotine-shim"]
# shim boots `soulseek-rs daemon --bind 127.0.0.1:5030`, waits for the
# socket, then serves :8787 (/ws + /health on the same port).
```

Compose changes (validate in an untracked `compose.override.yaml` first per
AGENTS.md worktree rules, then commit): bridge builds the new Dockerfile,
publishes `2234:2234` TCP+UDP (was 60754), keeps internal `5030`
unpublished, keeps volumes `config:/config data:/data`, keeps service names
`bridge`/`worker` (web relies on compose DNS). Healthcheck must use the shim
binary or curl — the current `bun -e fetch` probe (`compose.yaml:62`) stays
unhealthy in an image without bun. `web` env (`BRIDGE_INTERNAL_URL=
http://bridge:8787`) is unchanged. Moving `60754 -> 2234` needs a container
recreate (port mappings are immutable at runtime, `server.ts:1938`,
`compose.yaml:35`); hot-swap alone leaves the host mapping stale. Sync
`host.env` to the compose env or a UI-set `2234` is lost on restart
(`server.ts:302`). Keep the docker.sock mount commented unless on a trusted
LAN with `BRIDGE_TOKEN` auth (`compose.yaml:51`, `docker.ts:12`).
`waitForHealthy` currently probes only `:8787/health`, not the peer port
(`docker.ts:259`) — extend it to probe `2234`. `proxy-server.js` stays
unchanged; fix the `BRIDGE_PORT` fallback `80 -> 8787` (`proxy-server.js:31`).

Vendoring: pin `soulseek-rs@<sha>` (investigated `20bd676`) via submodule or
vendored source + `cargo --locked` and a `SOULSEEK_RS_VERSION` stamp. Track
the `176/x` identity and `2416` vs `2242` server-port divergence on upgrade.

## 6. Shim mapping (full replace)

- Auth/session: `BRIDGE_TOKEN` Bearer/subprotocol at the shim edge,
  translated to the `daemon.token` file read. The vault files
  (`session.vault`/`.vault.key`) go away; use `password_cmd` or
  `SOULSEEK_PASSWORD` (no persistence, per README). The migration must carry
  the vault files or auto-login breaks (`server.ts:280` omits them).
- Search: `search.start/results/list/forget` + `wishlist*`. The shim owns the
  timeout window and result shaping, then emits `search:start/result/end`.
  `search:user/room/buddies` have no native daemon mode (responder-only) —
  emulate via global search + client-side filter and document the behavior
  change.
- Browse: `browse.user` poll + local paging cache (preserve the raw
  `browse.cache` bytes format).
- Transfers: `download.*` / `upload.*` + status events. `.part` resume
  replaces the `incomplete/` strategy. Keep writing both `downloads.json`
  and the `transfers.json` compat stub or the queue is lost on downgrade
  (`transfers.ts:530`). Reimplement
  `transfer:stats/queue/finished` (with `downloadUrl` + `localPath`) and the
  `/files/:token` + `/api/files/raw` Range server over shared `/data`.
- Chat: `room.*` + `message.send/history` + `event.room/message`. The shim
  persists `logs/rooms` + `logs/private` on disk — the migration must copy
  the directories, not just files (`server.ts:280` copies files only).
- Userinfo/buddies/privileges: `user.request/info/watch/unwatch/watched` +
  `privileges.check/own`.
- Shares: `shares.status/files/set/reindex`. Flatten
  PUBLIC/BUDDY/TRUSTED/BANNED (`shares.ts:37`); partial tiers leak shares
  (`SharedFileList` 4/5 + `FolderContents` 36/37 + zlib). `preview` becomes a
  dry scan in the shim. Audio probing (mp3/flac bitrate/duration) comes free.
- Config: `config.toml` read/write + `download.set_dir` + listener set
  (daemon restart; no `Bun.listen` equivalent). Port the `docker.ts` recreate
  flow or drop it deliberately.
- Shim-owned (daemon has none): `statistics.json`, diagnostics (preserve the
  JSONL + redaction + tail-500 format), `/health?json`, `/upnp/status`,
  `/portchecker`, `/interfaces` (each plus its `/api/*` alias),
  `/container`, `/restart`, bans/ignores (all three writes + broadcasts),
  plugins (933 lines, `manager.ts:323`, Bun dynamic import + zap/break/pass
  `L772` + 30 wrappers — stub in v1, port later; this is the largest hidden
  scope), geoblock CSV bundle, spectrum 410 + worker proxy.

## 7. Config migration (one-shot converter in the shim)

`settings.json` -> `config.toml` (username/server/listener_port
2234/download_dir/shared_dirs/search_timeout). `shares.json` tiers ->
flat `shared_dirs` (log dropped buddy/trusted). `downloads.json` -> daemon
`downloads.json` envelope `{version:0,data}`. `listen_port 60754` -> `2234`
plus router re-forward notice. `wishlist.json` -> TOML array. `worker.json`
untouched (0600). Chat logs: no upstream import — carry the `logs/` dirs
as-is. `statistics.json`, `plugins.json`, vault stay shim-owned in
`/config`. Preserve `browse.cache` bytes verbatim.

## 8. Build order

1. Vendor the pin + scaffold `shim/` (axum `:8787`, `/health`, `/ws` with
   401 auth, daemon spawn + `auth protocol:2` + event pump + `healthcheck`
   subcommand).
2. Port the WS serde types (all of section 3.1, including the 10 commonly
   omitted: logout, search:page, browse:page, transfer:clear-many,
   chat:logs, chat:global, config:get, statistics:reset, spectrum stub,
   diagnostics:browser-log) with golden tests against current web payloads.
3. Implement search/browse/transfers/chat/userinfo/shares bridges, the file
   Range server, and config/statistics/diagnostics plus the `/api/*`
   aliases and the install POST cap. Plugins and ban/ignore start as
   stubs, then go full.
4. New Dockerfile + local override quad + migration converter + docs
   (`ATTRIBUTION.md`, README security note, `docs/deployment.md` port
   change).
5. Verify: `cargo test` + `cargo clippy` + e2e against `soulfind` (mirror
   upstream CI) + web Playwright smoke (`cp apps/web/.env.example
   apps/web/.env` first) + `bun run build` for web. Probe `:8787/health`
   and peer `2234`.
6. Remove the Bun `apps/bridge/src/*` only after parity; keep
   `proxy-server.js` untouched.

## 9. Top risks

1. Plugin system port (largest scope; stub v1).
2. Share-tier flattening leaking shares; firewalled-child and
   locked-result gaps carry over.
3. Ban/ignore split-brain if the triple write is not preserved.
4. `browse.cache` bytes misparsed as JSON.
5. Vault dropped -> auto-login fails.
6. Host port mapping stale after `60754 -> 2234` without recreate.
7. Daemon `5030` accidentally published (no TLS).
8. Search semantic change (no native user/room/buddy search).
9. `2416` vs `2242` server move and `176/x` identity change.
10. Daemon upgrades breaking the `protocol:2` handshake (pin + fail loud +
    CI bump task).
