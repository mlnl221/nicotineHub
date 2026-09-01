# Plan: NAT/UPnP robustness + type-1 obfuscation (compatibility) + browse/search hardening

**Worktree:** `/home/magnus/projects/nicotine_mobile-fix-nat-obfuscation` branch `fix/nat-obfuscation-browse-search` base `stage@fdf1cb2`
**Decisions:** keep `network_mode: host`, router UPnP/NAT-PMP only (no VPN/Gluetun), obfuscation `compatibility` (normal first, fallback to obfuscated)
**Ref:** `apps/bridge/src/portmapper.ts`, `session.ts:344`, `soulseek.ts:568`, `shares.ts`, local `~/projects/slskr` analysis (`crates/slskr-protocol/src/obfuscation.rs:3`, `crates/slskr-client/src/io.rs:365`, `listener.rs:212`)

## 1. Context

Search/browse require inbound `P` to receive `FileSearchResponse 9` / `SharedFileList 5`. With `LISTEN_PORT 60754` unreachable, results/timeouts. Current portmapper ports `pynicotine/portmapper.py` but `findLocalIpAddress()` `session.ts:344` returns first `!internal` iface (often `docker0`/`tailscale`) not outbound route, causing `NAT-PMP addPortMapping` bind `172.x` → gateway unreachable and SSDP `setMulticastInterface(172.x)` misses LAN. `portmapper.ts:337` double `setTimeout(doResolve,2s)+5.5s` truncates slow IGD. No obfuscation: `session.ts:1884` ignores `obfuscatedPort`, failing against peers advertising only rotated port.

`slskr` provides no router UPnP (only `natpmpc` for Proton) but contributes proven obfuscated transport and bounded decompression patterns.

## 2. Goals / Non-Goals

Goals:
- Fix host-mode `findLocalIpAddress` to return outbound-route IP
- Fix SSDP 2s truncation, fetch caps, orphan lease ordering
- Add type-1 rotated obfuscation **outbound fallback** (compatibility) + **inbound demux** on same `LISTEN_PORT`
- Add browse `inflate` trailing-data and size guards parity
- Expose `lastAttemptAt` in health/diagnostics

Non-Goals: VPN natpmpc, PCP, second advertised port, distributed branch vs leaf.

## 3. Changes

### 3.1 `session.ts:344` `findLocalIpAddress` — host-route aware

Current:
```ts
for (addrs of networkInterfaces) if (!internal IPv4) return first
```

Proposed:
- Parse `/proc/net/route` for default `Iface` (same as `NATPMP.getGatewayAddress` but also return iface) — reuse logic from `portmapper.ts:33` factored into `getDefaultGatewayIface()` helper.
- If found, lookup `networkInterfaces()[iface]` exact `IPv4 !internal` → return that address.
- Fallback: UDP connect probing: `createSocket("udp4")` `connect(53,"8.8.8.8", cb => socket.address().address)` fast async with 200ms timeout and sync fallback to polling. For sync contexts, expose `findLocalIpAddressAsync()` and make `updatePortMapper`/`setListenPort`/`setNetworkInterface` async-aware while keeping sync shim for hot paths.
- Fallback else: scan all `!internal` IPv4, prefer `eth*`/`en*`/`wlan*`/`ens*` lexically, skip `docker*`/`br-*`/`veth*`/`tailscale*`.
- Return `0.0.0.0` only if none.

Test: mock `networkInterfaces` + `readFileSync(/proc/net/route)` in new `session.test.ts`.

### 3.2 `portmapper.ts:33` gateway + `212` UPnP

- `getGatewayAddress()` also expose `getGatewayAddressAndIface(): {gw, iface}|null`. `ip route` fallback add regex `default (?:via (\d.\d.\d.\d).*)?dev (\w+)` to handle `default dev eth0` without `via`.
- `UPnP.getServiceControlUrl(locationUrl)` caps:
  - `fetch(locationUrl, {redirect:"manual"})` + follow max 1 same-host redirect only.
  - `AbortController` 5s, read `body` with `max 16_384 bytes` guard (stream consume limit).
  - Validate `controlURL` same-host as `locationUrl` host, reject `evil.com`.
- `UPnP.getServices(privateIp)` fix double timer: keep only `5500ms` timeout, remove `2000ms` line `portmapper.ts:337`.
- `PortMapper.setPort`/`setListenPort` ordering: store `oldPort/oldIp/activeImpl`, `await removePortMapping(true)` with old values before `setPort(new)`. Add `setPortWithRemoval(oldPort,oldIp,newPort,newIp)` helper or sequential `remove` before `setPort` in callers.

### 3.3 Obfuscation — new `apps/bridge/src/obfuscation.ts` + `soulseek.ts` / `session.ts` wiring

Port `slskr/crates/slskr-protocol/src/obfuscation.rs:3`:

