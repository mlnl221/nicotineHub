"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useTransfers } from "@/lib/transfers";
import { useConfig } from "@/lib/config/provider";
import { useSidebarCollapsed } from "@/components/SidebarContext";

const NAV = [
  { icon: "downloading", label: "Downloads", href: "/downloads", key: "downloads" },
  { icon: "upload", label: "Uploads", href: "/uploads", key: "uploads" },
  { icon: "forum", label: "Private Chat", href: "/private-chat", key: "privateChat" },
  { icon: "folder_managed", label: "Browse Shares", href: "/browse", key: "browse" },
  { icon: "folder_open", label: "Files", href: "/files", key: "files" },
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
  const { collapsed, toggle } = useSidebarCollapsed();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const downloadsCount = mounted ? downloads.length : 0;
  const uploadsCount = mounted ? uploads.length : 0;
  const displayUser = mounted ? (state.user ?? "System Administrator") : "System Administrator";
  const visibleMap = settings.ui.modes_visible || {};
  const order = settings.ui.modes_order || NAV.map((n) => n.key);
  const orderedNav = [...NAV].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const filteredNav = mounted ? orderedNav.filter((n) => visibleMap[n.key] !== false) : orderedNav;

  // Collapsed width 4rem (16) vs expanded 18rem (72)
  const widthClass = collapsed ? "w-16" : "w-72";
  const paddingClass = collapsed ? "p-3" : "p-6";

  return (
    <nav className={`fixed left-0 top-0 z-50 hidden h-full ${widthClass} flex-col backdrop-blur-md dark:bg-surface-container-low/90 md:flex bg-surface-container-low/90 border-r border-outline-variant/5 ${paddingClass} transition-all duration-300`}>
      {/* Header + collapse toggle */}
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2`}>
        {!collapsed ? (
          <div>
            <div className="mb-1 font-headline text-lg font-black text-on-surface dark:text-inverse-primary">
              NICOTINE HUB
            </div>
            <div className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
              Secure Homelab Node
            </div>
          </div>
        ) : (
          <div className="font-headline text-sm font-black text-on-surface dark:text-inverse-primary">NH</div>
        )}
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-high/60 hover:bg-surface-container-high text-on-surface-variant dark:text-outline transition-colors"
          title={collapsed ? "Expand" : "Collapse"}
        >
          <span className="material-symbols-outlined text-[18px]">{collapsed ? "chevron_right" : "chevron_left"}</span>
        </button>
      </div>

      <div className={`mt-6 flex items-center ${collapsed ? "justify-center" : "space-x-3"}`}>
        <img
          src="/icon-512.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 rounded-xl object-contain bg-white p-1 shadow-sm ring-1 ring-black/5 dark:bg-white shrink-0"
        />
        {!collapsed ? (
          <div className="font-label text-sm font-semibold text-primary dark:text-inverse-primary truncate" suppressHydrationWarning title={displayUser}>
            {displayUser}
          </div>
        ) : null}
      </div>

      {/* Primary Search — single blue button (replaces old New Transfer + former Search nav) */}
      <Link
        href="/search"
        className={`mt-6 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 font-label text-xs font-semibold uppercase tracking-widest text-on-primary shadow-sm hover:bg-primary-container hover:text-on-primary-container transition-colors ${collapsed ? "px-0" : "px-4"}`}
        title="Search Files"
      >
        <span className="material-symbols-outlined text-[18px]">search</span>
        {!collapsed ? <span>Search</span> : null}
      </Link>

      <ul className="mt-6 flex-1 space-y-1 overflow-y-auto overflow-x-hidden hide-scrollbar">
        {filteredNav.map((item) => {
          const isActive = mounted ? (pathname === item.href || (item.href !== "#" && pathname.startsWith(item.href))) : false;
          const badge =
            item.label === "Downloads" && downloadsCount > 0 ? ` (${downloadsCount})`
            : item.label === "Uploads" && uploadsCount > 0 ? ` (${uploadsCount})`
            : "";
          return (
            <li key={item.label} className="active:scale-95 duration-150">
              <Link
                href={item.href}
                title={collapsed ? `${item.label}${badge}` : undefined}
                className={
                  isActive
                    ? `flex items-center rounded-xl bg-primary-fixed/30 px-3 py-3 font-bold text-primary dark:bg-primary-container/20 dark:text-inverse-primary ${collapsed ? "justify-center" : "space-x-3"}`
                    : `flex items-center rounded-xl px-3 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant ${collapsed ? "justify-center" : "space-x-3"}`
                }
                style={isActive ? ({ fontVariationSettings: "'FILL' 1" } as React.CSSProperties) : undefined}
              >
                <span className="material-symbols-outlined shrink-0" style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                  {item.icon}
                </span>
                {!collapsed ? (
                  <span className="font-label text-xs uppercase tracking-widest truncate" suppressHydrationWarning>
                    {item.label}
                    {badge}
                  </span>
                ) : badge ? (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-tertiary px-1 text-[9px] leading-4 text-center text-on-tertiary font-bold md:hidden">{badge.trim().replace(/[()]/g,"")}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className={`space-y-1 border-t border-surface-container-high/20 pt-4 ${collapsed ? "items-center" : ""}`}>
        <Link
          href="/settings"
          title={collapsed ? "Settings" : undefined}
          className={`flex items-center rounded-xl px-3 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant ${collapsed ? "justify-center" : "space-x-3"}`}
        >
          <span className="material-symbols-outlined">settings</span>
          {!collapsed ? <span className="font-label text-xs uppercase tracking-widest">Settings</span> : null}
        </Link>
        {/* Hide diagnostics/statistics when collapsed to avoid busy bottom */}
        {!collapsed ? (
          <>
            <Link
              href="/diagnostics"
              className="flex items-center space-x-3 rounded-xl px-3 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
            >
              <span className="material-symbols-outlined">monitoring</span>
              <span className="font-label text-xs uppercase tracking-widest">Diagnostics</span>
            </Link>
            <Link
              href="/statistics"
              className="flex items-center space-x-3 rounded-xl px-3 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
            >
              <span className="material-symbols-outlined">bar_chart</span>
              <span className="font-label text-xs uppercase tracking-widest">Statistics</span>
            </Link>
          </>
        ) : null}
        <button
          onClick={() => logout()}
          title={collapsed ? "Logoff" : undefined}
          className={`flex w-full items-center rounded-xl px-3 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant ${collapsed ? "justify-center" : "space-x-3"}`}
        >
          <span className="material-symbols-outlined">logout</span>
          {!collapsed ? <span className="font-label text-xs uppercase tracking-widest">Logoff</span> : null}
        </button>
        {!collapsed ? (
          <div className="pt-3 text-[10px] leading-relaxed text-on-surface-variant/60 dark:text-outline/60">
            <a href="/settings?tab=about#about" className="font-label uppercase tracking-widest underline decoration-dotted hover:text-primary">
              About
            </a>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
