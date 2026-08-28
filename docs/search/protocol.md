# Search Protocol — Wire-Level Reference

All integers are **little-endian**. Strings are `uint32 length` + UTF-8 bytes (legacy
clients used Latin-1; modern clients decode UTF-8 and fall back to Latin-1). Framing:

- **Server messages:** `[uint32 length][uint32 code][payload]` (length = payload + 4).
- **Peer messages:** `[uint32 length][uint32 code][payload]`.
- **Peer-Init messages:** `[uint32 length][uint8 code][payload]` (code 0 or 1).
- **Distributed messages:** `[uint32 length][uint8 code][payload]`.

> Source of truth: nicotine-plus `doc/SLSKPROTOCOL.md` and `pynicotine/slskmessages.py`.

---

## 1. Issuing a global search — Server code 26 `FileSearch`

Sent **to** the server. The server floods it through the distributed network; results
come back from peers over reverse P2P connections (never over this socket).

| # | Field | Type |
|---|-------|------|
| 1 | token | uint32 |
| 2 | search query | string |

```text
[uint32 len][uint32 26][uint32 token][string query]
```

**Query hygiene (critical):** nicotine splits the query on spaces and **drops any bare
`-word` token before transmitting** (`" ".join(x for x in text.split() if x != "-")`).
Those excluded words are kept client-side and used to filter returned rows (see
`filters.md`). A quoted `"exact phrase"` and a partial `*erm` are preserved in the
transmitted query. Server enforces `min_search_chars = 3`.

The server sends **no response** to code 26 — it only relays. (When the server relays a
search to a *specific* user outside the distributed network, the receive form is
`[string username][uint32 token][string query]`; not relevant to us as the searcher.)

---

## 2. How results actually arrive (the P2P connect-back)

The server does **not** return results. Flow:

1. We send `FileSearch` (26) with our `token`.
2. The server propagates the query as a `DistribSearch` (distributed code 3) through the
   distributed network (informational for us — we do **not** need to be a distributed
   parent/child to issue our own search).
3. Every peer with a match **connects back to us** and sends `FileSearchResponse`
   (peer code 9) carrying our original `token`.
4. We match `token` → active search and display.

### Peer connection types
When a peer connects to deliver a result, it sends the **first** bytes as a Peer-Init:

- **`PeerInit` — init code 1** (direct connection):
  `[string own_username][string conn_type][uint32 token]`
  `conn_type` ∈ `P` (peer/search), `F` (file transfer), `D` (distributed). For search
  results it is `P`. The `token` is always `0` in modern clients.
- **`PierceFireWall` — init code 0** (indirect connection response):
  `[uint32 token]` — the token taken from a `ConnectToPeer` (server code 18) message.

### Two ways a peer reaches us
- **Direct:** the peer resolves our IP:port (from the distributed network / server) and
  connects straight to our listen port, sending `PeerInit`. We accept.
- **Indirect (relay):** if the peer can't reach us, the server sends **us** a
  `ConnectToPeer` (server code 18):
  - Receive: `[string username][string type][uint32 ip][uint32 port][uint32 token][bool privileged][uint32 obfuscation_type][uint32 obfuscated_port]`.
  - We then connect to that `ip:port` and send `PierceFireWall(token)` (init 0). The peer
    replies with its `FileSearchResponse`.

After the handshake, the peer sends normal **peer messages**; we read `FileSearchResponse`
(code 9). One connection per peer is reused.

---

## 3. Search result — Peer code 9 `FileSearchResponse`

**The entire message body (everything after the code) is zlib-compressed**
(`zlib.compress(msg, level=4)` in nicotine). On the wire:

```text
[uint32 len][uint32 9][zlib( payload )]
```

Decompress (cap ~128 MiB to avoid abuse), then the layout is **flat** — a list of files,
**not** folder-grouped on the wire (folder grouping is reconstructed client-side by
splitting the path on `\`):

| # | Field | Type | Notes |
|---|-------|------|-------|
| 1 | username | string | the sharer |
| 2 | token | uint32 | echoes our search token |
| 3 | number of results | uint32 | public results |
| 4 | **per result** (below) | | |
| 5 | slotfree | bool | peer has a free upload slot |
| 6 | avgspeed | uint32 | peer average upload speed |
| 7 | queue length | uint32 | files queued at peer |
| 8 | unknown | uint32 | always 0 from official clients (may be absent) |
| 9 | number of private results | uint32 | optional, if bytes remain |
| 10 | **per private result** | | same structure as public |

### Per-result field order
| # | Field | Type | Notes |
|---|-------|------|-------|
| a | code | uint8 | always `1` |
| b | filename | string | **full virtual path**, folders separated by `\` |
| c | file size | uint64 | see size note |
| d | extension length | uint32 | **obsolete** — present but ignored/skipped |
| e | number of attributes | uint32 | count of (code,value) pairs |
| f | **per attribute** | | `uint32 code`, `uint32 value` |

**File size bug:** normally uint64, but if the high byte is `255` (a Soulseek NS >2 GiB
bug), parse only the low 4 bytes (uint32) and skip the rest.

### File attributes (code → meaning, all uint32)
| Code | Attribute | Unit |
|------|-----------|------|
| 0 | Bitrate | kbps |
| 1 | Duration / Length | seconds |
| 2 | VBR | 0 or 1 |
| 3 | Encoder | obsolete |
| 4 | Sample Rate | Hz |
| 5 | Bit Depth | bits |

Common combinations in the wild:
- Lossy: `{0: bitrate, 1: duration, 2: vbr}`
- Lossless FLAC/WAV/APE: `{1: duration, 4: sample rate, 5: bit depth}`
- WV: `{0: bitrate, 1: duration, 4: sample rate, 5: bit depth}`

If `nfiles > 1`, nicotine sorts results by `name` before delivery.

---

## 4. Token mechanism

- Tokens are `uint32`, generated by the client. nicotine starts at
  `randint(0, 2^32 // 1000)` and increments by 1 per search (wrapping at `2^32`). The
  same counter is reused for searches, transfers, and connection requests.
- **Acceptance gate:** before sending, register the token as "allowed". The network layer
  keeps an `allowed_responses` set; `FileSearchResponse` parsing aborts *before* the
  expensive zlib inflate if its token is not allowed. On search end, deregister so late
  results are dropped.
- **Matching:** results are matched to a search **solely by `token`**. No other key.

---

## 5. Related / future message codes (reference only)

| Code | Message | Relevance |
|------|---------|-----------|
| 26 | FileSearch | ✅ issue global search |
| 42 | UserSearch | later: search one user's shares |
| 103 | WishlistSearch | later: periodic wishlist re-search |
| 104 | WishlistInterval | later: server-driven re-search period |
| 120 | RoomSearch | later: search a room |
| 160 | ExcludedSearchPhrases | later/never: governs *answering* searches, not searching |
| 18 | ConnectToPeer | ✅ indirect result delivery (relay) |
| 93 | EmbeddedMessage | distributed; not needed to issue our own search |
| 3 | DistribSearch | distributed flood; informational |
| 4 | SharedFileListRequest (peer) | later: browse a user's whole share list |
| 9 | FileSearchResponse (peer) | ✅ results |
| 1 | PeerInit (init) | ✅ peer handshake |
| 0 | PierceFireWall (init) | ✅ indirect handshake |
