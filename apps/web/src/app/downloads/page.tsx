"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { useTransfers } from "@/lib/transfers";
import { TransferCard } from "@/components/transfers/TransferCard";
import { ThroughputChart } from "@/components/transfers/ThroughputChart";
import { DownloadStats } from "@/components/transfers/StatsCards";
import { PageHeader } from "@/components/PageHeader";
import { useStatistics } from "@/lib/statistics";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { transferMenu } from "@/lib/context-menu/menus";
import { useConfig } from "@/lib/config/provider";
import { useSearchesOptional } from "@/lib/search";
import { isDemo } from "@/lib/demo";
import { useSpectrum, parseDownloadToken } from "@/lib/spectrum";
import { usePlayer } from "@/lib/player/store";
import { downloadPlayUrl, formatLabelOf, splitArtistTitle } from "@/lib/player/urls";
import { SpectrumHoverCard } from "@/components/transfers/SpectrumHoverCard";
import { TagEditor } from "@/components/tag/TagEditor";
import { BulkBar } from "@/components/tag/BulkBar";
import { BulkTagEditor } from "@/components/tag/BulkTagEditor";
import { BulkScrapeModal } from "@/components/tag/BulkScrapeModal";
import { useBulkSelection } from "@/lib/bulkSelection";
import { bulkVerify, bulkAnalyze, bulkRequestSpectrum } from "@/lib/worker";
import { bridgeFetchUrl } from "@/lib/bridgeHttp";
import { humanSize, humanSpeed as _humanSpeed } from "@/lib/format";

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  return _humanSpeed(bps) || "—";
}

function getFolder(vp: string): string {
  const idx = vp.lastIndexOf("\\");
  return idx >= 0 ? (vp.slice(0, idx) || "(root)") : "(root)";
}
function isAudioForSpectrum(fileName: string): boolean {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ["flac", "wav", "aiff", "aif", "mp3", "ogg", "wma", "m4a", "wv", "aac", "opus"].includes(ext);
}

