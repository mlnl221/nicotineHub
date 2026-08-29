"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useConfig } from "@/lib/config/provider";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";

const NetworkSection = dynamic(() => import("@/components/settings/NetworkSection").then((m) => m.NetworkSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const UiSection = dynamic(() => import("@/components/settings/UiSection").then((m) => m.UiSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const SearchesSection = dynamic(() => import("@/components/settings/SearchesSection").then((m) => m.SearchesSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const NotificationsSection = dynamic(() => import("@/components/settings/NotificationsSection").then((m) => m.NotificationsSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const SharesSection = dynamic(() => import("@/components/settings/SharesSection").then((m) => m.SharesSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const DownloadsSection = dynamic(() => import("@/components/settings/DownloadsSection").then((m) => m.DownloadsSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const UploadsSection = dynamic(() => import("@/components/settings/UploadsSection").then((m) => m.UploadsSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const UserProfileSection = dynamic(() => import("@/components/settings/UserProfileSection").then((m) => m.UserProfileSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const ChatsSection = dynamic(() => import("@/components/settings/ChatsSection").then((m) => m.ChatsSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const NowPlayingSection = dynamic(() => import("@/components/settings/NowPlayingSection").then((m) => m.NowPlayingSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const LoggingSection = dynamic(() => import("@/components/settings/LoggingSection").then((m) => m.LoggingSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const BannedUsersSection = dynamic(() => import("@/components/settings/BannedUsersSection").then((m) => m.BannedUsersSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const IgnoredUsersSection = dynamic(() => import("@/components/settings/IgnoredUsersSection").then((m) => m.IgnoredUsersSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const UrlHandlersSection = dynamic(() => import("@/components/settings/UrlHandlersSection").then((m) => m.UrlHandlersSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });
const PluginsSection = dynamic(() => import("@/components/settings/PluginsSection").then((m) => m.PluginsSection), { loading: () => <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" /> });

type TabId =
  | "network"
  | "appearance"
  | "shares"
  | "downloads"
  | "uploads"
  | "searches"
  | "user-profile"
  | "chats"
  | "now-playing"
  | "logging"
  | "banned-users"
  | "ignored-users"
  | "url-handlers"
  | "plugins"
  | "notifications";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "network", label: "Network", icon: "dns" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "shares", label: "Shares", icon: "folder" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "uploads", label: "Uploads", icon: "upload" },
  { id: "searches", label: "Searches", icon: "search" },
  { id: "user-profile", label: "User Profile", icon: "person" },
  { id: "chats", label: "Chats", icon: "chat" },
  { id: "now-playing", label: "Now Playing", icon: "music_note" },
  { id: "logging", label: "Logging", icon: "article" },
  { id: "banned-users", label: "Banned Users", icon: "block" },
  { id: "ignored-users", label: "Ignored Users", icon: "person_off" },
  { id: "url-handlers", label: "URL Handlers", icon: "link" },
  { id: "plugins", label: "Plugins", icon: "extension" },
  { id: "notifications", label: "Notifications", icon: "notifications" },
];

type TabGroup = { label: string; tabs: TabId[] };

const TAB_GROUPS: TabGroup[] = [
  { label: "Connection", tabs: ["network"] },
  { label: "Interface", tabs: ["appearance", "notifications"] },
  { label: "Transfers", tabs: ["shares", "downloads", "uploads"] },
  { label: "Search & Users", tabs: ["searches", "user-profile", "banned-users", "ignored-users"] },
  { label: "Chat & Playback", tabs: ["chats", "now-playing"] },
  { label: "System", tabs: ["logging", "url-handlers", "plugins"] },
];

const TAB_MAP = new Map(TABS.map((t) => [t.id, t] as const));
const VALID_TABS = new Set<string>(TABS.map((t) => t.id));

export default function SettingsPage() {
  const { resetAll } = useConfig();
  const [tab, setTab] = useState<TabId>("network");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Deep-link via ?tab= / #tab — sync to URL and survive reload (settings-plan.md Phase B)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("tab");
    const fromHash = window.location.hash.replace(/^#/, "");
    const initial = fromQuery || fromHash;
    if (initial && VALID_TABS.has(initial)) setTab(initial as TabId);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.hash = tab;
    window.history.replaceState(null, "", url.toString());
  }, [tab, mounted]);

  const activeTab = TAB_MAP.get(tab);

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Settings" />

      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(circle at 50% 20%, rgba(51, 102, 204, 0.15) 0%, transparent 60%)",
          }}
        />

        <header className="relative z-10 hidden md:flex w-full items-center justify-between px-4 py-3 md:px-8 md:py-6">
          <Link
            href="/search"
            className="flex items-center gap-2 font-label text-xs uppercase tracking-widest text-on-surface-variant transition-colors hover:text-primary dark:text-outline dark:hover:text-primary-fixed"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to search
          </Link>
          <button
            onClick={() => {
              if (confirm("Reset all settings to their defaults?")) resetAll();
            }}
            className="glass-card rounded-xl px-4 py-2 font-label text-xs uppercase tracking-widest text-error transition-colors hover:bg-error-container"
          >
            Reset all
          </button>
        </header>

        <div className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-6 md:px-8 md:pt-2 md:pb-8">
          <h1 className="mb-1 font-headline text-3xl font-bold tracking-tight text-on-surface dark:text-inverse-primary md:text-4xl">
            Settings
          </h1>
          <p className="mb-6 font-body text-sm text-on-surface-variant dark:text-outline">
            Preferences for this browser client. Stored locally in your browser.
          </p>

          {/* Mobile dropdown — grouped select */}
          <div className="mb-6 md:hidden">
            <label htmlFor="settings-tab-select" className="sr-only">
              Select settings section
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant dark:text-outline">
                <span className="material-symbols-outlined text-[20px]">{activeTab?.icon}</span>
              </span>
              <select
                id="settings-tab-select"
                value={tab}
                onChange={(e) => setTab(e.target.value as TabId)}
                className="w-full appearance-none rounded-2xl bg-surface-container-lowest py-3 pl-10 pr-10 font-label text-sm font-medium text-on-surface ghost-border transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:bg-surface-container-high dark:text-inverse-on-surface"
              >
                {TAB_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.tabs.map((id) => {
                      const t = TAB_MAP.get(id);
                      if (!t) return null;
                      return (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant dark:text-outline">
                <span className="material-symbols-outlined text-[20px]">expand_more</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-6 md:flex-row md:gap-8">
            {/* Desktop left nav — sticky grouped vertical list */}
            <nav
              aria-label="Settings sections"
              className="hidden shrink-0 md:block md:w-64 md:self-start"
            >
              <div className="sticky top-6 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-low p-2 shadow-sm dark:bg-surface-container-high hide-scrollbar">
                <div role="tablist" aria-orientation="vertical" className="space-y-4 py-1">
                  {TAB_GROUPS.map((group) => (
                    <div key={group.label}>
                      <div className="px-3 pb-1.5 pt-3 font-label text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/70 dark:text-outline">
                        {group.label}
                      </div>
                      <div className="space-y-1">
                        {group.tabs.map((id) => {
                          const t = TAB_MAP.get(id);
                          if (!t) return null;
                          const active = tab === t.id;
                          return (
                            <button
                              key={t.id}
                              id={`tab-${t.id}`}
                              role="tab"
                              aria-selected={active}
                              onClick={() => setTab(t.id)}
                              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-label text-sm transition-all ${
                                active
                                  ? "bg-primary text-on-primary shadow-sm"
                                  : "text-on-surface-variant hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant/60"
                              }`}
                              style={active ? ({ fontVariationSettings: "'FILL' 1" } as React.CSSProperties) : undefined}
                            >
                              <span
                                className="material-symbols-outlined text-[18px] shrink-0"
                                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                              >
                                {t.icon}
                              </span>
                              <span className={active ? "font-medium" : ""}>{t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </nav>

            {/* Content */}
            <div className="min-w-0 flex-1">
              {tab === "network" ? (
                <NetworkSection />
              ) : tab === "appearance" ? (
                <UiSection />
              ) : tab === "shares" ? (
                <SharesSection />
              ) : tab === "downloads" ? (
                <DownloadsSection />
              ) : tab === "uploads" ? (
                <UploadsSection />
              ) : tab === "searches" ? (
                <SearchesSection />
              ) : tab === "user-profile" ? (
                <UserProfileSection />
              ) : tab === "chats" ? (
                <ChatsSection />
              ) : tab === "now-playing" ? (
                <NowPlayingSection />
              ) : tab === "logging" ? (
                <LoggingSection />
              ) : tab === "banned-users" ? (
                <BannedUsersSection />
              ) : tab === "ignored-users" ? (
                <IgnoredUsersSection />
              ) : tab === "url-handlers" ? (
                <UrlHandlersSection />
              ) : tab === "plugins" ? (
                <PluginsSection />
              ) : (
                <NotificationsSection />
              )}
            </div>
          </div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
