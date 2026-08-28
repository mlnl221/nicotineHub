"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { useTransfers } from "@/lib/transfers";

const NAV = [
  { icon: "search_check", label: "Search Files", href: "/search" },
  { icon: "downloading", label: "Downloads", href: "/downloads" },
  { icon: "upload", label: "Uploads", href: "/uploads" },
  { icon: "forum", label: "Private Chat", href: "#" },
  { icon: "folder_managed", label: "Browse Shares", href: "#" },
  { icon: "account_circle", label: "User Profiles", href: "/profile" },
  { icon: "group", label: "Buddies", href: "#" },
  { icon: "groups", label: "Chat Rooms", href: "#" },
  { icon: "interests", label: "Interests", href: "#" },
];

export function Sidebar() {
  const { logout, state } = useSession();
  const pathname = usePathname();
  let downloadsCount = 0;
  let uploadsCount = 0;
  try {
    const t = useTransfers();
    downloadsCount = t.downloads.length;
    uploadsCount = t.uploads.length;
  } catch {
    // TransfersProvider not mounted on login page
  }

  return (
    <nav className="fixed left-0 top-0 z-50 flex h-full w-72 flex-col space-y-8 bg-surface-container-low/90 p-6 backdrop-blur-md dark:bg-surface-container-highest/90">
      <div>
        <div className="mb-1 font-headline text-lg font-black text-on-surface dark:text-inverse-primary">
          NICOTINE+ HUB
        </div>
        <div className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
          Secure Homelab Node
        </div>
      </div>

      <div className="flex items-center space-x-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container">
          <span className="font-headline text-sm font-bold text-on-primary">N</span>
        </div>
        <div className="font-label text-sm font-semibold text-primary dark:text-inverse-primary">
          {state.user ?? "System Administrator"}
        </div>
      </div>

      <button className="flex items-center justify-center space-x-2 rounded-xl bg-primary-container py-3 font-label text-xs uppercase tracking-widest text-on-primary-container transition-colors hover:bg-primary">
        <span className="material-symbols-outlined text-[18px]">add</span>
        <span>New Transfer</span>
      </button>

      <ul className="mt-8 flex-1 space-y-2">
        {NAV.map((item) => {
          const isActive = pathname === item.href || (item.href !== "#" && pathname.startsWith(item.href));
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
                <span className="font-label text-xs uppercase tracking-widest">
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
          href="#"
          className="flex items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
        >
          <span className="material-symbols-outlined">monitoring</span>
          <span className="font-label text-xs uppercase tracking-widest">Diagnostics</span>
        </a>
        <button
          onClick={() => logout()}
          className="flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
        >
          <span className="material-symbols-outlined">logout</span>
          <span className="font-label text-xs uppercase tracking-widest">Logoff</span>
        </button>
      </div>
    </nav>
  );
}
