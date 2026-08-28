"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";

export default function ProfileLookup() {
  const router = useRouter();
  const { state } = useSession();
  const [username, setUsername] = useState("");

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
      <main className="relative ml-72 flex min-h-screen flex-1 flex-col items-center justify-center px-6">
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
        </div>
      </main>
    </div>
  );
}
