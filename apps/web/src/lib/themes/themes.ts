// Built-in themes — vendored palette values (see docs/proposals/themes.md §2).
// Hex is verbatim from source (case preserved). Never invent values;
// white / last-horizon / solitude ship no orange/brown — tertiary falls back
// to yellow, error to red (both always present).

export interface AppTheme {
  id: string;
  label: string;
  mode: "light" | "dark";
  /** background / dark_background / darker_background / lighter_background */
  bg: string;
  bgDark: string;
  bgDarker: string;
  bgLighter: string;
  /** lowest surface tier (darker bg on dark, bg itself on light) */
  lowest: string;
  /** foreground / secondary text / brightest foreground */
  fg: string;
  fgDim: string;
  fgBright: string;
  /** accent + blue companion (primary-container / inverse accents) */
  accent: string;
  blue: string;
  /** selection + muted (hover surfaces / borders) */
  selection: string;
  muted: string;
  /** yellow semantic (badges, upload bars) */
  tertiary: string;
  /** red semantic (danger states) */
  error: string;
  /** text on solid accent (contrast-picked per theme, not computed) */
  onAccent: string;
  /** text on solid yellow/red (dark text on dark themes, fg on light) */
  onFixed: string;
}

export const THEMES: AppTheme[] = [
  { id: "tokyo-night", label: "Tokyo Night", mode: "dark", bg: "#1a1b26", bgDark: "#13141c", bgDarker: "#0e0e14", bgLighter: "#24283b", lowest: "#0e0e14", fg: "#a9b1d6", fgDim: "#b4bee6", fgBright: "#c0caf5", accent: "#7aa2f7", blue: "#7aa2f7", selection: "#292e42", muted: "#414868", tertiary: "#e0af68", error: "#f7768e", onAccent: "#0e0e14", onFixed: "#0e0e14" },
  { id: "catppuccin", label: "Catppuccin", mode: "dark", bg: "#1e1e2e", bgDark: "#161622", bgDarker: "#101019", bgLighter: "#313244", lowest: "#101019", fg: "#cdd6f4", fgDim: "#bac2de", fgBright: "#cdd6f4", accent: "#89b4fa", blue: "#89b4fa", selection: "#45475a", muted: "#585b70", tertiary: "#f9e2af", error: "#f38ba8", onAccent: "#101019", onFixed: "#101019" },
  { id: "lumon", label: "Lumon", mode: "dark", bg: "#16242d", bgDark: "#101b21", bgDarker: "#0b1216", bgLighter: "#1b2d40", lowest: "#0b1216", fg: "#d6e2ee", fgDim: "#d6e2ee", fgBright: "#f2fcff", accent: "#8bc9eb", blue: "#6fb8e3", selection: "#243d56", muted: "#304860", tertiary: "#6fa4c9", error: "#4d86b0", onAccent: "#0b1216", onFixed: "#0b1216" },
  { id: "ethereal", label: "Ethereal", mode: "dark", bg: "#060B1E", bgDark: "#040816", bgDarker: "#030610", bgLighter: "#131a3a", lowest: "#030610", fg: "#ffcead", fgDim: "#c9b8a6", fgBright: "#ffcead", accent: "#7d82d9", blue: "#7d82d9", selection: "#252e56", muted: "#6d7db6", tertiary: "#E9BB4F", error: "#ED5B5A", onAccent: "#030610", onFixed: "#030610" },
  { id: "everforest", label: "Everforest", mode: "dark", bg: "#2d353b", bgDark: "#21272c", bgDarker: "#181d20", bgLighter: "#343f44", lowest: "#181d20", fg: "#d3c6aa", fgDim: "#9da9a0", fgBright: "#d3c6aa", accent: "#7fbbb3", blue: "#7fbbb3", selection: "#3d484d", muted: "#475258", tertiary: "#dbbc7f", error: "#e67e80", onAccent: "#181d20", onFixed: "#181d20" },
  { id: "gruvbox", label: "Gruvbox", mode: "dark", bg: "#282828", bgDark: "#1e1e1e", bgDarker: "#161616", bgLighter: "#3c3836", lowest: "#161616", fg: "#d4be98", fgDim: "#bdae93", fgBright: "#d4be98", accent: "#7daea3", blue: "#7daea3", selection: "#504945", muted: "#665c54", tertiary: "#d8a657", error: "#ea6962", onAccent: "#161616", onFixed: "#161616" },
  { id: "miasma", label: "Miasma", mode: "dark", bg: "#222222", bgDark: "#191919", bgDarker: "#121212", bgLighter: "#2c2c2c", lowest: "#121212", fg: "#c2c2b0", fgDim: "#8a8a7e", fgBright: "#c2c2b0", accent: "#78824b", blue: "#78824b", selection: "#383838", muted: "#666666", tertiary: "#b36d43", error: "#685742", onAccent: "#121212", onFixed: "#121212" },
  { id: "hackerman", label: "Hackerman", mode: "dark", bg: "#0B0C16", bgDark: "#080910", bgDarker: "#06060c", bgLighter: "#151828", lowest: "#06060c", fg: "#ddf7ff", fgDim: "#b5c5db", fgBright: "#ddf7ff", accent: "#82FB9C", blue: "#829dd4", selection: "#1f253a", muted: "#2d3450", tertiary: "#50f7d4", error: "#50f872", onAccent: "#06060c", onFixed: "#06060c" },
  { id: "osaka-jade", label: "Osaka Jade", mode: "dark", bg: "#111c18", bgDark: "#0c1512", bgDarker: "#090f0d", bgLighter: "#23372B", lowest: "#090f0d", fg: "#C1C497", fgDim: "#D6D5BC", fgBright: "#F7E8B2", accent: "#509475", blue: "#509475", selection: "#32473B", muted: "#53685B", tertiary: "#459451", error: "#FF5345", onAccent: "#090f0d", onFixed: "#090f0d" },
  // Kanagawa accent == foreground by design; primary-container uses blue #7e9cd8 instead.
  { id: "kanagawa", label: "Kanagawa", mode: "dark", bg: "#1f1f28", bgDark: "#17171e", bgDarker: "#111116", bgLighter: "#223249", lowest: "#111116", fg: "#dcd7ba", fgDim: "#c8c093", fgBright: "#dcd7ba", accent: "#dcd7ba", blue: "#7e9cd8", selection: "#363646", muted: "#54546D", tertiary: "#c0a36e", error: "#c34043", onAccent: "#111116", onFixed: "#111116" },
  { id: "nord", label: "Nord", mode: "dark", bg: "#2e3440", bgDark: "#222730", bgDarker: "#191c23", bgLighter: "#3b4252", lowest: "#191c23", fg: "#d8dee9", fgDim: "#adb5c4", fgBright: "#d8dee9", accent: "#81a1c1", blue: "#81a1c1", selection: "#434c5e", muted: "#4c566a", tertiary: "#ebcb8b", error: "#bf616a", onAccent: "#191c23", onFixed: "#191c23" },
  { id: "matte-black", label: "Matte Black", mode: "dark", bg: "#121212", bgDark: "#0d0d0d", bgDarker: "#090909", bgLighter: "#1e1e1e", lowest: "#090909", fg: "#bebebe", fgDim: "#8a8a8d", fgBright: "#bebebe", accent: "#e68e0d", blue: "#e68e0d", selection: "#2a2a2a", muted: "#333333", tertiary: "#b91c1c", error: "#D35F5F", onAccent: "#090909", onFixed: "#090909" },
  { id: "vantablack", label: "Vantablack", mode: "dark", bg: "#000000", bgDark: "#090909", bgDarker: "#070707", bgLighter: "#1a1a1a", lowest: "#070707", fg: "#ffffff", fgDim: "#ececec", fgBright: "#ffffff", accent: "#8d8d8d", blue: "#8d8d8d", selection: "#1a1a1a", muted: "#7a7a7a", tertiary: "#cecece", error: "#a4a4a4", onAccent: "#070707", onFixed: "#070707" },
  { id: "ristretto", label: "Ristretto", mode: "dark", bg: "#2c2525", bgDark: "#211b1b", bgDarker: "#181414", bgLighter: "#3d2f2a", lowest: "#181414", fg: "#e6d9db", fgDim: "#c3b7b8", fgBright: "#e6d9db", accent: "#f38d70", blue: "#f38d70", selection: "#403e41", muted: "#72696a", tertiary: "#f9cc6c", error: "#fd6883", onAccent: "#181414", onFixed: "#181414" },
  { id: "retro-82", label: "Retro 82", mode: "dark", bg: "#05182e", bgDark: "#031222", bgDarker: "#020c17", bgLighter: "#0a2540", lowest: "#020c17", fg: "#f6dcac", fgDim: "#a7c9c6", fgBright: "#f6dcac", accent: "#faa968", blue: "#3f8f8a", selection: "#134e5a", muted: "#2a6b78", tertiary: "#e97b3c", error: "#f85525", onAccent: "#020c17", onFixed: "#020c17" },
  { id: "flexoki-light", label: "Flexoki Light", mode: "light", bg: "#FFFCF0", bgDark: "#f2efe4", bgDarker: "#e5e2d8", bgLighter: "#E6E4D9", lowest: "#FFFCF0", fg: "#100F0F", fgDim: "#878580", fgBright: "#100F0F", accent: "#205EA6", blue: "#205EA6", selection: "#CECDC3", muted: "#B7B5AC", tertiary: "#D0A215", error: "#D14D41", onAccent: "#ffffff", onFixed: "#100F0F" },
  // Rose Pine ships mode="light" (Dawn variant).
  { id: "rose-pine", label: "Rose Pine", mode: "light", bg: "#faf4ed", bgDark: "#ede7e1", bgDarker: "#e1dbd5", bgLighter: "#f2e9e1", lowest: "#faf4ed", fg: "#575279", fgDim: "#9893a5", fgBright: "#575279", accent: "#56949f", blue: "#56949f", selection: "#dfdad9", muted: "#cecacd", tertiary: "#ea9d34", error: "#b4637a", onAccent: "#ffffff", onFixed: "#575279" },
  { id: "catppuccin-latte", label: "Catppuccin Latte", mode: "light", bg: "#eff1f5", bgDark: "#e3e4e8", bgDarker: "#d7d8dc", bgLighter: "#dce0e8", lowest: "#eff1f5", fg: "#4c4f69", fgDim: "#9ca0b0", fgBright: "#4c4f69", accent: "#1e66f5", blue: "#1e66f5", selection: "#ccd0da", muted: "#acb0be", tertiary: "#df8e1d", error: "#d20f39", onAccent: "#ffffff", onFixed: "#4c4f69" },
  // White ships no orange/brown — tertiary uses yellow #4a4a4a.
  { id: "white", label: "White", mode: "light", bg: "#ffffff", bgDark: "#f5f5f5", bgDarker: "#e8e8e8", bgLighter: "#c0c0c0", lowest: "#ffffff", fg: "#000000", fgDim: "#c0c0c0", fgBright: "#000000", accent: "#6e6e6e", blue: "#1a1a1a", selection: "#c0c0c0", muted: "#808080", tertiary: "#4a4a4a", error: "#2a2a2a", onAccent: "#ffffff", onFixed: "#000000" },
  // Last Horizon ships no orange/brown; lighter_background == bg; selection == muted.
  { id: "last-horizon", label: "Last Horizon", mode: "dark", bg: "#0c0b0c", bgDark: "#090809", bgDarker: "#060606", bgLighter: "#0c0b0c", lowest: "#060606", fg: "#FAFCFB", fgDim: "#cfd3cd", fgBright: "#e2dddc", accent: "#b59790", blue: "#b59790", selection: "#584e51", muted: "#584e51", tertiary: "#6B5E73", error: "#c38b7b", onAccent: "#060606", onFixed: "#060606" },
  // Lupine yellow == orange #026fde (filed that way upstream).
  { id: "lupine", label: "Lupine", mode: "light", bg: "#fafafa", bgDark: "#ececec", bgDarker: "#dedede", bgLighter: "#f5f5f5", lowest: "#fafafa", fg: "#212121", fgDim: "#757575", fgBright: "#000000", accent: "#3264eb", blue: "#3264eb", selection: "#d0d0d0", muted: "#9e9e9e", tertiary: "#026fde", error: "#c900c4", onAccent: "#ffffff", onFixed: "#212121" },
  // Solitude ships no orange/brown; lighter_background == bg.
  { id: "solitude", label: "Solitude", mode: "dark", bg: "#101315", bgDark: "#0c0e10", bgDarker: "#080a0b", bgLighter: "#101315", lowest: "#080a0b", fg: "#cacccc", fgDim: "#cbc2be", fgBright: "#a5aeb4", accent: "#798186", blue: "#798186", selection: "#343d41", muted: "#4b4e55", tertiary: "#d9dbdc", error: "#565d60", onAccent: "#080a0b", onFixed: "#080a0b" },
];

export const LIGHT_THEMES = THEMES.filter((t) => t.mode === "light");
export const DARK_THEMES = THEMES.filter((t) => t.mode === "dark");

export const DEFAULT_LIGHT_THEME = "catppuccin-latte";
export const DEFAULT_DARK_THEME = "tokyo-night";

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function getTheme(id: string | null | undefined): AppTheme | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function isThemeId(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}
