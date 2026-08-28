# Search — Implementation Spec (nicotine_mobile)

Scope decided with the user:

- **Global search only.** No wishlist/buddies rooms, no per-user browse.
- **Full P2P in the bridge.** The bridge is a real Soulseek peer: it opens an inbound
  peer listener, joins the distributed network, sends `FileSearch` (1) to distributed
  and direct peers, and decodes `FileSearchResponse` (9) results that come back over
  peer connections (including `ConnectToPeer` (18) relayed connections from the server).
- **Full filter parity** with nicotine-plus (regex include/exclude, size/bitrate/length
  operators, file-type tokens, country, free-slot, public-only).

The web app is a thin client: it opens one WS to the bridge, owns the search UI state
(tabs, streaming rows, filters), and never speaks Soulseek directly.

## Client ↔ Bridge contract (JSON over `ws://host:8787/ws`)

### Client → Bridge
```jsonc
// start a global search; user assigns searchId (monotonic per tab)
{ "type": "search", "searchId": 1, "query": "daft punk" }

// stop a search in progress (bridge tears down distributed ticket + pending peers)
{ "type": "search:stop", "searchId": 1 }
```

### Bridge → Client
```jsonc
// emitted when the distributed ticket is registered
{ "type": "search:start", "searchId": 1, "token": 481241 }

// streamed zero or more times; each message is a batch of rows
{ "type": "search:result", "searchId": 1, "token": 481241, "rows": [ <SearchRow>, ... ] }

// emitted once the search is finished or aborted
{ "type": "search:end", "searchId": 1, "reason": "max_results" | "connection_closed" | "aborted" | "timeout" }
```

`reason: "max_results"` fires when the bridge caps a single search at 2500 rows
(`MAX_RESULTS_PER_SEARCH`) to match nicotine's practical limit.

### SearchRow
```ts
interface SearchRow {
  user: string;       // peer username
  folder: string;     // parent folder shown in results tree
  path: string;       // full path (used for slsk:// link + download)
  filename: string;   // basename
  fileType: string;   // file extension without dot, lowercased
  size: number;       // bytes
  slotFree: boolean;  // true if peer has a free upload slot
  inQueue: number;    // upload queue length (0 when slotFree)
  speed: number;      // peer upload speed in bytes/s (0 if unknown)
  attributes: { type: number; value: number }[]; // bitrate(0), length(1), vbr(2), sampleRate(4), bitDepth(5)
  private: boolean;   // true if result came from a private/locked share
}
```

## Result flow (why P2P is required)

1. On `search`, bridge sends `FileSearch` (1) with a random token to the server. The
   server registers the token → distributed ticket and fans it out.
2. Other peers respond with `FileSearchResponse` (9). Two cases:
   - **Direct:** the peer already has our `ConnectToPeer` info, so it connects to our
     inbound listener. First bytes are `PeerInit` framed as `[uint32 len][uint8 code=1]`.
   - **Relayed:** the peer sends `ConnectToPeer` (18) *via the server*; bridge replies
     with `PierceFireWall` (0) using the given token (if we are the recipient) and then
     the peer finishes the handshake and sends `FileSearchResponse` over that socket.
3. Bridge parses the `FileSearchResponse`, groups rows by `user`, de-dupes per user,
   maps to `SearchRow`, and emits `search:result` batches keyed by `searchId`.

> The bridge advertises its listen port to the server via `SetWaitPort` (2) using
> `LISTEN_PORT` (default `2234`). For real results the port must be reachable from the
> internet — see `compose.yaml` (published `2234/tcp` + `2234/udp`).

## Files

- `apps/bridge/src/soulseek.ts` — wire builders/parsers (`buildFileSearch`,
  `frameInitMessage`, `buildPierceFireWall`, `parseConnectToPeer`,
  `parseFileSearchResponse` incl. zlib + private results).
- `apps/bridge/src/session.ts` — `SoulseekSession.search(query, searchId, handlers)`,
  per-user dedup, ConnectToPeer relay, `cancelSearch(searchId)`, `toRow`.
- `apps/bridge/src/server.ts` — WS protocol above.
- `apps/bridge/src/soulseek.test.ts` — byte-level tests vs nicotine wire format.
- `apps/web/src/lib/protocol.ts` — `SearchRow`, `FilterState`, message types.
- `apps/web/src/lib/session.tsx` — shared WS; exposes `send` + `subscribe`.
- `apps/web/src/lib/search.tsx` — `SearchProvider` / `useSearches` (tabs, streaming, filters).
- `apps/web/src/lib/filter.ts` — `applyFilters` (full nicotine filter syntax).
- `apps/web/src/lib/format.ts` — `humanSize` / `humanSpeed` / `humanLength` / `humanQuality`.
- `apps/web/src/components/search/*` — `SearchBar`, `SearchTabs`, `FilterBar`,
  `ResultsList`, `SearchScreen`.
- `apps/web/src/app/search/page.tsx` — route; redirects to `/` when not connected.

See `protocol.md`, `filters.md`, `ui.md`, `workflow.md` for detail.
