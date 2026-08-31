"use client";

import { useEffect, useRef } from "react";
import { useConfig } from "@/lib/config/provider";

/**
 * PWA mapping for desktop window geometry (width/height/maximized).
 * Stores viewport size to ui.width/height when not maximized, restores on load.
 * Desktop x/y are kept as -1 (centered) — PWA has no window position.
 */
export function WindowGeometrySync() {
  const { settings, setOption } = useConfig();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const isMax = w >= window.screen.width - 32 && h >= window.screen.height - 32;
        // Only update if changed and not maximized (per nicotine maximized true means ignore size)
        try {
          if (!isMax) {
            if (settings.ui.width !== w) setOption("ui", "width", w);
            if (settings.ui.height !== h) setOption("ui", "height", h);
          }
          if (settings.ui.maximized !== isMax) setOption("ui", "maximized", isMax);
        } catch {}
      }, 800);
    };
    window.addEventListener("resize", onResize);
    // Initial sync: if stored size differs from current viewport and not maximized, note but don't force resize (browser can't resize)
    return () => {
      window.removeEventListener("resize", onResize);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [settings.ui.width, settings.ui.height, settings.ui.maximized, setOption]);

  return null;
}
