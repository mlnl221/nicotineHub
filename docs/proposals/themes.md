# Themes — plan (theme pair)

## Decisions (locked)

- Scope: all 22 built-in themes (vendored palette values, see §2).
- UX: Settings → Appearance gets two dropdowns, `Light theme` (5 options) + `Dark theme` (17 options). Top toggle flips between the two picks, not just light/dark mode. Defaults: `catppuccin-latte` + `tokyo-night`.
- Persistence: instant `localStorage` for paint (existing `nicotineHub.theme` pattern), `ui.light_theme` / `ui.dark_theme` also saved to bridge `settings.json` via the generic `ui` section path (deferred Save like `ui.dark_mode` today).

## 1. Palette source

- Vendored per-theme palette values (see §2 tables). The reference set lists 22 themes; the manual page shows 19 previews. Extra 3: `last-horizon`, `lupine`, `solitude`.
- `colors.toml` schema (union of 30 keys observed across all 22 files):

```toml
mode = "dark" | "light"
background / dark_background / darker_background / lighter_background
foreground / dark_foreground / light_foreground / bright_foreground
accent / selection / muted
red / orange / yellow / green / cyan / blue / magenta / brown
bright_red / bright_yellow / bright_green / bright_cyan / bright_blue / bright_magenta
# optional, only some themes:
hyprland_active_border / hyprland_inactive_border
active_border_color / active_tab_background
```

- No `bright_orange` / `bright_brown` in any file. Missing keys: `white` (no orange, brown); `last-horizon` (no orange, brown); `solitude` (no orange, brown). Fall back to accent/muted for those slots.
- Override extras: `lumon` (+`active_border_color #f2fcff`, +`active_tab_background #6fb8e3`); `hackerman` (+`hyprland_active_border rgba(26a269ee) rgba(2ec27eee) 45deg`); `last-horizon` (+4 border keys); `solitude` (+4 border keys). Hyprland/border keys are desktop-only; ignore for web mapping except as accent candidates if needed.

## 2. Exact palettes (verbatim hex from colors.toml)

Mode split: 17 dark, 5 light (`flexoki-light`, `rose-pine`, `catppuccin-latte`, `white`, `lupine`). Note `rose-pine` ships `mode="light"` (Dawn variant).

### 2a. Core mapping keys per theme

| theme | mode | background | foreground | accent | selection | muted |
|---|---|---|---|---|---|---|
| tokyo-night | dark | #1a1b26 | #a9b1d6 | #7aa2f7 | #292e42 | #414868 |
| catppuccin | dark | #1e1e2e | #cdd6f4 | #89b4fa | #45475a | #585b70 |
| lumon | dark | #16242d | #d6e2ee | #8bc9eb | #243d56 | #304860 |
| ethereal | dark | #060B1E | #ffcead | #7d82d9 | #252e56 | #6d7db6 |
| everforest | dark | #2d353b | #d3c6aa | #7fbbb3 | #3d484d | #475258 |
| gruvbox | dark | #282828 | #d4be98 | #7daea3 | #504945 | #665c54 |
| miasma | dark | #222222 | #c2c2b0 | #78824b | #383838 | #666666 |
| hackerman | dark | #0B0C16 | #ddf7ff | #82FB9C | #1f253a | #2d3450 |
| osaka-jade | dark | #111c18 | #C1C497 | #509475 | #32473B | #53685B |
| kanagawa | dark | #1f1f28 | #dcd7ba | #dcd7ba | #363646 | #54546D |
| nord | dark | #2e3440 | #d8dee9 | #81a1c1 | #434c5e | #4c566a |
| matte-black | dark | #121212 | #bebebe | #e68e0d | #2a2a2a | #333333 |
| vantablack | dark | #000000 | #ffffff | #8d8d8d | #1a1a1a | #7a7a7a |
| ristretto | dark | #2c2525 | #e6d9db | #f38d70 | #403e41 | #72696a |
| retro-82 | dark | #05182e | #f6dcac | #faa968 | #134e5a | #2a6b78 |
| flexoki-light | light | #FFFCF0 | #100F0F | #205EA6 | #CECDC3 | #B7B5AC |
| rose-pine | light | #faf4ed | #575279 | #56949f | #dfdad9 | #cecacd |
| catppuccin-latte | light | #eff1f5 | #4c4f69 | #1e66f5 | #ccd0da | #acb0be |
| white | light | #ffffff | #000000 | #6e6e6e | #c0c0c0 | #808080 |
| last-horizon | dark | #0c0b0c | #FAFCFB | #b59790 | #584e51 | #584e51 |
| lupine | light | #fafafa | #212121 | #3264eb | #d0d0d0 | #9e9e9e |
| solitude | dark | #101315 | #cacccc | #798186 | #343d41 | #4b4e55 |