```
ROTATED_OBFUSCATION_TYPE = 1
encode_rotated(input,key): [key LE4][input XOR keystream(key.rotate_left(1) per 4B)]
decode_rotated(input): key=LE4; xor rest
apply_rotated_keystream: for 4B chunk key=rotate_left(1); xor
```

- Create `apps/bridge/src/obfuscation.ts` with `encodeRotated`, `decodeRotated`, `ROTATED_TYPE`.
- `soulseek.ts:400` add `encodeRotatedFrame`/`decodeRotatedFrame` helpers, `buildSetWaitPortObfuscated(port, obfPort)` framing `packUint32(port)+packUint32(1)+packUint32(obfPort)` tail (peer address same), `parse` already handles tail.
- `session.ts:1874` `connectToPeer(ctp)` add `obfuscatedPort` branch: try `Bun.connect(ip, port)` normal via `buildPierceFireWall`; on fail/timeout try `obfuscatedPort` via new `connectToPeerObfuscated` which sends `encodeRotated([len][code][PierceFirewall(token)])` and expects `decodeRotated` inbound.
- `session.ts:1922` `connectPeerWithRelay` directPromise: normal `connectPeerPlain`, relay `pendingConnects`, race; add `directObfuscatedPromise` if `addr.obfuscatedPort` present and `addr.obfuscationType===1` — only started after `directPlain` fails (compatibility).
- Inbound: `session.ts:2008` `processPeer` init handling: before checking `pendingFileTokens` heuristic, try `decodeRotated` peek 8B for length `<=16M` like `slskr/listener.rs:212` shared demux. If succeeds, mark `state.obfuscated=true` and decode full frame. Add `readObfuscatedInit` path for `PierceFirewall`/`PeerInit`.
- Listener: `startListener` currently `Bun.listen({hostname})` raw. Add shared demux: peek first bytes via `tryDecodeObfuscated` in `peerStates` buffer path; reuse same port (no +1) to keep host mapping simple. Document that `LISTEN_PORT` serves both plain+obfuscated.
- Keep `PortMapper` mapping single `LISTEN_PORT` (host+router only need one). No extra UPnP mapping for obfuscated unless user sets `OBFUSCATED_PORT`.

Feature flag: `OBFUSCATION=1` env or config `server.obfuscation` toggles; defaults on (to match slskr) but outbound prefers plain.

### 3.4 Browse/Search decompression hardening

- `shares.ts:969` `parseSharedFileListResponse` currently `inflateSync(payload)` bare. Add guard like `soulseek.ts:631` `inflateWithCap` with `MAX_SEARCH_DECOMPRESSED 128M`/`MAX_SHARE_DECOMPRESSED 64M`, second-stage check `buf[0]==0x78` two-stage, and **trailing check**: `inflateSync` total_in === payload.length else throw `TrailingCompressedData` (mirror `slskr/share_payload.rs:32`).
- `soulseek.ts:634` `inflateWithCap` add `if (buf.length > max) throw` already; add explicit `total_in` length check via sync no streaming in Node; add tests for concatenated zlib rejection.

### 3.5 Diagnostics

- `session.ts:398` `getPortMapperStatus` already returns `lastAttemptAt`; ensure `server.ts:415` `/health?json` + `/upnp/status` `server.ts:432` includes it (currently `getGlobalPortMapperStatus` trims to `active,port,ip,error,lastSuccessAt,hasPort` — add `lastAttemptAt`).
- `portmapper.ts:494` `startRenewalTimer` still runs after failure; add exponential backoff 2h→1h→30m? Keep 2h but log `will retry at ...`.

## 4. Tests

- `portmapper.test.ts`: keep existing `NATPMP constants`, `getServiceControlUrl` relative/absolute, add test for `ip route` `default dev eth0` parsing, double-timer removal, fetch cap.
- New `obfuscation.test.ts`: `encode/decode roundtrip`, rotate vectors from slskr `tests/obfuscation.rs`, `buildSetWaitPortObfuscated` framing, `decodeRotated` `<4` error.
- `session.test.ts` (new): `findLocalIpAddress` with mocked `networkInterfaces` + `/proc/net/route` iface, `setListenPort` orphan removal order.
- `soulseek.test.ts`: add browseshare trailing-data rejection.

Command: `bun test && bun run build` in worktree (`PORT=8788 LISTEN_PORT=60755 bun run --cwd apps/bridge dev` etc not needed for CI).

## 5. Rollout

- Worktree already `fix/nat-obfuscation-browse-search` base `stage`. Implement in order 3.1→3.2→3.3→3.4→3.5.
- Verify `ss -tlnp | grep 60755` no collide with main `60754`.
- PR description: `Fixes NAT route IP + SSDP timeout + orphan lease + type-1 obfuscation compatibility + browse zlib trailing`.
- Risks: obfuscated inbound on same port changes framing heuristics — guard with `tryDecodeRotated` fallback to plain.
