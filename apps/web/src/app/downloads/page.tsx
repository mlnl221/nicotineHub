"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { useTransfers } from "@/lib/transfers";
import { TransferCard } from "@/components/transfers/TransferCard";

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
      <main className="relative ml-72 flex min-h-screen flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-40 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-10 py-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4 border-b border-transparent shadow-sm shadow-on-surface/5">
          <div>
            <h2 className="font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Downloads &amp; Uploads</h2>
            <p className="font-body text-on-surface-variant dark:text-outline text-sm mt-1">Monitoring {activeCount} active connections</p>
          </div>
          <div className="flex items-center gap-4">
            <div data-testid="download-speed" className="bg-surface-container-low dark:bg-surface-container-high px-4 py-2 rounded-lg flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">arrow_downward</span>
              <span className="font-label font-semibold text-sm">{humanSpeed(totalDown)}</span>
            </div>
            <div data-testid="upload-speed" className="bg-surface-container-low dark:bg-surface-container-high px-4 py-2 rounded-lg flex items-center gap-3">
              <span className="material-symbols-outlined text-tertiary">arrow_upward</span>
              <span className="font-label font-semibold text-sm">{humanSpeed(totalUp)}</span>
            </div>
            <a href="/settings" className="bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors flex items-center justify-center" aria-label="Settings">
              <span className="material-symbols-outlined">settings</span>
            </a>
          </div>
        </header>

        <div className="p-10 space-y-8 max-w-screen-2xl mx-auto w-full">
          <section className="bg-surface dark:bg-surface-container-low rounded-xl p-6 relative overflow-hidden h-64 flex flex-col justify-between ghost-border">
            <div className="z-10 relative">
              <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline mb-1">Network Throughput</h3>
              <div className="font-headline text-2xl font-semibold dark:text-on-surface">Real-time Bandwidth</div>
              <p className="font-label text-xs text-outline mt-1">Live chart in Phase 6 — placeholder</p>
            </div>
            <div className="absolute inset-0 w-full h-full opacity-40 pointer-events-none" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(9, 76, 178, 0.05) 100%)" }}>
              <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                <path d="M0,80 Q25,60 50,70 T100,40 L100,100 L0,100 Z" fill="rgba(9, 76, 178, 0.1)"></path>
                <path d="M0,80 Q25,60 50,70 T100,40" fill="none" stroke="#094cb2" strokeWidth="0.5"></path>
                <path d="M0,90 Q30,85 60,95 T100,80 L100,100 L0,100 Z" fill="rgba(109, 94, 0, 0.1)"></path>
                <path d="M0,90 Q30,85 60,95 T100,80" fill="none" stroke="#6d5e00" strokeWidth="0.5"></path>
              </svg>
            </div>
          </section>

          {/* Mobile tab switcher */}
          <div className="flex xl:hidden rounded-xl bg-surface-container-low p-1 gap-1">
            <button
              data-testid="tab-downloads"
              onClick={() => setTab("downloads")}
              className={`flex-1 py-2.5 rounded-lg font-label text-sm font-semibold transition-colors ${tab==="downloads" ? "bg-surface-container-lowest shadow text-primary" : "text-on-surface-variant"}`}
            >
              Downloading ({dlCount})
            </button>
            <button
              data-testid="tab-uploads"
              onClick={() => setTab("uploads")}
              className={`flex-1 py-2.5 rounded-lg font-label text-sm font-semibold transition-colors ${tab==="uploads" ? "bg-surface-container-lowest shadow text-primary" : "text-on-surface-variant"}`}
            >
              Uploading ({ulCount})
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <section data-testid="downloads-section" className={`${tab==="downloads" ? "flex" : "hidden"} xl:flex flex-col gap-4 bg-surface dark:bg-surface-container-low rounded-xl p-6 ghost-border`}>
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

            <section data-testid="uploads-section" className={`${tab==="uploads" ? "flex" : "hidden"} xl:flex flex-col gap-4 bg-surface dark:bg-surface-container-low rounded-xl p-6 ghost-border`}>
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
