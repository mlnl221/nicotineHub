"use client";

import { useState } from "react";
import { useConfig } from "@/lib/config/provider";
import { Sidebar } from "@/components/Sidebar";
import { NetworkSection } from "@/components/settings/NetworkSection";
import { UiSection } from "@/components/settings/UiSection";
import { SearchesSection } from "@/components/settings/SearchesSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { SharesSection } from "@/components/settings/SharesSection";
import { DownloadsSection } from "@/components/settings/DownloadsSection";
import { UploadsSection } from "@/components/settings/UploadsSection";
import { UserProfileSection } from "@/components/settings/UserProfileSection";
import { ChatsSection } from "@/components/settings/ChatsSection";
import { NowPlayingSection } from "@/components/settings/NowPlayingSection";
import { LoggingSection } from "@/components/settings/LoggingSection";
import { BannedUsersSection } from "@/components/settings/BannedUsersSection";
import { IgnoredUsersSection } from "@/components/settings/IgnoredUsersSection";
import { UrlHandlersSection } from "@/components/settings/UrlHandlersSection";
import { PluginsSection } from "@/components/settings/PluginsSection";

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

export default function SettingsPage() {
  const { resetAll } = useConfig();
  const [tab, setTab] = useState<TabId>("network");

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />

      <main className="relative ml-72 flex min-h-screen flex-1 flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(circle at 50% 20%, rgba(51, 102, 204, 0.15) 0%, transparent 60%)",
          }}
        />

        <header className="relative z-10 flex w-full items-center justify-between px-10 py-6">
          <a
            href="/search"
            className="flex items-center gap-2 font-label text-xs uppercase tracking-widest text-on-surface-variant transition-colors hover:text-primary dark:text-outline dark:hover:text-primary-fixed"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to search
          </a>
          <button
            onClick={() => {
              if (confirm("Reset all settings to their defaults?")) resetAll();
            }}
            className="glass-card rounded-xl px-4 py-2 font-label text-xs uppercase tracking-widest text-error transition-colors hover:bg-error-container"
          >
            Reset all
          </button>
        </header>

        <div className="relative z-10 mx-auto w-full max-w-3xl flex-1 flex-col px-10 pt-6 pb-16">
          <h1 className="mb-1 font-headline text-4xl font-light tracking-tight text-on-surface dark:text-inverse-primary">
            Settings
          </h1>
          <p className="mb-8 font-body text-sm text-on-surface-variant dark:text-outline">
            Preferences for this browser client. Stored locally in your browser.
          </p>

          {/* Tab bar */}
          <div className="mb-8 flex gap-2 overflow-x-auto pb-1">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 font-label text-xs uppercase tracking-widest transition-all ${
                    active
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high dark:bg-surface-variant dark:text-outline dark:hover:bg-surface-container-highest"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>

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
      </main>
    </div>
  );
}
