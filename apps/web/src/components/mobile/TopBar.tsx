"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleToggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    toggle();
    // keep config in sync (ui.dark_mode)
    try {
      setOption("ui", "dark_mode", next === "dark");
    } catch {}
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between gap-2 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-outline-variant/10 px-4 pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 shadow-sm dark:bg-surface-container-low/80 md:hidden max-w-[100vw] overflow-hidden">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {showBack && backHref ? (
          <Link href={backHref} className="flex h-11 w-11 shrink-0 items-center justify-center -ml-2 rounded-full hover:bg-surface-container-high active:scale-95 transition-colors">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">arrow_back</span>
          </Link>
        ) : (
          <Link href="/search" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-0.5 shadow-sm ring-1 ring-black/5 shrink-0">
            <img src="/icon-512.png" alt="" width={32} height={32} className="h-full w-full rounded-md object-contain" />
          </Link>
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <h1 className="font-headline text-[15px] font-bold tracking-tight text-on-surface truncate leading-none max-w-full">{title}</h1>
          {subtitle ? <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant truncate leading-none mt-0.5 max-w-full">{subtitle}</p> : null}
          {mounted && state.user && !subtitle ? <p className="font-label text-[10px] text-on-surface-variant truncate max-w-[40vw]" suppressHydrationWarning>{state.user}</p> : null}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleToggle}
          aria-label="Toggle theme"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-container-high active:scale-95 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
            {theme === "dark" ? "light_mode" : "dark_mode"}
          </span>
        </button>
        <Link
          href="/settings"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-container-high active:scale-95 transition-colors"
          aria-label="Settings"
        >
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">settings</span>
        </Link>
      </div>
    </header>
  );
}
