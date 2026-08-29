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
import { UploadStats } from "@/components/transfers/StatsCards";
import { PageHeader } from "@/components/PageHeader";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { transferMenu } from "@/lib/context-menu/menus";
import { useConfig } from "@/lib/config/provider";
import { useSearchesOptional } from "@/lib/search";
import { isDemo } from "@/lib/demo";

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  const mb = bps / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bps / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function getFolder(vp: string): string { const idx = vp.lastIndexOf("\\"); return idx >= 0 ? (vp.slice(0, idx) || "(root)") : "(root)"; }
function UploadsInner() {
  const { uploads, downloads, stats, clearTransfer } = useTransfers();
  const { settings, setOption } = useConfig();
  const searches = useSearchesOptional();
  const router = useRouter();
  const totalDown = stats?.downloadSpeed ?? downloads.filter(d => d.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const totalUp = stats?.uploadSpeed ?? uploads.filter(u=>u.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const activeCount = downloads.length + uploads.length;
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; transfer: import("@/lib/protocol").Transfer } | null>(null);
  const groupMode = settings.transfers.groupuploads ?? "folder_grouping";
  const expandMode = settings.transfers.expand_uploads ?? "all";
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (groupMode === "ungrouped") { setCollapsed(new Set()); return; }
    const keys = (() => { const m = new Map<string, unknown>(); uploads.forEach((t) => { const k = groupMode === "user_grouping" ? t.username : getFolder(t.virtualPath); m.set(k, true); }); return [...m.keys()]; })();
    if (expandMode === "all") setCollapsed(new Set());
    else if (expandMode === "none") setCollapsed(new Set(keys));
    else if (expandMode === "partial") setCollapsed(new Set(keys.slice(Math.floor(keys.length/2))));
  }, [groupMode, expandMode, uploads.map(u=>u.id).join("|")]);
  const uploadGroups = (() => {
    if (groupMode === "ungrouped") return [["ungrouped", uploads] as [string, typeof uploads]];
    const map = new Map<string, typeof uploads>();
    uploads.forEach((t) => { const k = groupMode === "user_grouping" ? t.username : getFolder(t.virtualPath); const arr = map.get(k); if (arr) arr.push(t); else map.set(k, [t]); });
    return [...map.entries()];
  })();
  const handleDoubleClick = (t: import("@/lib/protocol").Transfer) => {
    const action = settings.transfers.upload_doubleclick;
    switch (action) {
      case 0: break;
      case 1: window.dispatchEvent(new CustomEvent("nicotine:toast", { detail: { title: "Open", body: "No file to open" } })); break;
      case 2: window.dispatchEvent(new CustomEvent("nicotine:toast", { detail: { title: "Open", body: "Browser cannot open file manager" } })); break;
      case 3: searches ? searches.startSearch(t.fileName) : router.push(`/search?query=${encodeURIComponent(t.fileName)}`); break;
      case 4: clearTransfer(t.id, true); break;
      case 5: clearTransfer(t.id, true); break;
      case 6: clearTransfer(t.id, true); break;
      case 7: router.push(`/browse/${encodeURIComponent(t.username)}`); break;
      default: break;
    }
  };

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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-headline text-xl font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary">upload</span>
                Uploading ({uploads.length})
              </h3>
              <div className="flex items-center gap-1">
                <select value={groupMode} onChange={(e) => setOption("transfers", "groupuploads", e.target.value)} className="rounded-full bg-surface-container-high px-2 py-1 text-[10px] font-semibold outline-none">
                  <option value="folder_grouping">By Folder</option>
                  <option value="user_grouping">By User</option>
                  <option value="ungrouped">Ungrouped</option>
                </select>
                <select value={expandMode} onChange={(e) => setOption("transfers", "expand_uploads", e.target.value)} className="rounded-full bg-surface-container-low px-2 py-1 text-[10px] font-semibold outline-none">
                  <option value="all">Expand All</option>
                  <option value="partial">Partial</option>
                  <option value="none">Collapse</option>
                </select>
              </div>
            </div>
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
                <Link href="/downloads" className="mt-6 inline-flex font-label text-sm font-semibold text-primary hover:underline">View Downloads</Link>
              </div>
            ) : (
              <div className="space-y-4">
                {uploadGroups.map(([groupKey, items]) => {
                  const isCollapsed = groupMode !== "ungrouped" && collapsed.has(groupKey);
                  return (
                    <div key={groupKey}>
                      {groupMode !== "ungrouped" ? (
                        <button onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(groupKey)) n.delete(groupKey); else n.add(groupKey); return n; })} className="flex w-full items-center gap-2 py-2 text-left">
                          <span className="material-symbols-outlined text-[16px]">{isCollapsed ? "chevron_right" : "expand_more"}</span>
                          <span className="font-label text-xs font-semibold truncate">{groupKey}</span>
                          <span className="font-label text-[10px] text-outline">{items.length}</span>
                        </button>
                      ) : null}
                      {!isCollapsed ? (
                        <div className="space-y-3">
                          {items.map((t) => (
                            <div key={t.id} onDoubleClick={() => handleDoubleClick(t)} onContextMenu={(e) => { e.preventDefault(); setMenuAnchor({ x: e.clientX, y: e.clientY, transfer: t }); }}>
                              <TransferCard transfer={t} onCancel={() => clearTransfer(t.id, true)} onClear={() => clearTransfer(t.id, true)} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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
