"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
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
import { useSpectrum } from "@/lib/spectrum";
import { SpectrumHoverCard } from "@/components/transfers/SpectrumHoverCard";
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
  const { downloads, uploads, stats, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer } = useTransfers();
  const { total } = useStatistics();
  const { settings, setOption } = useConfig();
  const searches = useSearchesOptional();
  const router = useRouter();
  const { requestSpectrum, getEntry } = useSpectrum();
  const totalDown = stats?.downloadSpeed ?? downloads.filter(d => d.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const totalUp = stats?.uploadSpeed ?? uploads.filter(u=>u.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const activeCount = downloads.length + uploads.length;
  const [tab, setTab] = useState<"downloads" | "uploads">("downloads");
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; transfer: import("@/lib/protocol").Transfer; isUpload: boolean } | null>(null);

  const dlCount = downloads.length;
  const ulCount = uploads.length;
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

  const handleDoubleClick = (t: import("@/lib/protocol").Transfer, isUpload: boolean) => {
    const action = isUpload ? settings.transfers.upload_doubleclick : settings.transfers.download_doubleclick;
    // 0 Nothing,1 Open File,2 Open in File Manager,3 Search,4 Pause/Abort,5 Remove,6 Resume/Retry,7 Browse Folder
    switch (action) {
      case 0: break;
      case 1: {
        if (t.status === "Finished" && (t as unknown as { downloadUrl?: string }).downloadUrl) window.open((t as unknown as { downloadUrl: string }).downloadUrl, "_blank");
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
      <TopBar title="Downloads" subtitle={`${dlCount} downloading • ${ulCount} uploading`} />
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

          {/* Mobile tab switcher — downloads tab + download stats replacing uploads button per design */}
          <div className="flex xl:hidden rounded-xl bg-surface-container-low p-1 gap-1">
            <button
              data-testid="tab-downloads"
              onClick={() => setTab("downloads")}
              className={`flex-1 min-h-11 py-3 rounded-lg font-label text-xs sm:text-sm font-semibold truncate transition-colors ${tab==="downloads" ? "bg-surface-container-lowest shadow text-primary" : "text-on-surface-variant"}`}
            >
              Downloading ({dlCount})
            </button>
            <div
              data-testid="download-stats"
              className="flex-1 min-h-11 py-2 px-2 rounded-lg bg-surface-container-lowest ghost-border flex flex-col items-center justify-center text-center"
            >
              <span className="font-label text-[10px] leading-none uppercase tracking-widest text-outline">All-time Downloads</span>
              <span className="font-label text-xs font-semibold text-on-surface truncate">{dlDone} files • {humanSize(dlSize)} • {dlPeers} peers</span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-full overflow-hidden">
            <section data-testid="downloads-section" className={`${tab==="downloads" ? "flex" : "hidden"} xl:flex flex-col gap-4 bg-surface dark:bg-surface-container-low rounded-xl p-4 md:p-6 ghost-border max-w-full overflow-hidden`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-headline text-xl font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">download</span>
                  Downloading ({dlCount})
                </h3>
                <div className="flex items-center gap-1">
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
                          <div className="space-y-3">
                            {items.map((t) => {
                              const spectrumEntry = getEntry(t.id);
                              const hasSpectrum = spectrumEntry?.status === "done";
                              const isFinished = t.status === "Finished";
                              const canAnalyze = isFinished && isAudioForSpectrum(t.fileName);
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
                              // Wrap with SpectrumHoverCard if finished audio or has spectrum
                              const wrapped = isFinished && isAudioForSpectrum(t.fileName) ? (
                                <SpectrumHoverCard transferId={t.id} fileName={t.fileName}>{card}</SpectrumHoverCard>
                              ) : card;
                              return (
                                <div key={t.id} onDoubleClick={() => handleDoubleClick(t, false)} onContextMenu={(e) => { e.preventDefault(); setMenuAnchor({ x: e.clientX, y: e.clientY, transfer: t, isUpload: false }); }}>
                                  {wrapped}
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

            <section data-testid="uploads-section" className={`${tab==="uploads" ? "flex" : "hidden"} xl:flex flex-col gap-4 bg-surface dark:bg-surface-container-low rounded-xl p-4 md:p-6 ghost-border max-w-full overflow-hidden`}>
              <h3 className="font-headline text-xl font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary">upload</span>
                Uploading ({ulCount})
              </h3>
              {uploads.length === 0 ? (
                <div data-testid="empty-uploads" className="py-12 text-center">
                  <p className="font-body text-on-surface-variant">No active uploads</p>
                  <p className="font-label text-xs text-outline mt-2 max-w-sm mx-auto">Uploads are queued but cannot start until you configure Shares. This matches nicotine+ behavior where uploads remain visible but disabled when no shares are set.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {uploads.map((t) => (
                    <div key={t.id} onContextMenu={(e) => { e.preventDefault(); setMenuAnchor({ x: e.clientX, y: e.clientY, transfer: t, isUpload: true }); }}>
                      <TransferCard
                        transfer={t}
                        onCancel={() => clearTransfer(t.id, true)}
                        onClear={() => clearTransfer(t.id, true)}
                      />
                    </div>
                  ))}
                </div>
              )}
              {uploads.length === 0 && (
                <div className="bg-tertiary-fixed/30 dark:bg-tertiary-container/20 rounded-lg p-4 flex gap-3 items-start">
                  <span className="material-symbols-outlined text-tertiary text-xl">info</span>
                  <div>
                    <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">No shared folders</p>
                    <p className="font-label text-xs text-on-surface-variant mt-1">Configure shared folders in Settings → Shares to enable uploads. Queue remains inspectable.</p>
                  </div>
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
                  ? () => requestSpectrum(menuAnchor.transfer.id)
                  : undefined,
              hasSpectrum: !!getEntry(menuAnchor.transfer.id) && getEntry(menuAnchor.transfer.id)?.status === "done",
            }
          )}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
    </div>
  );
}

export default function DownloadsPage() {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "failed") router.replace("/");
  }, [state.status, router]);
  if (state.status === "idle" || state.status === "connecting") return <div className="flex h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (state.status !== "connected") return null;
  return <DownloadsInner />;
}
