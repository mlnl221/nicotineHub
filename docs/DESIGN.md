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

## Omitted Nicotine+ Controls — Intentional

Per Phase A/B decision (2026-08-30), the following nicotine+ `userinterface.ui` controls are **omitted** to preserve `DESIGN.md` editorial consistency:

- **Color pickers** (`chatme/chatcommand/chathilite/urlcolor/useronline/useraway/useroffline/chatremote/chatlocal/textbg/search/inputcolor/tab_default/tab_hilite/tab_changed` — 15 hex keys): Replaced by fixed `primary #094cb2 / tertiary #6d5e00 / surface tiers` palette. User theming stays `dark_mode` boolean only.
- **Font pickers** (`globalfont/textviewfont/chatfont/searchfont/listfont/browserfont/transfersfont`): Replaced by `Noto Serif / Inter / Public Sans` stack via `apps/web/src/app/layout.tsx` font preconnect. No runtime font selection.
- **Tab position selectors** (`tabmain/tabrooms/tabprivate/tabinfo/tabbrowse/tabsearch` Top/Bottom/Left/Right): Mobile PWA uses fixed `BottomNav` + desktop `Sidebar` — no user reposition.
- **Rationale:** Keeps `Primary only for links/actions`, `surface tiers for elevation`, `ghost-border` boundaries and `backdrop-blur` glass tokens consistent; prevents user CSS fragmentation.
- **Language — English-only:** App is English-only by design. 30+ `po/` locales (`pynicotine/config.py:ui.language`) intentionally not ported; `UiSection.tsx` shows fixed English note. No i18n planned (see `docs/porting-status.md`).
- **Plugins — `youtube_info` not ported:** `pynicotine/plugins/youtube_info` requires YouTube Data v3 API key + `www.googleapis.com` per chat line — intentionally omitted, not homelab-relevant. `leech_detector` is ported; further plugins need the disabled `install*` path re-added first.
- **MAX_SOCKETS — dynamic with homelab floor:** `min(2/3·ulimit, 2048)` (Windows cap 512, floor 64, `env MAX_SOCKETS` wins) like nicotine `slskproto.py` (`session.ts` `maxSockets`); homelab-sufficient, not hand-tuned.
- **Diagnostics:** Stays routed at `/diagnostics` (500-line tail + 2000 stored + download JSONL) rather than docked MainWindow pane — intentional for mobile viewport; see `apps/web/src/app/diagnostics/page.tsx`.