### 2b. Background/foreground ramp per theme

| theme | dark_bg | darker_bg | lighter_bg | dark_fg | light_fg | bright_fg |
|---|---|---|---|---|---|---|
| tokyo-night | #13141c | #0e0e14 | #24283b | #565f89 | #b4bee6 | #c0caf5 |
| catppuccin | #161622 | #101019 | #313244 | #6c7086 | #bac2de | #cdd6f4 |
| lumon | #101b21 | #0b1216 | #1b2d40 | #4d86b0 | #d6e2ee | #f2fcff |
| ethereal | #040816 | #030610 | #131a3a | #6d7db6 | #c9b8a6 | #ffcead |
| everforest | #21272c | #181d20 | #343f44 | #4f585e | #9da9a0 | #d3c6aa |
| gruvbox | #1e1e1e | #161616 | #3c3836 | #7c6f64 | #bdae93 | #d4be98 |
| miasma | #191919 | #121212 | #2c2c2c | #555555 | #8a8a7e | #c2c2b0 |
| hackerman | #080910 | #06060c | #151828 | #6a6e95 | #b5c5db | #ddf7ff |
| osaka-jade | #0c1512 | #090f0d | #23372B | #81B8A8 | #D6D5BC | #F7E8B2 |
| kanagawa | #17171e | #111116 | #223249 | #727169 | #c8c093 | #dcd7ba |
| nord | #222730 | #191c23 | #3b4252 | #667080 | #adb5c4 | #d8dee9 |
| matte-black | #0d0d0d | #090909 | #1e1e1e | #555555 | #8a8a8d | #bebebe |
| vantablack | #090909 | #070707 | #1a1a1a | #505050 | #ececec | #ffffff |
| ristretto | #211b1b | #181414 | #3d2f2a | #72696a | #c3b7b8 | #e6d9db |
| retro-82 | #031222 | #020c17 | #0a2540 | #3f8f8a | #a7c9c6 | #f6dcac |
| flexoki-light | #f2efe4 | #e5e2d8 | #E6E4D9 | #878580 | #403E3C | #100F0F |
| rose-pine | #ede7e1 | #e1dbd5 | #f2e9e1 | #9893a5 | #6e6a86 | #575279 |
| catppuccin-latte | #e3e4e8 | #d7d8dc | #dce0e8 | #9ca0b0 | #5c5f77 | #4c4f69 |
| white | #f5f5f5 | #e8e8e8 | #c0c0c0 | #c0c0c0 | #000000 | #000000 |
| last-horizon | #090809 | #060606 | #0c0b0c (=bg) | #584e51 | #cfd3cd | #e2dddc |
| lupine | #ececec | #dedede | #f5f5f5 | #757575 | #424242 | #000000 |
| solitude | #0c0e10 | #080a0b | #101315 (=bg) | #4b4e55 | #cbc2be | #a5aeb4 |

### 2c. Semantic hues + brights per theme

Format: `red / orange / yellow / green / cyan / blue / magenta / brown | bright_red / bright_yellow / bright_green / bright_cyan / bright_blue / bright_magenta`.

