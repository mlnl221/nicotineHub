"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import Link from "next/link";

const RECENT_BROWSE_KEY = "nicotine.recentBrowse";

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_BROWSE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function saveRecent(username: string) {
  try {
    const cur = loadRecent();
    const next = [username, ...cur.filter((x) => x.toLowerCase() !== username.toLowerCase())].slice(0, 20);
    localStorage.setItem(RECENT_BROWSE_KEY, JSON.stringify(next));
  } catch {}
}

export default function BrowseSharesPage() {
  const { state } = useSession();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  if (state.status !== "connected") return null;

  const go = () => {
    const u = username.trim();
    if (!u) return;
    saveRecent(u);
    router.push(`/browse/${encodeURIComponent(u)}`);
  };

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Browse" subtitle="Browse shared files" />
      <main className="md:ml-72 flex min-h-screen flex-1 flex-col overflow-hidden bg-background pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <header className="hidden md:flex sticky top-0 z-10 bg-surface-container-lowest/80 backdrop-blur-xl px-10 py-6">
          <div className="mx-auto flex max-w-screen-2xl items-end justify-between">
            <div>
              <h2 className="font-headline text-3xl font-bold tracking-tight text-on-surface">Browse Shares</h2>
              <p className="mt-1 font-body text-sm text-on-surface-variant">Browse another user&apos;s shared files</p>
            </div>
          </div>
        </header>
        <div className="mx-auto w-full max-w-xl flex-1 p-6 md:p-10">
          <div className="rounded-xl bg-surface-container-lowest p-8 shadow-sm ring-1 ring-outline-variant/15">
            <label className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Username</label>
            <div className="mt-3 flex gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder="Enter username to browse"
                className="flex-1 rounded-xl bg-surface-container-low px-4 py-3 font-body text-sm outline-none ghost-border focus:border-primary"
              />
              <button
                onClick={go}
                disabled={!username.trim()}
                className="rounded-xl bg-primary px-6 py-3 font-label text-xs font-bold uppercase tracking-widest text-on-primary disabled:opacity-50 hover:bg-primary-container"
              >
                Browse
              </button>
            </div>
            <p className="mt-3 font-body text-xs text-outline">
              Tip: use &quot;Browse&quot; from a search result or profile to jump directly.
            </p>
          </div>

          {recent.length ? (
            <div className="mt-8 rounded-xl bg-surface-container-lowest p-6 ghost-border">
              <div className="flex items-center justify-between">
                <h3 className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Recent browses</h3>
                <button
                  onClick={() => {
                    localStorage.removeItem(RECENT_BROWSE_KEY);
                    setRecent([]);
                  }}
                  className="font-label text-xs text-outline hover:text-error"
                >
                  Clear
                </button>
              </div>
              <ul className="mt-4 space-y-2">
                {recent.map((u) => (
                  <li key={u}>
                    <Link
                      href={`/browse/${encodeURIComponent(u)}`}
                      onClick={() => saveRecent(u)}
                      className="flex items-center justify-between rounded-lg bg-surface-container-low px-4 py-3 hover:bg-surface-container-high"
                    >
                      <span className="font-body text-sm font-medium">{u}</span>
                      <span className="material-symbols-outlined text-[18px] text-outline">chevron_right</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
