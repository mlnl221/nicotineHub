"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBrowseTabs } from "@/lib/browse-tabs";
import type { BrowseTab } from "@/lib/browse-tabs";
import { useTransfers } from "@/lib/transfers";
import { isDemo } from "@/lib/demo";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { browseFolderMenu, browseFileMenu } from "@/lib/context-menu/menus";
import { useConfig } from "@/lib/config/provider";
import { useBulkSelection, useMarqueeSelection } from "@/lib/bulkSelection";
import { usePaneWidth } from "@/lib/usePaneWidth";

const PAGE_SIZE = 50;

// Memoized folder row — prevents all 9k rows re-rendering on select/expand.
// contentVisibility skips offscreen layout (browser-native virtualization).
// APG treeview: the row itself is the single tab stop (roving tabindex —
// selected row tabIndex 0, rest -1); inner buttons are click-only
// (tabIndex -1) so Tab crosses the whole tree in N stops, not 2N.
const FolderRow = memo(function FolderRow({ name, short, depth, hasChildren, isExpanded, isSelected, statsLine, rowRef, onToggle, onSelect, onMenu }: {
  name: string; short: string; depth: number; hasChildren: boolean; isExpanded: boolean; isSelected: boolean; statsLine: string;
  rowRef: (el: HTMLDivElement | null) => void;
  onToggle: () => void; onSelect: () => void; onMenu: (x: number, y: number) => void;
}) {
  return (
    <div
      ref={rowRef}
      title={name}
      role="treeitem"
      data-folder-row={name}
      tabIndex={isSelected ? 0 : -1}
      aria-selected={isSelected}
      aria-level={depth + 1}
      aria-expanded={hasChildren ? isExpanded : undefined}
      className={`flex w-full min-w-max items-center gap-1 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${isSelected ? "bg-primary-fixed/20 text-primary border border-primary/10" : "hover:bg-surface-container-low text-on-surface-variant"}`}
      style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: "8px", paddingTop: "6px", paddingBottom: "6px", contentVisibility: "auto", containIntrinsicSize: "auto 57px" }}
    >
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-surface-container-high"
          aria-label={isExpanded ? `Collapse ${short}` : `Expand ${short}`}
        >
          <span className="material-symbols-outlined text-[18px]">{isExpanded ? "expand_more" : "chevron_right"}</span>
        </button>
      ) : (
        <span className="w-7 shrink-0" aria-hidden />
      )}
      <button
        tabIndex={-1}
        onClick={onSelect}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e.clientX, e.clientY); }}
        className="flex flex-1 items-center gap-3 min-w-0 text-left"
      >
        <span className="material-symbols-outlined text-[20px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>{hasChildren ? (isExpanded ? "folder_open" : "folder") : "folder"}</span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap font-body text-sm font-medium" title={name}>{short}</p>
          <p className="truncate font-label text-[11px] text-on-surface-variant">{statsLine}</p>
        </div>
      </button>
    </div>
  );
});

