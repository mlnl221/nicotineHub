"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { useUserInfo } from "@/lib/userinfo";
import { humanSpeed } from "@/lib/format";

function profilePicSrc(pic: string): string {
  const isSvg = pic.trimStart().startsWith("<svg");
  const mime = isSvg ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${pic}`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-low dark:bg-surface-container-high rounded-xl p-5 flex flex-col gap-2 ghost-border">
      <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
        {label}
      </span>
      <span className="font-headline text-2xl font-semibold text-on-surface dark:text-on-surface">
        {value}
      </span>
    </div>
  );
}

function ProfileInner({ username }: { username: string }) {
  const router = useRouter();
  const { profile, loading, error } = useUserInfo(username);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const statusLabel =
    profile.status?.status === 2 ? "Online" : profile.status?.status === 1 ? "Away" : "Offline";

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <main className="relative ml-72 flex min-h-screen flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-40 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-10 py-8 flex flex-col gap-4 border-b border-transparent shadow-sm shadow-on-surface/5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {profile.info?.pic ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profilePicSrc(profile.info.pic)}
                  alt={`${username} profile picture`}
                  className="h-16 w-16 rounded-full object-cover bg-surface-container-highest"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container">
                  <span className="font-headline text-xl font-bold text-on-primary">
                    {username.slice(0, 1).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <h2 className="font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight truncate">
                  {username}
                </h2>
                <div className="mt-1 flex items-center gap-2 font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
                  <span>{statusLabel}</span>
                  {profile.status?.privileged ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-container px-2 py-0.5 text-tertiary-on-container dark:bg-tertiary-fixed/30 dark:text-tertiary-fixed">
                      <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        star
                      </span>
                      Privileged
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => flash("Browse shares coming soon")}
                className="rounded-xl bg-primary-container px-4 py-2.5 font-label text-xs font-semibold uppercase tracking-widest text-on-primary-container transition-colors hover:bg-primary hover:text-on-primary"
              >
                Browse Files
              </button>
              <button
                onClick={() => flash("Private chat coming soon")}
                className="rounded-xl bg-surface-container-low px-4 py-2.5 font-label text-xs font-semibold uppercase tracking-widest text-on-surface transition-colors hover:bg-surface-container-high dark:bg-surface-container-high dark:text-on-surface"
              >
                Send Message
              </button>
            </div>
          </div>
        </header>

        <div className="p-10 space-y-8 max-w-screen-2xl mx-auto w-full">
          {error ? (
            <div className="bg-tertiary-fixed/30 dark:bg-tertiary-container/20 rounded-xl p-5 flex gap-3 items-start">
              <span className="material-symbols-outlined text-tertiary text-xl">info</span>
              <p className="font-body text-sm text-on-tertiary-container dark:text-tertiary-fixed">
                {error} The user may be offline or unreachable.
              </p>
            </div>
          ) : null}

          {loading && !error ? (
            <div className="flex items-center gap-3 font-body text-on-surface-variant">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              Loading profile…
            </div>
          ) : null}

          {profile.stats ? (
            <section className="grid grid-cols-2 gap-4">
              <StatCard label="Files Shared" value={profile.stats.files.toLocaleString()} />
              <StatCard label="Shared Folders" value={profile.stats.dirs.toLocaleString()} />
              <StatCard
                label="Avg Speed"
                value={profile.stats.avgspeed ? humanSpeed(profile.stats.avgspeed) : "—"}
              />
              <StatCard label="Upload Slots" value={profile.info?.slotsavail ? "Open" : "Full"} />
            </section>
          ) : null}

          {profile.info?.descr ? (
            <section className="bg-surface dark:bg-surface-container-low rounded-xl p-6 ghost-border">
              <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline mb-3">
                Description
              </h3>
              <p className="font-body text-sm text-on-surface dark:text-on-surface whitespace-pre-wrap break-words">
                {profile.info.descr}
              </p>
            </section>
          ) : null}

          {profile.interests ? (
            <section className="bg-surface dark:bg-surface-container-low rounded-xl p-6 ghost-border">
              <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline mb-3">
                Interests
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="font-label text-xs text-tertiary mb-2">Likes</p>
                  {profile.interests.likes.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {profile.interests.likes.map((like) => (
                        <li
                          key={like}
                          className="rounded-full bg-primary-container/30 px-3 py-1 font-label text-xs text-primary dark:text-primary-fixed"
                        >
                          {like}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="font-body text-sm text-on-surface-variant">None listed</p>
                  )}
                </div>
                <div>
                  <p className="font-label text-xs text-outline mb-2">Dislikes</p>
                  {profile.interests.hates.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {profile.interests.hates.map((hate) => (
                        <li
                          key={hate}
                          className="rounded-full bg-surface-container-high px-3 py-1 font-label text-xs text-on-surface-variant"
                        >
                          {hate}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="font-body text-sm text-on-surface-variant">None listed</p>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </main>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-inverse-surface px-4 py-2 font-label text-xs text-inverse-on-surface shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

const RECENT_KEY = "nicotine.recentProfiles";

function saveRecent(username: string) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const filtered = [username, ...list.filter((x: string) => x !== username)].slice(0, 20);
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered));
  } catch {}
}

export default function ProfilePage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "");
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  useEffect(() => {
    if (username) saveRecent(username);
  }, [username]);

  if (state.status !== "connected" || !username) return null;
  return <ProfileInner username={username} />;
}
