# Search Feature — Workflow & Implementation Spec

This folder documents **how Soulseek search works in nicotine+**, distilled so we can
implement a search page that behaves *exactly* like nicotine. It is the single source
of truth for the search feature. The implementation target (confirmed) is:

- **Mode:** Global file search only (server code 26). The architecture leaves room for
  Buddies / Rooms / User search later.
- **Backend:** The bridge does **full P2P** — it listens for inbound peer connections,
  performs the peer handshake, zlib-decodes `FileSearchResponse` (peer code 9), and
  forwards parsed results to the web client over WebSocket. Real results, not mocks.
- **Filters:** Full nicotine parity (regex include/exclude, size / bitrate / length
  operator expressions, file-type, country, free-slot, public-only).

A design mockup exists at `docs/search.html` (the "Alexandria" editorial style from
`docs/DESIGN.md`). **It is a suggestion/guideline, not a requirement.** Several elements
in it are fabricated marketing (e.g. "Trending Network Shares", "encrypted, limitless",
a "Verified" badge) and do not exist in Soulseek — see `ui.md` for the mapping and what
to keep vs. drop.

## Documents in this folder

| File | What it covers |
|------|----------------|
| `protocol.md`  | Wire-level message layouts: `FileSearch` (26), `FileSearchResponse` (9, zlib), peer handshake (`PeerInit` 1 / `PierceFireWall` 0), `ConnectToPeer` (18) relay, token mechanism, distributed flood (informational). |
| `workflow.md`  | End-to-end runtime flow: issue → token routing → P2P connect-back → aggregation → display. Plus the canonical **result row data model**. |
| `filters.md`   | Full filter reference with nicotine's exact syntax and examples (the filter bar parity spec). |
| `ui.md`        | UI/workflow: search bar, per-search tabs, the 12 result columns, grouping, sorting, context actions, download handoff, mobile/touch adaptation, and the `search.html` mockup mapping (real vs. suggestion-only). |

## Architecture & Browser ↔ Bridge contract

The browser cannot open raw TCP. The Bun bridge owns the Soulseek TCP connection (server
+ inbound peer listener) and speaks JSON over WebSocket to the web app.

```
[ Web (Next.js PWA) ]  -- WebSocket JSON --  [ Bun bridge :8787 ]
                                                |  server TCP  --> server.slsknet.org:2242  (FileSearch 26)
                                                |  peer listener --> inbound peers (FileSearchResponse 9, zlib)
```

### Messages: Web → Bridge
- `search:start` — `{ type, query, searchId, mode? }`. `mode` is `"global"` for now
  (reserved: `"buddies" | "rooms" | "user"`). The bridge allocates a `uint32` token,
  registers it, and sends `FileSearch` (26) to the server. Replies with `search:started`.
- `search:stop` — `{ searchId }`. Deregisters the token so late results are ignored.

### Messages: Bridge → Web
- `search:started` — `{ searchId, token }`. Confirms the search is live.
- `search:result` — `{ searchId, token, batch: Result[] }`. Streamed; each batch is one
  peer's response (nicotine sends one response per matching user). `Result` shape is the
  row model in `workflow.md`.
- `search:end` — `{ searchId, reason }`. `reason` ∈ `max_results | stopped | timeout`.
- `search:error` — `{ searchId, message }`.

### Result shape (one row)
```ts
type SearchResult = {
  user: string;
  country?: string;        // ISO code, if known
  speed: number;           // avg upload speed (B/s), 0 if unknown
  inQueue: number;         // files queued at peer; 0 == free slot
  slotFree: boolean;       // msg.freeulslots
  folder: string;          // directory portion of the virtual path (\-separated)
  filename: string;        // basename
  path: string;            // full virtual path (folder + "\" + filename)
  size: number;            // bytes (uint64)
  quality: number;         // bitrate kbps (0 if lossless-only)
  length: number;          // duration seconds (0 if unknown)
  fileType: string;        // extension or generic type
  private: boolean;        // from a private share
  attributes: { bitrate?: number; length?: number; vbr?: number; sampleRate?: number; bitDepth?: number };
};
```

## Out of scope (documented for later)
- Buddies / Rooms / User search, Wishlist (periodic re-search), Browse-user
  (`SharedFileListRequest` peer 4), `ExcludedSearchPhrases` (160, only matters when we
  *answer* searches), and the distributed parent/child network (not needed to *issue*
  our own global search — the server floods it for us).
- Actual file transfers (download/upload P2P). The search page records a download intent
  and hands off to a not-yet-built transfers subsystem (see `ui.md`).
