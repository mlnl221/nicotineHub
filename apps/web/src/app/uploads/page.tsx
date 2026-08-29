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
import { UploadStats } from "@/components/transfers/StatsCards";
import { PageHeader } from "@/components/PageHeader";
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

function UploadsInner() {
  const { uploads, downloads, stats, clearTransfer } = useTransfers();
  const totalDown = stats?.downloadSpeed ?? downloads.filter(d => d.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const totalUp = stats?.uploadSpeed ?? uploads.filter(u=>u.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const activeCount = downloads.length + uploads.length;
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; transfer: import("@/lib/protocol").Transfer } | null>(null);

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Uploads" subtitle={`${uploads.length} uploading • ${downloads.length} total`} />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-hidden pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <PageHeader
          title="Uploads"
          subtitle={`${activeCount} active`}
          mobileSubtitle={`${activeCount} active •`}
          desktopSubtitle={`Monitoring ${activeCount} connections — Uploads visible even when shares not configured`}
          downloadSpeed={humanSpeed(totalDown)}
          uploadSpeed={humanSpeed(totalUp)}
          showSpeeds
          settingsHref="/settings?tab=uploads#uploads"
        />

        <div className="p-4 md:p-10 space-y-6 md:space-y-8 max-w-screen-2xl mx-auto w-full">
          {isDemo ? (
            <div className="rounded-xl bg-tertiary-fixed/20 dark:bg-tertiary-container/20 px-4 py-3 flex items-center gap-3 ghost-border">
              <span className="material-symbols-outlined text-tertiary">info</span>
              <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">Demo preview — 1 upload simulated below (see Downloads for both). New transfers are disabled on Vercel.</p>
            </div>
          ) : null}
          <ThroughputChart />
          <UploadStats />
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
                  <div key={t.id} onContextMenu={(e) => { e.preventDefault(); setMenuAnchor({ x: e.clientX, y: e.clientY, transfer: t }); }}>
                    <TransferCard transfer={t} onCancel={() => clearTransfer(t.id, true)} onClear={() => clearTransfer(t.id, true)} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <BottomNav />
      {menuAnchor ? (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={transferMenu({ user: menuAnchor.transfer.username, fileName: menuAnchor.transfer.fileName, virtualPath: menuAnchor.transfer.virtualPath }, true, { onRemove: () => clearTransfer(menuAnchor.transfer.id, true), onClear: () => clearTransfer(menuAnchor.transfer.id, true) })}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
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
