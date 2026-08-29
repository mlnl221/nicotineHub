"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { ProfileProvider, useProfileTabs } from "@/lib/profile-tabs";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { ProfileView } from "@/components/profile/ProfileView";

const RECENT_KEY = "nicotine.recentProfiles";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function TabbedProfileInner() {
  const { state } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tabs, activeTab, openProfile } = useProfileTabs();
  const [username, setUsername] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => { setRecent(loadRecent()); }, [tabs.length]);

  useEffect(() => {
    const q = searchParams.get("user") || searchParams.get("username");
    if (q) {
      const u = decodeURIComponent(q);
      if (u) {
        openProfile(u);
        const url = new URL(window.location.href);
        url.searchParams.delete("user");
        url.searchParams.delete("username");
        window.history.replaceState(null, "", url.toString());
      }
    }
  }, [searchParams, openProfile]);

  const go = () => {
    const u = username.trim();
    if (!u) return;
    if (tabs.length >= 10) return;
    openProfile(u);
    setUsername("");
    setRecent(loadRecent());
  };

  if (state.status !== "connected") return null;

  return (
    <div className="flex min-h-screen max-w-[100vw] overflow-x-hidden bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Profiles" />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-hidden pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-outline-variant/10">
          <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 md:px-10 py-3 flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder={tabs.length >= 10 ? "Max 10 tabs reached — close one first" : "Enter a username"}
                disabled={tabs.length >= 10}
                className="flex-1 min-w-0 rounded-xl bg-surface-container-low px-4 py-3 font-body text-sm outline-none ghost-border focus:border-primary disabled:opacity-50"
              />
              <button
                onClick={go}
                disabled={!username.trim() || tabs.length >= 10}
                className="shrink-0 rounded-xl bg-primary-container px-5 py-3 min-h-11 font-label text-xs font-semibold uppercase tracking-widest text-on-primary-container hover:bg-primary hover:text-on-primary disabled:opacity-50"
              >
                View
              </button>
            </div>
            <ProfileTabs />
            <p className="font-label text-xs text-outline">Tabs load in background and persist. {tabs.length}/10.</p>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {activeTab ? (
            <ProfileView key={activeTab.id} tab={activeTab} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
              <div className="w-full max-w-md text-center">
                <h2 className="font-headline text-3xl font-bold">User Profiles</h2>
                <p className="font-body text-sm text-on-surface-variant mt-2 mb-6">
                  Look up any Soulseek user to see their shared files, speed, description, and interests. Each profile opens in its own tab.
                </p>
                {recent.length ? (
                  <div className="mt-8 text-left">
                    <h3 className="font-label text-xs uppercase tracking-widest text-on-surface-variant mb-3">Recently Viewed</h3>
                    <ul className="flex flex-col gap-2">
                      {recent.map((u) => (
                        <li key={u}>
                          <button
                            onClick={() => openProfile(u)}
                            className="flex w-full items-center gap-3 rounded-xl bg-surface-container-low dark:bg-surface-container-high px-4 py-3 ghost-border hover:bg-surface-container-high dark:hover:bg-surface-container text-left"
                          >
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container font-headline text-xs font-bold text-on-primary">
                              {u.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="font-label text-sm text-on-surface">{u}</span>
                            <span className="material-symbols-outlined ml-auto text-outline text-[18px]">chevron_right</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => { localStorage.removeItem(RECENT_KEY); setRecent([]); }} className="mt-3 font-label text-xs text-outline hover:text-on-surface-variant underline">Clear</button>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

export default function ProfileLookup() {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => { if (state.status !== "connected") router.replace("/"); }, [state.status, router]);
  if (state.status !== "connected") return null;
  return (
    <ProfileProvider>
      <TabbedProfileInner />
    </ProfileProvider>
  );
}
