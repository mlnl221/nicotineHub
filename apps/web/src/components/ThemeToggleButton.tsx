"use client";

import { useTheme } from "@/components/ThemeProvider";
import { useConfig } from "@/lib/config/provider";

export function ThemeToggleButton({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const { setOption } = useConfig();

  const handleToggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    toggle();
    try {
      setOption("ui", "dark_mode", next === "dark");
    } catch {}
  };

  return (
    <button
      onClick={handleToggle}
      aria-label="Toggle theme"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={`hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center shrink-0 ${className}`}
    >
      <span className="material-symbols-outlined">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
    </button>
  );
}
