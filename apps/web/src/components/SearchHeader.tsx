"use client";

import { useTheme } from "@/components/ThemeProvider";

export function SearchHeader() {
  const { theme, toggle } = useTheme();

  return (
    <header className="relative z-10 flex w-full items-center justify-end px-10 py-6">
      <div className="flex items-center space-x-4">
        <button className="glass-card flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:text-primary dark:text-inverse-primary dark:hover:text-primary-fixed">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <button
          onClick={toggle}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="glass-card flex h-10 w-10 items-center justify-center rounded-full border-primary/30 bg-primary-container/10 text-on-surface-variant transition-colors hover:text-primary dark:border-primary/30 dark:bg-primary-container/10 dark:text-inverse-primary dark:hover:text-primary-fixed"
        >
          <span className="material-symbols-outlined">
            {theme === "dark" ? "light_mode" : "dark_mode"}
          </span>
        </button>
      </div>
    </header>
  );
}