- tokyo-night: #f7768e / #eb927b / #e0af68 / #9ece6a / #449dab / #7aa2f7 / #ad8ee6 / #75493d | #ff7a93 / #ff9e64 / #b9f27c / #0db9d7 / #7da6ff / #bb9af7
- catppuccin: #f38ba8 / #f6b6ab / #f9e2af / #a6e3a1 / #94e2d5 / #89b4fa / #f5c2e7 / #7b5b55 | #f38ba8 / #f9e2af / #a6e3a1 / #94e2d5 / #89b4fa / #f5c2e7
- lumon: #4d86b0 / #8bc9eb / #6fa4c9 / #5e95bc / #b4e4f6 / #6fb8e3 / #8bc9eb / #456475 | #73a6cb / #9dcae5 / #86b7d8 / #d1eef8 / #f2fcff / #b1d8ee
- ethereal: #ED5B5A / #eb8b54 / #E9BB4F / #92a593 / #a3bfd1 / #7d82d9 / #c89dc1 / #75452a | #faaaa9 / #f7dc9c / #c4cfc4 / #dfeaf0 / #c2c4f0 / #ead7e7
- everforest: #e67e80 / #e09d7f / #dbbc7f / #a7c080 / #83c092 / #7fbbb3 / #d699b6 / #704e3f | #e67e80 / #dbbc7f / #a7c080 / #83c092 / #7fbbb3 / #d699b6
- gruvbox: #ea6962 / #e1875c / #d8a657 / #a9b665 / #89b482 / #7daea3 / #d3869b / #70432e | #ea6962 / #d8a657 / #a9b665 / #89b482 / #7daea3 / #d3869b
- miasma: #685742 / #8d6242 / #b36d43 / #5f875f / #c9a554 / #78824b / #bb7744 / #463121 | #685742 / #b36d43 / #5f875f / #c9a554 / #78824b / #bb7744
- hackerman: #50f872 / #50f7a3 / #50f7d4 / #4fe88f / #7cf8f7 / #829dd4 / #86a7df / #287b51 | #85ff9d / #a4ffec / #9cf7c2 / #d1fffe / #c4d2ed / #cddbf4
- osaka-jade: #FF5345 / #a2734b / #459451 / #549e6a / #2DD5B7 / #509475 / #D2689C / #513925 | #db9f9c / #E5C736 / #63b07a / #8CD3CB / #ACD4CF / #75bbb3
- kanagawa: #c34043 / #c17158 / #c0a36e / #76946a / #6a9589 / #7e9cd8 / #957fb8 / #60382c | #e82424 / #e6c384 / #98bb6c / #7aa89f / #7fb4ca / #938aa9
- nord: #bf616a / #d5967a / #ebcb8b / #a3be8c / #88c0d0 / #81a1c1 / #b48ead / #6a4b3d | #bf616a / #ebcb8b / #a3be8c / #8fbcbb (note: only theme where bright_cyan differs from cyan) / #81a1c1 / #b48ead
- matte-black: #D35F5F / #c63d3d / #b91c1c / #FFC107 / #bebebe / #e68e0d / #D35F5F / #631e1e | #B91C1C / #b90a0a / #FFC107 / #eaeaea / #f59e0b / #B91C1C
- vantablack: #a4a4a4 / #b9b9b9 / #cecece / #b6b6b6 / #b0b0b0 / #8d8d8d / #9b9b9b / #5c5c5c | #a4a4a4 / #cecece / #b6b6b6 / #b0b0b0 / #8d8d8d / #9b9b9b
- ristretto: #fd6883 / #fb9a77 / #f9cc6c / #adda78 / #85dacc / #f38d70 / #a8a9eb / #7d4d3b | #ff8297 / #fcd675 / #c8e292 / #9bf1e1 / #f8a788 / #bebffd
- retro-82: #f85525 / #faa968 / #e97b3c / #028391 / #8cbfb8 / #3f8f8a / #3f8f8a / #743d1e | #f85525 / #e97b3c / #028391 / #8cbfb8 / #faa968 / #3f8f8a
- flexoki-light: #D14D41 / #d0772b / #D0A215 / #879A39 / #3AA99F / #205EA6 / #CE5D97 / #683b15 | #D14D41 / #D0A215 / #879A39 / #3AA99F / #4385BE / #CE5D97
- rose-pine: #b4637a / #cf8057 / #ea9d34 / #286983 / #d7827e / #56949f / #907aa9 / #67402b | #b4637a / #ea9d34 / #286983 / #d7827e / #56949f / #907aa9
- catppuccin-latte: #d20f39 / #d84e2b / #df8e1d / #40a02b / #179299 / #1e66f5 / #ea76cb / #6c2715 | #d20f39 / #df8e1d / #40a02b / #179299 / #1e66f5 / #ea76cb
- white: #2a2a2a / (orange MISSING) / #4a4a4a / #3a3a3a / #3e3e3e / #1a1a1a / #2e2e2e / (brown MISSING) | #2a2a2a / #4a4a4a / #3a3a3a / #3e3e3e / #1a1a1a / #2e2e2e
- last-horizon: #c38b7b / (orange MISSING) / #6B5E73 / #87a9b0 / #a5a0b6 / #b59790 / #c4d8e2 / (brown MISSING) | #c38b7b / #6B5E73 / #87a9b0 / #a5a0b6 / #b59790 / #c4d8e2
- lupine: #c900c4 / #026fde / #026fde (=orange) / #4a2fd0 / #0c67de / #3264eb / #8a4ad7 / #013a6f | #f930fb / #358fff / #9f85e0 / #3986ff / #5482ff / #b363ff
- solitude: #565d60 / (orange MISSING) / #d9dbdc / #9fa5a9 / #707070 / #798186 / #aeaeae / (brown MISSING) | #de6145 / #c9c2b4 / #343d41 / #707070 / #5d6367 / #9a9a9a

