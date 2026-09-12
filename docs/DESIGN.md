# Alexandria — High-End Editorial

## North Star: "The Digital Curator"
A scholarly, premium reading experience. Dense information made effortless through serif authority and generous whitespace.

## Colors
- **Primary (`#094cb2`):** Links, primary actions, focus states only.
- **Surface tiers** create hierarchy—no explicit borders. Use background shifts between `surface-container-lowest` → `surface-dim`.
- **Tertiary (`#6d5e00`):** Archival gold for highlights and badges.
- **No-Line Rule:** Never use 1px borders. Define boundaries through background color shifts.
- Use glassmorphism for floating menus (80% opacity + 20px backdrop-blur). Gradient CTAs from `primary` → `primary_container`.

## Typography
- **Headlines:** Noto Serif — large, authoritative, generous leading.
- **Body:** Inter — modern clarity for dense text.
- **Labels:** Public Sans — archival metadata feel.

## Elevation
- Depth through tonal layering, not shadows. Stack surface tokens for natural elevation.
- Modals: extra-diffused shadows (24-40px blur, 4-6% opacity, tinted `on_surface`).
- If borders needed: "Ghost Border" — `outline_variant` at 15% opacity.

## Components
- **Buttons:** Primary = gradient fill, Secondary = surface-high bg + primary text, Tertiary = text + hover underline.
- **Cards:** No divider lines. Use spacing or alternating surface colors.
- **Inputs:** White bg, ghost border, focus = primary border.

## Rules
- Use whitespace as structure. Serif for narrative text. One primary action per view.
- Never use sharp corners — minimum `sm` roundness.

## Mobile Page Standards

Every page follows one shell so mobile stays consistent. Desktop is guarded by `md:` and must never regress. Standardized in PR #166 (`feat/search-mobile-compact`, phases 1–3); follow these rules when building new pages.

### Page shell (copy verbatim)

```tsx
<div className="flex min-h-screen max-w-full overflow-x-clip ...">
  <Sidebar />
  <TopBar title="..." subtitle="..." />
  <main className="md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-clip max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
    <PageHeader title="..." subtitle="..." settingsHref="..." />
    {/* sticky toolbar, then scroll content */}
  </main>
  <BottomNav />
</div>
```

- `TopBar` is 60px tall. Any secondary sticky bar uses `top-[calc(60px+env(safe-area-inset-top,0px))]` on mobile, `md:top-0` (or `md:static`) on desktop. Edge-to-edge bars — never nest a sticky bar inside a padded card.
- Mains/roots use `overflow-x-clip`, **not** `overflow-x-hidden` (`hidden` breaks `position: sticky` and creates scroll containers).
- Demo-mode offsets in `globals.css` are keyed to the 60px TopBar; keep them in sync if TopBar height changes.

### Touch targets (two-tier)

- Tier 1, `min-h-11` (44px): buttons, text inputs, selects, textareas, rows, tab pills.
- Tier 2, `min-h-9` (36px): tab-pill close buttons (`h-8 w-8`), chips, sort/group/expand selects, bulk-bar Clear.
- All text inputs/selects/textareas: `text-base md:text-sm` (iOS focus-zoom guard). No exceptions — audit every input, including diagnostics-style filter fields.

### Shared mobile components (reuse, don't re-invent)

- `EmptyState` (`components/mobile/EmptyState.tsx`) — page-level empties: centered icon + title + helper + action, `role="status"`. Title strings and `testId`s are asserted in `e2e/` — never rename without updating specs.
- `CompactEmpty` — inline notes inside scroll flow or cards. For page-level empties use `EmptyState`.
- `SectionLabel` — kickers/list captions only (`text-xs font-semibold uppercase tracking-widest`). Real sections keep proper heading elements. Never `text-[10px]` labels for section kickers.
- `MobileHelp` (`components/ui/MobileHelp.tsx`) — progressive disclosure: `short` summary + info button on mobile, full children inline on desktop. Info button must meet Tier 2 (≥36px), not `h-6 w-6`. Use instead of hiding help text on mobile.
- `BulkBarShell` (`components/ui/BulkBarShell.tsx`) — selection bars: count + Clear + actions slot + optional note. Wire all bulk bars through it.
- `ContextMenu` + `useContextMenu().openAt` — all dropdown/overflow menus. It self-clamps to viewport, flips near edges, closes on scroll/resize, one menu at a time. Don't build inline absolute menus. Menu item labels asserted in `e2e/chat.spec.ts` — keep stable.

### Collapsible toolbars (lookup / scope / picker pattern)