function formatBytes(n: number): string {
  try {
    const raw = typeof localStorage !== "undefined" ? (localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings")) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { ui?: { file_size_unit?: string } };
      if (parsed?.ui?.file_size_unit === "B") return `${n.toLocaleString()} B`;
    }
  } catch {}
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function BrowseView({ tab }: { tab: BrowseTab }) {
  const router = useRouter();
  const { setQuery, openFolder, retry } = useBrowseTabs();
  const { requestDownload } = useTransfers();
  const { settings } = useConfig();
  const { username, loading, error, folders, total, currentFolder, currentFiles, query } = tab;

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  // Debounced folder search — typing must not re-filter 9k folders per keystroke.
  const [folderInput, setFolderInput] = useState(query);
  useEffect(() => { setFolderInput(query); }, [query, tab.id]);
  useEffect(() => {
    if (folderInput === query) return;
    const t = setTimeout(() => setQuery(tab.id, folderInput), 200);
    return () => clearTimeout(t);
  }, [folderInput, query, tab.id, setQuery]);
  const [propsFile, setPropsFile] = useState<null | { name: string; size: number; ext: string; attrs: Array<[number, number]>; folder: string }>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; items: import("@/components/ui/ContextMenu").MenuItem[] } | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const bulk = useBulkSelection();
  const [selectMode, setSelectMode] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // auto-select first folder when folders load — respects userbrowse.expand_folders (nicotine parity)
  useEffect(() => {
    const expand = (settings as unknown as { userbrowse?: { expand_folders?: string } }).userbrowse?.expand_folders ?? "all";
    if (expand === "none") return; // stay collapsed until user picks
    if (folders.length && !selectedFolder) setSelectedFolder(folders[0].name);
  }, [folders, selectedFolder, settings]);

  // Pane width persisted
  const [asideW, onAsideDown, setAsideW] = usePaneWidth("nicotineHub.browse.asideW");

  const allFoldersWithParents = useMemo(() => {
    const names = new Set(folders.map((f) => f.name));
    const extras: typeof folders = [];
    for (const f of folders) {
      const parts = f.name.split("\\");
      for (let i = 1; i < parts.length; i++) {
        const prefix = parts.slice(0, i).join("\\");
        if (prefix && !names.has(prefix)) {
          names.add(prefix);
          extras.push({ name: prefix, files: [] });
        }
      }
    }
    // Parent above children (lexicographic) — filesystem walk order can emit child before parent, making tree illogical
    return [...folders, ...extras].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [folders]);

  // Lowercase index built once per folder batch — filter/sort never call toLowerCase in loops.
  const folderIndex = useMemo(() => allFoldersWithParents.map((f) => ({
    f,
    nameLow: f.name.toLowerCase(),
    fileLows: f.files.map((file) => file.name.toLowerCase()),
  })), [allFoldersWithParents]);

  const filteredFolders = useMemo(() => {
    if (!query) return allFoldersWithParents;
    const q = query.toLowerCase();
    const matches = folderIndex.filter((e) => e.nameLow.includes(q) || e.fileLows.some((n) => n.includes(q)));
    const visible = new Set(matches.map((e) => e.f.name));
    for (const e of matches) {
      let cur = e.f.name;
      while (true) {
        const idx = cur.lastIndexOf("\\");
        if (idx < 0) break;
        cur = cur.slice(0, idx);
        visible.add(cur);
      }
    }
    return allFoldersWithParents.filter((f) => visible.has(f.name));
  }, [allFoldersWithParents, folderIndex, query]);

  // reset selection when username changes (tab switch handled via new tab prop, but folders may change)
  // NB: match against allFoldersWithParents so selecting a synthetic parent isn't wiped
  useEffect(() => {
    if (!allFoldersWithParents.find((f) => f.name === selectedFolder)) {
      const expand = (settings as unknown as { userbrowse?: { expand_folders?: string } }).userbrowse?.expand_folders ?? "all";
      if (expand === "none") { setSelectedFolder(null); return; } // stay unpicked until user picks
      if (allFoldersWithParents.length) setSelectedFolder(allFoldersWithParents[0].name);
      else setSelectedFolder(null);
    }
  }, [allFoldersWithParents, selectedFolder, settings]);

  // Subdirectory tree: depth + parent collapse (minimal + optional tree)
  const minDepth = useMemo(() => {
    if (!filteredFolders.length) return 0;
    return Math.min(...filteredFolders.map((f) => f.name.split("\\").length));
  }, [filteredFolders]);

  const folderMeta = useMemo(() => {
    // Single pass: every folder registers its ancestors as "has children".
    // Old code ran filteredFolders.some(startsWith) per folder = O(n²).
    const parents = new Set<string>();
    for (const f of filteredFolders) {
      let cur = f.name;
      while (true) {
        const idx = cur.lastIndexOf("\\");
        if (idx < 0) break;
        cur = cur.slice(0, idx);
        parents.add(cur);
      }
    }
    const map = new Map<string, { depth: number; hasChildren: boolean }>();
    for (const f of filteredFolders) {
      map.set(f.name, { depth: f.name.split("\\").length - minDepth, hasChildren: parents.has(f.name) });
    }
    return map;
  }, [filteredFolders, minDepth]);

  // Recursive stats: each folder's total includes all descendant subfolders' files
  // Protocol carries own-files only, so parents with 0 own files need descendant aggregation
  const folderStats = useMemo(() => {
    const map = new Map<string, { files: number; folders: number }>();
    for (const f of filteredFolders) map.set(f.name, { files: f.files.length, folders: 0 });
    for (const f of filteredFolders) {
      let cur = f.name;
      while (true) {
        const idx = cur.lastIndexOf("\\");
        if (idx < 0) break;
        cur = cur.slice(0, idx);
        const entry = map.get(cur);
        if (entry) {
          entry.files += f.files.length;
          entry.folders += 1;
        }
      }
    }
    return map;
  }, [filteredFolders]);

  useEffect(() => {
    setExpandedPaths(new Set());
  }, [tab.id]);

  const visibleTreeFolders = useMemo(() => {
    // O(1) ancestor lookup via Set — old code ran filteredFolders.some per ancestor = O(n²).
    const names = new Set(filteredFolders.map((f) => f.name));
    return filteredFolders.filter((f) => {
      const depth = folderMeta.get(f.name)?.depth ?? 0;
      if (depth === 0) return true;
      const parts = f.name.split("\\");
      for (let i = parts.length - 1; i > minDepth; i--) {
        const ancestor = parts.slice(0, i).join("\\");
        if (names.has(ancestor) && !expandedPaths.has(ancestor)) return false;
      }
      return true;
    });
  }, [filteredFolders, folderMeta, expandedPaths, minDepth]);

  // Fix stale files: only use currentFiles when it matches the selected folder (prevents showing previous folder's files)
  // NB: fall back to allFoldersWithParents so synthetic parents stay selectable (Download Folder is recursive)
  const activeFolder = useMemo(() => {
    if (currentFiles && currentFolder && currentFolder === selectedFolder) return { name: currentFolder, files: currentFiles };
    return allFoldersWithParents.find((f) => f.name === selectedFolder) || null;
  }, [currentFiles, currentFolder, allFoldersWithParents, selectedFolder]);

  const visibleFiles = useMemo(() => {
    if (!activeFolder) return [];
    if (!fileQuery) return activeFolder.files;
    const q = fileQuery.toLowerCase();
    return activeFolder.files.filter((f) => f.name.toLowerCase().includes(q));
  }, [activeFolder, fileQuery]);

  const [visibleFolderCount, setVisibleFolderCount] = useState(PAGE_SIZE);
  const [visibleFileCount, setVisibleFileCount] = useState(PAGE_SIZE);
  const folderSentinel = useRef<HTMLDivElement | null>(null);
  const fileSentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setVisibleFolderCount(PAGE_SIZE); }, [visibleTreeFolders.length, filteredFolders.length, query, expandedPaths.size]);
  useEffect(() => { setVisibleFileCount(PAGE_SIZE); }, [visibleFiles.length, activeFolder?.name, fileQuery]);
  // Reset selection when folder changes (prevents stale selection across folders)
  useEffect(() => { bulk.clear(); }, [activeFolder?.name]);

  useEffect(() => {
    if (visibleFolderCount >= visibleTreeFolders.length) return;
    const el = folderSentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleFolderCount((v) => Math.min(v + PAGE_SIZE, visibleTreeFolders.length));
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visibleFolderCount, visibleTreeFolders.length]);

  useEffect(() => {
    if (visibleFileCount >= visibleFiles.length) return;
    const el = fileSentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleFileCount((v) => Math.min(v + PAGE_SIZE, visibleFiles.length));
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visibleFileCount, visibleFiles.length]);

  const [sortKey, setSortKey] = useState<"name" | "size" | "bitrate" | "length">(() => {
    try { const s = JSON.parse((localStorage.getItem("nicotineHub.browse.sort") ?? localStorage.getItem("nicotine.browse.sort")) || "null"); return s?.key || "name"; } catch { return "name"; }
  });
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => {
    try { const s = JSON.parse((localStorage.getItem("nicotineHub.browse.sort") ?? localStorage.getItem("nicotine.browse.sort")) || "null"); return s?.dir || "asc"; } catch { return "asc"; }
  });
  useEffect(() => {
    try { localStorage.setItem("nicotineHub.browse.sort", JSON.stringify({ key: sortKey, dir: sortDir })); } catch {}
  }, [sortKey, sortDir]);

  // Audio attrs parsed once per file list — old code built new Map per compare (O(n log n) allocs).
  const fileAttrCache = useMemo(() => {
    const m = new Map<string, { br: number; len: number; low: string }>();
    for (const f of visibleFiles) {
      let br = 0, len = 0;
      for (const [k, v] of f.attrs) { if (k === 0) br = v; else if (k === 1) len = v; }
      m.set(f.name, { br, len, low: f.name.toLowerCase() });
    }
    return m;
  }, [visibleFiles]);

  const sortedFiles = useMemo(() => {
    const arr = [...visibleFiles];
    arr.sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      if (sortKey === "name") { va = fileAttrCache.get(a.name)?.low ?? ""; vb = fileAttrCache.get(b.name)?.low ?? ""; }
      else if (sortKey === "size") { va = a.size; vb = b.size; }
      else if (sortKey === "bitrate") { va = fileAttrCache.get(a.name)?.br ?? 0; vb = fileAttrCache.get(b.name)?.br ?? 0; }
      else if (sortKey === "length") { va = fileAttrCache.get(a.name)?.len ?? 0; vb = fileAttrCache.get(b.name)?.len ?? 0; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [visibleFiles, fileAttrCache, sortKey, sortDir]);

  const pagedFolders = useMemo(() => visibleTreeFolders.slice(0, visibleFolderCount), [visibleTreeFolders, visibleFolderCount]);
  const pagedFiles = useMemo(() => sortedFiles.slice(0, visibleFileCount), [sortedFiles, visibleFileCount]);
  const pagedFileIds = useMemo(() => pagedFiles.map((f) => f.name), [pagedFiles]);
  const marquee = useMarqueeSelection(bulk.setSelection);

  // Keyboard tree nav: Up/Down move, Right expand/child, Left collapse/parent, Enter opens.
  // Single stable ref callback (memo-safe): DOM focus follows selection so screen
  // readers announce moves; roving tabindex keeps one tab stop for the whole tree.
  const folderListRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const rowRefCb = useCallback((el: HTMLDivElement | null) => {
    const n = el?.dataset.folderRow;
    if (!n) return;
    if (el) rowRefs.current.set(n, el);
    else rowRefs.current.delete(n);
  }, []);
  const typeRef = useRef<{ buf: string; at: number }>({ buf: "", at: 0 });
  const selectFolder = (name: string) => {
    setSelectedFolder(name);
    openFolder(tab.id, name);
    const idx = visibleTreeFolders.findIndex((f) => f.name === name);
    if (idx >= visibleFolderCount) setVisibleFolderCount(Math.min(idx + PAGE_SIZE, visibleTreeFolders.length));
    requestAnimationFrame(() => {
      try {
        const row = rowRefs.current.get(name) ?? folderListRef.current?.querySelector(`[data-folder-row="${CSS.escape(name)}"]`);
        row?.scrollIntoView({ block: "nearest" });
        (row as HTMLElement | undefined)?.focus?.({ preventScroll: true });
      } catch {}
    });
  };
  const toggleFolder = (name: string, expand: boolean) => {
    setExpandedPaths((prev) => {
      if (prev.has(name) === expand) return prev;
      const n = new Set(prev);
      if (expand) n.add(name);
      else n.delete(name);
      return n;
    });
  };
  const handleFolderKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable]")) return;
    // Inner row buttons are tabIndex -1 (click-only) — all keyboard goes through
    // this single path, so Enter/Space can't double-fire native + container logic.
    const idx = Math.max(0, visibleTreeFolders.findIndex((f) => f.name === selectedFolder));
    const cur = visibleTreeFolders[idx];
    if (!cur) return;
    const meta = folderMeta.get(cur.name);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, Math.min(visibleTreeFolders.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
      const target = visibleTreeFolders[next];
      if (target && target.name !== selectedFolder) selectFolder(target.name);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (meta?.hasChildren && !expandedPaths.has(cur.name)) toggleFolder(cur.name, true);
      else {
        const child = visibleTreeFolders.slice(idx + 1).find((f) => f.name.startsWith(cur.name + "\\"));
        if (child) selectFolder(child.name);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (meta?.hasChildren && expandedPaths.has(cur.name)) toggleFolder(cur.name, false);
      else {
        const prefix = cur.name.slice(0, cur.name.lastIndexOf("\\"));
        const parent = [...visibleTreeFolders].reverse().find((f) => f.name === prefix || cur.name.startsWith(f.name + "\\"));
        if (parent) selectFolder(parent.name);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFolder(tab.id, cur.name);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = visibleTreeFolders[0];
      if (first) selectFolder(first.name);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = visibleTreeFolders[visibleTreeFolders.length - 1];
      if (last) selectFolder(last.name);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead (APG): jump to next folder starting with the typed prefix.
      const now = Date.now();
      if (now - typeRef.current.at > 600) typeRef.current.buf = "";
      typeRef.current.at = now;
      typeRef.current.buf += e.key.toLowerCase();
      const buf = typeRef.current.buf;
      const shorts = visibleTreeFolders.map((f) => (f.name.split("\\").pop() || f.name).toLowerCase());
      let at = shorts.findIndex((n, i) => i > idx && n.startsWith(buf));
      if (at < 0) at = shorts.findIndex((n) => n.startsWith(buf));
      if (at >= 0 && visibleTreeFolders[at].name !== selectedFolder) selectFolder(visibleTreeFolders[at].name);
    }
  };

  // Download helpers — always recursive per user request
  const downloadFolder = (folderName: string) => {
    if (isDemo) return;
    const targetFolders = folders.filter((f) => f.name === folderName || f.name.startsWith(folderName + "\\"));
    const files = targetFolders.flatMap((f) => f.files);
    files.forEach((file, idx) => {
      const shortName = file.name.split(/[\\\/]/).pop() || file.name;
      const vp = file.name.includes("\\") || file.name.includes("/") ? file.name : `${folderName}\\${shortName}`;
      setTimeout(() => requestDownload({ username, virtualPath: vp, size: file.size, fileName: shortName }), idx * 150);
    });
  };
  const downloadSelected = () => {
    if (isDemo || !bulk.selected.size) return;
    if (bulk.selected.size > 1 && !window.confirm(`Download ${bulk.selected.size} selected files?`)) return;
    const filesByPath = new Map<string, typeof visibleFiles[0]>();
    for (const f of folders) for (const file of f.files) filesByPath.set(file.name, file);
    let i = 0;
    for (const path of bulk.selected) {
      const file = filesByPath.get(path);
      if (!file) continue;
      const shortName = file.name.split(/[\\\/]/).pop() || file.name;
      const vp = file.name;
      setTimeout(() => requestDownload({ username, virtualPath: vp, size: file.size, fileName: shortName }), i++ * 150);
    }
  };

  // Escape closes the properties dialog (backdrop click already does).
  useEffect(() => {
    if (!propsFile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPropsFile(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [propsFile]);
  // Header totals memoized — old code re-reduced all files every render.
  const { totalSize, totalFiles } = useMemo(() => {
    let size = 0, count = 0;
    for (const f of folders) {
      count += f.files.length;
      for (const file of f.files) size += file.size || 0;
    }
    return { totalSize: size, totalFiles: count };
  }, [folders]);

  // Loading progress: folders.length vs authoritative total from bridge.
  const loadProgress = loading && total && total > 0
    ? Math.min(1, folders.length / total)
    : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-h-0">
      {!loading && !error && folders.length === 0 ? (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-6 py-3 font-body text-sm text-amber-900 dark:text-amber-200">
          No shares available — this user shares no files or no shares are configured on the bridge. Check Settings → Shares and run a rescan (check_shares_available parity).
        </div>
      ) : null}
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-surface-container-highest/20 bg-surface-container-lowest/80 backdrop-blur-xl px-6 py-4 md:px-8">
        <nav className="flex items-center gap-1 font-body text-xs overflow-x-auto hide-scrollbar whitespace-nowrap max-w-full">
          <span className="font-semibold text-on-surface whitespace-nowrap">{username}</span>
          {selectedFolder ? (
            <>
              <span className="material-symbols-outlined text-[16px] text-outline-variant">chevron_right</span>
              <span className="truncate text-on-surface-variant">{selectedFolder.split("\\").pop()}</span>
            </>
          ) : null}
        </nav>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between max-w-full overflow-hidden">
          <div className="min-w-0">
            <h1 className="font-headline text-2xl font-bold tracking-tight truncate max-w-full">{username}&apos;s Shares</h1>
            <p className="mt-1 font-body text-xs text-on-surface-variant" aria-live="polite">
              {loading
                ? (total ? `Loading ${folders.length.toLocaleString()} / ${total.toLocaleString()} folders…` : folders.length ? `Loading ${folders.length.toLocaleString()} folders…` : "Loading…")
                : `${folders.length} folders • ${totalFiles} files • ${formatBytes(totalSize)}`}
              {error ? ` • ${error}` : ""}
            </p>
            {loadProgress !== null ? (
              <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-container-high" role="progressbar" aria-valuenow={Math.round(loadProgress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Loading shares">
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(loadProgress * 100)}%` }} />
              </div>
            ) : null}
          </div>
          <div className="flex gap-2 min-w-0 flex-wrap">
            <button
              onClick={() => router.push(`/profile?user=${encodeURIComponent(username)}`)}
              className="shrink-0 rounded-full bg-surface-container-high px-4 py-2.5 min-h-9 font-label text-xs hover:bg-surface-variant"
            >
              View Profile
            </button>
            <button
              data-testid="browse-reload"
              onClick={() => retry(tab.id)}
              disabled={loading}
              title="Reload from network"
              aria-label="Reload"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high hover:bg-surface-variant disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
            <div className="relative flex-1 sm:flex-none min-w-0">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-outline">search</span>
              <input
                value={fileQuery}
                onChange={(e) => setFileQuery(e.target.value)}
                placeholder="Search files in folder..."
                className="w-full sm:w-64 min-h-11 rounded-full bg-surface-container-low py-2.5 pl-9 pr-4 font-body text-base placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/20 md:text-sm"
              />
            </div>
            {error ? (
              <button onClick={() => retry(tab.id)} className="shrink-0 rounded-full bg-primary px-4 py-2.5 min-h-9 font-label text-xs font-bold text-on-primary">Retry</button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0" style={isDemo ? ({ marginTop: "var(--demo-banner-h)" } as React.CSSProperties) : undefined}>
        {/* Folder list */}
        <aside className="hidden flex-shrink-0 flex-col border-r border-surface-container-highest/30 bg-surface-container-lowest md:flex min-h-0" style={{ width: asideW }}>
          <div className="flex items-center gap-2 border-b border-surface-container-highest/20 p-3">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">search</span>
              <input
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => {
                  // ↓ drops focus into the first matching row — closes the search/keyboard gap.
                  if (e.key === "ArrowDown" && visibleTreeFolders.length) {
                    e.preventDefault();
                    selectFolder(visibleTreeFolders[0].name);
                  }
                }}
                placeholder="Search folders..."
                className="w-full rounded-full bg-surface-container-low py-2.5 pl-9 pr-4 font-body text-base focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-11 md:text-sm"
              />
            </div>
            <button
              type="button"
              title="Expand all"
              aria-label="Expand all"
              data-testid="browse-expand-all"
              disabled={filteredFolders.length === 0}
              onClick={() => setExpandedPaths(new Set(filteredFolders.filter((f) => folderMeta.get(f.name)?.hasChildren).map((f) => f.name)))}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-low hover:bg-surface-container-high disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">unfold_more</span>
            </button>
            <button
              type="button"
              title="Collapse all"
              aria-label="Collapse all"
              data-testid="browse-collapse-all"
              disabled={filteredFolders.length === 0 || expandedPaths.size === 0}
              onClick={() => setExpandedPaths(new Set())}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-low hover:bg-surface-container-high disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">unfold_less</span>
            </button>
          </div>
          <div ref={folderListRef} tabIndex={0} role="tree" aria-label={`${username} folders`} onKeyDown={handleFolderKeyDown} className="flex-1 overflow-y-auto overflow-x-auto overscroll-contain min-h-0 p-2 space-y-1" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            {loading && folders.length === 0 ? (
              <div className="space-y-2 p-2" aria-live="polite" aria-busy="true">
                <div className="flex items-center gap-3 px-2 py-1">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-transparent border-t-primary" style={{ animationDuration: "0.8s" }} />
                  <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant animate-pulse">Fetching shares from {username}…</span>
                </div>
                <div className="h-10 animate-pulse rounded-lg bg-surface-container-high" />
                <div className="h-10 animate-pulse rounded-lg bg-surface-container-high" />
                <div className="h-10 animate-pulse rounded-lg bg-surface-container-high" />
              </div>
            ) : filteredFolders.length === 0 ? (
              <p className="p-4 font-body text-sm text-outline">No folders found.</p>
            ) : (
              <>
                {loading && total && total > folders.length ? (
                  <p className="px-4 py-2 font-label text-xs text-on-surface-variant animate-pulse" aria-live="polite">
                    Loading {folders.length.toLocaleString()} / {total.toLocaleString()} folders…
                  </p>
                ) : null}
                {pagedFolders.map((f) => {
                  const meta = folderMeta.get(f.name);
                  const depth = meta?.depth ?? 0;
                  const hasChildren = meta?.hasChildren ?? false;
                  const s = folderStats.get(f.name);
                  const statsLine = !s ? `${f.files.length} files` : s.folders > 0 ? `${s.files.toLocaleString()} files · ${s.folders} folders` : `${s.files} files`;
                  const short = f.name.split("\\").pop() || f.name;
                  return (
                    <FolderRow
                      key={f.name}
                      name={f.name}
                      short={short}
                      depth={depth}
                      hasChildren={hasChildren}
                      isExpanded={expandedPaths.has(f.name)}
                      isSelected={selectedFolder === f.name}
                      statsLine={statsLine}
                      rowRef={rowRefCb}
                      onToggle={() => toggleFolder(f.name, !expandedPaths.has(f.name))}
                      onSelect={() => { setSelectedFolder(f.name); openFolder(tab.id, f.name); }}
                      onMenu={(x, y) => setMenuAnchor({ x, y, items: browseFolderMenu(username, f.name, false, { onDownloadFolder: downloadFolder }) })}
                    />
                  );
                })}
                {visibleFolderCount < visibleTreeFolders.length ? (
                  <div className="flex flex-col items-center gap-2 py-3">
                    <span className="font-label text-xs text-outline">{visibleFolderCount} of {visibleTreeFolders.length} folders</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setVisibleFolderCount((v) => Math.min(v + PAGE_SIZE, visibleTreeFolders.length))} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs">Load 50 more</button>
                      <button type="button" onClick={() => setVisibleFolderCount(visibleTreeFolders.length)} className="rounded-full bg-primary px-3 py-1.5 font-label text-xs font-bold text-on-primary">Load all</button>
                    </div>
                  </div>
                ) : null}
                {visibleFolderCount < visibleTreeFolders.length ? <div ref={folderSentinel} className="h-px" aria-hidden /> : null}
              </>
            )}
            </div>
        </aside>
        {/* Drag handle — resize folder pane (pointer + ArrowLeft/Right when focused) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize folder list (Left/Right arrows)"
          aria-valuenow={Math.round(asideW)}
          aria-valuemin={240}
          aria-valuemax={640}
          tabIndex={0}
          onPointerDown={onAsideDown}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setAsideW(asideW + (e.key === "ArrowRight" ? 24 : -24));
          }}
          className="hidden md:flex w-2 shrink-0 cursor-col-resize items-center justify-center hover:bg-primary/10 touch-none select-none focus-visible:outline-none focus-visible:bg-primary/20"
          style={{ touchAction: "none" }}
        >
          <div className="h-8 w-0.5 rounded-full bg-outline-variant/40" />
        </div>

        {/* File list */}
        <div className="flex flex-1 flex-col overflow-hidden min-h-0">
          <div className="border-b border-surface-container-highest/20 bg-surface-container-lowest p-3 md:hidden">
            <select
              value={selectedFolder || ""}
              title={selectedFolder || undefined}
              onChange={(e) => {
                setSelectedFolder(e.target.value);
                openFolder(tab.id, e.target.value);
              }}
              className="w-full rounded-lg bg-surface-container-low px-3 py-2.5 min-h-11 font-body text-sm"
            >
              {selectedFolder && !pagedFolders.some((f) => f.name === selectedFolder) ? (
                <option key={selectedFolder} value={selectedFolder}>{selectedFolder.split("\\").pop() || selectedFolder}</option>
              ) : null}
              {pagedFolders.map((f) => {
                const depth = folderMeta.get(f.name)?.depth ?? 0;
                const prefix = depth > 0 ? `${"— ".repeat(Math.min(depth, 6))}` : "";
                const short = f.name.split("\\").pop() || f.name;
                return <option key={f.name} value={f.name}>{prefix}{short} ({f.files.length})</option>;
              })}
            </select>
            {visibleTreeFolders.length > pagedFolders.length ? (
              <p className="mt-1 font-label text-[11px] text-outline">Showing {pagedFolders.length} of {visibleTreeFolders.length} — use search to narrow.</p>
            ) : null}
          </div>

          {loading && !activeFolder ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="mt-3 font-body text-sm text-on-surface-variant">
                  {total && total > folders.length
                    ? `Fetching shares from ${username}… ${folders.length.toLocaleString()} / ${total.toLocaleString()}`
                    : `Fetching shares from ${username}…`}
                </p>
                <p className="mt-1 font-label text-xs text-outline">This can take up to 30s if the peer is behind NAT.</p>
              </div>
            </div>
          ) : error && folders.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <div className="rounded-xl bg-surface-container-lowest p-8 text-center ghost-border">
                <span className="material-symbols-outlined text-3xl text-error">cloud_off</span>
                <h3 className="mt-2 font-headline font-semibold">Could not browse {username}</h3>
                <p className="mt-1 font-body text-sm text-on-surface-variant">{error}</p>
                <button onClick={() => retry(tab.id)} className="mt-4 rounded-full bg-primary px-5 py-2 font-label text-xs font-bold uppercase tracking-widest text-on-primary">Retry</button>
              </div>
            </div>
          ) : !activeFolder ? (
            <div className="flex flex-1 items-center justify-center p-10 font-body text-sm text-outline">Select a folder to view files.</div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden min-h-0">
              <div className="flex items-center justify-between border-b border-surface-container-highest/20 bg-surface-container-low px-4 py-3 gap-2">
                <h2 className="truncate font-label text-xs uppercase tracking-widest text-on-surface font-bold" title={activeFolder.name}>{activeFolder.name}</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setSelectMode((v) => !v)}
                    className={`shrink-0 rounded-full px-3 py-1.5 font-label text-xs font-bold ${selectMode ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}
                    aria-pressed={selectMode}
                  >
                    {selectMode ? "Done" : "Select"}
                  </button>
                  <span className="font-label text-xs text-on-surface-variant hidden sm:inline">{visibleFiles.length} files</span>
                  {selectMode && bulk.size > 0 ? (
                    <button
                      disabled={isDemo}
                      onClick={downloadSelected}
                      className={`shrink-0 rounded-full px-3 py-1.5 font-label text-xs font-bold ${isDemo ? "bg-surface-container-high text-outline cursor-not-allowed" : "bg-primary text-on-primary hover:bg-primary-container"}`}
                    >
                      Download {bulk.size} Selected
                    </button>
                  ) : null}
                  <button
                    disabled={isDemo}
                    title={isDemo ? "Disabled in demo" : `Download all ${visibleFiles.length} files (incl. subfolders)`}
                    onClick={() => {
                      if (isDemo) return;
                      downloadFolder(activeFolder.name);
                    }}
                    className={`rounded-full px-3 py-1.5 font-label text-xs font-bold ${isDemo ? "bg-surface-container-high text-outline cursor-not-allowed" : "bg-primary text-on-primary hover:bg-primary-container"}`}
                  >
                    Download Folder
                  </button>
                  <div className="hidden md:flex items-center gap-1 text-[11px]">
                    {(["name", "size", "bitrate", "length"] as const).map((k) => (
                      <button key={k} onClick={() => { if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir("asc"); } }} className={`rounded-full px-2 py-1 font-label ${sortKey === k ? "bg-primary-fixed/20 text-primary font-bold" : "bg-surface-container-high text-on-surface-variant"}`}>{k}{sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
                    ))}
                  </div>
                </div>
              </div>
              {selectMode && visibleFiles.length > 0 ? (
                <div className="flex items-center gap-3 px-4 py-2 bg-surface-container-low border-b border-surface-container-highest/20">
                  <input
                    type="checkbox"
                    checked={pagedFiles.length > 0 && pagedFiles.every((f) => bulk.has(f.name))}
                    ref={(el) => { if (el) (el as HTMLInputElement).indeterminate = bulk.size > 0 && !pagedFiles.every((f) => bulk.has(f.name)) && pagedFiles.some((f) => bulk.has(f.name)); }}
                    onChange={() => {
                      const all = pagedFiles.every((f) => bulk.has(f.name)) ? bulk.clear() : bulk.selectAll(pagedFiles.map((f) => f.name));
                      void all;
                    }}
                    className="h-4 w-4 shrink-0 accent-primary"
                    aria-label="Select all"
                  />
                  <span className="font-label text-xs">Select all displayed ({pagedFiles.length})</span>
                  <span className="ml-auto font-label text-[11px] text-on-surface-variant">{bulk.size} selected</span>
                  <button onClick={() => bulk.clear()} className="rounded-full bg-surface-container-high px-3 py-1 text-[11px]">Clear</button>
                </div>
              ) : null}
              <div key={activeFolder.name} className="flex-1 overflow-y-auto overscroll-contain min-h-0" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                {visibleFiles.length === 0 ? (
                  <p className="p-6 font-body text-sm text-outline">No files match &quot;{fileQuery}&quot; in this folder.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-surface-container-highest/20 bg-surface-container-lowest">
                      {pagedFiles.map((file, idx) => {
                        const shortName = file.name.split(/[\\\/]/).pop() || file.name;
                        const attrsMap = new Map(file.attrs);
                        const bitrate = attrsMap.get(0);
                        const length = attrsMap.get(1);
                        const isEven = idx % 2 === 0;
                        const checked = bulk.has(file.name);
                        return (
                           <li
                             key={file.name}
                             {...marquee(file.name)}
                             // Keyboard selection mirrors mouse: Enter/Space toggles (range with Shift).
                             // tabIndex only in select mode — otherwise per-row Download buttons cover keyboard users.
                             tabIndex={selectMode ? 0 : -1}
                             role="checkbox"
                             aria-checked={checked}
                             aria-label={shortName}
                             onKeyDown={(e) => {
                               if (e.key !== "Enter" && e.key !== " ") return;
                               if ((e.target as HTMLElement).closest("button,input")) return;
                               e.preventDefault();
                               if (e.shiftKey) bulk.toggleRange(file.name, pagedFileIds);
                               else bulk.toggle(file.name);
                             }}
                             onClick={(e) => {
                               marquee(file.name).onClick(e);
                               if (e.defaultPrevented) return;
                               if ((e.target as HTMLElement).closest("button,input")) return;
                               if (selectMode || e.ctrlKey || e.metaKey || e.shiftKey) {
                                 e.preventDefault();
                                  if (e.shiftKey) bulk.toggleRange(file.name, pagedFileIds);
                                 else bulk.toggle(file.name);
                               }
                             }}
                             onPointerDown={(e) => {
                               if (e.pointerType === "touch") longPressTimer.current = setTimeout(() => { setSelectMode(true); bulk.toggle(file.name); navigator.vibrate?.(10); }, 500);
                             }}
                             onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                             onPointerCancel={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                             onContextMenu={(e) => {
                               e.preventDefault();
                               e.stopPropagation();
                               const shortName2 = file.name.split(/[\\\/]/).pop() || file.name;
                              const vp = file.name.includes("\\") || file.name.includes("/") ? file.name : `${activeFolder!.name}\\${shortName2}`;
                              setMenuAnchor({
                                x: e.clientX, y: e.clientY,
                                items: browseFileMenu(username, { path: vp, filename: shortName2 }, false, {
                                  onDownload: () => requestDownload({ username, virtualPath: vp, size: file.size, fileName: shortName2 }),
                                  onDownloadFolder: downloadFolder,
                                   selectedCount: bulk.has(file.name) ? bulk.size : 1,
                                   onDownloadSelected: downloadSelected,
                                }),
                              });
                            }}
                            className={`flex items-center gap-3 px-4 py-3 ${checked ? "bg-primary-fixed/15 border-l-2 border-primary" : isEven ? "bg-surface-container-lowest dark:bg-surface-container-high" : "bg-surface-container-low dark:bg-surface-container-highest/40"} hover:bg-surface-container-high/40 dark:hover:bg-surface-variant/40`}
                          >
                            {selectMode ? (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => bulk.toggle(file.name)}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  // Shift+click range like FileExplorer — ev has shiftKey
                                   if ((ev as unknown as { shiftKey?: boolean }).shiftKey) bulk.toggleRange(file.name, pagedFileIds);
                                }}
                                className="h-4 w-4 shrink-0 accent-primary"
                              />
                            ) : null}
                            <span className="material-symbols-outlined text-outline text-[20px]">audio_file</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-body text-sm font-medium text-on-surface" title={file.name}>
                                {settings.ui.reverse_file_paths ?? true ? shortName : file.name}
                              </p>
                              <p className="font-label text-xs text-on-surface-variant">
                                {formatBytes(file.size)} {file.ext ? `• ${file.ext}` : ""} {bitrate ? `• ${bitrate}kbps` : ""} {length ? `• ${Math.floor(length/60)}:${String(length%60).padStart(2,"0")}` : ""}
                              </p>
                              {!settings.ui.reverse_file_paths && file.name !== shortName ? (
                                <p className="truncate font-label text-[10px] text-outline" title={shortName}>{shortName}</p>
                              ) : null}
                            </div>
                            <button onClick={() => setPropsFile({ name: file.name, size: file.size, ext: file.ext, attrs: file.attrs, folder: activeFolder.name })} className="shrink-0 rounded-full bg-surface-container-high px-3 py-2.5 min-h-9 font-label text-xs hover:bg-surface-variant" title="Properties">
                              <span className="material-symbols-outlined text-[16px]">info</span>
                            </button>
                            <button
                              disabled={isDemo}
                              title={isDemo ? "Downloads disabled in demo" : "Download"}
                              onClick={() => {
                                if (isDemo) return;
                                const virtualPath = `${activeFolder.name}\\${shortName}`;
                                const vp = file.name.includes("\\") || file.name.includes("/") ? file.name : virtualPath;
                                requestDownload({ username, virtualPath: vp, size: file.size, fileName: shortName });
                              }}
                              className={`shrink-0 rounded-full px-4 py-2.5 min-h-9 font-label text-xs font-bold ${isDemo ? "bg-surface-container-high text-outline cursor-not-allowed" : "bg-primary text-on-primary hover:bg-primary-container"}`}
                            >
                              {isDemo ? "Disabled" : "Download"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {visibleFileCount < visibleFiles.length ? (
                      <div className="flex flex-col items-center gap-2 py-3">
                        <span className="font-label text-xs text-outline">{visibleFileCount} of {visibleFiles.length} files</span>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setVisibleFileCount((v) => Math.min(v + PAGE_SIZE, visibleFiles.length))} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs">Load 50 more</button>
                          <button type="button" onClick={() => setVisibleFileCount(visibleFiles.length)} className="rounded-full bg-primary px-3 py-1.5 font-label text-xs font-bold text-on-primary">Load all</button>
                        </div>
                      </div>
                    ) : null}
                    {visibleFileCount < visibleFiles.length ? <div ref={fileSentinel} className="h-px" aria-hidden /> : null}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {menuAnchor ? <ContextMenu x={menuAnchor.x} y={menuAnchor.y} items={menuAnchor.items} onClose={() => setMenuAnchor(null)} /> : null}
      {propsFile ? (
        <div role="dialog" aria-modal="true" aria-label={`Properties of ${propsFile.name.split("\\").pop() || propsFile.name}`} className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 p-4" onClick={() => setPropsFile(null)}>
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-headline text-lg font-bold truncate">{propsFile.name.split("\\").pop()}</h3>
              <button autoFocus onClick={() => setPropsFile(null)} aria-label="Close properties" className="rounded-full p-2 hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="mt-4 space-y-3 font-body text-sm">
              <div className="flex justify-between"><span className="text-on-surface-variant">Folder</span><span className="font-mono text-xs truncate max-w-[60%] text-right">{propsFile.folder}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Full path</span><span className="font-mono text-xs truncate max-w-[60%] text-right">{propsFile.name}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Size</span><span>{formatBytes(propsFile.size)}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Extension</span><span>{propsFile.ext || "—"}</span></div>
              {(() => {
                const m = new Map(propsFile.attrs);
                return (
                  <>
                    {m.has(0) ? <div className="flex justify-between"><span className="text-on-surface-variant">Bitrate</span><span>{m.get(0)} kbps {m.get(2) ? "(VBR)" : ""}</span></div> : null}
                    {m.has(1) ? <div className="flex justify-between"><span className="text-on-surface-variant">Length</span><span>{Math.floor(m.get(1)!/60)}:{String(m.get(1)!%60).padStart(2,"0")} ({m.get(1)}s)</span></div> : null}
                    {m.has(4) ? <div className="flex justify-between"><span className="text-on-surface-variant">Sample rate</span><span>{m.get(4)} Hz</span></div> : null}
                    {m.has(5) ? <div className="flex justify-between"><span className="text-on-surface-variant">Bit depth</span><span>{m.get(5)} bit</span></div> : null}
                    {propsFile.attrs.length === 0 ? <p className="text-xs text-outline">No audio attributes</p> : null}
                  </>
                );
              })()}
              <div className="flex justify-between"><span className="text-on-surface-variant">Virtual path</span><button onClick={() => { navigator.clipboard.writeText(propsFile.name); }} className="font-mono text-xs text-primary hover:underline">Copy</button></div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                disabled={isDemo}
                onClick={() => {
                  if (isDemo) return;
                  const shortName = propsFile.name.split("\\").pop() || propsFile.name;
                  const vp = propsFile.name.includes("\\") ? propsFile.name : `${propsFile.folder}\\${shortName}`;
                  requestDownload({ username, virtualPath: vp, size: propsFile.size, fileName: shortName });
                  setPropsFile(null);
                }}
                className={`flex-1 rounded-xl py-3 font-label text-xs font-bold ${isDemo ? "bg-surface-container-high text-outline cursor-not-allowed" : "bg-primary text-on-primary"}`}
              >
                {isDemo ? "Disabled in demo" : "Download"}
              </button>
              <button onClick={() => setPropsFile(null)} className="rounded-xl bg-surface-container-high px-6 py-3 font-label text-xs">Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
