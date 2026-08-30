"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { BrowseProvider, useBrowseTabs } from "@/lib/browse-tabs";
import { BrowseTabs } from "@/components/browse/BrowseTabs";
import { BrowseView } from "@/components/browse/BrowseView";

const RECENT_BROWSE_KEY = "nicotineHub.recentBrowse";

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = (localStorage.getItem(RECENT_BROWSE_KEY) ?? localStorage.getItem(RECENT_BROWSE_KEY.replace("nicotineHub.", "nicotine.")));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
function saveRecent(username: string) {
  try {
    const cur = loadRecent();
    const next = [username, ...cur.filter((x) => x.toLowerCase() !== username.toLowerCase())].slice(0, 20);
    localStorage.setItem(RECENT_BROWSE_KEY, JSON.stringify(next));
  } catch {}
}

function BrowseInner() {
  const { state } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tabs, activeTab, openBrowse } = useBrowseTabs();
  const [username, setUsername] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => { setRecent(loadRecent()); }, [tabs.length]);

  // Handle ?user= deep link (from profile Browse Files or direct link)
  useEffect(() => {
    const q = searchParams.get("user") || searchParams.get("username");
    if (q) {
      const u = decodeURIComponent(q);
      if (u) {
        saveRecent(u);
        openBrowse(u);
        // clean URL without reload
        const url = new URL(window.location.href);
        url.searchParams.delete("user");
        url.searchParams.delete("username");
        window.history.replaceState(null, "", url.toString());
      }
    }
  }, [searchParams, openBrowse]);

  const go = () => {
    const u = username.trim();
    if (!u) return;
    if (tabs.length >= 10) return;
    saveRecent(u);
    openBrowse(u);
    setUsername("");
    setRecent(loadRecent());
  };

  if (state.status !== "connected") return null;

  const hasTabs = tabs.length > 0;

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] max-w-full overflow-hidden bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Browse" subtitle={`Browse shared files • ${tabs.length}/10 tabs`} />
      <main className="md:ml-72 flex flex-1 flex-col overflow-hidden min-h-0 bg-background pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <header className="hidden md:flex sticky top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
          <div>
            <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Browse Shares</h2>
            <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">{tabs.length}/10 tabs • Browse another user&apos;s shared files — {hasTabs ? `${activeTab?.username ?? tabs[0].username}` : "enter a username above"}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <Link href="/settings?tab=shares#shares" className="hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center" aria-label="Shares settings">
              <span className="material-symbols-outlined">settings</span>
            </Link>
          </div>
        </header>

        {/* Input + tabs bar */}
        <div className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-surface-container-highest/20">
          <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 md:px-10 py-3 flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">search</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && go()}
                  placeholder={tabs.length >= 10 ? "Max 10 tabs reached — close one first" : "Enter username to browse"}
                  disabled={tabs.length >= 10}
                  className="w-full rounded-xl bg-surface-container-low pl-9 pr-4 py-3 min-h-11 font-body text-sm outline-none ghost-border focus:border-primary disabled:opacity-50"
                />
              </div>
              <button
                onClick={go}
                disabled={!username.trim() || tabs.length >= 10}
                className="shrink-0 rounded-xl bg-primary px-6 py-3 min-h-11 font-label text-xs font-bold uppercase tracking-widest text-on-primary disabled:opacity-50 hover:bg-primary-container"
              >
                Browse
              </button>
            </div>
            <BrowseTabs />
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden min-h-0">
          {activeTab ? (
            <BrowseView key={activeTab.id} tab={activeTab} />
          ) : (
            <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto overscroll-contain min-h-0 p-4 sm:p-6 md:p-10">
              <div className="rounded-xl bg-surface-container-lowest p-8 shadow-sm ring-1 ring-outline-variant/15">
                <p className="font-body text-sm text-on-surface-variant">No browse open. Enter a username above or pick from recent.</p>
                <p className="mt-2 font-label text-xs text-outline">Tip: use &quot;Browse&quot; from a search result or profile to jump directly. Tabs load in background and persist.</p>
              </div>
              {recent.length ? (
                <div className="mt-8 rounded-xl bg-surface-container-lowest p-6 ghost-border">
                  <div className="flex items-center justify-between">
                    <h3 className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Recent browses</h3>
                    <button onClick={() => { localStorage.removeItem(RECENT_BROWSE_KEY); setRecent([]); }} className="font-label text-xs text-outline hover:text-error">Clear</button>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {recent.map((u) => (
                      <li key={u}>
                        <button
                          onClick={() => { saveRecent(u); openBrowse(u); }}
                          className="flex w-full items-center justify-between rounded-lg bg-surface-container-low px-4 py-3 hover:bg-surface-container-high text-left"
                        >
                          <span className="font-body text-sm font-medium">{u}</span>
                          <span className="material-symbols-outlined text-[18px] text-outline">chevron_right</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

export default function BrowseSharesPage() {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => { if (state.status !== "connected") router.replace("/"); }, [state.status, router]);
  if (state.status !== "connected") return null;
  return (
    <BrowseProvider>
      <BrowseInner />
    </BrowseProvider>
  );
}
