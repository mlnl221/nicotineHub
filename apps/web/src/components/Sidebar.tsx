"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useTransfers } from "@/lib/transfers";
import { useConfig } from "@/lib/config/provider";

const NAV = [
  { icon: "search_check", label: "Search Files", href: "/search", key: "search" },
  { icon: "downloading", label: "Downloads", href: "/downloads", key: "downloads" },
  { icon: "upload", label: "Uploads", href: "/uploads", key: "uploads" },
  { icon: "forum", label: "Private Chat", href: "/private-chat", key: "privateChat" },
  { icon: "folder_managed", label: "Browse Shares", href: "/browse", key: "browse" },
  { icon: "account_circle", label: "User Profiles", href: "/profile", key: "profile" },
  { icon: "group", label: "Buddies", href: "/buddies", key: "buddies" },
  { icon: "groups", label: "Chat Rooms", href: "/chat", key: "chat" },
  { icon: "interests", label: "Interests", href: "/interests", key: "interests" },
];

export function Sidebar() {
  const { logout, state } = useSession();
  const pathname = usePathname();
  const { settings } = useConfig();
  const { downloads, uploads } = useTransfers();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const downloadsCount = mounted ? downloads.length : 0;
  const uploadsCount = mounted ? uploads.length : 0;
  const displayUser = mounted ? (state.user ?? "System Administrator") : "System Administrator";
  const visibleMap = settings.ui.modes_visible || {};
  const order = settings.ui.modes_order || NAV.map((n) => n.key);
  const orderedNav = [...NAV].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const filteredNav = mounted ? orderedNav.filter((n) => visibleMap[n.key] !== false) : orderedNav;

  return (
    <nav className="fixed left-0 top-0 z-50 hidden h-full w-72 flex-col space-y-8 bg-surface-container-low/90 p-6 backdrop-blur-md dark:bg-surface-container-low/90 md:flex">
      <div>
        <div className="mb-1 font-headline text-lg font-black text-on-surface dark:text-inverse-primary">
          NICOTINE HUB
        </div>
        <div className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
          Secure Homelab Node
        </div>
      </div>

      <div className="flex items-center space-x-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container">
          <span className="font-headline text-sm font-bold text-on-primary">N</span>
        </div>
        <div className="font-label text-sm font-semibold text-primary dark:text-inverse-primary" suppressHydrationWarning>
          {displayUser}
        </div>
      </div>

      <button className="flex items-center justify-center space-x-2 rounded-xl bg-primary-container py-3 font-label text-xs uppercase tracking-widest text-on-primary-container transition-colors hover:bg-primary">
        <span className="material-symbols-outlined text-[18px]">add</span>
        <span>New Transfer</span>
      </button>

      <ul className="mt-8 flex-1 space-y-2">
        {filteredNav.map((item) => {
          const isActive = mounted ? (pathname === item.href || (item.href !== "#" && pathname.startsWith(item.href))) : false;
          const badge =
            item.label === "Downloads" && downloadsCount > 0 ? ` (${downloadsCount})`
            : item.label === "Uploads" && uploadsCount > 0 ? ` (${uploadsCount})`
            : "";
          return (
            <li key={item.label} className="scale-105 cursor-pointer duration-200 active:scale-95">
              <Link
                href={item.href}
                className={
                  isActive
                    ? "flex items-center space-x-3 rounded-xl bg-primary-fixed/30 px-4 py-3 font-bold text-primary dark:bg-primary-container/20 dark:text-inverse-primary"
                    : "flex items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
                }
                style={isActive ? ({ fontVariationSettings: "'FILL' 1" } as React.CSSProperties) : undefined}
              >
                <span className="material-symbols-outlined" style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                  {item.icon}
                </span>
                <span className="font-label text-xs uppercase tracking-widest" suppressHydrationWarning>
                  {item.label}
                  {badge}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-surface-container-high/20 pt-8">
        <a
          href="/settings"
          className="flex items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
        >
          <span className="material-symbols-outlined">settings</span>
          <span className="font-label text-xs uppercase tracking-widest">Settings</span>
        </a>
        <a
          href="/diagnostics"
          className="flex items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
        >
          <span className="material-symbols-outlined">monitoring</span>
          <span className="font-label text-xs uppercase tracking-widest">Diagnostics</span>
        </a>
        <a
          href="/statistics"
          className="flex items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
        >
          <span className="material-symbols-outlined">bar_chart</span>
          <span className="font-label text-xs uppercase tracking-widest">Statistics</span>
        </a>
        <button
          onClick={() => logout()}
          className="flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
        >
          <span className="material-symbols-outlined">logout</span>
          <span className="font-label text-xs uppercase tracking-widest">Logoff</span>
        </button>
        <div className="pt-4 text-[10px] leading-relaxed text-on-surface-variant/60 dark:text-outline/60">
          <p className="font-label uppercase tracking-widest">GPL-3.0-or-later</p>
          <p>
            Based on{" "}
            <a href="https://github.com/nicotine-plus/nicotine-plus" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              Nicotine+
            </a>
            . Not affiliated with{" "}
            <a href="https://www.slsknet.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              Soulseek
            </a>
            .
          </p>
          <p className="mt-1">
            <a href="https://github.com/mlnl221/nicotineHub" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-primary">
              Source
            </a>{" "}
            •{" "}
            <a href="https://github.com/mlnl221/nicotineHub/blob/main/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-primary">
              Attribution
            </a>
          </p>
        </div>
      </div>
    </nav>
  );
}
