"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session";
import { RequireAuth } from "@/components/RequireAuth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { PageHeader } from "@/components/PageHeader";
import { useProfileTabs } from "@/lib/profile-tabs";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { ProfileView } from "@/components/profile/ProfileView";
import { MobileHelp } from "@/components/ui/MobileHelp";
import { profilePicSrc } from "@/lib/profile-pic";

const RECENT_KEY = "nicotineHub.recentProfiles";

function loadRecent(): string[] {
  try {
    const raw = (localStorage.getItem(RECENT_KEY) ?? localStorage.getItem(RECENT_KEY.replace("nicotineHub.", "nicotine.")));
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
  // Mobile collapses the lookup row behind a pill once a profile is open.
  const [lookupOpen, setLookupOpen] = useState(false);
  // Own avatar: real picture when own profile tab already fetched one.
  const ownPic = tabs.find((t) => t.username.toLowerCase() === (state.user ?? "").toLowerCase())?.profile.info?.pic;

  useEffect(() => { setRecent(loadRecent()); }, [tabs.length]);

  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    const q = searchParams.get("user") || searchParams.get("username");
    if (!q) { handledRef.current = null; return; }
    let u = "";
    try { u = decodeURIComponent(q); } catch { u = q; }
    if (!u) return;
    const lower = u.toLowerCase();
    if (handledRef.current === lower) return;
    handledRef.current = lower;
    openProfile(u);
    const url = new URL(window.location.href);
    url.searchParams.delete("user");
    url.searchParams.delete("username");
    const clean = url.pathname + (url.search ? url.search : "") + url.hash;
    try { router.replace(clean); } catch { window.history.replaceState(null, "", url.toString()); }
    setTimeout(() => { if (handledRef.current === lower) handledRef.current = null; }, 800);
  }, [searchParams, openProfile, router]);

  const go = () => {
    const u = username.trim();
    if (!u) return;
    if (tabs.length >= 10) return;
    openProfile(u);
    setUsername("");
    setLookupOpen(false);
    setRecent(loadRecent());
  };

  if (state.status !== "connected") return null;

  const lookupCollapsed = !!activeTab && !lookupOpen;
  const ownAvatar = (
    <button
      onClick={() => state.user && tabs.length < 10 && openProfile(state.user)}
      disabled={!state.user || tabs.length >= 10}
      aria-label="View my public profile"
      title={state.user ? `View ${state.user}'s public profile` : "Sign in to view your profile"}
      className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-primary-container font-headline text-sm font-bold text-on-primary disabled:opacity-50 md:hidden"
    >
      {ownPic ? (
        <Image src={profilePicSrc(ownPic)} alt="My profile picture" width={44} height={44} unoptimized loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{(state.user ?? "?").slice(0, 1).toUpperCase()}</span>
      )}
    </button>
  );

  return (
    <div className="flex min-h-screen max-w-full overflow-x-clip bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Profiles" subtitle={`${tabs.length}/10 tabs • User profiles`} />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <PageHeader
          title="User Profiles"
          subtitle={`${tabs.length}/10 tabs • ${activeTab ? `Viewing ${activeTab.username}` : "Look up any Soulseek user"}`}
          settingsHref="/settings?tab=user-profile#user-profile"
        />
        <div className="sticky top-[calc(60px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-outline-variant/10">
          <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 md:px-10 py-1.5 md:py-3 flex flex-col gap-2 md:gap-3">
            <div className="flex gap-2">
              {lookupCollapsed ? (
                <button
                  type="button"
                  onClick={() => setLookupOpen(true)}
                  aria-label="Look up another user"
                  className="flex min-h-11 flex-1 items-center gap-2 rounded-xl bg-surface-container-low ghost-border px-4 font-body text-sm text-outline md:hidden"
                >
                  <span className="material-symbols-outlined text-[18px]">search</span>
                  Look up user…
                </button>
              ) : null}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder={tabs.length >= 10 ? "Max 10 tabs reached — close one first" : "Enter a username"}
                disabled={tabs.length >= 10}
                className={`${lookupCollapsed ? "hidden" : "block"} flex-1 min-w-0 rounded-xl bg-surface-container-low px-4 py-3 font-body text-sm outline-none ghost-border focus:border-primary disabled:opacity-50 md:block`}
              />
              <button
                onClick={go}
                disabled={!username.trim() || tabs.length >= 10}
                className={`${lookupCollapsed ? "hidden" : ""} shrink-0 rounded-xl bg-primary-container px-5 py-3 min-h-11 font-label text-xs font-semibold uppercase tracking-widest text-on-primary-container hover:bg-primary hover:text-on-primary disabled:opacity-50 md:shrink-0`}
              >
                View
              </button>
              {activeTab && lookupOpen ? (
                <button
                  type="button"
                  onClick={() => setLookupOpen(false)}
                  aria-label="Collapse lookup"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant md:hidden"
                >
                  <span className="material-symbols-outlined">expand_less</span>
                </button>
              ) : null}
              <button
                onClick={() => state.user && tabs.length < 10 && openProfile(state.user)}
                disabled={!state.user || tabs.length >= 10}
                aria-label="View my public profile"
                title={state.user ? `View ${state.user}'s public profile` : "Sign in to view your profile"}
                className="shrink-0 hidden md:inline-flex items-center gap-1.5 rounded-xl bg-surface-container-high px-5 py-3 min-h-11 font-label text-xs font-semibold uppercase tracking-widest text-primary hover:bg-surface-container disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden>account_circle</span>
                My profile
              </button>
              {ownAvatar}
            </div>
            <ProfileTabs />
            <MobileHelp short="Tabs load in background and persist." testId="profile-tabs-help">
              <p className="font-label text-xs text-outline">Tabs load in background and persist. {tabs.length}/10.</p>
            </MobileHelp>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-x-hidden max-w-full min-w-0 min-h-0">
          {activeTab ? (
            <ProfileView key={activeTab.id} tab={activeTab} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
              <div className="w-full max-w-md text-center">
                <h2 className="font-headline text-3xl font-bold">User Profiles</h2>
                <MobileHelp short="Look up any Soulseek user." testId="profile-empty-help">
                  <p className="font-body text-sm text-on-surface-variant mt-2 mb-6">
                    Look up any Soulseek user to see their shared files, speed, description, and interests. Each profile opens in its own tab.
                  </p>
                </MobileHelp>
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
  return (
    <RequireAuth>
      <TabbedProfileInner />
    </RequireAuth>
  );
}