Dense toolbars collapse behind a pill once context is active (profile lookup → "Look up user…", search scope → current-mode pill, chat picker → "Look up rooms…", wishlist → toggle). Rules:

- **One mounted instance, CSS show/hide only** — never conditionally unmount inputs, or draft text is lost on toggle/resize. Toggle with `hidden` / `block` classes, not `{open && <Input/>}`.
- **Desktop always expanded via `md:` classes** (`md:block`, `md:flex`). State defaults serve mobile; CSS overrides serve desktop.
- **GOTCHA — `hidden` applies at all breakpoints.** Any element hidden in collapsed mode MUST carry its desktop restore (`md:block` / `md:inline-flex`). Missing it deletes the control on desktop whenever a tab is active (PR #166 review: profile View button). Verify every collapse at 1280px with an active tab.
- Collapsing must never strand function: switching modes/rooms/tabs stays possible from the collapsed state (PR #166 review: chat picker needed a joined-rooms switcher because the public dropdown only fills the join field).

### Overlay scale (z + bottom offsets, mobile)

- `z-40`: TopBar, MiniPlayer, BulkBarShell. `z-50`: BottomNav, toasts. `z-70–100`: action sheets, modals, `ContextMenu` portal, About dialog.
- Bottom-anchored floats offset above BottomNav (~64–76px) **plus** `env(safe-area-inset-bottom)`. Toasts must sit above modal z, or firings from dialogs are invisible.
- Demo/preview banners use the amber visual language (`amber-50` / `amber-950`), not tertiary.

### Dark parity checklist

Every new surface needs explicit `dark:` variants: sticky bars, tab pills (inactive state), inputs/selects, menus, sheet/modal panels. Unverified dark = broken dark.

### Logic + tests

- Pure UI rules go in react-free `lib/` helpers importable by `bun:test` (pattern: `lib/mobile-help.ts`, `lib/profile-pic.ts`). One canonical implementation per rule — two diverged sniffers shipped in PR #166 and had to be merged.
- Keep-green: `bun test` (unit, incl. mobile-help/profile-pic) + `bun run build` (typecheck + prod). Playwright spot-check at 390–440px, rest + scrolled: sticky bars stick at 60px, no horizontal overflow (`scrollingElement.scrollWidth <= innerWidth`), header gap ≤4px.

## Omitted Nicotine+ Controls — Intentional

Per Phase A/B decision (2026-08-30), the following nicotine+ `userinterface.ui` controls are **omitted** to preserve `DESIGN.md` editorial consistency:

- **Color pickers** (`chatme/chatcommand/chathilite/urlcolor/useronline/useraway/useroffline/chatremote/chatlocal/textbg/search/inputcolor/tab_default/tab_hilite/tab_changed` — 15 hex keys): Replaced by fixed `primary #094cb2 / tertiary #6d5e00 / surface tiers` palette. User theming stays `dark_mode` boolean only.
- **Font pickers** (`globalfont/textviewfont/chatfont/searchfont/listfont/browserfont/transfersfont`): Replaced by `Noto Serif / Inter / Public Sans` stack via `apps/web/src/app/layout.tsx` font preconnect. No runtime font selection.
- **Tab position selectors** (`tabmain/tabrooms/tabprivate/tabinfo/tabbrowse/tabsearch` Top/Bottom/Left/Right): Mobile PWA uses fixed `BottomNav` + desktop `Sidebar` — no user reposition.
- **Rationale:** Keeps `Primary only for links/actions`, `surface tiers for elevation`, `ghost-border` boundaries and `backdrop-blur` glass tokens consistent; prevents user CSS fragmentation.
- **Language — English-only:** App is English-only by design. 30+ `po/` locales intentionally not ported; `UiSection.tsx` shows fixed English note. No i18n planned.
- **Plugins — `youtube_info` not ported:** `pynicotine/plugins/youtube_info` requires YouTube Data v3 API key + `www.googleapis.com` per chat line — intentionally omitted, not homelab-relevant. `leech_detector` is ported; further plugins need the disabled `install*` path re-added first.
- **MAX_SOCKETS — dynamic with homelab floor:** `min(2/3·ulimit, 2048)` (Windows cap 512, floor 64, `env MAX_SOCKETS` wins) like nicotine `slskproto.py` (`session.ts` `maxSockets`); homelab-sufficient, not hand-tuned.
- **Diagnostics:** Stays routed at `/diagnostics` (500-line tail + 2000 stored + download JSONL) rather than docked MainWindow pane — intentional for mobile viewport; see `apps/web/src/app/diagnostics/page.tsx`.