"use client";

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
import { isDemo } from "@/lib/demo";

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  const mb = bps / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bps / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function humanSize(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function DownloadsInner() {
  const { downloads, uploads, stats, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer } = useTransfers();
  const { total } = useStatistics();
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

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Downloads" subtitle={`${dlCount} downloading • ${ulCount} uploading`} />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-hidden pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
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
              <h3 className="font-headline text-xl font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">download</span>
                Downloading ({dlCount})
              </h3>
              {downloads.length === 0 ? (
                <div data-testid="empty-downloads" className="py-12 text-center">
                  <p className="font-body text-on-surface-variant">No active downloads</p>
                  <a href="/search" className="mt-3 inline-flex font-label text-sm font-semibold text-primary hover:underline">Search Files</a>
                </div>
              ) : (
                <div className="space-y-4">
                  {downloads.map((t) => (
                    <div key={t.id} onContextMenu={(e) => { e.preventDefault(); setMenuAnchor({ x: e.clientX, y: e.clientY, transfer: t, isUpload: false }); }}>
                      <TransferCard
                        transfer={t}
                        onPause={() => pauseDownload(t.id)}
                        onCancel={() => cancelDownload(t.id)}
                        onResume={() => resumeDownload(t.id)}
                        onRetry={() => retryDownload(t.id)}
                        onClear={() => clearTransfer(t.id, false)}
                      />
                    </div>
                  ))}
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
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);
  if (state.status !== "connected") return null;
  return <DownloadsInner />;
}
