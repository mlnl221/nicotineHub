"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTransfers } from "@/lib/transfers";

type NavItem = { icon: string; label: string; href: string };

const PRIMARY: NavItem[] = [
  { icon: "search", label: "Search", href: "/search" },
  { icon: "downloading", label: "Transfers", href: "/downloads" },
  { icon: "folder_managed", label: "Browse", href: "/browse" },
  { icon: "group", label: "Buddies", href: "/buddies" },
  { icon: "forum", label: "Chat", href: "/private-chat" },
];

const MORE: NavItem[] = [
  { icon: "upload", label: "Uploads", href: "/uploads" },
  { icon: "groups", label: "Chat Rooms", href: "/chat" },
  { icon: "account_circle", label: "Profiles", href: "/profile" },
  { icon: "interests", label: "Interests", href: "/interests" },
  { icon: "settings", label: "Settings", href: "/settings" },
  { icon: "monitoring", label: "Diagnostics", href: "/diagnostics" },
];

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === "/search" && pathname.startsWith("/search")) return true;
  if (href === "/downloads" && (pathname.startsWith("/downloads") || pathname.startsWith("/uploads"))) return true;
  if (href === "/browse" && pathname.startsWith("/browse")) return true;
  if (href === "/buddies" && pathname.startsWith("/buddies")) return true;
  if (href === "/private-chat" && pathname.startsWith("/private-chat")) return true;
  if (href === "/chat" && pathname.startsWith("/chat")) return true;
  if (href === "/profile" && pathname.startsWith("/profile")) return true;
  if (href === "/interests" && pathname.startsWith("/interests")) return true;
  return pathname.startsWith(href);
}

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  let transferCount = 0;
  try {
    const t = useTransfers();
    transferCount = t.downloads.length + t.uploads.length;
  } catch {}

  const moreActive = MORE.some((i) => isActive(pathname, i.href));

  return (
    <>
      {/* Backdrop */}
      {moreOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden"
        />
      )}
      {/* More sheet */}
      <div
        className={`fixed bottom-[calc(60px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-50 mx-2 rounded-2xl bg-surface-container-lowest shadow-[0_-8px_40px_rgba(0,0,0,0.12)] border border-outline-variant/15 transition-all duration-300 md:hidden ${moreOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"}`}
      >
        <div className="p-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-outline-variant/40" />
          <div className="grid grid-cols-3 gap-2 p-2">
            {MORE.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1 rounded-xl px-2 py-4 text-center transition-colors ${active ? "bg-primary-fixed/20 text-primary dark:bg-primary-container/20 dark:text-inverse-primary" : "text-on-surface-variant hover:bg-surface-container-low"}`}
                >
                  <span className="material-symbols-outlined text-[22px]" style={active ? ({ fontVariationSettings: "'FILL' 1" } as React.CSSProperties) : undefined}>
                    {item.icon}
                  </span>
                  <span className="font-label text-[10px] uppercase tracking-widest leading-tight">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-xl bg-surface-container-lowest/80 backdrop-blur-xl shadow-[0_-4px_20px_rgba(0,0,0,0.06)] border-t border-outline-variant/10 dark:bg-surface-container-low/90 md:hidden">
        <div className="flex items-center justify-around px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] w-full">
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item.href);
            const showBadge = item.href === "/downloads" && transferCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "flex flex-col items-center justify-center rounded-full bg-primary-container/20 px-3 py-1.5 text-primary dark:bg-primary-fixed-dim/20 dark:text-primary-fixed-dim transition-all active:scale-90"
                    : "flex flex-col items-center justify-center px-2 py-1.5 text-on-surface-variant opacity-70 hover:text-primary transition-all active:scale-90 relative"
                }
                style={active ? ({ fontVariationSettings: "'FILL' 1" } as React.CSSProperties) : undefined}
              >
                <span className="material-symbols-outlined text-[22px] leading-none" style={active ? ({ fontVariationSettings: "'FILL' 1" } as React.CSSProperties) : undefined}>
                  {item.icon}
                </span>
                <span className={`font-label text-[9px] uppercase tracking-widest mt-0.5 leading-none ${active ? "font-bold" : ""}`}>{item.label}</span>
                {showBadge && (
                  <span className="absolute -top-0.5 right-0.5 min-w-[16px] h-4 rounded-full bg-tertiary px-1 text-[10px] leading-4 text-center text-on-tertiary font-bold">
                    {transferCount > 99 ? "99+" : transferCount}
                  </span>
                )}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            aria-label="More navigation"
            className={`flex flex-col items-center justify-center px-2 py-1.5 transition-all active:scale-90 ${moreActive || moreOpen ? "rounded-full bg-primary-container/20 px-3 text-primary dark:bg-primary-fixed-dim/20 dark:text-primary-fixed-dim" : "text-on-surface-variant opacity-70"}`}
          >
            <span className="material-symbols-outlined text-[22px] leading-none">{moreOpen ? "close" : "more_horiz"}</span>
            <span className={`font-label text-[9px] uppercase tracking-widest mt-0.5 leading-none ${moreActive ? "font-bold" : ""}`}>More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