function DownloadsInner() {
  const { downloads, stats, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer } = useTransfers();
  const { total } = useStatistics();
  const { settings, setOption } = useConfig();
  const searches = useSearchesOptional();
  const router = useRouter();
  const { requestSpectrum, getEntry } = useSpectrum();
  const { play } = usePlayer();
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; transfer: import("@/lib/protocol").Transfer; isUpload: boolean } | null>(null);
  const [tagFile, setTagFile] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const bulk = useBulkSelection();
  const [bulkEditor, setBulkEditor] = useState(false);
  const [bulkScrape, setBulkScrape] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ title: string; rows: Array<Record<string, unknown>> } | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const totalDown = stats?.downloadSpeed ?? downloads.filter(d => d.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const totalUp = stats?.uploadSpeed ?? 0;
  const activeCount = downloads.length;

  const dlCount = downloads.length;
  const dlDone = total?.completed_downloads ?? 0;
  const dlSize = total?.downloaded_size ?? 0;
  const dlPeers = new Set(downloads.map((d) => d.username)).size;

  const groupMode = settings.transfers.groupdownloads ?? "folder_grouping";
  const expandMode = settings.transfers.expand_downloads ?? "all";
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // sync expand -> collapsed
  useEffect(() => {
    if (groupMode === "ungrouped") { setCollapsed(new Set()); return; }
    const keys = (() => {
      const m = new Map<string, unknown>();
      downloads.forEach((t) => {
        const k = groupMode === "user_grouping" ? t.username : getFolder(t.virtualPath);
        m.set(k, true);
      });
      return [...m.keys()];
    })();
    if (expandMode === "all") setCollapsed(new Set());
    else if (expandMode === "none") setCollapsed(new Set(keys));
    else if (expandMode === "partial") setCollapsed(new Set(keys.slice(Math.floor(keys.length/2))));
  }, [groupMode, expandMode, downloads.map(d=>d.id).join("|")]);

  const downloadGroups = (() => {
    if (groupMode === "ungrouped") return [["ungrouped", downloads] as [string, typeof downloads]];
    const map = new Map<string, typeof downloads>();
    downloads.forEach((t) => {
      const k = groupMode === "user_grouping" ? t.username : getFolder(t.virtualPath);
      const arr = map.get(k);
      if (arr) arr.push(t); else map.set(k, [t]);
    });
    return [...map.entries()];
  })();

  const audioIds = downloads.filter((d) => !isDemo && isAudioForSpectrum(d.fileName) && d.status === "Finished").map((d) => d.id);
  const selectedFileNames = Array.from(bulk.selected).map((id) => downloads.find((d) => d.id === id)?.fileName).filter(Boolean) as string[];
  const handleBulkVerify = async () => {
    const ids = Array.from(bulk.selected);
    const files = ids.map((id) => downloads.find((d) => d.id === id)?.fileName).filter(Boolean) as string[];
    if (!files.length) return;
    try { const r = await bulkVerify(files); setBulkResult({ title: `Verify — ${files.length} files`, rows: r.results as Array<Record<string, unknown>> }); } catch (e) { setBulkResult({ title: "Verify error", rows: [{ error: e instanceof Error ? e.message : String(e) }] }); }
  };
  const handleBulkAnalyze = async () => {
    const ids = Array.from(bulk.selected);
    const files = ids.map((id) => downloads.find((d) => d.id === id)?.fileName).filter(Boolean) as string[];
    if (!files.length) return;
    try { const r = await bulkAnalyze(files); setBulkResult({ title: `Analyze (fast) — ${files.length} files`, rows: r.results as Array<Record<string, unknown>> }); } catch (e) { setBulkResult({ title: "Analyze error", rows: [{ error: e instanceof Error ? e.message : String(e) }] }); }
  };
  const handleBulkSpectrum = async () => {
    const ids = Array.from(bulk.selected);
    const files = ids.map((id) => { const t = downloads.find((d) => d.id === id); return t ? { fileName: t.fileName, size: t.size, token: parseDownloadToken(t as unknown as { downloadUrl?: string }) } : null; }).filter(Boolean) as Array<{ fileName: string; size?: number; token?: number }>;
    if (!files.length) return;
    setBulkResult({ title: "Spectrum queue started", rows: files.map((f) => ({ fileName: f.fileName, status: "queued" })) });
    const res = await bulkRequestSpectrum(files);
    setBulkResult({ title: `Spectrum — ${files.length} files`, rows: res as unknown as Array<Record<string, unknown>> });
  };
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

  const handlePlay = (t: import("@/lib/protocol").Transfer) => {
    const dl = (t as unknown as { downloadUrl?: string }).downloadUrl;
    if (t.status !== "Finished" || !dl) return;
    const target = downloadPlayUrl(dl, t.fileName);
    if (!target) return;
    const { artist, title } = splitArtistTitle(t.fileName);
    play({ title, artist, src: target.url, formatLabel: formatLabelOf(t.fileName), transcoding: target.viaWorker, fileKey: t.fileName, size: t.size });
  };

  const handleDoubleClick = (t: import("@/lib/protocol").Transfer, isUpload: boolean) => {
    const action = isUpload ? settings.transfers.upload_doubleclick : settings.transfers.download_doubleclick;
    // 0 Nothing,1 Open File,2 Open in File Manager,3 Search,4 Pause/Abort,5 Remove,6 Resume/Retry,7 Browse Folder
    switch (action) {
      case 0: break;
      case 1: {
        if (t.status === "Finished" && (t as unknown as { downloadUrl?: string }).downloadUrl) window.open(bridgeFetchUrl((t as unknown as { downloadUrl: string }).downloadUrl), "_blank");
        else window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Open", body: "No file to open" } }));
        break;
      }
      case 2: window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Open", body: "Browser cannot open file manager" } })); break;
      case 3: searches ? searches.startSearch(t.fileName) : router.push(`/search?query=${encodeURIComponent(t.fileName)}`); break;
      case 4: isUpload ? clearTransfer(t.id, true) : pauseDownload(t.id); break;
      case 5: isUpload ? clearTransfer(t.id, true) : cancelDownload(t.id); break;
      case 6: isUpload ? clearTransfer(t.id, true) : resumeDownload(t.id); break;
      case 7: router.push(`/browse/${encodeURIComponent(t.username)}`); break;
      default: break;
    }
  };

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Downloads" subtitle={`${dlCount} downloading`} />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <PageHeader
          title="Downloads"
          subtitle={`${activeCount} active`}
          mobileSubtitle={`${activeCount} active •`}
          desktopSubtitle={`Monitoring ${activeCount} connections`}
          downloadSpeed={humanSpeed(totalDown)}
          uploadSpeed={humanSpeed(totalUp)}
          showSpeeds
          settingsHref="/settings?tab=downloads#downloads"
        />

        <div className="p-4 md:p-10 space-y-6 md:space-y-8 max-w-screen-2xl mx-auto w-full">
          {isDemo ? (
            <div className="rounded-xl bg-tertiary-fixed/20 dark:bg-tertiary-container/20 px-4 py-3 flex items-center gap-3 ghost-border">
              <span className="material-symbols-outlined text-tertiary">info</span>
              <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">Demo preview — 1 download + 1 upload simulated below (animated). New downloads are disabled on Vercel — search, chat, profiles &amp; browse are mocked.</p>
            </div>
          ) : null}
          <ThroughputChart />

          <DownloadStats />

          {/* Mobile download stats */}
          <div className="flex xl:hidden rounded-xl bg-surface-container-low p-1 gap-1">
            <div
              data-testid="download-stats"
              className="flex-1 min-h-11 py-2 px-2 rounded-lg bg-surface-container-lowest ghost-border flex flex-col items-center justify-center text-center"
            >
              <span className="font-label text-[10px] leading-none uppercase tracking-widest text-outline">All-time Downloads</span>
              <span className="font-label text-xs font-semibold text-on-surface truncate">{dlDone} files • {humanSize(dlSize)} • {dlPeers} peers</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 max-w-full overflow-hidden">
            <section data-testid="downloads-section" className="flex flex-col gap-4 bg-surface dark:bg-surface-container-low rounded-xl p-4 md:p-6 ghost-border max-w-full overflow-hidden">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-headline text-xl font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">download</span>
                  Downloading ({dlCount})
                </h3>
                <div className="flex items-center gap-1">
                  {!isDemo ? (
                    <button onClick={() => setSelectMode((v) => !v)} className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold ${selectMode ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}>
                      <span className="material-symbols-outlined text-[14px]">{selectMode ? "check_box" : "check_box_outline_blank"}</span> {selectMode ? `Selecting (${bulk.size}/50)` : "Select"}
                    </button>
                  ) : null}
                  {selectMode && audioIds.length ? (
                    <>
                      <button onClick={() => bulk.selectAll(audioIds)} className="hidden sm:inline-flex rounded-full bg-surface-container-high px-2 py-1 text-[10px]">All</button>
                      <button onClick={() => bulk.clear()} className="hidden sm:inline-flex rounded-full bg-surface-container-high px-2 py-1 text-[10px]">Clear</button>
                    </>
                  ) : null}
                  <select value={groupMode} onChange={(e) => setOption("transfers", "groupdownloads", e.target.value)} className="rounded-full bg-surface-container-high px-2 py-1 text-[10px] font-semibold outline-none">
                    <option value="folder_grouping">By Folder</option>
                    <option value="user_grouping">By User</option>
                    <option value="ungrouped">Ungrouped</option>
                  </select>
                  <select value={expandMode} onChange={(e) => setOption("transfers", "expand_downloads", e.target.value)} className="rounded-full bg-surface-container-low px-2 py-1 text-[10px] font-semibold outline-none">
                    <option value="all">Expand All</option>
                    <option value="partial">Partial</option>
                    <option value="none">Collapse</option>
                  </select>
                </div>
              </div>
              {selectMode ? <p className="font-body text-[10px] text-outline">Bulk edit: title+artist per-file, others uniform · Limit 50 · Shift+click / Shift+↑/↓ extends range — per-page only</p> : null}
              {downloads.length === 0 ? (
                <div data-testid="empty-downloads" className="py-12 text-center">
                  <p className="font-body text-on-surface-variant">No active downloads</p>
                  <Link href="/search" className="mt-3 inline-flex font-label text-sm font-semibold text-primary hover:underline">Search Files</Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {downloadGroups.map(([groupKey, items]) => {
                    const isCollapsed = groupMode !== "ungrouped" && collapsed.has(groupKey);
                    return (
                      <div key={groupKey}>
                        {groupMode !== "ungrouped" ? (
                          <button
                            onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(groupKey)) n.delete(groupKey); else n.add(groupKey); return n; })}
                            className="flex w-full items-center gap-2 py-2 text-left"
                          >
                            <span className="material-symbols-outlined text-[16px]">{isCollapsed ? "chevron_right" : "expand_more"}</span>
                            <span className="font-label text-xs font-semibold truncate">{groupKey}</span>
                            <span className="font-label text-[10px] text-outline">{items.length}</span>
                          </button>
                        ) : null}
                        {!isCollapsed ? (
                          <div onKeyDown={handleKeyDown} tabIndex={selectMode ? 0 : -1} className="space-y-3 outline-none">
                            {items.map((t) => {
                              const spectrumEntry = getEntry(t.id);
                              const hasSpectrum = spectrumEntry?.status === "done";
                              const isFinished = t.status === "Finished";
                              const canAnalyze = isFinished && isAudioForSpectrum(t.fileName);
                              const checked = bulk.has(t.id);
                              const isAudio = isAudioForSpectrum(t.fileName);
                              const card = (
                                <TransferCard
                                  transfer={t}
                                  onPause={() => pauseDownload(t.id)}
                                  onCancel={() => cancelDownload(t.id)}
                                  onResume={() => resumeDownload(t.id)}
                                  onRetry={() => retryDownload(t.id)}
                                  onClear={() => clearTransfer(t.id, false)}
                                />
                              );
                              const wrapped = isFinished && isAudio ? (
                                <SpectrumHoverCard transferId={t.id} fileName={t.fileName}>{card}</SpectrumHoverCard>
                              ) : card;
                              return (
                                <div key={t.id} className={`flex items-center gap-2 rounded-xl ${checked ? "ring-1 ring-primary bg-primary-fixed/10" : ""} ${selectMode && isAudio && isFinished && focusedIdx === audioIds.indexOf(t.id) ? "ring-1 ring-primary" : ""}`} onDoubleClick={() => !selectMode && handleDoubleClick(t, false)} onContextMenu={(e) => { if (selectMode) return; e.preventDefault(); setMenuAnchor({ x: e.clientX, y: e.clientY, transfer: t, isUpload: false }); }}>
                                  {selectMode && isAudio && isFinished ? (
                                    <input type="checkbox" checked={checked} onChange={(e) => bulk.toggle(t.id)} onClick={(e) => { e.stopPropagation(); if (e.shiftKey) bulk.toggleRange(t.id, audioIds); }} className="ml-2 h-4 w-4 shrink-0 accent-primary" />
                                  ) : null}
                                  <div className="flex-1 min-w-0" onClick={() => { if (selectMode && isAudio && isFinished) { const cb = bulk.has(t.id); if (cb) bulk.remove(t.id); else bulk.toggle(t.id); } }}>
                                    {wrapped}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
      <BottomNav />
      {menuAnchor ? (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={transferMenu(
            { user: menuAnchor.transfer.username, fileName: menuAnchor.transfer.fileName, virtualPath: menuAnchor.transfer.virtualPath },
            menuAnchor.isUpload,
            {
              onResume: () => menuAnchor.isUpload ? clearTransfer(menuAnchor.transfer.id, true) : resumeDownload(menuAnchor.transfer.id),
              onPause: () => menuAnchor.isUpload ? clearTransfer(menuAnchor.transfer.id, true) : pauseDownload(menuAnchor.transfer.id),
              onRemove: () => menuAnchor.isUpload ? clearTransfer(menuAnchor.transfer.id, true) : cancelDownload(menuAnchor.transfer.id),
              onRetry: () => retryDownload(menuAnchor.transfer.id),
              onClear: () => clearTransfer(menuAnchor.transfer.id, menuAnchor.isUpload),
              onAnalyzeSpectrum: menuAnchor.isUpload
                ? undefined
                : isAudioForSpectrum(menuAnchor.transfer.fileName) && menuAnchor.transfer.status === "Finished"
                  ? () => requestSpectrum(menuAnchor.transfer.id, {
                      fileName: menuAnchor.transfer.fileName,
                      size: menuAnchor.transfer.size,
                      token: parseDownloadToken(menuAnchor.transfer as unknown as { downloadUrl?: string }),
                    })
                  : undefined,
              hasSpectrum: !!getEntry(menuAnchor.transfer.id) && getEntry(menuAnchor.transfer.id)?.status === "done",
              onEditTags: !isDemo && isAudioForSpectrum(menuAnchor.transfer.fileName) && menuAnchor.transfer.status === "Finished"
                ? () => setTagFile(menuAnchor.transfer.fileName)
                : undefined,
              onPlay: !isDemo && !menuAnchor.isUpload && menuAnchor.transfer.status === "Finished" &&
                !!(menuAnchor.transfer as unknown as { downloadUrl?: string }).downloadUrl &&
                !!downloadPlayUrl((menuAnchor.transfer as unknown as { downloadUrl: string }).downloadUrl, menuAnchor.transfer.fileName)
                ? () => handlePlay(menuAnchor.transfer)
                : undefined,
            }
          )}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
      {tagFile ? <TagEditor open={!!tagFile} fileName={tagFile} onClose={() => setTagFile(null)} /> : null}
      <BulkBar count={bulk.size} onClear={bulk.clear} onEdit={() => setBulkEditor(true)} onScrape={() => setBulkScrape(true)} onVerify={handleBulkVerify} onAnalyze={handleBulkAnalyze} onSpectrum={handleBulkSpectrum} />
      {bulkEditor ? <BulkTagEditor open={bulkEditor} files={selectedFileNames} onClose={() => setBulkEditor(false)} onSaved={() => bulk.clear()} /> : null}
      {bulkScrape ? <BulkScrapeModal open={bulkScrape} files={selectedFileNames} onClose={() => setBulkScrape(false)} /> : null}
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
            <div className="px-6 py-3 border-t flex justify-end">
              <button onClick={() => setBulkResult(null)} className="rounded-full bg-primary px-5 py-2 font-label text-xs font-bold text-on-primary">Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function DownloadsPage() {
  return (
    <RequireAuth>
      <DownloadsInner />
    </RequireAuth>
  );
}