## 3. Current web token system

- `apps/web/src/app/globals.css:1-5`: Tailwind v4 CSS-first (`@import "tailwindcss"`, `@custom-variant dark (&:where(.dark,.dark *))`). No `tailwind.config.*`.
- `globals.css:6-65` `@theme` light palette (~50 `--color-*` vars). Current light base: `background/surface #faf9fa`, `primary #094cb2`, `primary-container #3366cc`, `surface-tint #2259bf`, `inverse-primary #b1c5ff`, `primary-fixed #d9e2ff`, `tertiary #6d5e00`, `tertiary-container #bfab49`, `error #ba1a1a`, `outline #737784`, `outline-variant #c3c6d5`, full surface ramp `dim/low/lowest/container/high/highest/variant/bright`.
- `globals.css:74-93` `.dark` overrides only 19 vars (surfaces + `on-surface` + `outline` + `surface-tint #b1c5ff`). `primary/secondary/tertiary/error` hues are NOT redefined in dark; dark adaptation is done per-component with `dark:` utilities (e.g. `dark:bg-inverse-surface`, `dark:text-inverse-primary`).
- Utilities resolve to `var(--color-*)`, so overriding vars repaints without rebuild. Opacity modifiers (`bg-primary/10`, `border-primary/20`, `selection:bg-primary/30`) derive via `color-mix` and follow accent automatically.
- Mode driver: `layout.tsx:80` FOUC script reads `localStorage nicotineHub.theme ?? nicotine.theme`, adds `.dark`; `ThemeProvider.tsx:23-28,35-54` toggles class + persists. Zero `data-theme` usage today.
- Helpers with baked rgba that must become var-derived: `.glass-panel/.glass-card/.ghost-border/.progress-glow/.btn-glow` (`globals.css:95-127,205-214`), scrollbars (`globals.css:140-187`), all currently hardcode `rgba(9,76,178,*)`, `rgba(195,198,213,*)`, `rgba(67,70,83,*)`.

## 4. Theme → app token mapping

