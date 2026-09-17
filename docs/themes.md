# Themes

Nicotine Hub ships **22 built-in themes**: 17 dark, 5 light. Pick one light and one
dark theme; the top-bar toggle flips between the two.

- Change: **Settings → Appearance → Light theme / Dark theme** (or during onboarding).
- Defaults: `Catppuccin Latte` (light) + `Tokyo Night` (dark).
- Picks sync to the bridge (`ui.light_theme` / `ui.dark_theme` in `settings.json`)
  and persist locally for instant paint (no flash on reload).

Screenshots in this repo show a mix of themes — the caption under each one names it.

## Dark themes

| Theme | Look | Background / Text / Accent |
|---|---|---|
| [Tokyo Night](#tokyo-night) | Default dark. Muted indigo editor classic. | `#1a1b26` / `#a9b1d6` / `#7aa2f7` |
| [Catppuccin](#catppuccin) | Soft pastel dark, low harshness. | `#1e1e2e` / `#cdd6f4` / `#89b4fa` |
| [Lumon](#lumon) | Cold corporate teal-blue. | `#16242d` / `#d6e2ee` / `#8bc9eb` |
| [Ethereal](#ethereal) | Near-black indigo, warm peach text. | `#060B1E` / `#ffcead` / `#7d82d9` |
| [Everforest](#everforest) | Warm green-tinted forest. | `#2d353b` / `#d3c6aa` / `#7fbbb3` |
| [Gruvbox](#gruvbox) | Retro warm contrast, brownish gray. | `#282828` / `#d4be98` / `#7daea3` |
| [Miasma](#miasma) | Desaturated olive-gray, dimmest accents. | `#222222` / `#c2c2b0` / `#78824b` |
| [Hackerman](#hackerman) | Terminal green-on-black matrix. | `#0B0C16` / `#ddf7ff` / `#82FB9C` |
| [Osaka Jade](#osaka-jade) | Deep green with gold highlights. | `#111c18` / `#C1C497` / `#509475` |
| [Kanagawa](#kanagawa) | Muted ink-wave grays; accent matches text by design. | `#1f1f28` / `#dcd7ba` / `#dcd7ba` |
| [Nord](#nord) | Frosty desaturated blue-gray. | `#2e3440` / `#d8dee9` / `#81a1c1` |
| [Matte Black](#matte-black) | Flat dark gray, amber accent. | `#121212` / `#bebebe` / `#e68e0d` |
| [Vantablack](#vantablack) | Pure black, monochrome gray. | `#000000` / `#ffffff` / `#8d8d8d` |
| [Ristretto](#ristretto) | Coffee browns, salmon accent. | `#2c2525` / `#e6d9db` / `#f38d70` |
| [Retro 82](#retro-82) | Synthwave navy, sunset orange. | `#05182e` / `#f6dcac` / `#faa968` |
| [Last Horizon](#last-horizon) | Near-black plum-gray, dusty rose accent. | `#0c0b0c` / `#FAFCFB` / `#b59790` |
| [Solitude](#solitude) | Stark blue-gray minimalism. | `#101315` / `#cacccc` / `#798186` |

## Light themes

| Theme | Look | Background / Text / Accent |
|---|---|---|
| [Flexoki Light](#flexoki-light) | Warm paper, understated blue. | `#FFFCF0` / `#100F0F` / `#205EA6` |
| [Rose Pine](#rose-pine) | Rosy dawn, muted mauve text (Dawn variant). | `#faf4ed` / `#575279` / `#56949f` |
| [Catppuccin Latte](#catppuccin-latte) | Default light. Clean pastel. | `#eff1f5` / `#4c4f69` / `#1e66f5` |
| [White](#white) | Maximum-contrast black on white. | `#ffffff` / `#000000` / `#6e6e6e` |
| [Lupine](#lupine) | Neutral light gray, vivid blue accent. | `#fafafa` / `#212121` / `#3264eb` |

## Notes per theme

### Tokyo Night
Default dark. Balanced indigo (`#7aa2f7` accent) readable everywhere.
Seen in: `docs/screenshots/02-search.png`.

### Catppuccin
Pastel dark (`#89b4fa`); gentle on the eyes for long browsing sessions.
Seen in: `docs/screenshots/03-search-filters.png`.

### Lumon
Teal-tinted corporate dark (`#8bc9eb`); danger states stay blue-gray rather than red.
Seen in: `docs/screenshots/08-browse.png`.

### Ethereal
Darkest indigo (`#060B1E`) with peach text (`#ffcead`) — highest text/background
warmth of any dark theme. Not currently pictured.

### Everforest
Green-forward dark (`#7fbbb3`); comfortable warm background (`#2d353b`).
Seen in: `docs/screenshots/06-spectrum.png`.

### Gruvbox
Classic retro palette; aqua accent (`#7daea3`) on warm gray.
Seen in: `docs/screenshots/05-downloads.png`.

### Miasma
Deliberately muted — olive accent (`#78824b`), dimmest error states.
Low-contrast by design; avoid for small text. Not currently pictured.

### Hackerman
Neon green accent (`#82FB9C`) on near-black; buttons use dark text for contrast.
Seen in: `docs/screenshots/m2-more-sheet.png`.

### Osaka Jade
Jade green (`#509475`) with gold bright text (`#F7E8B2`); red stays vivid (`#FF5345`).
Seen in: `docs/screenshots/m1-search.png`.

### Kanagawa
Accent equals foreground (`#dcd7ba`) by design — active states look tonal;
selected surfaces use companion blue `#7e9cd8` instead.
Seen in: `docs/screenshots/09-chat.png`.

### Nord
Frost palette (`#81a1c1`); calm and uniform across surfaces.
Seen in: `docs/screenshots/04-search-link.png`.

### Matte Black
Flat `#121212` with amber accent (`#e68e0d`); closest to OLED-dark without pure black.
Seen in: `docs/screenshots/m3-downloads.png`.

### Vantablack
Pure-black background, fully monochrome gray accents — maximum battery saving on
OLED, minimum hue. Not currently pictured.

### Ristretto
Warm coffee theme; salmon accent (`#f38d70`), pink error (`#fd6883`).
Seen in: `docs/screenshots/10-private-chat.png`.

### Retro 82
Synthwave navy (`#05182e`) with orange accent (`#faa968`) and teal selection.
Seen in: `docs/screenshots/07-spectrum-zoom.png`.

### Last Horizon
Near-black with dusty-rose accent (`#b59790`); ships no orange/brown, so warning
hues fall back to accent/muted. Not currently pictured.

### Solitude
Minimal blue-gray (`#798186`); ships no orange/brown (same fallback as above).
Not currently pictured.

### Flexoki Light
Warm paper background (`#FFFCF0`); softest light theme.
Seen in: `docs/screenshots/01-login.png`.

### Rose Pine
Dawn variant (`mode="light"`); mauve text (`#575279`), teal accent (`#56949f`).
Seen in: `docs/screenshots/m4-chat.png`.

### Catppuccin Latte
Default light. Crisp pastel with strong blue accent (`#1e66f5`).
Not currently pictured.

### White
Pure `#ffffff`, monochrome; ships no orange/brown (warning hues fall back).
Highest contrast light theme. Not currently pictured.

### Lupine
Clean `#fafafa` gray with vivid blue accent (`#3264eb`) and magenta errors.
Not currently pictured.

## Source

Palette values are vendored verbatim from upstream `colors.toml` files — see
`apps/web/src/lib/themes/themes.ts` and `docs/proposals/themes.md §2`.
Never invent hex values; missing orange/brown slots (white, last-horizon,
solitude) fall back to accent/muted.
