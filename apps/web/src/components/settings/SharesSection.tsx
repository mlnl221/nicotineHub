"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import type { SharedFolder } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, SelectControl, TextFieldControl } from "@/components/settings/controls";
import { useSession } from "@/lib/session";

const FileExplorer = dynamic(() => import("@/components/files/FileExplorer").then((m) => m.FileExplorer), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-xl bg-surface-container-high" />,
});

// Deterministic hour label — fixed locale + UTC so SSR == client. Previous used
// `toLocaleTimeString(undefined, {hour:"numeric"})` which is locale/timezone non-deterministic → hydration mismatch.
// Matches nicotine-plus `datetime.now().replace(hour=hour).strftime("%X")` stripping seconds, but normalized to en-US.
function hourLabel(hour: number) {
  const d = new Date(Date.UTC(2020, 0, 1, hour, 0, 0, 0));
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });
}

function visibilityValue(buddy: boolean, trusted: boolean): string {
  if (buddy && trusted) return "both";
  if (buddy) return "buddy";
  if (trusted) return "trusted";
  return "none";
}

// Mirrors pynicotine/shares.py:1013 get_normalized_virtual_name + convert_shares slash handling
function getNormalizedVirtualName(requested: string, existing: SharedFolder[]): string {
  let virtual = requested.trim();
  if (!virtual) virtual = "Shared";
  virtual = virtual.replace(/\//g, "_").replace(/\\/g, "_").trim().replace(/^[" ]+|[" ]+$/g, "");
  if (virtual === "." || virtual === "..") virtual = virtual.replace(/\./g, "_");
  if (!virtual) virtual = "Shared";
  const existingNames = new Set(existing.map(([v]) => v));
  let candidate = virtual;
  let counter = 1;
  while (existingNames.has(candidate)) {
    candidate = `${virtual}${counter}`;
    counter += 1;
  }
  return candidate;
}

function normalizeFolderPath(p: string): string {
  // Mirrors shares.py os.path.normpath + slash handling; browser has no OS norm, keep forward slashes trimmed
  let s = p.trim().replace(/\\/g, "/");
  // collapse // and strip trailing /
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function getBasename(path: string): string {
  const n = normalizeFolderPath(path);
  const parts = n.split("/");
  const last = parts[parts.length - 1] || "Shared";
  // drive letter handling (C:) → use last non-empty
  return last || "Shared";
}

type Permission = "public" | "buddy" | "trusted";
const PERM_LABEL: Record<Permission, string> = { public: "Public", buddy: "Buddies", trusted: "Trusted" };
const PERM_TO_KEY: Record<Permission, "shared" | "buddyshared" | "trustedshared"> = {
  public: "shared",
  buddy: "buddyshared",
  trusted: "trustedshared",
};

export function SharesSection() {
  const { settings, setOption } = useConfig();
  const t = settings.transfers;
  const { send, subscribe, state } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [lastCounts, setLastCounts] = useState<{ dirs: number; files: number } | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [lastRescanAt, setLastRescanAt] = useState<number | null>(null);
  const [unavailableShares, setUnavailableShares] = useState<[string, string][] | null>(null);
  const [secretHits, setSecretHits] = useState<string[] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{ counts: { dirs: number; files: number }; sample: string[]; excludedCount: number; secretHits: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    return subscribe((msg) => {
      if ((msg as { type: string }).type === "shares:rescanned") {
        const m = msg as unknown as { counts?: { dirs: number; files: number }; unavailable?: [string, string][]; secretHits?: string[] };
        setRescanning(false);
        if (m.counts) setLastCounts(m.counts);
        setLastRescanAt(Date.now());
        setRescanError(null);
        setUnavailableShares(m.unavailable?.length ? m.unavailable : null);
        setSecretHits(m.secretHits?.length ? m.secretHits : null);
      } else if ((msg as { type: string }).type === "shares:preview:result") {
        const m = msg as unknown as { counts?: { dirs: number; files: number }; sample?: string[]; excludedCount?: number; secretHits?: string[] };
        setPreviewLoading(false);
        if (m.counts && Array.isArray(m.sample)) {
          setPreviewData({ counts: m.counts, sample: m.sample, excludedCount: m.excludedCount ?? 0, secretHits: m.secretHits ?? [] });
          setPreviewError(null);
        }
      } else if ((msg as { type: string }).type === "error" && (rescanning || previewLoading)) {
        const m = msg as unknown as { error?: string };
        if (rescanning) { setRescanning(false); setRescanError(m.error || "Rescan failed"); }
        if (previewLoading) { setPreviewLoading(false); setPreviewError(m.error || "Preview failed"); }
      }
    });
  }, [subscribe, rescanning, previewLoading]);

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ virtualName: string; folderPath: string; permission: Permission } | null>(null);
  const [dialogVirtual, setDialogVirtual] = useState("");
  const [dialogPath, setDialogPath] = useState("");
  const [dialogPerm, setDialogPerm] = useState<Permission>("public");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  function dataPathFromExplorer(p: string): string {
    const n = normalizeFolderPath(p) || "/";
    if (n === "/") return "/data";
    if (n === "/data" || n.startsWith("/data/")) return n;
    return "/data" + (n.startsWith("/") ? n : `/${n}`);
  }
  function basenameOfExplorerPath(p: string): string {
    if (!p || p === "/") return "Shared";
    const parts = p.split("/").filter(Boolean);
    return parts[parts.length - 1] || "Shared";
  }

  const allShares: Array<{ virtualName: string; folderPath: string; permission: Permission }> = [
    ...t.shared.map(([v, p]) => ({ virtualName: v, folderPath: p, permission: "public" as const })),
    ...t.buddyshared.map(([v, p]) => ({ virtualName: v, folderPath: p, permission: "buddy" as const })),
    ...t.trustedshared.map(([v, p]) => ({ virtualName: v, folderPath: p, permission: "trusted" as const })),
  ].sort((a, b) => a.virtualName.localeCompare(b.virtualName));
  const unavailablePathSet = new Set((unavailableShares ?? []).map(([, p]) => normalizeFolderPath(p).toLowerCase()));

  function removeShareByPathOrName(folderPath: string, virtualName: string) {
    const norm = normalizeFolderPath(folderPath);
    const normLower = norm.toLowerCase();
    const targetVirtual = virtualName;
    // Build filtered arrays removing any entry matching path (case-insensitive normalized) or virtual name exact
    const filterFn = ([v, p]: SharedFolder) => {
      const pn = normalizeFolderPath(p).toLowerCase();
      if (pn === normLower) return false;
      if (v === targetVirtual) return false;
      return true;
    };
    const nextShared = t.shared.filter(filterFn);
    const nextBuddy = t.buddyshared.filter(filterFn);
    const nextTrusted = t.trustedshared.filter(filterFn);
    // Only call setOption if something changed (to avoid extra renders)
    if (nextShared.length !== t.shared.length) setOption("transfers", "shared", nextShared);
    if (nextBuddy.length !== t.buddyshared.length) setOption("transfers", "buddyshared", nextBuddy);
    if (nextTrusted.length !== t.trustedshared.length) setOption("transfers", "trustedshared", nextTrusted);
    return { nextShared, nextBuddy, nextTrusted };
  }

  function addShareInternal(folderPath: string, permission: Permission, virtualName?: string) {
    const normPath = normalizeFolderPath(folderPath);
    if (!normPath) return null;
    // Remove prior share with same path (all groups) — mirrors shares.py:1050 core.shares.remove_share
    const normLower = normPath.toLowerCase();
    let s = t.shared.filter(([, p]) => normalizeFolderPath(p).toLowerCase() !== normLower);
    let b = t.buddyshared.filter(([, p]) => normalizeFolderPath(p).toLowerCase() !== normLower);
    let tr = t.trustedshared.filter(([, p]) => normalizeFolderPath(p).toLowerCase() !== normLower);
    // Collect remaining for dedup check
    const remaining: SharedFolder[] = [...s, ...b, ...tr];
    const base = virtualName?.trim() || getBasename(normPath);
    const normalizedVirtual = getNormalizedVirtualName(base, remaining);
    const entry: SharedFolder = [normalizedVirtual, normPath];
    if (permission === "public") s = [...s, entry];
    else if (permission === "buddy") b = [...b, entry];
    else tr = [...tr, entry];

    // Apply — need to compute which key changed
    // Use sequential setOption calls (provider merges shallow)
    if (permission === "public") {
      if (s.length !== t.shared.length || !t.shared.find(([v, p]) => v === normalizedVirtual && p === normPath)) {
        setOption("transfers", "shared", s);
      }
      // also need to persist removals from other groups if prior duplicate existed there
      if (b.length !== t.buddyshared.length) setOption("transfers", "buddyshared", b);
      if (tr.length !== t.trustedshared.length) setOption("transfers", "trustedshared", tr);
    } else if (permission === "buddy") {
      if (s.length !== t.shared.length) setOption("transfers", "shared", s);
      setOption("transfers", "buddyshared", b);
      if (tr.length !== t.trustedshared.length) setOption("transfers", "trustedshared", tr);
    } else {
      if (s.length !== t.shared.length) setOption("transfers", "shared", s);
      if (b.length !== t.buddyshared.length) setOption("transfers", "buddyshared", b);
      setOption("transfers", "trustedshared", tr);
    }
    return normalizedVirtual;
  }

  // Plus button handler — copies nicotine-plus SharesPage.on_add_shared_folder + on_add_shared_folder_selected
  // pynicotine/gtkgui/dialogs/preferences.py:936-955 FolderChooser(select_multiple=True) → core.shares.add_share(folder_path, share_groups)
  async function handlePlusClick() {
    // Prefer File System Access API (browser equivalent of FolderChooser) — requires user gesture, secure context
    const w = window as unknown as { showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle> };
    if (typeof w.showDirectoryPicker === "function") {
      try {
        const handle = await w.showDirectoryPicker({ mode: "read" });
        const name: string = (handle as unknown as { name: string }).name || "Shared";
        // Browser cannot expose absolute OS path; use handle.name as both virtual name base and folderPath placeholder.
        // Store as "/<name>"-ish relative so bridge FS scanner note still applies; user can edit to absolute via Edit dialog.
        // This matches the browser limitation callout and keeps parity with nicotine-plus basename fallback.
        const folderPath = name.includes("/") || name.includes("\\") ? name : name;
        // For showDirectoryPicker we store the name as folderPath; edit dialog can promote to absolute later.
        // Nicotine-plus would store absolute like /home/user/Music; browser stores virtual-relative and warns.
        const added = addShareInternal(folderPath, "public", name);
        if (!added) setDialogError("Could not add folder.");
        return;
      } catch (e: unknown) {
        const err = e as { name?: string };
        if (err?.name === "AbortError") return; // user cancelled
        // fall through to file input fallback
      }
    }
    // Fallback 1: hidden <input webkitdirectory> — derives folder name from webkitRelativePath
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
      return;
    }
    // Fallback 2: manual dialog
    openAddDialogWithPrefill("", "");
  }

  function openAddDialogWithPrefill(virtual: string, path: string) {
    setDialogVirtual(virtual);
    setDialogPath(path);
    setDialogPerm("public");
    setDialogError(null);
    setAddOpen(true);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // webkitRelativePath like "MyMusic/song.mp3" or "MyMusic/sub/track.flac" — top-level folder is Shared folder name
    const byRoot = new Map<string, string>();
    for (const f of Array.from(files)) {
      const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const root = rel.split("/")[0] || f.name.split("/")[0] || "Shared";
      if (!byRoot.has(root)) byRoot.set(root, root);
    }
    // Add each distinct root as a share (mirrors select_multiple=True)
    for (const [root] of byRoot) {
      addShareInternal(root, "public", root);
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openEditDialog(target: { virtualName: string; folderPath: string; permission: Permission }) {
    setEditTarget(target);
    setDialogVirtual(target.virtualName);
    setDialogPath(target.folderPath);
    setDialogPerm(target.permission);
    setDialogError(null);
  }

  function handleEditSave() {
    if (!editTarget) return;
    const newVirtualRaw = dialogVirtual.trim();
    const newPathRaw = dialogPath.trim();
    if (!newVirtualRaw) { setDialogError("Virtual name is required."); return; }
    if (!newPathRaw) { setDialogError("Folder path is required."); return; }
    // Mirrors preferences.py:957-984 on_edit_shared_folder_response: remove old, add new with validate_path=False
    // Remove old entry first
    const oldNorm = normalizeFolderPath(editTarget.folderPath).toLowerCase();
    const oldVirtual = editTarget.virtualName;
    // Build filtered collections without old
    let s = t.shared.filter(([v, p]) => !(v === oldVirtual || normalizeFolderPath(p).toLowerCase() === oldNorm));
    let b = t.buddyshared.filter(([v, p]) => !(v === oldVirtual || normalizeFolderPath(p).toLowerCase() === oldNorm));
    let tr = t.trustedshared.filter(([v, p]) => !(v === oldVirtual || normalizeFolderPath(p).toLowerCase() === oldNorm));

    // Also remove any existing entry that would collide with new path (if user changed path to existing share path) —
    // remove_share semantics: if new path already shared elsewhere, it gets removed before add (add_share does remove_share folderPath)
    const newNorm = normalizeFolderPath(newPathRaw).toLowerCase();
    s = s.filter(([, p]) => normalizeFolderPath(p).toLowerCase() !== newNorm);
    b = b.filter(([, p]) => normalizeFolderPath(p).toLowerCase() !== newNorm);
    tr = tr.filter(([, p]) => normalizeFolderPath(p).toLowerCase() !== newNorm);

    const remaining: SharedFolder[] = [...s, ...b, ...tr];
    // Dedup virtual name if collision with remaining (excluding self which already removed)
    let candidateVirtual = newVirtualRaw.replace(/\//g, "_").replace(/\\/g, "_").trim().replace(/^[" ]+|[" ]+$/g, "");
    if (candidateVirtual === "." || candidateVirtual === "..") candidateVirtual = candidateVirtual.replace(/\./g, "_");
    if (!candidateVirtual) candidateVirtual = "Shared";
    const existingNames = new Set(remaining.map(([v]) => v));
    let finalVirtual = candidateVirtual;
    let counter = 1;
    while (existingNames.has(finalVirtual)) {
      finalVirtual = `${candidateVirtual}${counter}`;
      counter += 1;
    }
    const normPathFinal = normalizeFolderPath(newPathRaw);
    const entry: SharedFolder = [finalVirtual, normPathFinal];
    if (dialogPerm === "public") s = [...s, entry];
    else if (dialogPerm === "buddy") b = [...b, entry];
    else tr = [...tr, entry];

    // Detect no-op (same virtual+perm as before normalized) — like preferences.py early return
    const permLabelMap: Record<Permission, string> = { public: "Public", buddy: "Buddies", trusted: "Trusted" };
    const wasNoop = editTarget.virtualName === finalVirtual && editTarget.permission === dialogPerm && normalizeFolderPath(editTarget.folderPath) === normPathFinal;
    if (wasNoop) { setEditTarget(null); return; }

    setOption("transfers", "shared", s);
    setOption("transfers", "buddyshared", b);
    setOption("transfers", "trustedshared", tr);
    setEditTarget(null);
  }

  function handleRemove(target: { virtualName: string; folderPath: string }) {
    const norm = normalizeFolderPath(target.folderPath).toLowerCase();
    const v = target.virtualName;
    const s = t.shared.filter(([vv, pp]) => !(vv === v || normalizeFolderPath(pp).toLowerCase() === norm));
    const b = t.buddyshared.filter(([vv, pp]) => !(vv === v || normalizeFolderPath(pp).toLowerCase() === norm));
    const tr = t.trustedshared.filter(([vv, pp]) => !(vv === v || normalizeFolderPath(pp).toLowerCase() === norm));
    if (s.length !== t.shared.length) setOption("transfers", "shared", s);
    if (b.length !== t.buddyshared.length) setOption("transfers", "buddyshared", b);
    if (tr.length !== t.trustedshared.length) setOption("transfers", "trustedshared", tr);
  }

  function handleAddDialogSave() {
    const v = dialogVirtual.trim() || getBasename(dialogPath);
    const p = dialogPath.trim();
    if (!p) { setDialogError("Folder path is required."); return; }
    const added = addShareInternal(p, dialogPerm, v);
    if (!added) { setDialogError("Could not add folder."); return; }
    setAddOpen(false);
  }

  const totalCount = t.shared.length + t.buddyshared.length + t.trustedshared.length;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Shared folders"
        description="Folders you share on the Soulseek network. WSL (bun): use absolute WSL paths like /home/user/Music or /mnt/c/Users/you/Music. Docker: browse container /data to add any nested folder. Browser pickers are a fallback."
      >
        <div className="py-4 space-y-3">
          <div className="rounded-xl bg-amber-50 px-4 py-3 font-body text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="font-semibold">Docker:</span> use <span className="font-mono">Browse /data</span> below to see the container&apos;s <span className="font-mono">/data</span> volume (or bind mount like <span className="font-mono">/home/user/Music:/data/Music:ro</span> then share <span className="font-mono">/data/Music</span>) and add any subdirectory as a share. This is the browser equivalent of <span className="font-mono">explorer /data</span> (container has no display server). For local device folders, use <span className="font-mono">Add folder</span> (File System Access API where available).
          </div>
          <div className="rounded-xl bg-surface-container-low px-3 py-2 dark:bg-surface-variant/20">
            <div className="font-body text-[11px] leading-relaxed text-on-surface-variant dark:text-outline">
              <span className="font-semibold">WSL (bun):</span> <span className="font-mono">/data</span> on WSL bun falls back to <span className="font-mono">./data</span> or <span className="font-mono">/tmp/nicotine-hub</span> if <span className="font-mono">/data</span> not writable. Add shares with absolute WSL paths (<span className="font-mono">/home/magnus/Music</span>, <span className="font-mono">/mnt/c/Users/you/Music</span>) that <span className="font-mono">existsSync</span> on the bridge — <span className="font-mono">/data/Music</span> only works inside Docker when mounted. Rescan shows <span className="font-mono">unavailable: [v→p]</span> if the path is not found (you saw <span className="font-mono">1 dirs · 0 files</span>).
            </div>
          </div>
          <div className="rounded-xl bg-surface-container-high px-3 py-2 dark:bg-surface-variant/30">
            <div className="font-body text-[11px] leading-relaxed text-on-surface-variant dark:text-outline">
              <span className="font-semibold">Security:</span> <span className="font-mono">/data</span> browsing is sandboxed to <span className="font-mono">DATA_DIR</span> (traversal & symlink-escapes blocked). If <span className="font-mono">BRIDGE_TOKEN</span> is set, <span className="font-mono">/api/files</span> requires <span className="font-mono">?token</span> or <span className="font-mono">Authorization: Bearer</span> — same gate as <span className="font-mono">/ws</span>/<span className="font-mono">/logs</span>. More secure than open CORS.
            </div>
          </div>
        </div>

        {/* Plus button header — nicotine-plus parity: FolderChooser Add + Docker Browse */}
        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">Configured shares</div>
            <div className="mt-0.5 font-body text-xs text-on-surface-variant dark:text-outline" suppressHydrationWarning>
              {mounted ? `${totalCount} folder(s)` : `0 folder(s)`} · Public {mounted ? t.shared.length : 0} · Buddies {mounted ? t.buddyshared.length : 0} · Trusted {mounted ? t.trustedshared.length : 0}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Browse container /data"
              onClick={() => setBrowseOpen(true)}
              className="inline-flex h-11 min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-label text-xs font-semibold uppercase tracking-widest text-on-primary shadow-sm transition-colors hover:bg-primary/90 active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">folder_open</span>
              <span className="hidden sm:inline">Browse /data</span>
              <span className="sm:hidden">Browse</span>
            </button>
            <button
              type="button"
              aria-label="Add shared folder"
              onClick={handlePlusClick}
              className="inline-flex h-11 min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-surface-container-high px-4 font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container-highest active:scale-95 dark:bg-surface-variant dark:text-outline"
            >
              <span className="material-symbols-outlined text-[18px]">create_new_folder</span>
              <span className="hidden sm:inline">Add folder</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </div>

        {/* Browse modal — portal to body so fixed inset-0 escapes parent relative z-10 stacking context */}
        {browseOpen && mounted && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setBrowseOpen(false)}>
            <div className="max-h-[90dvh] w-full max-w-3xl overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl dark:bg-surface-container-high" onClick={(e) => e.stopPropagation()}>
              <FileExplorer
                initialPath="/"
                showFiles
                selectable="directories"
                confirmLabel="Add this folder"
                title="Browse container /data"
                onSelect={(relativePath) => {
                  const abs = dataPathFromExplorer(relativePath);
                  const base = basenameOfExplorerPath(relativePath);
                  setBrowseOpen(false);
                  setDialogVirtual(base);
                  setDialogPath(abs);
                  setDialogPerm("public");
                  setDialogError(null);
                  setAddOpen(true);
                }}
                onClose={() => setBrowseOpen(false)}
              />
              <div className="flex justify-end gap-2 border-t border-outline-variant/15 bg-surface-container-low px-4 py-3 dark:bg-surface-variant/20">
                <a href="/files" className="font-label text-xs text-primary hover:underline">Open standalone Explorer</a>
                <button type="button" onClick={() => setBrowseOpen(false)} className="rounded-xl px-4 py-2 font-label text-sm text-on-surface-variant">Close</button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Preview modal — dry-run top 20 exposed files + excludedCount + secretHits */}
        {previewOpen && mounted && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setPreviewOpen(false)}>
            <div className="max-h-[90dvh] w-full max-w-xl overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl dark:bg-surface-container-high flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-outline-variant/15 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-primary">visibility</span>
                  <h3 className="font-headline text-base font-semibold text-on-surface dark:text-inverse-on-surface">Preview shares</h3>
                </div>
                <button type="button" aria-label="Close preview" onClick={() => setPreviewOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"><span className="material-symbols-outlined text-[18px]">close</span></button>
              </div>
              <div className="overflow-auto p-4 space-y-3">
                {previewLoading ? (
                  <div className="flex items-center gap-2 font-body text-sm text-on-surface-variant"><span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Scanning…</div>
                ) : previewData ? (
                  <>
                    <div className="font-body text-xs text-on-surface-variant">Would share <span className="font-semibold">{previewData.counts.dirs} dirs · {previewData.counts.files} files</span>{previewData.excludedCount ? ` · ${previewData.excludedCount} filtered by exclusions` : ""}.</div>
                    {previewData.secretHits.length > 0 && (
                      <div className="rounded-xl bg-error-container px-3 py-3 font-body text-xs leading-relaxed text-on-error-container">
                        <div className="font-semibold">Potential secrets in preview — add to exclusions:</div>
                        <ul className="mt-1 list-disc pl-4">
                          {previewData.secretHits.map((p) => <li key={p} className="font-mono break-all">{p}</li>)}
                        </ul>
                      </div>
                    )}
                    <div className="rounded-xl bg-surface-container-low px-3 py-3 dark:bg-surface-variant/20">
                      <div className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Top 20 exposed files</div>
                      {previewData.sample.length === 0 ? (
                        <div className="mt-2 font-body text-xs text-on-surface-variant">No files would be shared.</div>
                      ) : (
                        <ul className="mt-2 list-disc pl-4 space-y-0.5">
                          {previewData.sample.map((p) => <li key={p} className="font-mono text-xs break-all text-on-surface-variant dark:text-outline">{p}</li>)}
                        </ul>
                      )}
                    </div>
                  </>
                ) : previewError ? (
                  <div className="rounded-xl bg-error-container px-3 py-2 font-body text-xs text-on-error-container">{previewError}</div>
                ) : (
                  <div className="font-body text-xs text-on-surface-variant">No preview yet.</div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-outline-variant/15 bg-surface-container-low px-4 py-3 dark:bg-surface-variant/20">
                <button type="button" onClick={() => setPreviewOpen(false)} className="rounded-xl px-4 py-2 font-label text-sm text-on-surface-variant">Close</button>
                <button type="button" onClick={() => { setPreviewOpen(false); if (state.status === "connected") { setRescanning(true); setRescanError(null); setUnavailableShares(null); send({ type: "shares:rescan" }); } }} className="rounded-xl bg-primary px-5 py-2 font-label text-sm font-semibold text-on-primary">Rescan now</button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Hidden fallback file input for webkitdirectory */}
        <input
          ref={fileInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={handleFileInputChange}
        />

        {/* Shares list — mirrors preferences.py TreeView virtual_name|readable|folder|accessible_to sorted ascending */}
        <div className="pb-4">
          {allShares.length === 0 ? (
            <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-lowest/60 px-4 py-8 text-center dark:bg-surface-container-high/40">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high dark:bg-surface-variant">
                <span className="material-symbols-outlined text-[20px] text-on-surface-variant dark:text-outline">folder_off</span>
              </div>
              <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">No shared folders yet</div>
              <div className="mt-1 font-body text-xs text-on-surface-variant dark:text-outline">Tap + to add a folder from your device. In the browser the picker shows the OS directory chooser (where supported).</div>
              <button
                type="button"
                onClick={() => openAddDialogWithPrefill("", "")}
                className="mt-3 inline-flex items-center gap-1 font-label text-xs font-medium text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span> Add manually
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest dark:bg-surface-container-high">
              {/* Desktop table */}
              <div className="hidden sm:block">
                <div className="grid grid-cols-[1.2fr_1.8fr_110px_88px] gap-2 border-b border-outline-variant/15 bg-surface-container-low px-3 py-2 font-label text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/70 dark:bg-surface-variant/30 dark:text-outline">
                  <div>Virtual Folder</div>
                  <div>Folder</div>
                  <div>Accessible To</div>
                  <div className="text-right">Actions</div>
                </div>
                {allShares.map((row) => {
                  const isUnavailable = unavailablePathSet.has(normalizeFolderPath(row.folderPath).toLowerCase());
                  return (
                  <div key={`${row.permission}:${row.virtualName}`} className={`grid grid-cols-[1.2fr_1.8fr_110px_88px] items-center gap-2 border-b border-outline-variant/10 px-3 py-2.5 last:border-0 hover:bg-surface-container-high/40 dark:hover:bg-surface-variant/20 ${isUnavailable ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                    <div className="min-w-0 truncate font-body text-sm font-medium text-on-surface dark:text-inverse-on-surface" title={row.virtualName}>{row.virtualName}</div>
                    <div className="min-w-0 truncate font-mono text-xs dark:text-outline" title={row.folderPath}>
                      <span className={isUnavailable ? "text-amber-700 dark:text-amber-300" : "text-on-surface-variant"}>{row.folderPath}</span>
                      {isUnavailable && <span className="ml-1 inline-flex items-center rounded bg-amber-100 px-1 py-0.5 font-label text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">not found</span>}
                    </div>
                    <div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 font-label text-[11px] font-medium ${row.permission === "public" ? "bg-primary-container text-on-primary-container" : row.permission === "buddy" ? "bg-tertiary-container text-on-tertiary-container" : "bg-secondary-container text-on-secondary-container"}`}>{PERM_LABEL[row.permission]}</span>
                    </div>
                    <div className="flex justify-end gap-1">
                      <button type="button" aria-label={`Edit ${row.virtualName}`} onClick={() => openEditDialog(row)} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant">
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                      <button type="button" aria-label={`Remove ${row.virtualName}`} onClick={() => handleRemove(row)} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-error hover:bg-error-container/60">
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
              {/* Mobile cards */}
              <div className="divide-y divide-outline-variant/10 sm:hidden">
                {allShares.map((row) => (
                  <div key={`${row.permission}:${row.virtualName}-m`} className="flex items-center gap-3 px-3 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-high dark:bg-surface-variant">
                      <span className="material-symbols-outlined text-[18px] text-on-surface-variant dark:text-outline">folder</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">{row.virtualName}</div>
                      <div className={`truncate font-mono text-[11px] ${unavailablePathSet.has(normalizeFolderPath(row.folderPath).toLowerCase()) ? "text-amber-700 dark:text-amber-300" : "text-on-surface-variant dark:text-outline"}`}>{row.folderPath}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1"><span className={`inline-flex rounded-full px-2 py-0.5 font-label text-[10px] font-medium ${row.permission === "public" ? "bg-primary-container text-on-primary-container" : row.permission === "buddy" ? "bg-tertiary-container text-on-tertiary-container" : "bg-secondary-container text-on-secondary-container"}`}>{PERM_LABEL[row.permission]}</span>{unavailablePathSet.has(normalizeFolderPath(row.folderPath).toLowerCase()) && <span className="inline-flex items-center rounded bg-amber-100 px-1 py-0.5 font-label text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">not found</span>}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label={`Edit ${row.virtualName}`} onClick={() => openEditDialog(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant dark:bg-surface-variant dark:text-outline">
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button type="button" aria-label={`Remove ${row.virtualName}`} onClick={() => handleRemove(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-error-container/70 text-error">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => openAddDialogWithPrefill("", "")} className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs font-medium text-on-surface-variant hover:bg-surface-container-highest dark:bg-surface-variant dark:text-outline">
              <span className="material-symbols-outlined text-[16px]">add</span> Add manually
            </button>
            <span className="font-body text-xs leading-6 text-on-surface-variant dark:text-outline">Browser picker needs a user gesture and HTTPS/localhost.</span>
          </div>
        </div>

        {/* Advanced bulk editor — requested: leave old virtualName|/path editor behind Advanced toggle */}
        <div className="border-t border-outline-variant/15 pt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-surface-container-high/50 dark:hover:bg-surface-variant/30"
            aria-expanded={advancedOpen}
          >
            <span className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant dark:text-outline">Advanced — bulk edit</span>
            <span className={`material-symbols-outlined text-[20px] text-on-surface-variant transition-transform dark:text-outline ${advancedOpen ? "rotate-180" : ""}`}>expand_more</span>
          </button>
          {advancedOpen && (
            <div className="mt-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 dark:bg-surface-container-high/50">
              <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">Format: <span className="font-mono">virtualName|/path</span> one per line. Power-user bulk editing; mirrors <span className="font-mono">config.sections[&quot;transfers&quot;][&quot;shared&quot;]</span>.</div>
              <TextFieldControl
                label="Shared folders (public)"
                description={`${mounted ? t.shared.length : 0} folder(s) · format: virtualName|/path`}
                value={t.shared.map(([v, p]) => `${v}|${p}`).join("\n")}
                multiline
                placeholder="Music|/home/user/Music"
                onChange={(v) => {
                  const parsed = v
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => {
                      const [name, ...rest] = l.split("|");
                      return [name.trim(), rest.join("|").trim()] as [string, string];
                    })
                    .filter(([a, b]) => a && b);
                  setOption("transfers", "shared", parsed);
                }}
              />
              <TextFieldControl
                label="Buddy shares"
                description={`${mounted ? t.buddyshared.length : 0} folder(s)`}
                value={t.buddyshared.map(([v, p]) => `${v}|${p}`).join("\n")}
                multiline
                placeholder="Secret|/home/user/Secret"
                onChange={(v) => {
                  const parsed = v
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => {
                      const [name, ...rest] = l.split("|");
                      return [name.trim(), rest.join("|").trim()] as [string, string];
                    })
                    .filter(([a, b]) => a && b);
                  setOption("transfers", "buddyshared", parsed);
                }}
              />
              <TextFieldControl
                label="Trusted shares"
                description={`${mounted ? t.trustedshared.length : 0} folder(s)`}
                value={t.trustedshared.map(([v, p]) => `${v}|${p}`).join("\n")}
                multiline
                placeholder="Trusted|/home/user/Trusted"
                onChange={(v) => {
                  const parsed = v
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => {
                      const [name, ...rest] = l.split("|");
                      return [name.trim(), rest.join("|").trim()] as [string, string];
                    })
                    .filter(([a, b]) => a && b);
                  setOption("transfers", "trustedshared", parsed);
                }}
              />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Add / Edit dialogs — portal so z beats Sidebar z-50 */}
      {(addOpen || editTarget) && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => { setAddOpen(false); setEditTarget(null); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editTarget ? "Edit Shared Folder" : "Add Shared Folder"}
            className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-5 shadow-xl dark:bg-surface-container-high"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px] text-primary">{editTarget ? "edit" : "create_new_folder"}</span>
              <h3 className="font-headline text-lg font-semibold text-on-surface dark:text-inverse-on-surface">{editTarget ? "Edit Shared Folder" : "Add Shared Folder"}</h3>
            </div>
            <p className="mb-4 font-body text-xs leading-relaxed text-on-surface-variant dark:text-outline">
              {editTarget ? `Enter new virtual name for “${editTarget.folderPath}”:` : "Pick a folder via + (OS picker) or enter details below. Virtual name is how peers see the folder."}
            </p>
            <label className="mb-3 block">
              <span className="mb-1 block font-label text-xs font-medium text-on-surface dark:text-inverse-on-surface">Virtual name</span>
              <input
                value={dialogVirtual}
                onChange={(e) => setDialogVirtual(e.target.value)}
                placeholder="Music"
                className="w-full rounded-xl bg-surface-container-low px-4 py-3 font-body text-sm text-on-surface placeholder:text-outline border border-outline-variant/20 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:bg-surface-variant/50 dark:text-inverse-on-surface"
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block font-label text-xs font-medium text-on-surface dark:text-inverse-on-surface">Folder path</span>
              <input
                value={dialogPath}
                onChange={(e) => setDialogPath(e.target.value)}
                placeholder="/home/user/Music"
                className="w-full rounded-xl bg-surface-container-low px-4 py-3 font-mono text-sm text-on-surface placeholder:text-outline border border-outline-variant/20 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:bg-surface-variant/50 dark:text-inverse-on-surface"
              />
              <span className="mt-1 block font-body text-[11px] text-on-surface-variant dark:text-outline">Absolute path; browser-stored locally. Edit to your OS path if the picker only gave a name.</span>
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block font-label text-xs font-medium text-on-surface dark:text-inverse-on-surface">Accessible to</span>
              <select
                value={dialogPerm}
                onChange={(e) => setDialogPerm(e.target.value as Permission)}
                className="w-full rounded-xl bg-surface-container-low px-4 py-3 font-label text-sm text-on-surface border border-outline-variant/20 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:bg-surface-variant/50 dark:text-inverse-on-surface"
              >
                <option value="public">Public</option>
                <option value="buddy">Buddies</option>
                <option value="trusted">Trusted buddies</option>
              </select>
              <span className="mt-1 block font-body text-[11px] text-on-surface-variant dark:text-outline">Mirrors nicotine-plus PermissionLevel.PUBLIC/BUDDY/TRUSTED (shares.py:77).</span>
            </label>
            {dialogError && <div className="mb-3 rounded-xl bg-error-container px-3 py-2 font-body text-xs text-on-error-container">{dialogError}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAddOpen(false); setEditTarget(null); }} className="rounded-xl px-4 py-2.5 font-label text-sm text-on-surface-variant hover:bg-surface-container-high dark:text-outline dark:hover:bg-surface-variant">Cancel</button>
              <button
                type="button"
                onClick={() => { if (editTarget) handleEditSave(); else handleAddDialogSave(); }}
                className="rounded-xl bg-primary px-5 py-2.5 font-label text-sm font-semibold text-on-primary hover:bg-primary/90"
              >
                {editTarget ? "Save" : "Add"}
              </button>
            </div>
            </div>
          </div>,
        document.body
      )}

      <SectionCard title="Share filters" description="Patterns excluded from shares (case-insensitive, * wildcard). Trailing \ means folder.">
        <TextFieldControl
          label="Filters"
          description="One pattern per line. Defaults include @eaDir\, #recycle\, desktop.ini, Thumbs.db."
          value={t.share_filters.join("\n")}
          multiline
          placeholder="*.tmp&#10;@eaDir\"
          onChange={(v) => setOption("transfers", "share_filters", v.split("\n").map((s) => s.trim()).filter(Boolean))}
          onReset={() => setOption("transfers", "share_filters", defaults.transfers.share_filters)}
        />
      </SectionCard>

      <SectionCard title="Excluded paths" description="Extra globs excluded from shares (same *→.* rules as Share filters; trailing \ means folder). Slskd-style per-path exclusions.">
        <TextFieldControl
          label="Exclusions"
          description="One pattern per line. Examples: *.key, .env, wallet*, .git\ . Preview before rescanning."
          value={(t.exclusions ?? []).join("\n")}
          multiline
          placeholder="*.key&#10;.env&#10;wallet*&#10;.git\"
          onChange={(v) => setOption("transfers", "exclusions", v.split("\n").map((s) => s.trim()).filter(Boolean))}
          onReset={() => setOption("transfers", "exclusions", defaults.transfers.exclusions)}
        />
        {secretHits && secretHits.length > 0 && (
          <div className="mt-3 rounded-xl bg-error-container px-3 py-3 font-body text-xs leading-relaxed text-on-error-container">
            <div className="font-semibold">Potential secrets exposed — would be shared:</div>
            <ul className="mt-1 list-disc pl-4">
              {secretHits.slice(0, 20).map((p) => (
                <li key={p} className="font-mono break-all">{p}</li>
              ))}
            </ul>
            <div className="mt-2">Add patterns above like <span className="font-mono">.env</span>, <span className="font-mono">*.key</span>, <span className="font-mono">wallet*</span>, <span className="font-mono">.git\</span> then Preview/Rescan. Default <span className="font-mono">.*</span> already hides dotfiles.</div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Preview shares"
            onClick={() => {
              if (state.status !== "connected") return;
              setPreviewLoading(true);
              setPreviewError(null);
              setPreviewData(null);
              setPreviewOpen(true);
              send({ type: "shares:preview", exclusions: (t.exclusions ?? []) } as unknown as never);
              setTimeout(() => setPreviewLoading((v) => (v ? false : v)), 15000);
            }}
            disabled={state.status !== "connected" || previewLoading}
            className="inline-flex h-10 min-h-10 items-center justify-center gap-1.5 rounded-xl bg-secondary-container px-4 font-label text-xs font-semibold uppercase tracking-widest text-on-secondary-container shadow-sm transition-colors hover:bg-secondary-container/80 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
          >
            <span className={`material-symbols-outlined text-[18px] ${previewLoading ? "animate-spin" : ""}`}>{previewLoading ? "progress_activity" : "visibility"}</span>
            {previewLoading ? "Previewing…" : "Preview"}
          </button>
          <span className="font-body text-xs text-on-surface-variant dark:text-outline">{mounted ? `${(t.exclusions ?? []).length} pattern(s)` : ""} · dry-run shows top 20 files</span>
        </div>
        {previewError && <div className="mt-2 rounded-xl bg-error-container px-3 py-2 font-body text-xs text-on-error-container">{previewError}</div>}
      </SectionCard>

      <SectionCard title="Rescan" description="Re-scan all shared folders now — including /data mounts you just added.">
        <div className="flex flex-col gap-3 border-b border-outline-variant/10 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-body text-xs leading-relaxed text-on-surface-variant dark:text-outline">
                {rescanning ? "Scanning shares…" : lastCounts ? `${lastCounts.dirs} dirs · ${lastCounts.files} files` : state.status !== "connected" ? "Connect to bridge to rescan" : "Re-scan watched folders on the bridge (picks up new files)."}
              </div>
              {lastRescanAt && !rescanning && (
                <div className="font-body text-[11px] text-on-surface-variant/70 dark:text-outline/70">
                  Last rescan: {new Date(lastRescanAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })} ·{" "}
                  {lastCounts ? `${lastCounts.files} files` : "done"}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="Rescan shares"
              onClick={() => {
                if (rescanning || state.status !== "connected") return;
                setRescanning(true);
                setRescanError(null);
                setUnavailableShares(null);
                send({ type: "shares:rescan" });
                // ponytail: single-promise rescan, no progress stream — add shares:scan:progress if scans >5s become common
                setTimeout(() => setRescanning((v) => (v ? false : v)), 30_000);
              }}
              disabled={rescanning || state.status !== "connected"}
              className="inline-flex h-11 min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-label text-xs font-semibold uppercase tracking-widest text-on-primary shadow-sm transition-colors hover:bg-primary/90 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              <span className={`material-symbols-outlined text-[18px] ${rescanning ? "animate-spin" : ""}`}>{rescanning ? "progress_activity" : "refresh"}</span>
              {rescanning ? "Rescanning…" : "Rescan shares"}
            </button>
          </div>
          {rescanError && <div className="rounded-xl bg-error-container px-3 py-2 font-body text-xs text-on-error-container">{rescanError}</div>}
          {unavailableShares && unavailableShares.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3 py-3 font-body text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="font-semibold">Share path not found on bridge — rescan shows 1 dirs · 0 files:</div>
              <ul className="mt-1 list-disc pl-4">
                {unavailableShares.map(([v, p]) => (
                  <li key={`${v}:${p}`} className="font-mono break-all">{v} → {p}</li>
                ))}
              </ul>
              <div className="mt-2">WSL (bun): use absolute WSL path like <span className="font-mono">/home/magnus/Music</span> or <span className="font-mono">/mnt/c/Users/you/Music</span>. Docker: mount host folder into container (e.g. <span className="font-mono">-v /home/you/Music:/data/Music:ro</span>) then share <span className="font-mono">/data/Music</span>. Check bridge <span className="font-mono">/health?json</span> <span className="font-mono">dataDir</span> + <span className="font-mono">/api/files?path=/</span>.</div>
            </div>
          )}
          {secretHits && secretHits.length > 0 && (
            <div className="rounded-xl bg-error-container px-3 py-3 font-body text-xs leading-relaxed text-on-error-container">
              <div className="font-semibold">Potential secrets exposed — would be shared:</div>
              <ul className="mt-1 list-disc pl-4">
                {secretHits.slice(0, 20).map((p) => (
                  <li key={p} className="font-mono break-all">{p}</li>
                ))}
              </ul>
              <div className="mt-2">Add to Excluded paths above like <span className="font-mono">.env</span>, <span className="font-mono">*.key</span>, <span className="font-mono">wallet*</span>, <span className="font-mono">.git\</span> then Preview/Rescan.</div>
            </div>
          )}
          {state.status !== "connected" && (
            <div className="font-body text-[11px] text-on-surface-variant dark:text-outline">Bridge not connected — button enables after login.</div>
          )}
        </div>
        <ToggleControl
          label="Rescan on startup"
          description="Request a share rescan when the app starts (bridge handles it)."
          checked={t.rescanonstartup}
          onChange={(v) => setOption("transfers", "rescanonstartup", v)}
        />
        <ToggleControl
          label="Rescan daily"
          checked={t.rescan_shares_daily}
          onChange={(v) => setOption("transfers", "rescan_shares_daily", v)}
        />
        <SelectControl
          label="Rescan hour"
          description="Hour of day for daily rescan when enabled."
          value={t.rescan_shares_hour}
          onChange={(v) => setOption("transfers", "rescan_shares_hour", v)}
          options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }))}
        />
        <SelectControl
          label="Buddy share visibility"
          description="Who can see buddy/trusted shares without being a buddy. 'On request' entries show an indicator and require a message (pynicotine/shares visibility)."
          value={visibilityValue(t.reveal_buddy_shares, t.reveal_trusted_shares)}
          onChange={(v) => {
            if (v === "none") {
              setOption("transfers", "reveal_buddy_shares", false);
              setOption("transfers", "reveal_trusted_shares", false);
            } else if (v === "buddy") {
              setOption("transfers", "reveal_buddy_shares", true);
              setOption("transfers", "reveal_trusted_shares", false);
            } else if (v === "trusted") {
              setOption("transfers", "reveal_buddy_shares", false);
              setOption("transfers", "reveal_trusted_shares", true);
            } else {
              setOption("transfers", "reveal_buddy_shares", true);
              setOption("transfers", "reveal_trusted_shares", true);
            }
          }}
          options={[
            { value: "none", label: "Only buddies" },
            { value: "buddy", label: "Everyone can view buddy shares (on request)" },
            { value: "trusted", label: "Everyone can view trusted shares (on request)" },
            { value: "both", label: "Everyone can view buddy & trusted (on request)" },
          ]}
        />
      </SectionCard>
    </div>
  );
}
