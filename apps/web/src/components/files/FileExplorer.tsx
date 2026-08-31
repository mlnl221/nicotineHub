"use client";

import { useCallback, useEffect, useState } from "react";
import { bridgeFetchUrl, bridgeFetchHeaders, type BridgeFileEntry } from "@/lib/bridgeHttp";

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
  showFiles?: boolean; // if false, only directories are shown/interactive
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

  const fetchDir = useCallback(async (path: string) => {
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
    const parts = current === "/" ? [] : current.slice(1).split("/");
    const crumbs: { label: string; path: string }[] = [{ label: "⌂ /data", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  })();

  const dirs = entries.filter((e) => e.type === "directory");
  const files = entries.filter((e) => e.type !== "directory");

  const canSelectCurrent = selectable === "all" || selectable === "directories";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm dark:bg-surface-container-high">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-outline-variant/15 bg-surface-container-low px-3 py-2.5 dark:bg-surface-variant/20">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">folder_open</span>
          <span className="font-label text-sm font-semibold text-on-surface dark:text-inverse-on-surface">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
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
            {dirs.length} folder(s){showFiles ? ` · ${files.length} file(s)` : ""} · {canSelectCurrent ? "Select current folder to share" : ""}
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
      <div className="min-h-[280px] flex-1 overflow-auto bg-surface-container-lowest dark:bg-surface-container-high/40">
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
              Docker tip: ensure bridge is running on <span className="font-mono">:8787</span> and <span className="font-mono">DATA_DIR=/data</span> is mounted (volume <span className="font-mono">bridge-data:/data</span> or bind mount). If <span className="font-mono">BRIDGE_TOKEN</span> is set, add it in Settings → Network or <span className="font-mono">localStorage.nicotineHub.bridgeToken</span>.
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
            {/* Directories first */}
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
            {/* Symlinks (treated separately) */}
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
                  title="Try to enter symlink (blocked if it escapes /data)"
                >
                  Open
                </button>
              </div>
            ))}
            {showFiles && files.filter((e) => e.type !== "symlink").map((e) => (
              <div key={e.path} className="flex items-center gap-3 px-3 py-3 opacity-90">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant dark:bg-surface-variant dark:text-outline">
                  <span className="material-symbols-outlined text-[18px]">description</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-body text-sm text-on-surface dark:text-inverse-on-surface">{e.name}</div>
                  <div className="truncate font-mono text-[11px] text-on-surface-variant dark:text-outline">{formatSize(e.size)} · {formatMtime(e.mtime)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="border-t border-outline-variant/10 bg-surface-container-low px-3 py-2 dark:bg-surface-variant/20">
        <div className="font-body text-[11px] leading-relaxed text-on-surface-variant dark:text-outline">
          <span className="font-semibold">Security:</span> Listing is sandboxed to <span className="font-mono">/data</span> (container view). Traversal blocked, symlink escapes rejected. If <span className="font-mono">BRIDGE_TOKEN</span> is set, requests require <span className="font-mono">?token</span> or <span className="font-mono">Authorization: Bearer</span> (same as <span className="font-mono">/ws</span>, <span className="font-mono">/logs</span>).
        </div>
      </div>
    </div>
  );
}
