# Search Workflow — End-to-End

The runtime flow from typing a query to displaying results, exactly as nicotine does it.
Scoped to **global search**, but the structure generalizes to other modes later.

---

## 1. Issue a search

1. User submits a query in the search bar (mode = global).
2. `Search.do_search(term, mode)` (nicotine `pynicotine/search.py:234`):
   - Sanitize the term: split on spaces; drop bare `-word` (excluded words kept
     client-side); preserve `"exact phrase"` and `*partial`. Enforce `min_search_chars`.
   - Allocate a `uint32` token (incrementing counter, wraps at `2^32`).
   - Register the token as "allowed" so inbound `FileSearchResponse` with this token are
     accepted (and so they're dropped before zlib-inflate if not allowed).
   - If `enable_history`, push the sanitized term to the front of `history` (dedupe),
     cap at `SEARCH_HISTORY_LIMIT = 200`.
   - Emit the UI event that opens a **new search tab** named after the term.
   - Send the request: `FileSearch(token, query)` → server code **26**.

> For global search we do **not** need to join the distributed parent/child network. The
> server floods our query for us; results return via reverse P2P connections.

---

## 2. Token routing & result delivery

1. The bridge sends `FileSearch` (26) on the persistent server socket.
2. Matching peers connect **back** to the bridge's inbound peer listener (direct, or via
   `ConnectToPeer`/18 relay + `PierceFireWall`/0 for indirect). See `protocol.md` §2.
3. The bridge performs the peer handshake (`PeerInit`/1 or `PierceFireWall`/0), reads peer
   messages, and on `FileSearchResponse` (9):
   - zlib-inflate the body (cap 128 MiB).
   - Parse username, token, file list, `slotfree`, `avgspeed`, `inqueue` (see
     `protocol.md` §3).
   - Look up `token → (searchId, web session)`. Drop if token not allowed.
   - Forward a `search:result` batch (one peer's response = one batch) over WebSocket.

---

## 3. Aggregation (client-side, in the web app)

Mirrors nicotine's `gtkgui/search.py` behavior:

- **Per-user single response:** within one search, a given `user` contributes **at most
  one** response. If a second response arrives for the same user, ignore it.
- **Display cap:** stop accepting new rows once
  `num_results_found >= max_displayed_results` (**2500** default). Send `search:end`
  with reason `max_results` and deregister the token.
- **Term-level filtering (before transmit AND on results):** any `excluded_words` (`-word`)
  found in the lowercased path → drop the row; not all `included_words` present → drop
  (defends against peers returning wrong results).
- **Quality/length derivation** (`parse_audio_quality_length`): if `bitrate` missing but
  `sample_rate` & `bit_depth` present → `bitrate = sample_rate * bit_depth * 2 // 1000`;
  if `length` missing → approximate `size // (bitrate * 125)`.

---

## 4. Result row data model (canonical)

Every parsed file becomes one row. This is the shape the web app stores, filters, sorts,
and renders (matches `README.md` contract):

```ts
type SearchResult = {
  user: string;
  country?: string;        // ISO code (from IP geolocation or user country)
  speed: number;           // avg upload speed B/s, 0 if unknown
  inQueue: number;         // queued files at peer; 0 == free slot
  slotFree: boolean;       // msg.freeulslots
  folder: string;          // directory portion of virtual path (split on "\")
  filename: string;        // basename
  path: string;            // full virtual path (folder + "\" + filename)
  size: number;            // bytes (uint64)
  quality: number;         // bitrate kbps (0 if lossless-only)
  length: number;          // duration seconds (0 if unknown)
  fileType: string;        // extension or generic type
  private: boolean;        // from a private share
  attributes: {
    bitrate?: number; length?: number; vbr?: number;
    sampleRate?: number; bitDepth?: number;
  };
};
```

Derived display fields (computed once on ingest):
- `h_size` = `human_size(size)` (adaptive binary, e.g. `1.2 GiB`; exact bytes if user
  enables "exact file sizes").
- `h_speed` = `human_speed(speed)` + `/s`, blank if 0.
- `h_queue` = `humanize(inqueue)`; if `slotFree` then `0` → render empty (free slot).
- `h_quality` = `"{sampleRate/1000:.3g} kHz / {bitDepth} bit"` (lossless) or
  `"{bitrate} kbps"` (+ `" (vbr)"` when `vbr == 1`).
- `h_length` = `human_length(length)` (`MM:SS`).

---

## 5. Display & interaction

See `ui.md` for the full UI workflow (tabs, 12 columns, grouping, sorting, context
actions, download handoff). Summary:

- One **tab per search**, label = query, results stream in live (newest first).
- Default **Group by Folder**; columns: User, Country, Speed, In Queue, Private, Folder,
  File Type, Filename, Downloading, Size, Quality, Duration.
- Right-click / long-press context menu: Download, Download To…, Browse Folder, File
  Properties, Copy File/Folder URL, user actions.
- **Download** is a handoff: produce `(user, path, size, attributes)` and pass to the
  (future) transfers subsystem. The search page itself does no transfer work.

---

## 6. Stop / cleanup

- `search:stop` (web → bridge): deregister the token immediately; late results dropped.
- On `max_results`, `timeout`, or tab close: deregister token, emit `search:end`.
- Search history persists client-side (cap 200) for the search-box dropdown.
