# Search — UI mapping

Component tree in `apps/web/src/components/search/*`, themed per `docs/DESIGN.md`
(Alexandria high-end editorial; primary `#094cb2`, tertiary gold `#6d5e00`, surface tiers,
ghost-border, Material Symbols `material-symbols-outlined`).

| Nicotine | Mobile component | Notes |
|----------|------------------|-------|
| Search entry (top) | `SearchBar` | rounded "ghost-border" pill, `search` icon; filter toggle with active-count badge; stop button while searching |
| Search tabs / history | `SearchTabs` | horizontally scrollable pills, one per search; close (×) + live "•" while searching |
| Filter row | `FilterBar` | sheet-expandable grid of inputs matching `filters.md`; free-slot / public-only toggles |
| Results (folder tree) | `ResultsList` | rows grouped by `folder`, collapsible group headers, per-file row with type icon, size, quality, length, free-slot / queue badge |
| Result row actions | `SearchScreen` (bottom sheet) | long-press a row → Download (stub toast), Copy file URL (`slsk://`), Copy folder URL, Browse user (stub) |
| Status line | `SearchScreen` | "N of M results · searching… / limit reached" |

## What is intentionally NOT built (mockup was a suggestion only)
The `docs/search.html` mockup shipped with fabricated elements we agreed to drop:
- "Trending Network Shares" grid and the `TRENDING` mock data — search starts empty.
- "Verified" badge and per-card "Peers" count — not part of the Soulseek result model.
- "encrypted / limitless / secure" marketing copy — removed; the real value is the live
  P2P results.

## Tokens / classes used
- Backgrounds: `bg-surface-container-low`, `bg-surface-container-lowest`, `bg-surface-container`.
- Text: `text-on-surface`, `text-on-surface-variant`, `text-outline`.
- Accent: `text-primary`, `bg-primary-container`, `bg-tertiary-container`.
- Borders: the `ghost-border` utility (see `globals.css`); no hard borders per DESIGN.md.
- Type: `font-headline` (display), `font-body`, `font-label` (uppercase meta).

## Behavior
- Route `app/search/page.tsx` redirects to `/` unless `useSession().state.status === "connected"`.
- Each search opens a new tab; switching tabs preserves its rows + filters.
- Rows stream in live; `applyFilters` runs over the visible tab's rows.
- `MAX_RESULTS_PER_SEARCH` (2500) is enforced in the bridge; when hit, the status line
  shows "limit reached".
