"use client";

import { useEffect, useRef, useState } from "react";
import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import type { SharedFolder } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, SelectControl, TextFieldControl } from "@/components/settings/controls";

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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ virtualName: string; folderPath: string; permission: Permission } | null>(null);
  const [dialogVirtual, setDialogVirtual] = useState("");
  const [dialogPath, setDialogPath] = useState("");
  const [dialogPerm, setDialogPerm] = useState<Permission>("public");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allShares: Array<{ virtualName: string; folderPath: string; permission: Permission }> = [
    ...t.shared.map(([v, p]) => ({ virtualName: v, folderPath: p, permission: "public" as const })),
    ...t.buddyshared.map(([v, p]) => ({ virtualName: v, folderPath: p, permission: "buddy" as const })),
    ...t.trustedshared.map(([v, p]) => ({ virtualName: v, folderPath: p, permission: "trusted" as const })),
  ].sort((a, b) => a.virtualName.localeCompare(b.virtualName));

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
        description="Folders you share on the Soulseek network. In the browser, folder access requires the File System Access API (user gesture) and no background serving yet — paths are stored locally as virtual-name → path pairs."
      >
        <div className="py-4">
          <div className="rounded-xl bg-amber-50 px-4 py-3 font-body text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Browser limitation: sharing a local folder is gated by the browser. Use the + button to add a folder via the OS directory picker (File System Access API where available). Your entries are stored locally; P2P serving will use the bridge peer listener when configured.
          </div>
        </div>

        {/* Plus button header — nicotine-plus parity: FolderChooser Add */}
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">Configured shares</div>
            <div className="mt-0.5 font-body text-xs text-on-surface-variant dark:text-outline" suppressHydrationWarning>
              {mounted ? `${totalCount} folder(s)` : `0 folder(s)`} · Public {mounted ? t.shared.length : 0} · Buddies {mounted ? t.buddyshared.length : 0} · Trusted {mounted ? t.trustedshared.length : 0}
            </div>
          </div>
          <button
            type="button"
            aria-label="Add shared folder"
            onClick={handlePlusClick}
            className="inline-flex h-11 min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-label text-xs font-semibold uppercase tracking-widest text-on-primary shadow-sm transition-colors hover:bg-primary/90 active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">create_new_folder</span>
            <span className="hidden sm:inline">Add folder</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>

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
                {allShares.map((row) => (
                  <div key={`${row.permission}:${row.virtualName}`} className="grid grid-cols-[1.2fr_1.8fr_110px_88px] items-center gap-2 border-b border-outline-variant/10 px-3 py-2.5 last:border-0 hover:bg-surface-container-high/40 dark:hover:bg-surface-variant/20">
                    <div className="min-w-0 truncate font-body text-sm font-medium text-on-surface dark:text-inverse-on-surface" title={row.virtualName}>{row.virtualName}</div>
                    <div className="min-w-0 truncate font-mono text-xs text-on-surface-variant dark:text-outline" title={row.folderPath}>{row.folderPath}</div>
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
                ))}
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
                      <div className="truncate font-mono text-[11px] text-on-surface-variant dark:text-outline">{row.folderPath}</div>
                      <div className="mt-1"><span className={`inline-flex rounded-full px-2 py-0.5 font-label text-[10px] font-medium ${row.permission === "public" ? "bg-primary-container text-on-primary-container" : row.permission === "buddy" ? "bg-tertiary-container text-on-tertiary-container" : "bg-secondary-container text-on-secondary-container"}`}>{PERM_LABEL[row.permission]}</span></div>
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

      {/* Add / Edit dialogs — mirrors nicotine-plus EntryDialog with virtual name + second_droplist=PERMISSION_LEVELS */}
      {(addOpen || editTarget) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => { setAddOpen(false); setEditTarget(null); }}>
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
        </div>
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

      <SectionCard title="Rescan">
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
