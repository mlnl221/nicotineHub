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
import { bulkVerify, bulkAnalyze, bulkRequestSpectrum, verifyFile, analyzeFile, getWorkerHttpBase } from "@/lib/worker";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { fileExplorerDirMenu, fileExplorerMenu } from "@/lib/context-menu/menus";
import { useSpectrum } from "@/lib/spectrum";
import { usePlayer } from "@/lib/player/store";
import { dataFilePlayUrl, formatLabelOf, splitArtistTitle, toast } from "@/lib/player/urls";
import { createPortal } from "react-dom";
import { MediainfoModal } from "@/components/files/MediainfoModal";
import { RenameModal } from "@/components/files/RenameModal";
import { ImageHoverCard } from "@/components/files/ImageHoverCard";
import { useConfig } from "@/lib/config/provider";
import { useSession } from "@/lib/session";

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
  const { play } = usePlayer();

  const playFile = useCallback((absPath: string, name: string, size?: number) => {
    const target = dataFilePlayUrl(absPath);
    if (!target) {
      toast("Not playable", `${name} cannot play in the browser — download it instead.`);
      return;
    }
    const { artist, title } = splitArtistTitle(name);
    play({ title, artist, src: target.url, formatLabel: formatLabelOf(name), transcoding: target.viaWorker, fileKey: absPath, size });
  }, [play]);
  const [selectMode, setSelectMode] = useState(false);
  const bulk = useBulkSelection();
  const [bulkEditor, setBulkEditor] = useState(false);
  const [bulkScrape, setBulkScrape] = useState(false);
  const [singleScrapeFile, setSingleScrapeFile] = useState<string | null>(null);
  const [dirScrapeFiles, setDirScrapeFiles] = useState<string[] | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ title: string; rows: Array<Record<string, unknown>> } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const { requestSpectrum, getEntry } = useSpectrum();
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; file: BridgeFileEntry } | null>(null);
  const [spectrumModal, setSpectrumModal] = useState<{ file: BridgeFileEntry; activeTab: "full" | "zoom" } | null>(null);
  const [mediainfoFile, setMediainfoFile] = useState<string | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [sharesDirty, setSharesDirty] = useState<string[]>([]);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const { settings } = useConfig();
  const { state: sessionState, send, subscribe } = useSession();
  const [secInfoOpen, setSecInfoOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const currentRef = useRef(current);
  useEffect(() => { currentRef.current = current; }, [current]);

  const fetchDir = useCallback(async (path: string, opts?: { push?: boolean }) => {
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
      if (opts?.push && typeof window !== "undefined" && !isDemo) {
        try {
          window.history.pushState({ explorer: data.path }, "", window.location.href);
        } catch {}
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError("Cannot reach bridge. Is it running? The app tries same-origin (/api/bridge) first, then NEXT_PUBLIC_BRIDGE_URL / localStorage.nicotineHub.bridgeUrl.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDir(initialPath); }, [fetchDir, initialPath]);

  // Browser back walks up directories (invisible history entries, same URL)
  useEffect(() => {
    if (isDemo || typeof window === "undefined") return;
    try {
      const st = window.history.state as { explorer?: string } | null;
      if (!st?.explorer) {
        window.history.replaceState({ explorer: currentRef.current }, "", window.location.href);
      }
    } catch {}
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { explorer?: string } | null;
      const target = st?.explorer;
      if (typeof target === "string" && target !== currentRef.current) {
        fetchDir(target);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [fetchDir]);

  const handleDirScrape = async (dir: BridgeFileEntry) => {
    if (isDemo) {
      // Demo: only /data/Music/Demo is scrape-able via offline mock
      if (dir.path === "/data/Music/Demo") {
        const { mockFileExplorerResponse } = await import("@/lib/demo/fixtures");
        const data = mockFileExplorerResponse(dir.path);
        const AUDIO = new Set(["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus","mp2","alac"]);
        const audio = data.entries.filter((e) => e.type === "file" && AUDIO.has(e.name.split(".").pop()?.toLowerCase() ?? "")).map((e) => e.path).slice(0, 50);
        if (audio.length) setDirScrapeFiles(audio);
        return;
      }
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Demo", body: "Scrape Directory — only /data/Music/Demo is available in demo" } }));
      return;
    }
    setDirLoading(true);
    try {
      const url = bridgeFetchUrl(`/api/files?path=${encodeURIComponent(dir.path)}`);
      const res = await fetch(url, { headers: bridgeFetchHeaders(), cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = await res.json() as { entries: BridgeFileEntry[] };
      const AUDIO = new Set(["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus","mp2","alac"]);
      const audio = data.entries.filter((e) => e.type === "file" && AUDIO.has(e.name.split(".").pop()?.toLowerCase() ?? "")).map((e) => e.path).slice(0, 50);
      if (!audio.length) {
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "No audio files", body: `No audio files in ${dir.name}` } }));
        return;
      }
      setDirScrapeFiles(audio);
    } catch (e) {
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Scrape Directory failed", body: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setDirLoading(false);
    }
  };

  const breadcrumbs = (() => {
    if (current === "/") return [{ label: "⌂", path: "/" }];
    if (current === "/data") return [{ label: "⌂", path: "/" }, { label: "data", path: "/data" }];
    if (current.startsWith("/data/")) {
      const rest = current.slice("/data".length).split("/").filter(Boolean);
      const crumbs: { label: string; path: string }[] = [{ label: "⌂", path: "/" }, { label: "data", path: "/data" }];
      let acc = "/data";
      for (const p of rest) {
        acc += "/" + p;
        crumbs.push({ label: p, path: acc });
      }
      return crumbs;
    }
    const parts = current.slice(1).split("/").filter(Boolean);
    const crumbs: { label: string; path: string }[] = [{ label: "⌂", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  })();

  const DEMO_AUDIO_NAMES = new Set(["01. DJ Satomi - Waves.ogg", "12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg"]);
  const isDemoPlayable = (e: BridgeFileEntry) => DEMO_AUDIO_NAMES.has(e.name) || e.path === "/data/Music/Demo/01. DJ Satomi - Waves.ogg" || e.path === "/data/Music/Demo/12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg";
  const dirs = entries.filter((e) => e.type === "directory");
  const files = entries.filter((e) => e.type !== "directory");
  const audioFiles = files.filter((e) => {
    const ext = e.name.toLowerCase().split(".").pop() ?? "";
    const isAudioExt = ["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus","mp2","alac"].includes(ext);
    if (!isAudioExt) return false;
    if (!isDemo) return true;
    return isDemoPlayable(e);
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

  const handleSingleVerify = async (filePath: string) => {
    try {
      const r = await verifyFile(filePath);
      setBulkResult({ title: `Verify — ${filePath.split("/").pop()}`, rows: [{ fileName: filePath, ...(r as Record<string, unknown>) }] });
    } catch (e) {
      setBulkResult({ title: "Verify error", rows: [{ fileName: filePath, error: e instanceof Error ? e.message : String(e) }] });
    }
  };
  const handleSingleAnalyze = async (filePath: string) => {
    try {
      const r = await analyzeFile(filePath);
      setBulkResult({ title: `Analyze — ${filePath.split("/").pop()}`, rows: [{ fileName: filePath, ...(r as Record<string, unknown>) }] });
    } catch (e) {
      setBulkResult({ title: "Analyze error", rows: [{ fileName: filePath, error: e instanceof Error ? e.message : String(e) }] });
    }
  };
  const handleSingleSpectrum = async (filePath: string) => {
    setBulkResult({ title: "Spectrum — queued", rows: [{ fileName: filePath, status: "queued" }] });
    try {
      requestSpectrum(filePath, { fileName: filePath });
      const res = await bulkRequestSpectrum([{ fileName: filePath }]);
      const ok = res[0]?.ok;
      const name = filePath.split("/").pop() ?? filePath;
      if (ok) {
        setBulkResult({ title: `Done — ${name}`, rows: res as unknown as Array<Record<string, unknown>> });
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Done", body: `${name} spectrum ready — click the pill to view` } }));
        setTimeout(() => setBulkResult(null), 1400);
      } else {
        setBulkResult({ title: `Spectrum — ${name}`, rows: res as unknown as Array<Record<string, unknown>> });
      }
    } catch (e) {
      setBulkResult({ title: "Spectrum error", rows: [{ fileName: filePath, error: e instanceof Error ? e.message : String(e) }] });
    }
  };

  const getShareMatches = useCallback((filePath: string): string[] => {
    const t = (settings as unknown as { transfers?: { shared?: [string,string][]; buddyshared?: [string,string][]; trustedshared?: [string,string][] } }).transfers;
    if (!t) return [];
    const all: [string,string][] = [...(t.shared||[]), ...(t.buddyshared||[]), ...(t.trustedshared||[])];
    const hits: string[] = [];
    for (const [virtual, real] of all) {
      const r = (real || "").replace(/\/+$/, "");
      if (!r) continue;
      if (filePath === r || filePath.startsWith(r + "/")) hits.push(virtual || r);
    }
    return [...new Set(hits)];
  }, [settings]);

  const markSharesDirtyIfNeeded = useCallback((filePath: string) => {
    if (isDemo) return;
    const m = getShareMatches(filePath);
    if (m.length) {
      setSharesDirty((prev) => [...new Set([...prev, ...m])]);
      try { window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Renamed inside shared folder", body: `${m.join(", ")} — rescan needed to update what peers see.` } })); } catch {}
    }
  }, [getShareMatches]);

  const handleSharesRescan = useCallback(() => {
    if (isDemo) {
      try { window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Demo", body: "Rescan is disabled in demo" } })); } catch {}
      return;
    }
    if (sessionState.status !== "connected") {
      toast("Not connected", "Connect to the bridge to rescan");
      return;
    }
    setRescanning(true);
    setRescanError(null);
    try { send({ type: "shares:rescan" } as unknown as never); } catch (e) { setRescanning(false); setRescanError(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setRescanning((v) => (v ? false : v)), 30_000);
  }, [sessionState.status, send]);

  useEffect(() => {
    const unsub = subscribe((msg: unknown) => {
      const m = msg as { type?: string; counts?: { dirs:number; files:number }; error?: string };
      if (m.type === "shares:rescanned") {
        if (rescanning) {
          setRescanning(false);
          setSharesDirty([]);
          try { window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Shares rescanned", body: m.counts ? `${m.counts.dirs} dirs · ${m.counts.files} files` : "Done" } })); } catch {}
          fetchDir(current);
        }
      } else if (m.type === "error" && rescanning) {
        setRescanning(false);
        setRescanError(m.error || "Rescan failed");
      }
    });
    return () => { try { (unsub as unknown as () => void)(); } catch {} };
  }, [subscribe, rescanning, fetchDir, current]);

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
              onClick={() => fetchDir(parent ?? "/", { push: true })}
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
              onClick={() => fetchDir(c.path, { push: true })}
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

      {/* Shares-dirty rescan strip */}
      {sharesDirty.length > 0 && (
        <div className="flex flex-col gap-2 border-b border-amber-500/20 bg-amber-50 px-3 py-2.5 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-label text-xs font-semibold text-amber-900 dark:text-amber-200">Shared files changed{sharesDirty.length===1 ? ` — ${sharesDirty[0]}` : ` — ${sharesDirty.length} shares`} — rescan to update what peers see</div>
            {rescanError ? <div className="mt-1 font-body text-xs text-error">{rescanError}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setSharesDirty([])} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs">Dismiss</button>
            <button type="button" disabled={rescanning} onClick={handleSharesRescan} className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-1.5 font-label text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              <span className={`material-symbols-outlined text-[16px] ${rescanning ? "animate-spin" : ""}`}>{rescanning ? "progress_activity" : "refresh"}</span>
              {rescanning ? "Rescanning…" : "Rescan now"}
            </button>
          </div>
        </div>
      )}

      {/* Content — capped so 100+ rows scroll inside card, not the page */}
      <div ref={listRef as unknown as React.RefObject<HTMLDivElement>} tabIndex={selectMode ? 0 : -1} onKeyDown={handleKeyDown} data-custom-menu className="min-h-[280px] max-h-[55vh] md:max-h-[60vh] flex-1 overflow-auto overscroll-contain bg-surface-container-lowest dark:bg-surface-container-high/40 outline-none">
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
              Docker tip: the browser reaches the bridge through the web entrypoint (same-origin <span className="font-mono">/api/bridge</span> proxy — no published bridge port needed). Ensure <span className="font-mono">CONFIG_DIR=/config + DATA_DIR=/data</span> is mounted (volume <span className="font-mono">config:/config + data:/data</span> or bind mount). If <span className="font-mono">BRIDGE_TOKEN</span> is set, add it in Settings → Network or <span className="font-mono">localStorage.nicotineHub.bridgeToken</span>.
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
          <>
            {selectMode && audioIds.length > 0 && (() => {
              const isAllSelected = audioIds.length > 0 && (audioIds.length <= 50 ? audioIds.every((id) => bulk.has(id)) : bulk.size === 50);
              const isIndeterminate = bulk.size > 0 && !isAllSelected && audioIds.some((id) => bulk.has(id));
              return (
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border-b border-outline-variant/10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => { if (el) (el as HTMLInputElement).indeterminate = isIndeterminate; }}
                    onChange={() => (isAllSelected ? bulk.clear() : bulk.selectAll(audioIds))}
                    className="h-4 w-4 accent-primary"
                    aria-label="Select all displayed"
                  />
                  <span className="font-label text-xs">Select all displayed ({audioIds.length})</span>
                  <span className="ml-auto font-body text-[11px] text-outline">{bulk.size} selected</span>
                </div>
              );
            })()}
            <div className="divide-y divide-outline-variant/10">
              {dirs.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => fetchDir(e.path, { push: true })}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  setMenuAnchor({ x: ev.clientX, y: ev.clientY, file: e });
                }}
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
                  onClick={() => fetchDir(e.path, { push: true })}
                  className="rounded-full bg-surface-container-high px-2 py-1 font-label text-[11px] text-on-surface-variant hover:bg-surface-container-highest"
                  title="Try to enter symlink (blocked if it escapes /)"
                >
                  Open
                </button>
              </div>
            ))}
            {showFiles && files.filter((e) => e.type !== "symlink").map((e, idx) => {
              const ext = e.name.toLowerCase().split(".").pop() ?? "";
              const isAudioExt = ["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus","mp2","alac"].includes(ext);
              const isAudio = isDemo ? isDemoPlayable(e) : isAudioExt;
              const isImage = !isDemo && ["jpg","jpeg","png","gif","webp","bmp","ico"].includes(ext);
              const checked = bulk.has(e.path);
              const isFocused = focusedIdx === audioIds.indexOf(e.path);
              const spectrumEntry = getEntry(e.path);
              const hasSpectrum = spectrumEntry?.status === "done" && (!!spectrumEntry.fullBlobUrl || !!spectrumEntry.fullUrl);
              const isGenerating = spectrumEntry?.status === "queued" || spectrumEntry?.status === "generating";
              const row = (
              <div
                key={e.path}
                onClick={() => selectMode && isAudio && (isFocused ? bulk.toggleRange(e.path, audioIds) : bulk.toggle(e.path, audioIds))}
                onContextMenu={(ev) => {
                  if (selectMode) return;
                  ev.preventDefault();
                  ev.stopPropagation();
                  setMenuAnchor({ x: ev.clientX, y: ev.clientY, file: e });
                }}
                className={`flex items-center gap-3 px-3 py-3 hover:bg-surface-container-high/40 ${checked ? "bg-primary-fixed/20" : "opacity-90"} ${isFocused ? "ring-1 ring-primary" : ""} ${selectMode && isAudio ? "cursor-pointer" : ""}`}
              >
                {selectMode && isAudio ? (
                  <input type="checkbox" checked={checked} onChange={() => bulk.toggle(e.path)} onClick={(ev) => ev.stopPropagation()} className="h-4 w-4 shrink-0 accent-primary" />
                ) : null}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant dark:bg-surface-variant dark:text-outline">
                  <span className="material-symbols-outlined text-[18px]">{isImage ? "image" : isAudio ? "audio_file" : "description"}</span>
                </span>
                <div className="min-w-0 flex-1" onClick={() => selectMode && isAudio && bulk.toggle(e.path)}>
                  <div className="truncate font-body text-sm text-on-surface dark:text-inverse-on-surface flex items-center gap-1.5">
                    <span className="truncate">{e.name}</span>
                    {isAudio && hasSpectrum ? (
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); setSpectrumModal({ file: e, activeTab: "full" }); }}
                        className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary-container/70 px-2 py-0.5 font-label text-[10px] font-semibold text-on-primary-container hover:bg-primary-container"
                        title="View spectrum (Full + Zoom)"
                      >
                        <span className="material-symbols-outlined text-[12px]">graphic_eq</span> spectrum
                      </button>
                    ) : null}
                    {isAudio && isGenerating ? (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-label text-[10px] text-primary animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> generating
                      </span>
                    ) : null}
                    {isImage ? (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-secondary-container/70 px-2 py-0.5 font-label text-[10px] font-semibold text-on-secondary-container">
                        <span className="material-symbols-outlined text-[12px]">image</span> image
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-[11px] text-on-surface-variant dark:text-outline">{formatSize(e.size)} · {formatMtime(e.mtime)}</div>
                </div>
                {isAudio && !selectMode ? (
                  <button
                    type="button"
                    onClick={() => playFile(e.path, e.name, e.size)}
                    className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 font-label text-xs font-medium text-on-primary"
                    title="Play in browser"
                  >
                    <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span> Play
                  </button>
                ) : null}
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
              return isImage ? (
                <ImageHoverCard key={e.path} absPath={e.path} fileName={e.name}>
                  {row}
                </ImageHoverCard>
              ) : row;
            })}
          </div>
          </>
        )}
      </div>

      {/* Bulk bar per-page */}
      <BulkBar count={bulk.size} onClear={bulk.clear} onEdit={() => setBulkEditor(true)} onScrape={() => setBulkScrape(true)} onVerify={handleBulkVerify} onAnalyze={handleBulkAnalyze} onSpectrum={handleBulkSpectrum} />

      {/* Footer — security hover (was always-visible) */}
      <div className="relative border-t border-outline-variant/10 bg-surface-container-low px-3 py-2 dark:bg-surface-variant/20">
        <div className="flex items-center justify-between gap-2">
          <span className="font-label text-[11px] text-on-surface-variant dark:text-outline">Security</span>
          <button
            type="button"
            data-testid="explorer-security-info"
            aria-label="Security information"
            aria-describedby="explorer-security-tooltip"
            aria-expanded={secInfoOpen}
            onMouseEnter={() => setSecInfoOpen(true)}
            onMouseLeave={() => setSecInfoOpen(false)}
            onFocus={() => setSecInfoOpen(true)}
            onBlur={() => setSecInfoOpen(false)}
            onClick={() => setSecInfoOpen((v) => !v)}
            onKeyDown={(e) => { if (e.key === "Escape") setSecInfoOpen(false); }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-high hover:bg-surface-container-highest dark:bg-surface-variant"
          >
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">info</span>
          </button>
        </div>
        {secInfoOpen && (
          <div
            id="explorer-security-tooltip"
            role="tooltip"
            className="absolute bottom-full right-2 z-20 mb-2 max-w-[320px] rounded-xl bg-surface-container-highest p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)] ghost-border dark:bg-surface-variant"
          >
            <div className="font-body text-xs leading-relaxed text-on-surface-variant dark:text-outline">
              <span className="font-semibold">Security:</span> You start at <span className="font-mono">/data</span> but can navigate up to <span className="font-mono">/</span> (host root) — traversal outside <span className="font-mono">/</span> is blocked and symlink escapes are rejected. If <span className="font-mono">BRIDGE_TOKEN</span> is set, requests require <span className="font-mono">?token</span> or <span className="font-mono">Authorization: Bearer</span> (same as <span className="font-mono">/ws</span>, <span className="font-mono">/logs</span>).
            </div>
          </div>
        )}
      </div>
      {tagFile ? <TagEditor open={!!tagFile} fileName={tagFile} onClose={() => setTagFile(null)} onSaved={() => fetchDir(current)} /> : null}
      {bulkEditor ? <BulkTagEditor open={bulkEditor} files={Array.from(bulk.selected)} onClose={() => setBulkEditor(false)} onSaved={() => { bulk.clear(); fetchDir(current); }} /> : null}
      {bulkScrape || singleScrapeFile || dirScrapeFiles ? <BulkScrapeModal open={!!(bulkScrape || singleScrapeFile || dirScrapeFiles)} files={dirScrapeFiles ?? (singleScrapeFile ? [singleScrapeFile] : Array.from(bulk.selected))} onClose={() => { setBulkScrape(false); setSingleScrapeFile(null); setDirScrapeFiles(null); }} onRenamed={(paths) => { for (const p of paths) markSharesDirtyIfNeeded(p); if (paths.length) fetchDir(current); }} /> : null}
      {bulkResult && mounted ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={() => setBulkResult(null)}>
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
        </div>,
        document.body
      ) : null}
      {menuAnchor ? (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={(() => {
            const e = menuAnchor.file;
            if (e.type === "directory") {
              const isDemoDirScrapeable = isDemo && e.path === "/data/Music/Demo";
              return fileExplorerDirMenu(e, {
                onScrapeDir: (isDemo && !isDemoDirScrapeable) || dirLoading ? undefined : () => handleDirScrape(e),
              });
            }
            const ext = e.name.toLowerCase().split(".").pop() ?? "";
            const isAudioExt = ["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus","mp2","alac"].includes(ext);
            const isAudio = isDemo ? (e.name === "01. DJ Satomi - Waves.ogg" || e.name === "12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg" || e.path === "/data/Music/Demo/01. DJ Satomi - Waves.ogg" || e.path === "/data/Music/Demo/12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg") : isAudioExt;
            const entry = getEntry(e.path);
            const hasSpectrum = entry?.status === "done" && (!!entry.fullBlobUrl || !!entry.fullUrl);
            return fileExplorerMenu(e, {
              isAudio,
              hasSpectrum,
              onEditTags: isAudio ? () => setTagFile(e.path) : undefined,
              onScrape: isAudio ? () => setSingleScrapeFile(e.path) : undefined,
              onVerify: isAudio ? () => handleSingleVerify(e.path) : undefined,
              onAnalyze: isAudio ? () => handleSingleAnalyze(e.path) : undefined,
              onSpectrum: isAudio ? () => handleSingleSpectrum(e.path) : undefined,
              onPlay: isAudio ? () => playFile(e.path, e.name, e.size) : undefined,
              onMediainfo: isAudio || !isDemo ? () => setMediainfoFile(e.path) : undefined,
              onRename: isDemo ? undefined : () => setRenamePath(e.path),
            });
          })()}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
      {spectrumModal && mounted ? createPortal(
        (() => {
          const entry = getEntry(spectrumModal.file.path);
          const base = getWorkerHttpBase();
          const abs = (u?: string) => (u ? (u.startsWith("blob:") || u.startsWith("http") || u.startsWith("/") ? u : `${base}${u}`) : null);
          const fullSrc = entry?.fullBlobUrl || abs(entry?.fullUrl) || null;
          const zoomSrc = entry?.zoomBlobUrl || abs(entry?.zoomUrl) || null;
          const hasSpectrum = !!fullSrc || !!zoomSrc;
          if (!hasSpectrum) {
            return (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setSpectrumModal(null)}>
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className="relative bg-surface-container-lowest rounded-2xl p-6 shadow-2xl max-w-md w-full ghost-border" onClick={(e) => e.stopPropagation()}>
                  <h3 className="font-headline font-bold">Spectrum — {spectrumModal.file.name}</h3>
                  <p className="font-body text-sm text-outline mt-2">No spectrum yet. Right-click → Spectrum to generate.</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button onClick={() => { handleSingleSpectrum(spectrumModal.file.path); setSpectrumModal(null); }} className="rounded-full bg-primary px-5 py-2 font-label text-xs font-bold text-on-primary">Generate now</button>
                    <button onClick={() => setSpectrumModal(null)} className="rounded-full bg-surface-container-high px-5 py-2 font-label text-xs">Close</button>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4" onClick={() => setSpectrumModal(null)}>
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden ghost-border" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 shrink-0">
                  <div className="min-w-0">
                    <h3 className="font-headline text-sm font-semibold truncate">Spectrum — {spectrumModal.file.name}</h3>
                    <p className="font-mono text-[10px] text-outline truncate">{spectrumModal.file.path}</p>
                  </div>
                  <button onClick={() => setSpectrumModal(null)} className="ml-3 p-2 rounded-full hover:bg-surface-container-high min-h-11 min-w-11 flex items-center justify-center"><span className="material-symbols-outlined">close</span></button>
                </div>
                <div className="flex gap-1 p-2 bg-surface-container-low shrink-0">
                  <button onClick={() => setSpectrumModal({ ...spectrumModal, activeTab: "full" })} className={`flex-1 py-2.5 rounded-xl font-label text-xs font-semibold ${spectrumModal.activeTab === "full" ? "bg-primary text-on-primary shadow" : "bg-surface-container-high text-on-surface-variant"}`}>Full</button>
                  <button onClick={() => setSpectrumModal({ ...spectrumModal, activeTab: "zoom" })} className={`flex-1 py-2.5 rounded-xl font-label text-xs font-semibold ${spectrumModal.activeTab === "zoom" ? "bg-primary text-on-primary shadow" : "bg-surface-container-high text-on-surface-variant"}`}>Zoom</button>
                </div>
                <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-2 min-h-0">
                  {spectrumModal.activeTab === "full" ? (
                    fullSrc ? <img src={fullSrc} alt={`Full spectrum ${spectrumModal.file.name}`} className="max-w-full h-auto object-contain" /> : <span className="font-label text-sm text-on-surface-variant">No Full image</span>
                  ) : (
                    zoomSrc ? <img src={zoomSrc} alt={`Zoom spectrum ${spectrumModal.file.name}`} className="max-w-full h-auto object-contain" /> : <span className="font-label text-sm text-on-surface-variant">No Zoom image</span>
                  )}
                </div>
                <div className="px-4 py-2.5 flex flex-wrap gap-2 justify-between items-center bg-surface-container-low shrink-0">
                  <span className="font-label text-[11px] text-outline">sox Kaiser • -z 120 • cached in /tmp (wiped on reboot)</span>
                  <div className="flex gap-2">
                    {fullSrc ? <a href={fullSrc} download={`${spectrumModal.file.name}-Full.png`} className="px-3 py-2 rounded-full bg-surface-container-high font-label text-xs font-semibold">Download Full</a> : null}
                    {zoomSrc ? <a href={zoomSrc} download={`${spectrumModal.file.name}-Zoom.png`} className="px-3 py-2 rounded-full bg-primary text-on-primary font-label text-xs font-semibold">Download Zoom</a> : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      ) : null}
      {mediainfoFile ? <MediainfoModal filePath={mediainfoFile} onClose={() => setMediainfoFile(null)} /> : null}
      {renamePath ? <RenameModal filePath={renamePath} onClose={() => setRenamePath(null)} onRenamed={(newPath) => { fetchDir(current); markSharesDirtyIfNeeded(newPath); try { window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Renamed", body: newPath.split("/").pop() || newPath } })); } catch {} }} /> : null}
    </div>
  );
}