New catalog file `apps/web/src/lib/themes/themes.ts` holds the 22 rows from §2 (id, label, mode, bg ramp, fg ramp, accent, selection, muted, semantic hues).

Per-theme CSS: add `html[data-theme="<id>"] { ... }` blocks in `globals.css` right after the `.dark` block (before `.glass-panel`). Map:

| app var | Theme source | notes |
|---|---|---|
| `--color-background`, `--color-surface` | `background` | |
| `--color-surface-dim` | `darker_background` | |
| `--color-surface-container-lowest` | `darker_background` (dark) / `background` (light) | |
| `--color-surface-container-low` | `dark_background` | |
| `--color-surface-container` | `background` darkened/lightened one step (use `dark_background` for dark, `background` for light) | pick closest ramp entry, do not invent new hex |
| `--color-surface-container-high` | `lighter_background` | |
| `--color-surface-container-highest`, `--color-surface-variant` | `selection` | selected/hover surfaces |
| `--color-surface-bright` | `lighter_background` | |
| `--color-on-surface`, `--color-on-background` | `foreground` | |
| `--color-on-surface-variant` | `light_foreground` (dark themes) / `dark_foreground` (light themes) | secondary text |
| `--color-outline`, `--color-outline-variant` | `muted` (+ `selection` for variant on dark) | borders |
| `--color-primary`, `--color-surface-tint` | `accent` | main accent; `surface-tint` must track accent |
| `--color-primary-container` | `accent` at 70% mix with `selection`, or `blue` semantic if accent is low-contrast on bg | document choice per theme |
| `--color-on-primary` | `bright_foreground` when accent is dark, `darker_background` when accent is light (e.g. hackerman `#82FB9C` needs dark text) | contrast-check each of the 22 |
| `--color-inverse-primary`, `--color-primary-fixed-dim` | `bright_blue` / `blue` | dark-mode accent companions |
| `--color-primary-fixed`, `--color-on-primary-container` | `selection` + `bright_foreground` | active nav pills |
| `--color-tertiary`, `--color-tertiary-container` | keep existing gold OR map to `yellow/orange` per theme | decision needed per theme; saturated accents (hackerman, retro-82) clash with gold — map tertiary to theme `yellow` to avoid clash |
| `--color-error`, `--color-error-container` | `red` / `red` mixed with bg | replaces fixed `#ba1a1a` so danger states match theme |
| `--color-secondary`, `--color-secondary-container` | `muted` + `light_foreground` | |
| missing `orange/brown` (white, last-horizon, solitude) | fall back to `accent` / `muted` | never invent hex |

Keep the full primary family per theme (`primary`, `primary-container`, `primary-fixed`, `inverse-primary`, `primary-fixed-dim`, `surface-tint`, `on-*` companions). Mapping only `--color-primary` is insufficient: `BottomNav.tsx:100,128-131`, `Sidebar.tsx:153`, `chat/page.tsx:127,222,634` use the fixed/inverse companions in `dark:` branches and would go stale.

`@custom-variant dark` must also match `[data-theme="dark-group"]` or the provider must keep setting `.dark` alongside `data-theme` (recommended: keep both — `data-theme` for palette, `.dark` for existing `dark:` utilities — smallest diff, zero per-component edits).

## 5. Button / component coverage (what repaints, what needs fixes)

Accent-swap alone repaints (all token-driven): primary buttons (`LoginForm.tsx:217`, `ConfirmDialog.tsx:57`, `SectionSaveButton controls.tsx:414-420`), nav active states (`BottomNav.tsx:100,128-131`, `Sidebar.tsx:153`), pills/radios (`controls.tsx:295-298`, `SearchScreen.tsx:270,298`), toggles (`controls.tsx:62-64`), spinners (`border-primary`), badges (`bg-tertiary text-on-tertiary`), chat self-bubbles (`private-chat.tsx:293`, `chat/page.tsx:492`), transfer bars (`TransferCard.tsx:91`), inputs focus (`focus:border-primary focus:ring-primary`), opacity modifiers (`bg-primary-fixed/20`, `border-primary/20`, `selection:bg-primary/30`).

