"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBrowseTabs } from "@/lib/browse-tabs";
import type { BrowseTab } from "@/lib/browse-tabs";
import { useTransfers } from "@/lib/transfers";
import { isDemo } from "@/lib/demo";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { browseFolderMenu, browseFileMenu } from "@/lib/context-menu/menus";
import { useConfig } from "@/lib/config/provider";

const PAGE_SIZE = 50;

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
  const { username, loading, error, folders, currentFolder, currentFiles, query } = tab;

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [propsFile, setPropsFile] = useState<null | { name: string; size: number; ext: string; attrs: Array<[number, number]>; folder: string }>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; items: import("@/components/ui/ContextMenu").MenuItem[] } | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // auto-select first folder when folders load — respects userbrowse.expand_folders (nicotine parity)
  useEffect(() => {
    const expand = (settings as unknown as { userbrowse?: { expand_folders?: string } }).userbrowse?.expand_folders ?? "all";
    if (expand === "none") return; // stay collapsed until user picks
    if (folders.length && !selectedFolder) setSelectedFolder(folders[0].name);
  }, [folders, selectedFolder, settings]);

  // reset selection when username changes (tab switch handled via new tab prop, but folders may change)
  useEffect(() => {
    if (!folders.find((f) => f.name === selectedFolder)) {
      if (folders.length) setSelectedFolder(folders[0].name);
      else setSelectedFolder(null);
    }
  }, [folders, selectedFolder]);

  const filteredFolders = useMemo(() => {
    if (!query) return folders;
    const q = query.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q) || f.files.some((file) => file.name.toLowerCase().includes(q)));
  }, [folders, query]);

  // Subdirectory tree: depth + parent collapse (minimal + optional tree)
  const minDepth = useMemo(() => {
    if (!filteredFolders.length) return 0;
    return Math.min(...filteredFolders.map((f) => f.name.split("\\").length));
  }, [filteredFolders]);

  const folderMeta = useMemo(() => {
    const map = new Map<string, { depth: number; hasChildren: boolean }>();
    for (const f of filteredFolders) {
      const depth = f.name.split("\\").length - minDepth;
      const hasChildren = filteredFolders.some((o) => o.name !== f.name && o.name.startsWith(f.name + "\\"));
      map.set(f.name, { depth, hasChildren });
    }
    return map;
  }, [filteredFolders, minDepth]);

  // auto-expand parents when expand_folders !== "none"
  useEffect(() => {
    const expand = (settings as unknown as { userbrowse?: { expand_folders?: string } }).userbrowse?.expand_folders ?? "all";
    if (expand === "none") return;
    if (filteredFolders.length && expandedPaths.size === 0) {
      const parents = filteredFolders.filter((f) => folderMeta.get(f.name)?.hasChildren).map((f) => f.name);
      if (parents.length) setExpandedPaths(new Set(parents));
    }
  }, [filteredFolders, folderMeta, settings]);

  const visibleTreeFolders = useMemo(() => {
    return filteredFolders.filter((f) => {
      const depth = folderMeta.get(f.name)?.depth ?? 0;
      if (depth === 0) return true;
      const parts = f.name.split("\\");
      for (let i = parts.length - 1; i > minDepth; i--) {
        const ancestor = parts.slice(0, i).join("\\");
        if (filteredFolders.some((x) => x.name === ancestor) && !expandedPaths.has(ancestor)) return false;
      }
      return true;
    });
  }, [filteredFolders, folderMeta, expandedPaths, minDepth]);

  // Fix stale files: only use currentFiles when it matches the selected folder (prevents showing previous folder's files)
  const activeFolder = useMemo(() => {
    if (currentFiles && currentFolder && currentFolder === selectedFolder) return { name: currentFolder, files: currentFiles };
    return folders.find((f) => f.name === selectedFolder) || null;
  }, [currentFiles, currentFolder, folders, selectedFolder]);

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

  const sortedFiles = useMemo(() => {
    const arr = [...visibleFiles];
    arr.sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      if (sortKey === "name") { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (sortKey === "size") { va = a.size; vb = b.size; }
      else if (sortKey === "bitrate") { va = new Map(a.attrs).get(0) || 0; vb = new Map(b.attrs).get(0) || 0; }
      else if (sortKey === "length") { va = new Map(a.attrs).get(1) || 0; vb = new Map(b.attrs).get(1) || 0; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [visibleFiles, sortKey, sortDir]);

  const pagedFolders = useMemo(() => visibleTreeFolders.slice(0, visibleFolderCount), [visibleTreeFolders, visibleFolderCount]);
  const pagedFiles = useMemo(() => sortedFiles.slice(0, visibleFileCount), [sortedFiles, visibleFileCount]);

  const totalSize = folders.reduce((acc, f) => acc + f.files.reduce((a, file) => a + (file.size || 0), 0), 0);
  const totalFiles = folders.reduce((acc, f) => acc + f.files.length, 0);

  const expandFolders = (settings as unknown as { userbrowse?: { expand_folders?: string } }).userbrowse?.expand_folders ?? "all";
  return (
    <div className="flex flex-1 flex-col overflow-hidden min-h-0">
      {!loading && folders.length === 0 ? (
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
            <p className="mt-1 font-body text-xs text-on-surface-variant">
              {loading ? "Loading…" : `${folders.length} folders • ${totalFiles} files • ${formatBytes(totalSize)}`}
              {error ? ` • ${error}` : ""}
            </p>
          </div>
          <div className="flex gap-2 min-w-0 flex-wrap">
            <button
              onClick={() => router.push(`/profile?user=${encodeURIComponent(username)}`)}
              className="shrink-0 rounded-full bg-surface-container-high px-4 py-2.5 min-h-9 font-label text-xs hover:bg-surface-variant"
            >
              View Profile
            </button>
            <div className="relative flex-1 sm:flex-none min-w-0">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-outline">search</span>
              <input
                value={fileQuery}
                onChange={(e) => setFileQuery(e.target.value)}
                placeholder="Search files in folder..."
                className="w-full sm:w-64 min-h-11 rounded-full bg-surface-container-low py-2.5 pl-9 pr-4 font-body text-sm placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            {error ? (
              <button onClick={() => retry(tab.id)} className="shrink-0 rounded-full bg-primary px-4 py-2.5 min-h-9 font-label text-xs font-bold text-on-primary">Retry</button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Folder list */}
        <aside className="hidden w-80 flex-shrink-0 flex-col border-r border-surface-container-highest/30 bg-surface-container-lowest md:flex min-h-0">
          <div className="border-b border-surface-container-highest/20 p-3">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">search</span>
              <input
                value={query}
                onChange={(e) => setQuery(tab.id, e.target.value)}
                placeholder="Search folders..."
                className="w-full rounded-full bg-surface-container-low py-2 pl-9 pr-4 font-body text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 p-2 space-y-1" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            {loading && folders.length === 0 ? (
              <div className="space-y-2 p-2">
                <div className="h-10 animate-pulse rounded-lg bg-surface-container-high" />
                <div className="h-10 animate-pulse rounded-lg bg-surface-container-high" />
              </div>
            ) : filteredFolders.length === 0 ? (
              <p className="p-4 font-body text-sm text-outline">No folders found.</p>
            ) : (
              <>
                {pagedFolders.map((f) => {
                  const meta = folderMeta.get(f.name);
                  const depth = meta?.depth ?? 0;
                  const hasChildren = meta?.hasChildren ?? false;
                  const isExpanded = expandedPaths.has(f.name);
                  const isSelected = selectedFolder === f.name;
                  return (
                    <div
                      key={f.name}
                      className={`flex w-full items-center gap-1 rounded-lg text-left transition-colors ${isSelected ? "bg-primary-fixed/20 text-primary border border-primary/10" : "hover:bg-surface-container-low text-on-surface-variant"}`}
                      style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px', paddingTop: '6px', paddingBottom: '6px' }}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedPaths((prev) => {
                              const n = new Set(prev);
                              if (n.has(f.name)) n.delete(f.name);
                              else n.add(f.name);
                              return n;
                            });
                          }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-surface-container-high"
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                        >
                          <span className="material-symbols-outlined text-[18px]">{isExpanded ? "expand_more" : "chevron_right"}</span>
                        </button>
                      ) : (
                        <span className="w-7 shrink-0" aria-hidden />
                      )}
                      <button
                        onClick={() => {
                          setSelectedFolder(f.name);
                          openFolder(tab.id, f.name);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenuAnchor({ x: e.clientX, y: e.clientY, items: browseFolderMenu(username, f.name, false) });
                        }}
                        className="flex flex-1 items-center gap-3 min-w-0 text-left"
                      >
                        <span className="material-symbols-outlined text-[20px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>{hasChildren ? (isExpanded ? "folder_open" : "folder") : "folder"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-body text-sm font-medium">{f.name.split("\\").pop() || f.name}</p>
                          <p className="truncate font-label text-[11px] text-on-surface-variant">{f.files.length} files</p>
                        </div>
                      </button>
                    </div>
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

        {/* File list */}
        <div className="flex flex-1 flex-col overflow-hidden min-h-0">
          <div className="border-b border-surface-container-highest/20 bg-surface-container-lowest p-3 md:hidden">
            <select
              value={selectedFolder || ""}
              onChange={(e) => {
                setSelectedFolder(e.target.value);
                openFolder(tab.id, e.target.value);
              }}
              className="w-full rounded-lg bg-surface-container-low px-3 py-2.5 min-h-11 font-body text-sm"
            >
              {visibleTreeFolders.map((f) => {
                const depth = folderMeta.get(f.name)?.depth ?? 0;
                const prefix = depth > 0 ? `${"— ".repeat(depth)}` : "";
                const short = f.name.split("\\").pop() || f.name;
                return <option key={f.name} value={f.name}>{prefix}{short} ({f.files.length}) — {f.name}</option>;
              })}
            </select>
          </div>

          {loading && !activeFolder ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="mt-3 font-body text-sm text-on-surface-variant">Fetching shares from {username}…</p>
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
                <h2 className="truncate font-label text-xs uppercase tracking-widest text-on-surface font-bold">{activeFolder.name}</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-label text-xs text-on-surface-variant hidden sm:inline">{visibleFiles.length} files</span>
                  <button
                    disabled={isDemo}
                    title={isDemo ? "Disabled in demo" : `Download all ${visibleFiles.length} files`}
                    onClick={() => {
                      if (isDemo) return;
                      // batch with small delay to avoid MAX_SOCKETS burst
                      visibleFiles.forEach((file, idx) => {
                        const shortName = file.name.split(/[\\\/]/).pop() || file.name;
                        const vp = file.name.includes("\\") || file.name.includes("/") ? file.name : `${activeFolder.name}\\${shortName}`;
                        setTimeout(() => requestDownload({ username, virtualPath: vp, size: file.size, fileName: shortName }), idx * 150);
                      });
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
              <div key={activeFolder.name} className="flex-1 overflow-y-auto overscroll-contain min-h-0" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                {visibleFiles.length === 0 ? (
                  <p className="p-6 font-body text-sm text-outline">No files match &quot;{fileQuery}&quot; in this folder.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-surface-container-highest/30">
                      {pagedFiles.map((file) => {
                        const shortName = file.name.split(/[\\\/]/).pop() || file.name;
                        const attrsMap = new Map(file.attrs);
                        const bitrate = attrsMap.get(0);
                        const length = attrsMap.get(1);
                        return (
                          <li key={file.name} onContextMenu={(e) => { e.preventDefault(); const shortName = file.name.split(/[\\\/]/).pop() || file.name; const vp = file.name.includes("\\") || file.name.includes("/") ? file.name : `${activeFolder!.name}\\${shortName}`; setMenuAnchor({ x: e.clientX, y: e.clientY, items: browseFileMenu(username, { path: vp, filename: shortName }, false) }); }} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low/60">
                            <span className="material-symbols-outlined text-outline text-[20px]">audio_file</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-body text-sm font-medium text-on-surface">{shortName}</p>
                              <p className="font-label text-xs text-on-surface-variant">
                                {formatBytes(file.size)} {file.ext ? `• ${file.ext}` : ""} {bitrate ? `• ${bitrate}kbps` : ""} {length ? `• ${Math.floor(length/60)}:${String(length%60).padStart(2,"0")}` : ""}
                              </p>
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
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4" onClick={() => setPropsFile(null)}>
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-headline text-lg font-bold truncate">{propsFile.name.split("\\").pop()}</h3>
              <button onClick={() => setPropsFile(null)} className="rounded-full p-2 hover:bg-surface-container-high"><span className="material-symbols-outlined">close</span></button>
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
