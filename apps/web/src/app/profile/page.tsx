"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";

const RECENT_KEY = "nicotine.recentProfiles";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function ProfileLookup() {
  const router = useRouter();
  const { state } = useSession();
  const [username, setUsername] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  if (state.status !== "connected") {
    return null;
  }

  const go = () => {
    const u = username.trim();
    if (u) router.push(`/profile/${encodeURIComponent(u)}`);
  };

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Profiles" />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col items-center justify-center px-6 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="w-full max-w-md">
          <h2 className="font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">
            User Profiles
          </h2>
          <p className="font-body text-sm text-on-surface-variant mt-2 mb-6">
            Look up any Soulseek user to see their shared files, speed, description, and interests.
          </p>
          <div className="flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="Enter a username"
              className="flex-1 rounded-xl bg-surface-container-low px-4 py-3 font-body text-sm text-on-surface outline-none ghost-border focus:border-primary dark:bg-surface-container-high"
            />
            <button
              onClick={go}
              disabled={!username.trim()}
              className="rounded-xl bg-primary-container px-5 py-3 font-label text-xs font-semibold uppercase tracking-widest text-on-primary-container transition-colors hover:bg-primary hover:text-on-primary disabled:opacity-50"
            >
              View
            </button>
          </div>
          <p className="font-label text-xs text-outline mt-4">
            Tip: open a search result and choose “View Profile” to jump here directly.
          </p>

          {recent.length ? (
            <div className="mt-8">
              <h3 className="font-label text-xs uppercase tracking-widest text-on-surface-variant mb-3">
                Recently Viewed
              </h3>
              <ul className="flex flex-col gap-2">
                {recent.map((u) => (
                  <li key={u}>
                    <Link
                      href={`/profile/${encodeURIComponent(u)}`}
                      className="flex items-center gap-3 rounded-xl bg-surface-container-low dark:bg-surface-container-high px-4 py-3 ghost-border hover:bg-surface-container-high dark:hover:bg-surface-container transition-colors"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container font-headline text-xs font-bold text-on-primary">
                        {u.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="font-label text-sm text-on-surface">{u}</span>
                      <span className="material-symbols-outlined ml-auto text-outline text-[18px]">chevron_right</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => {
                  localStorage.removeItem(RECENT_KEY);
                  setRecent([]);
                }}
                className="mt-3 font-label text-xs text-outline hover:text-on-surface-variant underline"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
