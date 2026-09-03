"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bridgeFetchUrl, bridgeFetchHeaders, type BridgeFileEntry } from "@/lib/bridgeHttp";
import { isDemo } from "@/lib/demo";
import { mockFileExplorerResponse } from "@/lib/demo/fixtures";
import { TagEditor } from "@/components/tag/TagEditor";
import { BulkBar } from "@/components/tag/BulkBar";
import { BulkTagEditor } from "@/components/tag/BulkTagEditor";
import { BulkScrapeModal } from "@/components/tag/BulkScrapeModal";
import { useBulkSelection } from "@/lib/bulkSelection";
import { bulkVerify, bulkAnalyze, bulkRequestSpectrum } from "@/lib/worker";

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatMtime(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return "—"; }
}

export type FileExplorerProps = {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose?: () => void;
  selectable?: "directories" | "all";
  confirmLabel?: string;
  title?: string;
  showFiles?: boolean;
};

export function FileExplorer({
  initialPath = "/",
  onSelect,
  onClose,
  selectable = "directories",
  confirmLabel = "Share this folder",
  title = "Browse /data",
  showFiles = true,
}: FileExplorerProps) {
  const [current, setCurrent] = useState(initialPath);
  const [entries, setEntries] = useState<BridgeFileEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagFile, setTagFile] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const bulk = useBulkSelection();
  const [bulkEditor, setBulkEditor] = useState(false);
  const [bulkScrape, setBulkScrape] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ title: string; rows: Array<Record<string, unknown>> } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);

  const fetchDir = useCallback(async (path: string) => {
    if (isDemo) {
      setLoading(true);
      setError(null);
      await new Promise((r) => setTimeout(r, 180));
      const data = mockFileExplorerResponse(path);
      setCurrent(data.path);
      setParent(data.parent);
      setEntries(data.entries);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = bridgeFetchUrl(`/api/files?path=${encodeURIComponent(path)}`);
      const res = await fetch(url, { headers: bridgeFetchHeaders(), cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = await res.json() as { path: string; parent: string | null; entries: BridgeFileEntry[] };
      setCurrent(data.path);
      setParent(data.parent);
      setEntries(data.entries);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError("Cannot reach bridge. Is it running? Check NEXT_PUBLIC_BRIDGE_URL / localStorage.nicotineHub.bridgeUrl. On Docker: ensure bridge:8787 is reachable.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDir(initialPath); }, [fetchDir, initialPath]);

  const breadcrumbs = (() => {
    if (current === "/") return [{ label: "⌂ /", path: "/" }];
    if (current === "/data") return [{ label: "⌂ /", path: "/" }, { label: "/data", path: "/data" }];
    if (current.startsWith("/data/")) {
      const rest = current.slice("/data".length).split("/").filter(Boolean);
      const crumbs: { label: string; path: string }[] = [{ label: "⌂ /", path: "/" }, { label: "/data", path: "/data" }];
      let acc = "/data";
      for (const p of rest) {
        acc += "/" + p;
        crumbs.push({ label: p, path: acc });
      }
      return crumbs;
    }
    const parts = current.slice(1).split("/").filter(Boolean);
    const crumbs: { label: string; path: string }[] = [{ label: "⌂ /", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  })();

  const dirs = entries.filter((e) => e.type === "directory");
  const files = entries.filter((e) => e.type !== "directory");
  const audioFiles = files.filter((e) => {
    const ext = e.name.toLowerCase().split(".").pop() ?? "";
    return !isDemo && ["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus","mp2","alac"].includes(ext);
  });
  const audioIds = audioFiles.map((e) => e.path);

  const canSelectCurrent = selectable === "all" || selectable === "directories";

  // keyboard up/down with shift for range
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!selectMode) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.max(0, Math.min(audioIds.length - 1, focusedIdx + dir));
      setFocusedIdx(next);
      const id = audioIds[next];
      if (e.shiftKey && id) bulk.toggleRange(id, audioIds);
      else if (id && !e.shiftKey) bulk.toggle(id);
    }
  };

  const handleBulkVerify = async () => {
    const ids = Array.from(bulk.selected);
    if (!ids.length) return;
    try {
      const r = await bulkVerify(ids);
      setBulkResult({ title: `Verify — ${ids.length} files`, rows: r.results as Array<Record<string, unknown>> });
    } catch (e) {
      setBulkResult({ title: "Verify error", rows: [{ error: e instanceof Error ? e.message : String(e) }] });
    }
  };
  const handleBulkAnalyze = async () => {
    const ids = Array.from(bulk.selected);
    if (!ids.length) return;
    try {
      const r = await bulkAnalyze(ids);
      setBulkResult({ title: `Analyze (fast) — ${ids.length} files`, rows: r.results as Array<Record<string, unknown>> });
    } catch (e) {
      setBulkResult({ title: "Analyze error", rows: [{ error: e instanceof Error ? e.message : String(e) }] });
    }
  };
  const handleBulkSpectrum = async () => {
    const ids = Array.from(bulk.selected);
    if (!ids.length) return;
    setBulkResult({ title: "Spectrum queue started", rows: ids.map((f) => ({ fileName: f, status: "queued" })) });
    const res = await bulkRequestSpectrum(ids.map((f) => ({ fileName: f })));
    setBulkResult({ title: `Spectrum — ${ids.length} files`, rows: res as unknown as Array<Record<string, unknown>> });
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm dark:bg-surface-container-high">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-outline-variant/15 bg-surface-container-low px-3 py-2.5 dark:bg-surface-variant/20">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">folder_open</span>
          <span className="font-label text-sm font-semibold text-on-surface dark:text-inverse-on-surface">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {!isDemo ? (
            <button
              type="button"
              onClick={() => setSelectMode((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-label text-xs font-medium ${selectMode ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"}`}
            >
              <span className="material-symbols-outlined text-[16px]">{selectMode ? "check_box" : "check_box_outline_blank"}</span> Select
            </button>
          ) : null}
          {selectMode && audioIds.length ? (
            <>
              <button type="button" onClick={() => bulk.selectAll(audioIds)} className="hidden sm:inline-flex rounded-full bg-surface-container-high px-2 py-1 font-label text-[11px]">All ({Math.min(50, audioIds.length)})</button>
              <button type="button" onClick={() => bulk.clear()} className="hidden sm:inline-flex rounded-full bg-surface-container-high px-2 py-1 font-label text-[11px]">Clear</button>
            </>
          ) : null}
          {parent !== null && (
            <button
              type="button"
              onClick={() => fetchDir(parent ?? "/")}
              className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs font-medium text-on-surface-variant hover:bg-surface-container-highest dark:bg-surface-variant dark:text-outline"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_upward</span> Up
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-high dark:hover:bg-surface-variant" aria-label="Close">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-outline-variant/10 bg-surface-container-low/50 px-3 py-2 dark:bg-surface-variant/10">
        {breadcrumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-1">
            {i > 0 && <span className="text-outline/60">/</span>}
            <button
              type="button"
              onClick={() => fetchDir(c.path)}
              className={`rounded-full px-2 py-0.5 font-label text-xs ${i === breadcrumbs.length - 1 ? "bg-primary-container font-semibold text-on-primary-container" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest dark:bg-surface-variant dark:text-outline"}`}
            >
              {c.label}
            </button>
          </span>
        ))}
        <div className="ml-auto hidden items-center gap-1 sm:flex">
          <span className="font-mono text-[10px] text-outline">{current}</span>
          <button
            type="button"
            onClick={() => fetchDir(current)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
            title="Refresh"
            aria-label="Refresh"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
          </button>
        </div>
      </div>

      {/* Select bar */}
      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 bg-amber-50 px-3 py-2.5 dark:bg-amber-950/20">
        <div className="min-w-0">
          <div className="font-mono text-xs font-medium text-amber-900 dark:text-amber-200 truncate" title={current}>{current}</div>
          <div className="font-body text-[11px] text-amber-800/80 dark:text-amber-200/70">
            {dirs.length} folder(s){showFiles ? ` · ${files.length} file(s)` : ""}{selectMode && bulk.size ? ` · ${bulk.size} selected (max 50)` : ""} · {canSelectCurrent ? "Select current folder to share" : ""}
          </div>
        </div>
        <button
          type="button"
          disabled={!canSelectCurrent}
          onClick={() => onSelect(current)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2 font-label text-xs font-semibold text-on-primary shadow-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">drive_folder_upload</span>
          {confirmLabel}
        </button>
      </div>

      {/* Content */}
      <div ref={listRef as unknown as React.RefObject<HTMLDivElement>} tabIndex={selectMode ? 0 : -1} onKeyDown={handleKeyDown} className="min-h-[280px] flex-1 overflow-auto bg-surface-container-lowest dark:bg-surface-container-high/40 outline-none">
        {loading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-container-high dark:bg-surface-variant/30" />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="p-4">
            <div className="rounded-xl border border-error/30 bg-error-container/50 px-4 py-3">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-[18px] text-error">error</span>
                <div>
                  <div className="font-label text-sm font-medium text-on-error-container">Could not load</div>
                  <div className="mt-1 font-body text-xs text-on-error-container/90">{error}</div>
                  <button type="button" onClick={() => fetchDir(current)} className="mt-3 inline-flex rounded-full bg-error px-3 py-1.5 font-label text-xs font-semibold text-on-error hover:bg-error/90">Retry</button>
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-surface-container-high px-3 py-2 font-body text-xs text-on-surface-variant dark:bg-surface-variant/40 dark:text-outline">
              Docker tip: ensure bridge is running on <span className="font-mono">:8787</span> and <span className="font-mono">CONFIG_DIR=/config + DATA_DIR=/data</span> is mounted (volume <span className="font-mono">config:/config + data:/data</span> or bind mount). If <span className="font-mono">BRIDGE_TOKEN</span> is set, add it in Settings → Network or <span className="font-mono">localStorage.nicotineHub.bridgeToken</span>.
            </div>
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high dark:bg-surface-variant">
              <span className="material-symbols-outlined text-[22px] text-outline">folder_off</span>
            </div>
            <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">Empty folder</div>
            <div className="mt-1 font-body text-xs text-on-surface-variant dark:text-outline">No subdirectories here. You can still share this folder.</div>
          </div>
        )}
        {!loading && !error && entries.length > 0 && (
          <div className="divide-y divide-outline-variant/10">
            {dirs.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => fetchDir(e.path)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-container-high/60 dark:hover:bg-surface-variant/30"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
                  <span className="material-symbols-outlined text-[18px]">folder</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-body text-sm font-medium text-on-surface dark:text-inverse-on-surface">{e.name}</div>
                  <div className="truncate font-mono text-[11px] text-on-surface-variant dark:text-outline">{e.path} · {formatMtime(e.mtime)}</div>
                </div>
                <span className="material-symbols-outlined text-[18px] text-outline">chevron_right</span>
              </button>
            ))}
            {entries.filter((e) => e.type === "symlink").map((e) => (
              <div key={e.path} className="flex items-center gap-3 px-3 py-3 hover:bg-surface-container-high/30">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container">
                  <span className="material-symbols-outlined text-[18px]">link</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-body text-sm text-on-surface dark:text-inverse-on-surface">{e.name} <span className="font-label text-[10px] text-outline">symlink</span></div>
                  <div className="truncate font-mono text-[11px] text-on-surface-variant dark:text-outline">{e.path}</div>
                </div>
                <button
                  type="button"
                  onClick={() => fetchDir(e.path)}
                  className="rounded-full bg-surface-container-high px-2 py-1 font-label text-[11px] text-on-surface-variant hover:bg-surface-container-highest"
                  title="Try to enter symlink (blocked if it escapes /)"
                >
                  Open
                </button>
              </div>
            ))}
            {showFiles && files.filter((e) => e.type !== "symlink").map((e, idx) => {
              const ext = e.name.toLowerCase().split(".").pop() ?? "";
              const isAudio = !isDemo && ["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus","mp2","alac"].includes(ext);
              const checked = bulk.has(e.path);
              const isFocused = focusedIdx === audioIds.indexOf(e.path);
              return (
              <div key={e.path} onClick={() => selectMode && isAudio && (isFocused ? bulk.toggleRange(e.path, audioIds) : bulk.toggle(e.path, audioIds))} className={`flex items-center gap-3 px-3 py-3 hover:bg-surface-container-high/40 ${checked ? "bg-primary-fixed/20" : "opacity-90"} ${isFocused ? "ring-1 ring-primary" : ""} ${selectMode && isAudio ? "cursor-pointer" : ""}`}>
                {selectMode && isAudio ? (
                  <input type="checkbox" checked={checked} onChange={() => bulk.toggle(e.path)} onClick={(ev) => ev.stopPropagation()} className="h-4 w-4 shrink-0 accent-primary" />
                ) : null}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant dark:bg-surface-variant dark:text-outline">
                  <span className="material-symbols-outlined text-[18px]">{isAudio ? "audio_file" : "description"}</span>
                </span>
                <div className="min-w-0 flex-1" onClick={() => selectMode && isAudio && bulk.toggle(e.path)}>
                  <div className="truncate font-body text-sm text-on-surface dark:text-inverse-on-surface">{e.name}</div>
                  <div className="truncate font-mono text-[11px] text-on-surface-variant dark:text-outline">{formatSize(e.size)} · {formatMtime(e.mtime)}</div>
                </div>
                {isAudio && !selectMode ? (
                  <button
                    type="button"
                    onClick={() => setTagFile(e.path)}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs hover:bg-surface-variant"
                    title="Edit tags (worker)"
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span> Tags
                  </button>
                ) : null}
                {selectMode && isAudio ? (
                  <span className={`material-symbols-outlined text-[18px] ${checked ? "text-primary" : "text-outline"}`}>{checked ? "check_box" : "check_box_outline_blank"}</span>
                ) : null}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk bar per-page */}
      <BulkBar count={bulk.size} onClear={bulk.clear} onEdit={() => setBulkEditor(true)} onScrape={() => setBulkScrape(true)} onVerify={handleBulkVerify} onAnalyze={handleBulkAnalyze} onSpectrum={handleBulkSpectrum} />

      {/* Footer note */}
      <div className="border-t border-outline-variant/10 bg-surface-container-low px-3 py-2 dark:bg-surface-variant/20">
        <div className="font-body text-[11px] leading-relaxed text-on-surface-variant dark:text-outline">
          <span className="font-semibold">Security:</span> You start at <span className="font-mono">/data</span> but can navigate up to <span className="font-mono">/</span> (host root) — traversal outside <span className="font-mono">/</span> is blocked and symlink escapes are rejected. If <span className="font-mono">BRIDGE_TOKEN</span> is set, requests require <span className="font-mono">?token</span> or <span className="font-mono">Authorization: Bearer</span> (same as <span className="font-mono">/ws</span>, <span className="font-mono">/logs</span>).
        </div>
      </div>
      {tagFile ? <TagEditor open={!!tagFile} fileName={tagFile} onClose={() => setTagFile(null)} onSaved={() => fetchDir(current)} /> : null}
      {bulkEditor ? <BulkTagEditor open={bulkEditor} files={Array.from(bulk.selected)} onClose={() => setBulkEditor(false)} onSaved={() => { bulk.clear(); fetchDir(current); }} /> : null}
      {bulkScrape ? <BulkScrapeModal open={bulkScrape} files={Array.from(bulk.selected)} onClose={() => setBulkScrape(false)} /> : null}
      {bulkResult ? (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={() => setBulkResult(null)}>
          <div className="w-full max-w-[720px] max-h-[80vh] flex flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface-container-lowest shadow-xl ghost-border" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-outline-variant/10 flex justify-between gap-3">
              <h3 className="font-headline font-bold">{bulkResult.title}</h3>
              <button onClick={() => setBulkResult(null)} className="h-8 w-8 rounded-full bg-surface-container-high flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">close</span></button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {bulkResult.rows.map((r, i) => (
                <div key={i} className="rounded-xl bg-surface-container-low p-3 ghost-border font-mono text-xs break-all">
                  <div className="font-semibold truncate">{String((r as Record<string, unknown>).fileName ?? r.path ?? i)}</div>
                  <div className="text-[11px] text-on-surface-variant">{Object.entries(r).filter(([k]) => k !== "fileName" && k !== "path").map(([k,v]) => `${k}:${String(v)}`).join(" · ") || "ok"}</div>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-outline-variant/10 flex justify-end">
              <button onClick={() => setBulkResult(null)} className="rounded-full bg-primary px-5 py-2 font-label text-xs font-bold text-on-primary">Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
