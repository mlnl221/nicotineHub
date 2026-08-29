"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { useTheme } from "@/components/ThemeProvider";
import { useConfig } from "@/lib/config/provider";

type TopBarProps = {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  backHref?: string;
};

export function TopBar({ title = "Nicotine Hub", subtitle, showBack, backHref }: TopBarProps) {
  const { state } = useSession();
  const { theme, toggle } = useTheme();
  const { setOption } = useConfig();

  const handleToggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    toggle();
    // keep config in sync (ui.dark_mode)
    try {
      setOption("ui", "dark_mode", next === "dark");
    } catch {}
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between gap-2 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-outline-variant/10 px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 shadow-sm dark:bg-surface-container-low/80 md:hidden">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {showBack && backHref ? (
          <Link href={backHref} className="p-2 -ml-2 rounded-full hover:bg-surface-container-high active:scale-95 transition-colors">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">arrow_back</span>
          </Link>
        ) : (
          <Link href="/search" className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary font-headline font-black text-sm shrink-0">
            N
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="font-headline text-[15px] font-bold tracking-tight text-on-surface truncate leading-none">{title}</h1>
          {subtitle ? <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant truncate leading-none mt-0.5">{subtitle}</p> : null}
          {state.user && !subtitle ? <p className="font-label text-[10px] text-on-surface-variant truncate">{state.user}</p> : null}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleToggle}
          aria-label="Toggle theme"
          className="p-2 rounded-full hover:bg-surface-container-high active:scale-95 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
            {theme === "dark" ? "light_mode" : "dark_mode"}
          </span>
        </button>
        <Link
          href="/settings"
          className="p-2 rounded-full hover:bg-surface-container-high active:scale-95 transition-colors"
          aria-label="Settings"
        >
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">settings</span>
        </Link>
      </div>
    </header>
  );
}
