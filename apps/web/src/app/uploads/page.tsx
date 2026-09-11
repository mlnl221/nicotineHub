"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
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
import { TagEditor } from "@/components/tag/TagEditor";
import { BulkBar } from "@/components/tag/BulkBar";
import { BulkTagEditor } from "@/components/tag/BulkTagEditor";
import { AdjustTagsModal } from "@/components/tag/AdjustTagsModal";
import { useBulkSelection, useMarqueeSelection } from "@/lib/bulkSelection";
import { UPLOAD_CLEAR_SETS } from "@/lib/transfers";
import { bulkVerify, bulkAnalyze, bulkRequestSpectrum } from "@/lib/worker";
import { useSpectrum } from "@/lib/spectrum";

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  const mb = bps / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bps / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function getFolder(vp: string): string { const idx = vp.lastIndexOf("\\"); return idx >= 0 ? (vp.slice(0, idx) || "(root)") : "(root)"; }
function UploadsInner() {
  const { uploads, downloads, stats, clearTransfer, cancelUpload, clearMany, abortTransfer, banUser, messageAll } = useTransfers();
  const { settings, setOption } = useConfig();
  const searches = useSearchesOptional();
  const router = useRouter();
  const totalDown = stats?.downloadSpeed ?? downloads.filter(d => d.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const totalUp = stats?.uploadSpeed ?? uploads.filter(u=>u.status==="Transferring").reduce((s,t)=>s+t.speed,0);
  const activeCount = downloads.length + uploads.length;
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; transfer: import("@/lib/protocol").Transfer } | null>(null);
  const [tagFile, setTagFile] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const bulk = useBulkSelection();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bulkEditor, setBulkEditor] = useState(false);
  const [bulkScrape, setBulkScrape] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ title: string; rows: Array<Record<string, unknown>> } | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [clearOpen, setClearOpen] = useState(false);
  const { requestSpectrum } = useSpectrum();
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
  const transferIds = uploads.map((u) => u.id);
  const marquee = useMarqueeSelection(bulk.setSelection);
  // Drop picks for uploads that vanished so the count bar never counts ghosts.
  const liveIds = uploads.map((u) => u.id).join("|");
  useEffect(() => {
    if (!bulk.size) return;
    const live = new Set(uploads.map((u) => u.id));
    if ([...bulk.selected].some((id) => !live.has(id))) bulk.setSelection([...bulk.selected].filter((id) => live.has(id)));
  }, [liveIds]);
  const selectedFileNames = Array.from(bulk.selected).map((id) => uploads.find((u) => u.id === id)?.fileName).filter(Boolean) as string[];
  // Tag/verify/analyze/spectrum bulk ops stay capped at 50 files; transfer selection itself is uncapped.
  const capTagFiles = (files: string[]) => {
    if (files.length > 50) {
      window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Tag bulk limit", body: "First 50 files used for tag operations." } }));
      return files.slice(0, 50);
    }
    return files;
  };
  const handleBulkVerify = async () => {
    const files = capTagFiles(selectedFileNames);
    if (!files.length) return;
    try { const r = await bulkVerify(files); setBulkResult({ title: `Verify — ${files.length} files`, rows: r.results as Array<Record<string, unknown>> }); } catch (e) { setBulkResult({ title: "Verify error", rows: [{ error: e instanceof Error ? e.message : String(e) }] }); }
  };
  const handleBulkAnalyze = async () => {
    const files = capTagFiles(selectedFileNames);
    if (!files.length) return;
    try { const r = await bulkAnalyze(files); setBulkResult({ title: `Analyze — ${files.length} files`, rows: r.results as Array<Record<string, unknown>> }); } catch (e) { setBulkResult({ title: "Analyze error", rows: [{ error: e instanceof Error ? e.message : String(e) }] }); }
  };
  const handleBulkSpectrum = async () => {
    const names = capTagFiles(Array.from(bulk.selected).map((id) => uploads.find((u) => u.id === id)?.fileName).filter(Boolean) as string[]);
    const files = names.map((fileName) => ({ fileName }));
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
       const next = Math.max(0, Math.min(transferIds.length - 1, focusedIdx + dir));
       setFocusedIdx(next);
       const id = transferIds[next];
       if (e.shiftKey && id) bulk.toggleRange(id, transferIds);
       else if (id && !e.shiftKey) bulk.toggle(id);
    }
  };

  const selectedTransfers = uploads.filter((t) => bulk.has(t.id));
  const bulkAbort = () => {
    selectedTransfers.filter((t) => t.status !== "Finished" && t.status !== "Cancelled").forEach((t) => abortTransfer(t.id, true));
  };
  const bulkAbortUsers = () => {
    const users = new Set(selectedTransfers.map((t) => t.username));
    if (!users.size) return;
    uploads.filter((t) => users.has(t.username) && t.status !== "Finished" && t.status !== "Cancelled").forEach((t) => abortTransfer(t.id, true));
  };
  const handleMessageAll = () => {
    const users = [...new Set((selectedTransfers.length ? selectedTransfers : uploads).map((t) => t.username))];
    if (!users.length) return;
    const msg = window.prompt(`Message ${users.length} user(s)${selectedTransfers.length ? " (selected)" : " (all uploading)"}:`);
    if (msg) messageAll(users, msg);
  };
  const bulkRemove = () => {
    if (selectedTransfers.length > 1 && !window.confirm(`Remove ${selectedTransfers.length} selected uploads?`)) return;
    selectedTransfers.forEach((t) => clearTransfer(t.id, true));
    bulk.clear();
  };

  const handleDoubleClick = (t: import("@/lib/protocol").Transfer) => {
    const action = settings.transfers.upload_doubleclick;
    switch (action) {
      case 0: break;
      case 1: window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Open", body: "No file to open" } })); break;
      case 2: window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Open", body: "Browser cannot open file manager" } })); break;
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
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
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
              <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">Demo preview — 1 download + 1 upload simulated below (animated). New downloads are disabled on Vercel — search, chat, profiles &amp; browse are mocked.</p>
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
                {!isDemo ? (
                  <button onClick={() => setSelectMode((v) => !v)} className={`inline-flex items-center gap-1 rounded-full px-3 min-h-11 py-1 text-xs font-semibold ${selectMode ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}>
                    <span className="material-symbols-outlined text-[14px]">{selectMode ? "check_box" : "check_box_outline_blank"}</span> {selectMode ? `Selecting (${bulk.size})` : "Select"}
                  </button>
                ) : null}
                   {selectMode && transferIds.length ? (
                  <>
                    <label className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 min-h-11 py-1 text-xs font-semibold cursor-pointer" title="Select all">
                      <input type="checkbox" aria-label="Select all uploads" checked={transferIds.length > 0 && bulk.size === transferIds.length} ref={(el) => { if (el) el.indeterminate = bulk.size > 0 && bulk.size < transferIds.length; }} onChange={() => (bulk.size === transferIds.length ? bulk.clear() : bulk.selectAll(transferIds))} className="h-4 w-4 accent-primary" />
                      All
                    </label>
                    <button onClick={() => bulk.clear()} className="inline-flex rounded-full bg-surface-container-high px-2 min-h-11 py-1 text-xs">Clear</button>
                  </>
                ) : null}
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
            {selectMode ? <p className="font-body text-[10px] text-outline">Select-all covers every row, any user/grouping · Tag ops use first 50 · Shift+click / Shift+↑/↓ extends range</p> : null}
            {/* Nicotine-plus parity toolbar: always visible, touch-sized */}
            <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Upload actions">
              <button onClick={bulkAbort} disabled={!selectedTransfers.length} title="Abort selected uploads" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 min-h-11 py-1 text-xs font-semibold disabled:opacity-40">
                <span className="material-symbols-outlined text-[16px]">block</span> Abort
              </button>
              <button onClick={bulkAbortUsers} disabled={!selectedTransfers.length} title="Abort every upload from the selected users" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 min-h-11 py-1 text-xs font-semibold disabled:opacity-40">
                <span className="material-symbols-outlined text-[16px]">group_off</span> Abort Users
              </button>
              <button onClick={bulkRemove} disabled={!selectedTransfers.length} title="Remove selected uploads" className="inline-flex items-center gap-1 rounded-full bg-error-container px-3 min-h-11 py-1 text-xs font-semibold text-on-error-container disabled:opacity-40">
                <span className="material-symbols-outlined text-[16px]">delete</span> Remove
              </button>
              <button onClick={() => clearMany(true, UPLOAD_CLEAR_SETS["finished-cancelled"] ?? null)} title="Clear all finished/cancelled uploads" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 min-h-11 py-1 text-xs font-semibold">
                <span className="material-symbols-outlined text-[16px]">done_all</span> Clear Finished
              </button>
              <button onClick={handleMessageAll} title="Private-message uploading users (selected, or all)" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 min-h-11 py-1 text-xs font-semibold">
                <span className="material-symbols-outlined text-[16px]">chat_bubble</span> Message All
              </button>
              <div className="relative">
                <button onClick={() => setClearOpen((v) => !v)} aria-haspopup="menu" aria-expanded={clearOpen} title="Clear uploads by status" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 min-h-11 py-1 text-xs font-semibold">
                  <span className="material-symbols-outlined text-[16px]">clear_all</span> Clear All <span className="material-symbols-outlined text-[14px]">{clearOpen ? "expand_less" : "expand_more"}</span>
                </button>
                {clearOpen ? (
                  <div role="menu" className="absolute left-0 z-50 mt-1 w-60 overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl ghost-border">
                    {[
                      { label: "Finished / Cancelled / Failed", key: "finished-cancelled-failed" },
                      { label: "Finished / Cancelled", key: "finished-cancelled" },
                      { label: "Finished", key: "finished" },
                      { label: "Cancelled", key: "cancelled" },
                      { label: "Failed", key: "failed" },
                      { label: "User Logged Off", key: "logged-off" },
                      { label: "Queued…", key: "queued", confirm: "Clear queued uploads?" },
                      { label: "Everything…", key: "all", confirm: "Clear all uploads?", danger: true },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        role="menuitem"
                        onClick={() => { if (opt.confirm && !window.confirm(opt.confirm)) return; clearMany(true, UPLOAD_CLEAR_SETS[opt.key] ?? null); setClearOpen(false); }}
                        className={`flex w-full items-center px-4 min-h-11 text-left text-xs font-semibold hover:bg-surface-container-high ${opt.danger ? "text-error" : ""}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {uploads.length === 0 ? (
              <div data-testid="empty-uploads" className="py-16 text-center">
                <p className="font-body text-on-surface-variant">No active uploads</p>
                <div className="mt-4 bg-tertiary-fixed/30 dark:bg-tertiary-container/20 rounded-lg p-4 flex gap-3 items-start max-w-lg mx-auto text-left">
                  <span className="material-symbols-outlined text-tertiary text-xl">info</span>
                  <div>
                    <p className="font-label text-xs font-semibold text-on-tertiary-container dark:text-tertiary-fixed">No shared folders configured</p>
                    <p className="font-label text-xs text-on-surface-variant mt-1">Uploads are queued but cannot start until you configure Shares (Settings → Shares). The queue stays visible in the meantime.</p>
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
                        <div onKeyDown={handleKeyDown} tabIndex={selectMode ? 0 : -1} className="space-y-3 outline-none">
                          {items.map((t) => {
                             const checked = bulk.has(t.id);
                             return (
                              <div key={t.id} {...marquee(t.id)} className={`flex items-center gap-2 rounded-xl ${checked ? "ring-1 ring-primary bg-primary-fixed/10" : ""} ${selectMode && focusedIdx === transferIds.indexOf(t.id) ? "ring-1 ring-primary" : ""}`} onDoubleClick={() => !selectMode && handleDoubleClick(t)} onClick={(e) => { marquee(t.id).onClick(e); if (e.defaultPrevented || (e.target as HTMLElement).closest("button,input")) return; if (selectMode || e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); if (e.shiftKey) bulk.toggleRange(t.id, transferIds); else bulk.toggle(t.id); } }} onPointerDown={(e) => { if (e.pointerType === "touch") longPressTimer.current = setTimeout(() => { setSelectMode(true); bulk.toggle(t.id); navigator.vibrate?.(10); }, 500); }} onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }} onPointerCancel={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }} onContextMenu={(e) => { if (selectMode) return; e.preventDefault(); e.stopPropagation(); setMenuAnchor({ x: e.clientX, y: e.clientY, transfer: t }); }}>
                               {selectMode ? (
                                 <input type="checkbox" checked={checked} onChange={() => bulk.toggle(t.id)} onClick={(e) => { e.stopPropagation(); if (e.shiftKey) bulk.toggleRange(t.id, transferIds); }} className="ml-2 h-4 w-4 shrink-0 accent-primary" />
                              ) : null}
                               <div className="flex-1 min-w-0">
                                <TransferCard transfer={t} onCancel={() => cancelUpload(t.id)} onClear={() => clearTransfer(t.id, true)} onMenu={(x, y) => setMenuAnchor({ x, y, transfer: t })} />
                              </div>
                            </div>
                          );})}
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
          items={transferMenu({ user: menuAnchor.transfer.username, fileName: menuAnchor.transfer.fileName, virtualPath: menuAnchor.transfer.virtualPath }, true, {
            onPause: () => abortTransfer(menuAnchor.transfer.id, true),
            onRemove: () => clearTransfer(menuAnchor.transfer.id, true),
            onClear: () => clearTransfer(menuAnchor.transfer.id, true),
            onClearMany: (s) => clearMany(true, s),
            onBan: () => banUser(menuAnchor.transfer.username),
            onEditTags: isDemo ? undefined : ["mp3","flac","ogg","m4a","wav","wma","aac","opus","aiff","aif","wv"].includes(menuAnchor.transfer.fileName.toLowerCase().split(".").pop() ?? "") ? () => setTagFile(menuAnchor.transfer.fileName) : undefined,
            onAnalyzeSpectrum: isDemo ? undefined : ["flac","wav","aiff","aif","mp3","ogg","wma","m4a","wv","aac","opus"].includes(menuAnchor.transfer.fileName.toLowerCase().split(".").pop() ?? "") ? () => requestSpectrum(menuAnchor.transfer.id, { fileName: menuAnchor.transfer.fileName }) : undefined,
            hasSpectrum: false,
          })}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
      {tagFile ? <TagEditor open={!!tagFile} fileName={tagFile} onClose={() => setTagFile(null)} /> : null}
       <BulkBar count={bulk.size} onClear={bulk.clear} onEdit={() => setBulkEditor(true)} onScrape={() => setBulkScrape(true)} onVerify={handleBulkVerify} onAnalyze={handleBulkAnalyze} onSpectrum={handleBulkSpectrum} onRemove={bulkRemove} />
      {bulkEditor ? <BulkTagEditor open={bulkEditor} files={selectedFileNames.slice(0, 50)} onClose={() => setBulkEditor(false)} onSaved={() => bulk.clear()} /> : null}
      {bulkScrape ? <AdjustTagsModal open={bulkScrape} files={selectedFileNames.slice(0, 50)} onClose={() => setBulkScrape(false)} /> : null}
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

export default function UploadsPage() {
  return (
    <RequireAuth>
      <UploadsInner />
    </RequireAuth>
  );
}
