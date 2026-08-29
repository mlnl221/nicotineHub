"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { useTransfers } from "@/lib/transfers";
import { TransferCard } from "@/components/transfers/TransferCard";
import { isDemo } from "@/lib/demo";

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  const mb = bps / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bps / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function UploadsInner() {
  const { uploads, downloads, stats, clearTransfer } = useTransfers();
  const totalDown = stats?.downloadSpeed ?? downloads.filter(d => d.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const totalUp = stats?.uploadSpeed ?? uploads.filter(u=>u.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const activeCount = downloads.length + uploads.length;

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Transfers" />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-hidden pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <header className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
          <div>
            <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Uploads</h2>
            <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">{activeCount} active • <span className="md:hidden font-label text-xs">{humanSpeed(totalDown)} ↓ • {humanSpeed(totalUp)} ↑</span><span className="hidden md:inline">Monitoring {activeCount} connections — Uploads visible even when shares not configured</span></p>
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
            <a href="/downloads" className="hidden md:inline font-label text-sm font-semibold text-primary hover:underline">Downloads</a>
          </div>
        </header>

        <div className="p-4 md:p-10 space-y-6 md:space-y-8 max-w-screen-2xl mx-auto w-full">
          {isDemo ? (
            <div className="rounded-xl bg-tertiary-fixed/20 dark:bg-tertiary-container/20 px-4 py-3 flex items-center gap-3 ghost-border">
              <span className="material-symbols-outlined text-tertiary">info</span>
              <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">Demo preview — 1 upload simulated below (see Downloads for both). New transfers are disabled on Vercel.</p>
            </div>
          ) : null}
          <section data-testid="uploads-section" className="bg-surface dark:bg-surface-container-low rounded-xl p-4 md:p-6 ghost-border flex flex-col gap-4 max-w-full overflow-hidden">
            <h3 className="font-headline text-xl font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-tertiary">upload</span>
              Uploading ({uploads.length})
            </h3>
            {uploads.length === 0 ? (
              <div data-testid="empty-uploads" className="py-16 text-center">
                <p className="font-body text-on-surface-variant">No active uploads</p>
                <div className="mt-4 bg-tertiary-fixed/30 dark:bg-tertiary-container/20 rounded-lg p-4 flex gap-3 items-start max-w-lg mx-auto text-left">
                  <span className="material-symbols-outlined text-tertiary text-xl">info</span>
                  <div>
                    <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">No shared folders configured</p>
                    <p className="font-label text-xs text-on-surface-variant mt-1">Uploads are queued but cannot start until you configure Shares (Settings → Shares). Queue remains inspectable — matching nicotine+.</p>
                  </div>
                </div>
                <a href="/downloads" className="mt-6 inline-flex font-label text-sm font-semibold text-primary hover:underline">View Downloads</a>
              </div>
            ) : (
              <div className="space-y-4">
                {uploads.map((t) => (
                  <TransferCard key={t.id} transfer={t} onCancel={() => clearTransfer(t.id, true)} onClear={() => clearTransfer(t.id, true)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

export default function UploadsPage() {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);
  if (state.status !== "connected") return null;
  return <UploadsInner />;
}
