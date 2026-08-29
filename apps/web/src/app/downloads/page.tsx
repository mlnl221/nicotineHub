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
import { isDemo } from "@/lib/demo";

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  const mb = bps / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bps / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function DownloadsInner() {
  const { downloads, uploads, stats, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer } = useTransfers();
  const totalDown = stats?.downloadSpeed ?? downloads.filter(d => d.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const totalUp = stats?.uploadSpeed ?? uploads.filter(u=>u.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const activeCount = downloads.length + uploads.length;
  const [tab, setTab] = useState<"downloads" | "uploads">("downloads");

  const dlCount = downloads.length;
  const ulCount = uploads.length;

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Transfers" />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-hidden pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <header className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
          <div>
            <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Downloads &amp; Uploads</h2>
            <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">{activeCount} active • <span className="md:hidden font-label text-xs">{humanSpeed(totalDown)} ↓ • {humanSpeed(totalUp)} ↑</span><span className="hidden md:inline">Monitoring {activeCount} connections</span></p>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <div data-testid="download-speed" className="hidden md:flex bg-surface-container-low dark:bg-surface-container-high px-4 py-2 rounded-full md:rounded-lg items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">arrow_downward</span>
              <span className="font-label font-semibold text-xs md:text-sm">{humanSpeed(totalDown)}</span>
            </div>
            <div data-testid="upload-speed" className="hidden md:flex bg-surface-container-low dark:bg-surface-container-high px-4 py-2 rounded-full md:rounded-lg items-center gap-2">
              <span className="material-symbols-outlined text-tertiary text-[18px]">arrow_upward</span>
              <span className="font-label font-semibold text-xs md:text-sm">{humanSpeed(totalUp)}</span>
            </div>
            <a href="/settings" className="hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center" aria-label="Settings">
              <span className="material-symbols-outlined">settings</span>
            </a>
          </div>
        </header>

        <div className="p-4 md:p-10 space-y-6 md:space-y-8 max-w-screen-2xl mx-auto w-full">
          {isDemo ? (
            <div className="rounded-xl bg-tertiary-fixed/20 dark:bg-tertiary-container/20 px-4 py-3 flex items-center gap-3 ghost-border">
              <span className="material-symbols-outlined text-tertiary">info</span>
              <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">Demo — downloads &amp; uploads are disabled on Vercel. Search, chat, profiles &amp; browse are mocked.</p>
            </div>
          ) : null}
          <ThroughputChart />

          {/* Mobile tab switcher */}
          <div className="flex xl:hidden rounded-xl bg-surface-container-low p-1 gap-1">
            <button
              data-testid="tab-downloads"
              onClick={() => setTab("downloads")}
              className={`flex-1 min-h-11 py-3 rounded-lg font-label text-xs sm:text-sm font-semibold truncate transition-colors ${tab==="downloads" ? "bg-surface-container-lowest shadow text-primary" : "text-on-surface-variant"}`}
            >
              Downloading ({dlCount})
            </button>
            <button
              data-testid="tab-uploads"
              onClick={() => setTab("uploads")}
              className={`flex-1 min-h-11 py-3 rounded-lg font-label text-xs sm:text-sm font-semibold truncate transition-colors ${tab==="uploads" ? "bg-surface-container-lowest shadow text-primary" : "text-on-surface-variant"}`}
            >
              Uploading ({ulCount})
            </button>
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
                    <TransferCard
                      key={t.id}
                      transfer={t}
                      onPause={() => pauseDownload(t.id)}
                      onCancel={() => cancelDownload(t.id)}
                      onResume={() => resumeDownload(t.id)}
                      onRetry={() => retryDownload(t.id)}
                      onClear={() => clearTransfer(t.id, false)}
                    />
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
                    <TransferCard
                      key={t.id}
                      transfer={t}
                      onCancel={() => clearTransfer(t.id, true)}
                      onClear={() => clearTransfer(t.id, true)}
                    />
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