Must fix (baked, will NOT follow themes):

1. `FilterBar.tsx:75,85` `accent-[#094cb2]` → `accent-primary`.
2. `ThroughputChart.tsx:93-109` SVG `stroke="#094cb2"`, `stroke="#6d5e00"`, `fill="rgba(9,76,178,0.08)"`, chart bg `rgba(9,76,178,0.04)` + `dark:stroke-[#dcc661/#b1c5ff]` → `currentColor` or `color-mix(var(--color-primary) ...)`.
3. `globals.css:126,206` `.progress-glow`/`.btn-glow` `rgba(9,76,178,*)` → `color-mix(in srgb, var(--color-primary) 50%, transparent)`. Same for scrollbar hover `rgba(9,76,178,0.55/0.6)` and ghost borders/scrollbar thumbs that hardcode light grays.
4. `Sidebar.tsx:91,100`, `TopBar.tsx:43`, `AboutDialog.tsx:55` logo chips `bg-white ring-black/5` → `bg-surface-container-lowest`; they render as white blocks on dark saturated themes.
5. Inline radial gradients with baked blue (`app/page.tsx:50-55`, `diagnostics/page.tsx:369`, `settings/page.tsx:120-122`, `OnboardingWizard.tsx:49-50`: `rgba(51,102,204,0.15)`, `rgba(9,76,178,0.08)`) → derive from `var(--color-primary)` or drop to neutral.
6. `notifications.ts:32` flash `#497EC2` → `var(--color-primary)`.
7. Amber/green status pills (`bg-amber-50 text-amber-700`, `bg-green-500`, etc. in files/shares/uploads/downloads/NetworkSection/PortChecker) are acceptable fixed semantics, but spot-check contrast on darkest themes (vantablack `#000000`, miasma `#222222`, ethereal `#060B1E`).
8. Overlays `bg-black/40|60` scrims stay neutral — keep.
9. Missing states to add while touching: `focus-visible:ring-primary/60` on BottomNav/Sidebar links, ContextMenu, toggles/radios; `disabled:opacity-50` on dialog confirms. No new variants, just the two utilities.

Contrast risks per theme (check accent-on-bg for `bg-primary text-on-primary`): hackerman accent `#82FB9C` on `#0B0C16` (needs near-black text), kanagawa accent `#dcd7ba` ≈ foreground (active states may look washed — use `blue #7e9cd8` for primary-container there), vantablack accent `#8d8d8d` on `#000000` (mid-gray, verify AA for small text), white/lupine accents need white text swapped to dark. The `on-primary` choice per theme must be recorded in the catalog, not computed at runtime.

## 6. Settings UX + persistence + migration

