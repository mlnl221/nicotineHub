"use client";
import "@/lib/migration";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  getTheme,
  isThemeId,
} from "@/lib/themes/themes";

type Theme = "light" | "dark";
type Slot = "light" | "dark";

interface ThemePair {
  light: string;
  dark: string;
  mode: Theme;
}

interface ThemeApi {
  /** Active mode (mode of the active theme). Kept for compat. */
  theme: Theme;
  /** Active theme id (e.g. "tokyo-night"). */
  activeId: string;
  lightId: string;
  darkId: string;
  /** Flip between the chosen light and dark themes. */
  toggle: () => void;
  /** Compat: switch active mode, keeping both picks. */
  setTheme: (t: Theme) => void;
  /** Change one slot's pick (+ instant preview if that slot is active). */
  previewSlot: (slot: Slot, id: string) => void;
  /** Apply an arbitrary theme id (activates its slot). */
  applyId: (id: string) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

const PAIR_KEY = "nicotineHub.themePair";

function readPair(): ThemePair {
  const fallback: ThemePair = { light: DEFAULT_LIGHT_THEME, dark: DEFAULT_DARK_THEME, mode: "light" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PAIR_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ThemePair>;
      const light = isThemeId(p.light) ? p.light : fallback.light;
      const dark = isThemeId(p.dark) ? p.dark : fallback.dark;
      const active = getTheme(p.mode === "dark" ? dark : light);
      return { light, dark, mode: active?.mode ?? (p.mode === "dark" ? "dark" : "light") };
    }
    // Adopt bridge-synced ui picks / legacy binary theme on first run.
    try {
      const s = JSON.parse(localStorage.getItem("nicotineHub.settings") ?? "null") as {
        ui?: { light_theme?: unknown; dark_theme?: unknown; dark_mode?: unknown };
      } | null;
      if (s?.ui) {
        if (isThemeId(s.ui.light_theme)) fallback.light = s.ui.light_theme;
        if (isThemeId(s.ui.dark_theme)) fallback.dark = s.ui.dark_theme;
        if (typeof s.ui.dark_mode === "boolean") fallback.mode = s.ui.dark_mode ? "dark" : "light";
      }
    } catch {}
    if (fallback.mode === "light") {
      const legacy = localStorage.getItem("nicotineHub.theme") ?? localStorage.getItem("nicotine.theme");
      if (legacy === "dark" || legacy === "light") fallback.mode = legacy;
    }
  } catch {}
  return fallback;
}

function paint(pair: ThemePair) {
  const id = pair.mode === "dark" ? pair.dark : pair.light;
  const active = getTheme(id);
  const mode = active?.mode ?? pair.mode;
  document.documentElement.dataset.theme = id;
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem(PAIR_KEY, JSON.stringify({ ...pair, mode }));
    // Legacy binary key stays in sync for anything still reading it.
    localStorage.setItem("nicotineHub.theme", mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && active) meta.setAttribute("content", active.bg);
  } catch {}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pair, setPair] = useState<ThemePair>({ light: DEFAULT_LIGHT_THEME, dark: DEFAULT_DARK_THEME, mode: "light" });

  useEffect(() => {
    const next = readPair();
    setPair(next);
    paint(next);
  }, []);

  const toggle = useCallback(() => {
    setPair((prev) => {
      const next: ThemePair = { ...prev, mode: prev.mode === "dark" ? "light" : "dark" };
      paint(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setPair((prev) => {
      if (prev.mode === t) return prev;
      const next: ThemePair = { ...prev, mode: t };
      paint(next);
      return next;
    });
  }, []);

  const previewSlot = useCallback((slot: Slot, id: string) => {
    if (!isThemeId(id)) return;
    setPair((prev) => {
      const next: ThemePair = { ...prev, [slot]: id };
      // Keep mode glued to the edited slot so the pick previews instantly.
      next.mode = slot;
      paint(next);
      return next;
    });
  }, []);

  const applyId = useCallback((id: string) => {
    const t = getTheme(id);
    if (!t) return;
    setPair((prev) => {
      const next: ThemePair = { ...prev, [t.mode]: id, mode: t.mode };
      paint(next);
      return next;
    });
  }, []);

  const activeId = pair.mode === "dark" ? pair.dark : pair.light;
  const active = getTheme(activeId);
  const theme: Theme = active?.mode ?? pair.mode;

  return (
    <ThemeContext.Provider
      value={{ theme, activeId, lightId: pair.light, darkId: pair.dark, toggle, setTheme, previewSlot, applyId }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
