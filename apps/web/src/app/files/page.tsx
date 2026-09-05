"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { FileExplorer } from "@/components/files/FileExplorer";
import { isDemo } from "@/lib/demo";

export default function FilesPage() {
  const router = useRouter();
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Files" subtitle="Browse /data on the bridge" />

      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <header className="relative z-10 hidden w-full items-center justify-between px-4 py-3 md:flex md:px-8 md:py-6">
          <div>
            <h1 className="font-headline text-2xl font-bold tracking-tight text-on-surface dark:text-inverse-primary md:text-3xl">Files</h1>
            <p className="font-body text-sm text-on-surface-variant dark:text-outline">
              Browser-rendered Explorer for the container&apos;s <span className="font-mono">/data</span>. Pick a subdirectory to share.
            </p>
          </div>
          {lastSelected && (
            <div className="flex items-center gap-2 rounded-xl bg-primary-container px-3 py-2 text-xs text-on-primary-container">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              <span className="font-mono">{lastSelected}</span>
            </div>
          )}
        </header>

        <div className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pb-6 pt-4 md:px-8 md:pt-2 md:pb-8">
          {isDemo && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-amber-700 dark:text-amber-300">info</span>
                <div>
                  <div className="font-label text-sm font-semibold text-amber-900 dark:text-amber-200">Demo preview</div>
                  <div className="mt-1 font-body text-xs leading-relaxed text-amber-800 dark:text-amber-200/80">
                    Showing fake <span className="font-mono">/data</span> on Vercel (4 folders + 2 files at root, nested Music/Jazz/Blue Note etc). Click folders to navigate — all mocked, no bridge. On Docker you see your real mounted <span className="font-mono">/data</span> (e.g. <span className="font-mono">/home/user/m/data:/data</span>).
                    <span className="mt-1 block font-medium">🎧 Try it: open <span className="font-mono">/data/Music/Demo</span> — 2 playable Vorbis samples (<span className="font-mono">01. DJ Satomi - Waves.ogg</span> &amp; <span className="font-mono">12. Zombie Nation - Kernkraft 400 …ogg</span>, ~80kbps, ~2 MB) with working Play / Analyze / Mediainfo / Spectrum. No FLACs are committed — small Vorbis demos only.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-surface-container-lowest p-3 shadow-sm dark:bg-surface-container-high md:p-4">
            <FileExplorer
              initialPath="/data"
              showFiles
              selectable="directories"
              confirmLabel="Use this folder"
              title="Explorer — /data"
              onSelect={(p) => {
                setLastSelected(p);
                // For standalone page we just store and offer to go to shares
                // Also dispatch toast via custom event used elsewhere
                try {
                  window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Selected", body: p } }));
                } catch {}
              }}
            />
            {lastSelected && (
              <div className="mt-3 flex flex-col gap-2 rounded-xl bg-surface-container-high px-4 py-3 dark:bg-surface-variant/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-label text-xs font-semibold text-on-surface dark:text-inverse-on-surface">Selected</div>
                  <div className="truncate font-mono text-sm text-on-surface-variant dark:text-outline">{lastSelected}</div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/settings?tab=shares#shares")}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 font-label text-xs font-semibold uppercase tracking-widest text-on-primary hover:bg-primary/90"
                >
                  <span className="material-symbols-outlined text-[16px]">settings</span> Go to Shares
                </button>
              </div>
            )}
            <div className="relative mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="files-info"
                aria-label="About Explorer"
                aria-describedby="files-info-tooltip"
                aria-expanded={infoOpen}
                onClick={() => setInfoOpen((v) => !v)}
                onKeyDown={(e) => { if (e.key === "Escape") setInfoOpen(false); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs font-medium text-on-surface-variant hover:bg-surface-container-highest dark:bg-surface-variant dark:text-outline"
              >
                <span className="material-symbols-outlined text-[16px]">info</span> Info
              </button>
              {infoOpen && (
                <div
                  id="files-info-tooltip"
                  data-testid="files-info-tooltip"
                  role="tooltip"
                  className="absolute bottom-full left-0 z-[70] mb-2 max-w-sm rounded-xl bg-surface-container-highest p-3 shadow-lg ghost-border dark:bg-surface-variant"
                >
                  <div className="font-body text-xs leading-relaxed text-on-surface-variant dark:text-outline">
                    This is the browser replacement for <span className="font-mono">nautilus /data</span> / <span className="font-mono">explorer /data</span> / <span className="font-mono">xdg-open /data</span>. The container has no display server; this web UI is the Explorer. You start at <span className="font-mono">/data</span> but can navigate up to <span className="font-mono">/</span> (host root) — traversal outside <span className="font-mono">/</span> is blocked and symlink escapes are rejected. If <span className="font-mono">BRIDGE_TOKEN</span> is set, the bridge requires it for <span className="font-mono">/api/files</span> (same gate as <span className="font-mono">/ws</span>, <span className="font-mono">/logs</span>, <span className="font-mono">/diagnostics</span>, <span className="font-mono">/plugins</span>).
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