- Placement: `UiSection.tsx:29-33` inside Appearance `SectionCard`, after the dark toggle, using existing `SelectControl` (`controls.tsx:226-259`, generic `T extends string`, matches via `String(value)`). Mirror the language/buddy-placement pattern (`UiSection.tsx:44-50,103-112`). Options catalog mirrors `LANGUAGES` (`UiSection.tsx:14-21`): `LIGHT_THEMES` (5) + `DARK_THEMES` (17).
- State shape: add `light_theme: string` + `dark_theme: string` to `Settings.ui` (`defaults.ts:47-67` + defaults block `defaults.ts:241-271`). Keep `dark_mode: boolean` for compat. `VOLATILE_KEYS` unchanged — pair stays dirty-gated like `dark_mode`.
- Important ordering: `applyBridgedState` drops unknown keys (`provider.tsx:157`) and only adopts keys still at default (`provider.tsx:159`), so defaults must land before any bridge value can be adopted.
- Flow (generic, no bridge schema change — `ConfigUpdateSchema` is generic, `persistSetting` is generic): `setOption(ui, ...)` merges draft + autosaves `localStorage nicotineHub.settings` (`provider.tsx:104-118`) → dirty via `stripVolatile` compare (`provider.tsx:127-136`) → `SectionSaveButton` builds one `config:update` per key (`save.tsx:23-57`) → push + 10s ack on `config:updated` (`save.tsx:62-109`) → bridge `persistSetting` skips `worker`, atomic `tmp+renameSync` to `CONFIG_DIR/settings.json` (`server.ts:357-372`) → rebroadcast; reconnect reconciles via `config:get/state` + push saved (`sync.tsx:16-62`).
- Dual-state today: instant `ThemeProvider theme light|dark` (`nicotineHub.theme`) vs deferred `ui.dark_mode`. Header toggles (`ThemeToggleButton.tsx:10-16`, `TopBar.tsx:26-33`, `SearchHeader.tsx:10-14`) paint instantly but leave the section dirty until Appearance Save. New model: provider resolves `{ mode, lightId, darkId, activeId }`; `applyTheme()` sets `documentElement.dataset.theme = activeId` + toggles `.dark` per the active pick's mode + writes `nicotineHub.themePair` + updates `<meta name="theme-color">` to the active bg. Top toggles call `flipPair()` (swap active pick, keep both ids). `UiSection` selects call `setOption` + instant preview via provider without committing (same split as today).
- FOUC: extend inline script `layout.tsx:77-82` to read pair (`nicotineHub.settings` ui keys or `nicotineHub.themePair`) and set `data-theme` + `.dark` before paint. Current script only knows binary.
- `viewport.themeColor` (`layout.tsx:56`, static `#faf9fa`) + manifest (`manifest.webmanifest:9-10`, static `#faf9fa`): update meta at runtime per active theme; accept manifest/chrome mismatch on installed PWA (single static file) unless a dynamic manifest route is added later — explicitly out of scope.
- Onboarding: `AppearanceStep` (`steps.tsx:549-612`) mirrors with two selects or a card grid bound to `ui.light_theme/dark_theme` via `setOption`, instant preview via provider, commit with existing `saveSection("ui")` (`steps.tsx:567`). Update the `Alexandria no custom colors` note (`steps.tsx:583-586`) since themes become user-pickable.

## 7. Implementation phases

1. Catalog: new `apps/web/src/lib/themes/themes.ts` with all 22 rows (§2) + `LIGHT_THEMES` / `DARK_THEMES` option lists + per-theme `onPrimary` + fallbacks for missing orange/brown. Verify hex against raw `colors.toml` (no invented values).
2. CSS: `globals.css` `html[data-theme="<id>"]` blocks (§4 mapping) + var-derived glow/scrollbar/ghost-border fixes (§5 items 3). Keep `.dark` class mechanism; extend `@custom-variant` only if dropping `.dark`.
3. Provider + shell: extend `ThemeProvider.tsx:13-54` to pair model, FOUC script `layout.tsx:77-82`, runtime `theme-color` sync, convert `ThemeToggleButton`/`TopBar`/`SearchHeader` handlers to `flipPair()`.
4. Settings + onboarding: `defaults.ts` keys + `UiSection` pair selects + `steps.tsx` mirror + migration of legacy `nicotineHub.theme`/`nicotine.theme` (`storage.ts`, `migration.ts`, `provider.tsx:29-41` pattern).
5. Baked-color fixes: §5 items 1–6 (FilterBar, ThroughputChart, logo chips, gradients, notif flash) + focus/disabled states (item 9).
6. Verify: `bun test && bun run build`; manual matrix (each of 22 active, reload/FOUC, toggle flip, Save/dirty, reconnect adopt); Playwright appearance-tab screenshots; contrast spot-check on hackerman/kanagawa/vantablack/white.

## 8. Risks / out of scope

- PWA installed chrome keeps light `#faf9fa` until dynamic manifest — accepted.
- Tertiary gold vs saturated accents — mapped per theme (§4), not a new variant system.
- No system/auto mode, no community themes page, no font/radius per theme. Add when requested.
