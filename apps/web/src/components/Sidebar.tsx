"use client";

import { useSession } from "@/lib/session";
import { useTheme } from "@/components/ThemeProvider";

const NAV = [
  { icon: "search_check", label: "Search Files", active: true },
  { icon: "downloading", label: "Downloads" },
  { icon: "upload", label: "Uploads" },
  { icon: "forum", label: "Private Chat" },
  { icon: "folder_managed", label: "Browse Shares" },
  { icon: "account_circle", label: "User Profiles" },
  { icon: "group", label: "Buddies" },
  { icon: "groups", label: "Chat Rooms" },
  { icon: "interests", label: "Interests" },
];

export function Sidebar() {
  const { logout, state } = useSession();

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
        {NAV.map((item) => (
          <li key={item.label} className="scale-105 cursor-pointer duration-200 active:scale-95">
            <a
              href="#"
              className={
                item.active
                  ? "flex items-center space-x-3 rounded-xl bg-primary-fixed/30 px-4 py-3 font-bold text-primary dark:bg-primary-container/20 dark:text-inverse-primary"
                  : "flex items-center space-x-3 rounded-xl px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant"
              }
            >
              <span className="material-symbols-outlined">
                {item.icon}
              </span>
              <span className="font-label text-xs uppercase tracking-widest">{item.label}</span>
            </a>
          </li>
        ))}
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
