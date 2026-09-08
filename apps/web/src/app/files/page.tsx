"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { FileExplorer, type SharePermission } from "@/components/files/FileExplorer";
import { PageHeader } from "@/components/PageHeader";
import { RequireAuth } from "@/components/RequireAuth";
import { isDemo } from "@/lib/demo";
import { getLocal, setLocal } from "@/lib/storage";
import { useConfig } from "@/lib/config/provider";
import { useSaveSection } from "@/lib/config/save";
import { useSession } from "@/lib/session";

export default function FilesPage() {
  return (
    <RequireAuth>
      <FilesInner />
    </RequireAuth>
  );
}

function normalizeFolderPath(p: string): string {
  let s = p.trim().replace(/\\/g, "/");
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function getBasename(path: string): string {
  const parts = normalizeFolderPath(path).split("/");
  return parts[parts.length - 1] || "Shared";
}

// Mirrors SharesSection getNormalizedVirtualName — dedups virtual name against existing drafts
function getNormalizedVirtualName(requested: string, existing: [string, string][]): string {
  let virtual = requested.trim().replace(/\//g, "_").replace(/\\/g, "_").trim().replace(/^[" ]+|[" ]+$/g, "");
  if (!virtual) virtual = "Shared";
  if (virtual === "." || virtual === "..") virtual = virtual.replace(/\./g, "_");
  if (!virtual) virtual = "Shared";
  const names = new Set(existing.map(([v]) => v));
  let candidate = virtual;
  let counter = 1;
  while (names.has(candidate)) {
    candidate = `${virtual}${counter}`;
    counter += 1;
  }
  return candidate;
}

function FilesInner() {
  const router = useRouter();
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharePerm, setSharePerm] = useState<SharePermission>(() => {
    const v = getLocal("nicotineHub.files.sharePermission");
    return v === "buddy" || v === "trusted" ? v : "public";
  });
  const { settings, setOption } = useConfig();
  const saveSection = useSaveSection();
  const { state: sessionState, send } = useSession();

  const changeSharePerm = (p: SharePermission) => {
    setSharePerm(p);
    setLocal("nicotineHub.files.sharePermission", p);
  };

  const notify = (title: string, body: string) => {
    try {
      window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title, body } }));
    } catch {}
  };

  // Auto-save on pick: normalize → dedup → setOption(transfers.*) → saveSection → shares:rescan
  const handleSelect = async (p: string) => {
    if (saving) return;
    const norm = normalizeFolderPath(p);
    if (!norm || norm === "/") {
      notify("Cannot share", "Pick a subdirectory — the filesystem root cannot be shared.");
      return;
    }
    if (isDemo) {
      setLastSelected(p);
      notify("Demo", "Sharing is disabled in demo — connect to a bridge to save shares.");
      return;
    }
    const t = settings.transfers;
    const normLower = norm.toLowerCase();
    const all: [string, string][] = [...t.shared, ...t.buddyshared, ...t.trustedshared];
    if (all.some(([, real]) => normalizeFolderPath(real).toLowerCase() === normLower)) {
      setLastSelected(norm);
      notify("Already shared", `${norm} is already in your shares.`);
      return;
    }
    const key = sharePerm === "buddy" ? "buddyshared" : sharePerm === "trusted" ? "trustedshared" : "shared";
    const permLabel = sharePerm === "buddy" ? "Buddies" : sharePerm === "trusted" ? "Trusted" : "Public";
    const virtual = getNormalizedVirtualName(getBasename(norm), all);
    const nextList: [string, string][] = [...t[key], [virtual, norm]];
    // Pass the post-append draft explicitly — settings closure is pre-setOption until re-render
    const nextDraft = { ...settings, transfers: { ...t, [key]: nextList } };
    setOption("transfers", key, nextList);
    setLastSelected(norm);
    if (sessionState.status !== "connected") {
      try { await saveSection("transfers", () => nextDraft); } catch {}
      notify("Saved locally", `"${virtual}" saved (${permLabel}) — bridge offline, syncs on connect.`);
      return;
    }
    setSaving(true);
    try {
      await saveSection("transfers", () => nextDraft);
      notify("Share saved", `"${virtual}" → ${norm} (${permLabel}) — rescanning…`);
      try {
        send({ type: "shares:rescan" });
      } catch (e) {
        notify("Rescan failed", e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      notify("Save failed", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Files" subtitle="Browse /data on the bridge" />

      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <PageHeader
          title="Files"
          subtitle="Browser-rendered Explorer for the container's /data. Pick a subdirectory to share."
          settingsHref="/settings?tab=shares#shares"
          actions={
            lastSelected ? (
              <div className="hidden md:flex items-center gap-2 rounded-xl bg-primary-container px-3 py-2 text-xs text-on-primary-container">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span className="font-mono">{lastSelected}</span>
              </div>
            ) : undefined
          }
        />

        <div className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pb-6 pt-4 md:px-8 md:pt-2 md:pb-8">
          {isDemo && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-amber-700 dark:text-amber-300">info</span>
                <div>
                  <div className="font-label text-sm font-semibold text-amber-900 dark:text-amber-200">Demo preview</div>
                  <div className="mt-1 font-body text-xs leading-relaxed text-amber-800 dark:text-amber-200/80">
                    Showing fake <span className="font-mono">/data</span> on Vercel (4 folders + 2 files at root, nested Music/Jazz/Blue Note etc). Click folders to navigate — all mocked, no bridge. On Docker you see your real mounted <span className="font-mono">/data</span> (e.g. <span className="font-mono">/home/user/m/data:/data</span>).
                    <span className="mt-1 block font-medium">🎧 Try it: open <span className="font-mono">/data/Music/Demo</span> — 2 playable Vorbis samples (<span className="font-mono">01. DJ Satomi - Waves.ogg</span> &amp; <span className="font-mono">12. Zombie Nation - Kernkraft 400 …ogg</span>, ~80kbps, ~2 MB) with working Play / Analyze / Mediainfo / Spectrum / Scrape (Discogs mock — not saved). No FLACs are committed — small Vorbis demos only.</span>
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
              onSelect={handleSelect}
              sharePermission={sharePerm}
              onSharePermissionChange={changeSharePerm}
            />
            {lastSelected && (
              <div className="mt-3 flex flex-col gap-2 rounded-xl bg-surface-container-high px-4 py-3 dark:bg-surface-variant/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-label text-xs font-semibold text-on-surface dark:text-inverse-on-surface">Selected{saving ? " — saving…" : ""}</div>
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
                    This is the browser replacement for opening <span className="font-mono">/data</span> in your system file manager. The container has no display server; this web UI is the Explorer. You start at <span className="font-mono">/data</span> but can navigate up to <span className="font-mono">/</span> (host root) — traversal outside <span className="font-mono">/</span> is blocked and symlink escapes are rejected. If <span className="font-mono">BRIDGE_TOKEN</span> is set, the bridge requires it for <span className="font-mono">/api/files</span> (same gate as <span className="font-mono">/ws</span>, <span className="font-mono">/logs</span>, <span className="font-mono">/diagnostics</span>, <span className="font-mono">/plugins</span>).
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
