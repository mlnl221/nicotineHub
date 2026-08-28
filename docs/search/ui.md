# Search UI Workflow

How the search page behaves and is laid out, matching nicotine's workflow while following
our `docs/DESIGN.md` (Alexandria editorial) and **mobile-first** principles. A design
mockup exists at `docs/search.html` — treat it as **visual inspiration only** (see the
mapping at the end). Several mockup elements are fabricated and must not be built as-is.

---

## 1. Entry point — the search bar

- A single text entry + a **mode selector** (for now only **Global** is active; the
  selector is present but other modes are disabled/placeholder so the architecture is
  obvious).
- Placeholder: accurate copy, e.g. *"Search the Soulseek network…"*. (Do **not** copy the
  mockup's "encrypted, limitless" — Soulseek is plaintext TCP.)
- Search-term syntax (same as nicotine, show as hint):
  - plain word → must be included
  - `-word` → excluded (stripped before transmit, reapplied to rows)
  - `*erm` → partial
  - `"exact phrase"` → quoted
- A **tune / filters** button (mockup: `tune` icon) toggles the filter bar (see §4).
- Submit on **Enter** / a Search button. Opens a **new search tab**.

### Keyboard / touch (mobile)
- No `Ctrl+F` desktop shortcut; provide an on-screen **Filters** toggle button.
- `Esc` to close the filter bar → an on-screen **✕** in the filter sheet.
- Soft-keyboard Enter submits.

---

## 2. Search tabs — one per search, real-time streaming

- Each search opens in its **own tab**, label = the query. Multiple concurrent searches
  are supported (each has its own token).
- Results **stream in live** (newest first). A per-tab counter shows result count, with a
  `+` if filtered or at the cap.
- Tab context actions (desktop right-click → mobile long-press / overflow menu):
  Search Again, Copy Search Term, Close Tab, Close All.
- Our mobile adaptation: a **bottom tab strip** or a swipeable pager of active searches,
  plus a "New Search" affordance (FAB or the bar itself). Closing = swipe-to-dismiss or an
  **✕** on the tab.
- **No "Combined search" tab** in current nicotine; combined views are achieved via
  per-tab filters + shared history. (If desired later, aggregate row lists across tabs.)

---

## 3. Results — columns, grouping, sorting

### Columns (exact set, in order — nicotine `gtkgui/search.py`)
| Column | Type | Notes |
|--------|------|-------|
| User | text | the sharer |
| Country | icon | flag / country-code chip |
| Speed | number | upload speed (`h_speed`) |
| In Queue | number | queued files; empty = free slot |
| Private | icon | shown if from a private share |
| Folder | text | directory (tooltip = full path) |
| File Type | icon | by extension |
| Filename | text | (tooltip = full path) |
| Downloading | icon | set when enqueued |
| Size | number | `h_size` |
| Quality | number | `h_quality` (bitrate or kHz/bit) |
| Duration | number | `h_length` |

> **Correction to naive mockups:** there is **no dedicated "Free slots" or "Ul speed"
> column** — "Speed" *is* upload speed, and free-slot status is shown by an empty
> "In Queue". Keep the order above.

### Grouping (default **Group by Folder**; also **Group by User** / **Ungrouped**)
- Folder grouping: split `path` on `\`; folder row (expandable) contains file rows.
- User grouping: a user row contains folder/file rows beneath.
- Expand/collapse: expand all / none / partial (root rows only).

### Sorting
- Sortable on every column above (backed by hidden numeric `data` columns).
- **Default sort:** newest-first (rows get decreasing ids; ascending id sort yields
  top-most newest).

### Mobile adaptation
- A 12-column desktop tree becomes a **stacked card / row list** on mobile. Each result
  row shows: file-type icon, filename (headline/Noto Serif), folder (muted label), and a
  meta line (User · Size · Quality · Duration · free-slot indicator). Group headers
  (folder/user) are disclosure rows. Tap a row → action sheet (see §5). Hover tooltips
  become tap-to-reveal detail.

---

## 4. Filter bar (full parity — see `filters.md`)

A collapsible panel (mockup: the `tune` button reveals it). Contains, per nicotine:

| Control | Placeholder | Notes |
|---------|-------------|-------|
| Include text | `Include text…` | regex, see filters.md §1 |
| Exclude text | `Exclude text…` | regex |
| File type | `File type…` | `flac wav` / `!mp3` |
| File size | `File size…` | `>10.5m <1g` |
| Bitrate | `Bitrate…` | `256 <1412` |
| Duration | `Duration…` | `>6:00 <12:00` |
| Country code | `Country code…` | `US ES` / `!DE` |
| Free slot | toggle | Upload Slot Available |
| Public files | toggle | only if `private_search_results` |

- **Live filtering**, no Apply button. A Clear/Restore toggle. Recent values as a chip
  row (filter history, cap 50).
- Presets available as first items (see `filters.md` §presets).

### Mobile adaptation
- Filters live in a **bottom sheet** (glassmorphism per DESIGN.md: 80% opacity + 20px
  blur). Free-slot / public become switches. Combobox history → "recent filters" chips.

---

## 5. Context actions (right-click → long-press sheet)

Verbatim nicotine items, reused as handlers:
- **Download File(s)** → handoff to (future) transfers: `(user, path, size, attributes)`.
- **Download File(s) To…** → choose destination folder, then same handoff.
- **Download Folder(s)…** → resolve folder contents, confirm, handoff.
- **File Properties** (Alt+Return on desktop) → detail sheet.
- **View User Profile**, **Browse Folder** → `core.userbrowse.browse_user` (future;
  `SharedFileListRequest` peer 4).
- **Copy** submenu: Copy File Path, **Copy File URL** (`slsk://user/path`), Copy Folder
  URL.
- **User Actions** submenu: Select User's Results, etc.

Double-click / tap on a file row = Download; on a folder row = Download Folder.

> **Download is a handoff stub for now.** Transfers are post-MVP per `README.md` roadmap.
> The search page records the intent and calls a not-yet-built transfers API; it does no
> P2P transfer itself.

---

## 6. `docs/search.html` mockup — real vs. suggestion-only

The mockup is a **desktop "homelab" concept** in the Alexandria style. Use it for *visual
language* (serif headlines, surface tiers, glass cards, the color tokens in DESIGN.md),
**not** for feature scope. Mapping:

| Mockup element | Verdict |
|----------------|---------|
| Side nav (Search/Downloads/Uploads/Chat/Folders/Diagnostics/Logoff) | **Suggestion.** Navigation shell only. Downloads/Uploads/Chat/Folders are future features; for the search page keep a minimal nav (search + future placeholders). Mobile: bottom nav, not a 72px sidebar. |
| Search bar + `tune` filter button | **Keep** (adapt to mobile). |
| Quick filters "Any Type / Audio / Video / Software" | **Partial.** Real taxonomy is `audio/image/video/document/text/archive/executable` (no "software"/"any" special). Replace with the filter bar's file-type control. |
| "Trending Network Shares" + "View All Network" | **Drop.** Soulseek has no trending/global popularity feed. Replace with **Search History / Recent searches** (real, cap 200) or the active search tabs. |
| Bento result cards (Peers / Size / Bitrate / Quality / Verified) | **Partial.** "Peers: N" is misleading — each real row is *one user's file*, not a peer count. Show **User** per row. Drop the "Verified: Yes" badge (no such concept). Keep the card *visual style* (glass card, type badge, meta grid) for the mobile result row. |
| Marketing copy "encrypted, limitless" | **Drop / correct.** Soulseek is unencrypted plaintext TCP. Use accurate copy. |
| "New Transfer" button, footer links (Protocol Stats, Peer Graph…) | **Suggestion / drop.** Transfers are future; footer links are mockup flavor. |
| Alexandria tokens (primary `#094cb2`, tertiary gold `#6d5e00`, surface tiers, no borders, rounded ≥ `sm`, glass blur) | **Keep** — this is our `DESIGN.md` and should drive the real UI. |

---

## 7. Implementation checklist (web)
- [ ] `lib/protocol.ts`: add `search:start/stop/started/result/end/error` types + `SearchResult`.
- [ ] `useSearch` hook: WS client, per-search tab state, live result buffer, per-user
      dedup, 2500 cap, client-side filter + sort.
- [ ] `SearchBar` (global mode; mode selector present but other modes disabled).
- [ ] `SearchTabs` (streaming, counter, close).
- [ ] `FilterBar` (full parity; mobile bottom sheet).
- [ ] `ResultsList` (mobile row/card adapting the 12 columns; folder grouping; tap sheet
      with Download/Browse/Copy-URL).
- [ ] Download handoff stub (records intent; no transfer yet).
- [ ] Apply DESIGN.md tokens; mobile-first; semantic, accessible.
