"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { PageHeader } from "@/components/PageHeader";
import { useBuddies } from "@/lib/buddies";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { buddyMenu } from "@/lib/context-menu/menus";

export default function BuddiesPage() {
  return (
    <RequireAuth>
      <BuddiesInner />
    </RequireAuth>
  );
}

function BuddiesInner() {
  const router = useRouter();
  const { buddies, filter, setFilter, addBuddy, removeBuddy, setTrusted, setNotify, setNote } = useBuddies();
  const [addInput, setAddInput] = useState("");
  const [noteEdit, setNoteEdit] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; username: string } | null>(null);

  const handleAdd = () => {
    if (addInput.trim()) {
      const ok = addBuddy(addInput.trim());
      if (ok) setAddInput("");
    }
  };

  const onlineCount = buddies.filter((b) => b.status === 2).length;

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Buddies" subtitle={`${buddies.length} buddies • ${onlineCount} online`} />
      <main className="md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <PageHeader
          title="Buddies"
          subtitle={`${buddies.length} buddies • ${onlineCount} online • Trusted peers • watch status`}
          settingsHref="/settings?tab=network#network"
        />
          <div className="mx-auto w-full max-w-screen-2xl flex-1 px-4 sm:px-6 py-8 md:px-10 overflow-x-hidden max-w-full">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="max-w-2xl font-body text-sm leading-relaxed text-on-surface-variant">
                Manage your curated circle of trusted peers. Your buddy list is stored locally and watched for status
                changes.
              </p>
            </div>
            <div className="flex gap-2 min-w-0">
              <div className="relative flex-1 sm:flex-none min-w-0">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
                  search
                </span>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter buddies..."
                  className="w-full sm:w-64 min-h-11 rounded-full bg-surface-container-lowest py-2.5 pl-9 pr-4 font-body text-sm placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          </div>

          {/* Add buddy bar */}
          <div className="mb-8 flex gap-2 min-w-0">
            <div className="relative flex-1 min-w-0">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
                person_add
              </span>
              <input
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="Add buddy… (username)"
                className="w-full rounded-xl bg-surface-container-lowest py-3 pl-10 pr-4 font-body text-sm ghost-border focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-11"
              />
            </div>
            <button
              onClick={handleAdd}
              className="shrink-0 rounded-xl bg-primary px-6 py-3 min-h-11 font-label text-xs font-bold uppercase tracking-widest text-on-primary hover:bg-primary-container"
            >
              Add
            </button>
          </div>

          {buddies.length === 0 ? (
            <div className="rounded-xl bg-surface p-10 text-center ghost-border">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/20">
                <span className="material-symbols-outlined text-primary">group</span>
              </div>
              <h2 className="font-headline text-lg font-semibold">No buddies yet</h2>
              <p className="mx-auto mt-2 max-w-md font-body text-sm text-on-surface-variant">
                Add usernames you trust. We&apos;ll watch their status and let you message or browse them quickly.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {buddies.map((b) => {
                const isOnline = b.status === 2;
                const isAway = b.status === 1;
                return (
                  <div
                    key={b.username}
                    onDoubleClick={() => {
                      const note = prompt(`Note for ${b.username}`, b.note ?? "");
                      if (note !== null) setNote(b.username, note);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenuAnchor({ x: e.clientX, y: e.clientY, username: b.username });
                    }}
                    className="group relative flex flex-col rounded-xl bg-surface-container-lowest p-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)] ring-1 ring-outline-variant/15 transition-all hover:-translate-y-1 hover:shadow-[0_10px_40px_rgba(0,0,0,0.06)]"
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <div className="relative">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-container text-on-primary-container font-headline font-bold">
                          {b.username.slice(0, 2).toUpperCase()}
                        </div>
                        <span
                          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface-container-lowest ${isOnline ? "bg-green-500" : isAway ? "bg-yellow-500" : "bg-outline"}`}
                          title={isOnline ? "Online" : isAway ? "Away" : "Offline"}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setTrusted(b.username, !b.trusted)}
                          className={`p-1.5 rounded-full ${b.trusted ? "bg-tertiary-container text-on-tertiary-container" : "bg-surface-container-low text-outline hover:text-tertiary"}`}
                          title={b.trusted ? "Trusted" : "Not trusted"}
                        >
                          <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            star
                          </span>
                        </button>
                        <button
                          onClick={() => setNotify(b.username, !b.notify)}
                          className={`p-1.5 rounded-full ${b.notify ? "bg-primary-fixed text-on-primary-fixed" : "bg-surface-container-low text-outline"}`}
                          title={b.notify ? "Notify on status change" : "Muted"}
                        >
                          <span className="material-symbols-outlined text-[16px]">notifications</span>
                        </button>
                      </div>
                    </div>

                    <h3 className="truncate font-headline text-base font-semibold text-on-surface">{b.username}</h3>
                    <p className="mt-1 flex items-center gap-1 font-label text-xs text-on-surface-variant">
                      <span className="material-symbols-outlined text-[14px]">{isOnline ? "public" : "schedule"}</span>
                      {b.country ? `${(() => { try { const cc = b.country!.toUpperCase(); if (cc.length !== 2) return `${cc} • `; const A = 0x1F1E6; return `${String.fromCodePoint(A + cc.charCodeAt(0) - 65, A + cc.charCodeAt(1) - 65)} ${cc} • `; } catch { return `${b.country} • `; } })()}` : ""}
                      {isOnline ? "Online" : isAway ? "Away" : b.lastSeen ? `Last seen ${b.lastSeen}` : "Offline"}
                      {b.privileged ? " • ★ Privileged" : ""}
                    </p>
                    {b.note ? (
                      <p className="mt-2 line-clamp-2 rounded-lg bg-surface-container-low px-3 py-2 font-body text-xs text-on-surface-variant">
                        {b.note}
                      </p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg bg-surface-container-low p-2">
                        <div className="font-bold text-on-surface text-sm">{b.files ?? "—"}</div>
                        <div className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant">Files</div>
                      </div>
                      <div className="rounded-lg bg-surface-container-low p-2">
                        <div className="font-bold text-on-surface text-sm">
                          {b.avgspeed ? `${Math.round(b.avgspeed / 1000)} kB/s` : "—"}
                        </div>
                        <div className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant">Speed</div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => router.push(`/private-chat?user=${encodeURIComponent(b.username)}`)}
                        className="flex items-center justify-center gap-1 rounded-lg bg-primary-fixed/30 py-2 font-label text-xs font-semibold text-on-primary-fixed hover:bg-primary-container hover:text-on-primary-container"
                      >
                        <span className="material-symbols-outlined text-sm">chat_bubble</span> Chat
                      </button>
                      <button
                        onClick={() => router.push(`/profile/${encodeURIComponent(b.username)}`)}
                        className="flex items-center justify-center gap-1 rounded-lg bg-surface-container-high py-2 font-label text-xs font-semibold text-on-surface hover:bg-surface-variant"
                      >
                        <span className="material-symbols-outlined text-sm">person</span> Profile
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => router.push(`/browse/${encodeURIComponent(b.username)}`)}
                        className="rounded-lg bg-surface-container-low py-2 font-label text-xs font-semibold text-primary hover:bg-surface-container"
                      >
                        Browse
                      </button>
                      <button
                        onClick={() => removeBuddy(b.username)}
                        className="rounded-lg py-2 font-label text-xs font-semibold text-error hover:bg-error-container/50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <BottomNav />
      {menuAnchor ? (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={buddyMenu(menuAnchor.username, {
            onNote: () => {
              const cur = buddies.find((x) => x.username === menuAnchor.username);
              const note = prompt(`Note for ${menuAnchor.username}`, cur?.note ?? "");
              if (note !== null) setNote(menuAnchor.username, note);
            },
            onRemove: () => removeBuddy(menuAnchor.username),
          })}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
    </div>
  );
}
