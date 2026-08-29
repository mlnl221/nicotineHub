"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearches } from "@/lib/search";
import { applyFilters } from "@/lib/filter";
import { useTransfers } from "@/lib/transfers";
import type { SearchRow } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { useConfig } from "@/lib/config/provider";
import { WishlistManager } from "@/components/WishlistManager";
import { SearchBar } from "./SearchBar";
import { SearchTabs } from "./SearchTabs";
import { FilterBar } from "./FilterBar";
import { ResultsList } from "./ResultsList";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { searchResultMenu, searchTabMenu } from "@/lib/context-menu/menus";
import { useContextMenu } from "@/lib/context-menu/useContextMenu";
import { useWishlist } from "@/lib/wishlist";

export function SearchScreen() {
  const { activeTab, activeId, tabs, setActive, closeTab, startSearch, stopSearch, setFilters, clearFilters } = useSearches();
  const { requestDownload } = useTransfers();
  const { settings, setOption } = useConfig();
  const { getIgnored, markSeen } = useWishlist();
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(false);
  const [sheetRow, setSheetRow] = useState<SearchRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const ctxMenu = useContextMenu();
  const [menuRow, setMenuRow] = useState<SearchRow | null>(null);
  const [tabMenuAnchor, setTabMenuAnchor] = useState<{ x: number; y: number; tab: import("@/lib/search").SearchTab } | null>(null);

  const deferredRows = useDeferredValue(activeTab?.rows ?? []);
  const deferredFilters = useDeferredValue(activeTab?.filters ?? null);
  // Comlink worker for >500 rows — keeps main thread responsive, parity with pynicotine filter semantics via same applyFilters
  const [workerRows, setWorkerRows] = useState<SearchRow[] | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerApiRef = useRef<{ apply: (rows: SearchRow[], f: import("@/lib/protocol").FilterState) => Promise<SearchRow[]> } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (deferredRows.length <= 500) { setWorkerRows(null); return; }
    let cancelled = false;
    (async () => {
      try {
        if (!workerRef.current) {
          const w = new Worker(new URL("@/lib/filter.worker.ts", import.meta.url));
          workerRef.current = w;
          const Comlink = await import("comlink");
          workerApiRef.current = Comlink.wrap(w) as unknown as { apply: (r: SearchRow[], f: import("@/lib/protocol").FilterState) => Promise<SearchRow[]> };
        }
        if (!deferredFilters || !activeTab) return;
        const res = await workerApiRef.current!.apply(deferredRows, deferredFilters);
        if (!cancelled) setWorkerRows(res);
      } catch {
        if (!cancelled) setWorkerRows(null);
      }
    })();
    return () => { cancelled = true; };
  }, [deferredRows, deferredFilters, activeTab]);

  useEffect(() => {
    return () => { workerRef.current?.terminate(); workerRef.current = null; workerApiRef.current = null; };
  }, []);

  const visibleRows = useMemo(
    () => {
      let rows: typeof deferredRows;
      if (workerRows !== null && deferredRows.length > 500) rows = workerRows;
      else if (activeTab && deferredFilters) rows = applyFilters(deferredRows, deferredFilters);
      else if (activeTab) rows = applyFilters(activeTab.rows, activeTab.filters);
      else rows = [];
      // wishlist seen filtering: hide previously seen users
      if (activeTab?.mode === "wishlist") {
        const ignored = getIgnored(activeTab.query);
        if (ignored.size) rows = rows.filter((r) => !ignored.has(r.user));
      }
      return rows;
    },
    [activeTab, deferredRows, deferredFilters, workerRows, getIgnored],
  );
  const isStale = activeTab ? deferredRows !== activeTab.rows || deferredFilters !== activeTab.filters : false;

  // wishlist: mark visible users as seen when tab becomes active/read
  useEffect(() => {
    if (!activeTab || activeTab.mode !== "wishlist") return;
    if (visibleRows.length === 0) return;
    const users = [...new Set(visibleRows.map((r) => r.user))];
    // debounce seen marking 1s after visible
    const id = setTimeout(() => markSeen(activeTab.query, users), 1000);
    return () => clearTimeout(id);
  }, [activeTab?.id, visibleRows, markSeen]);

  const activeFilterCount = useMemo(() => {
    if (!activeTab) return 0;
    const f = activeTab.filters;
    let n = 0;
    if (f.include.trim()) n++;
    if (f.exclude.trim()) n++;
    if (f.fileType.trim()) n++;
    if (f.size.trim()) n++;
    if (f.bitrate.trim()) n++;
    if (f.length.trim()) n++;
    if (f.country.trim()) n++;
    if (f.freeSlot) n++;
    if (f.publicOnly) n++;
    return n;
  }, [activeTab]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const copyUrl = async (row: SearchRow, folder: boolean) => {
    const path = folder ? row.path.replace(/[^\\]*$/, "").replace(/\\$/, "") : row.path;
    const url = `slsk://${encodeURIComponent(row.user)}/${path.replace(/\\/g, "/")}`;
    try {
      await navigator.clipboard.writeText(url);
      flash("Link copied");
    } catch {
      flash(url);
    }
  };

  return (
    <div className="flex min-h-screen max-w-full overflow-x-hidden flex-col bg-surface-container-low dark:bg-inverse-surface" data-custom-menu>
      <header className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
        <div className="min-w-0 flex-1">
          <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Search</h2>
          <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">
            {activeTab ? (
              <>
                {visibleRows.length} of {activeTab.total} results
                {activeTab.status === "searching" ? " · searching…" : ""}
                {activeTab.mode !== "global" ? ` · ${activeTab.mode}${activeTab.target ? `:${activeTab.target}` : ""}` : ""}
                <span className="hidden md:inline"> • {tabs.length} tabs</span>
              </>
            ) : (
              <>Find files across the network • {tabs.length} tabs</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <Link href="/settings?tab=searches#searches" className="hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center" aria-label="Search settings">
            <span className="material-symbols-outlined">settings</span>
          </Link>
        </div>
      </header>
      <div className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-low/95 backdrop-blur dark:bg-inverse-surface/95 border-b border-outline-variant/10">
        <SearchBar
          onSearch={startSearch}
          onToggleFilters={() => setShowFilters((v) => !v)}
          activeFilterCount={activeFilterCount}
          searching={activeTab?.status === "searching"}
          onStop={() => activeId && stopSearch(activeId)}
        />
        <div
          onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            const pill = target.closest("[data-tab-id]") as HTMLElement | null;
            if (pill?.dataset.tabId) {
              e.preventDefault();
              const tab = tabs.find((t) => t.id === pill.dataset.tabId);
              if (tab) setTabMenuAnchor({ x: e.clientX, y: e.clientY, tab });
            }
          }}
        >
          <SearchTabs />
        </div>
        {showFilters && activeTab ? (
          <FilterBar
            filters={activeTab.filters}
            onChange={(partial) => activeId && setFilters(activeId, partial)}
            onClear={() => activeId && clearFilters(activeId)}
          />
        ) : null}
      </div>

      {activeTab ? (
        <div className="flex items-center justify-between gap-2 px-4 py-2 font-label text-xs text-on-surface-variant max-w-full overflow-hidden">
          <span className="min-w-0 flex-1 truncate">
            {visibleRows.length} of {activeTab.total} results
            {activeTab.status === "searching" ? " · searching…" : ""}
            {activeTab.reason === "max_results" ? " · limit reached" : ""}
            {activeTab.mode !== "global" ? ` · ${activeTab.mode}${activeTab.target ? `:${activeTab.target}` : ""}` : ""}
            {isStale ? " · filtering…" : ""}
            {visibleRows.length !== activeTab.total ? ` • showing ${visibleRows.length}` : ""}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <select
              value={settings.searches.group_searches}
              onChange={(e) => setOption("searches", "group_searches", e.target.value)}
              className="rounded-full bg-surface-container-high px-2 py-1 text-[10px] font-semibold text-on-surface-variant outline-none"
              title="Grouping"
            >
              <option value="folder_grouping">By Folder</option>
              <option value="user_grouping">By User</option>
              <option value="ungrouped">Ungrouped</option>
            </select>
            <select
              value={settings.searches.expand_results}
              onChange={(e) => setOption("searches", "expand_results", e.target.value)}
              className="rounded-full bg-surface-container-low px-2 py-1 text-[10px] font-semibold text-on-surface-variant outline-none"
              title="Expand"
            >
              <option value="all">Expand All</option>
              <option value="partial">Partial</option>
              <option value="none">Collapse</option>
            </select>
          </div>
        </div>
      ) : null}

      {activeTab ? (
        <div
          onContextMenu={(e) => {
            const rowEl = (e.target as HTMLElement).closest("[data-row-user]") as HTMLElement | null;
            if (rowEl?.dataset.rowUser) {
              e.preventDefault();
              const user = rowEl.dataset.rowUser;
              const path = rowEl.dataset.rowPath || "";
              const filename = rowEl.dataset.rowFilename || "";
              const folder = rowEl.dataset.rowFolder || "";
              const size = Number(rowEl.dataset.rowSize || "0");
              setMenuRow({ user, path, filename, folder, size, fileType: "", slotFree: false, speed: 0, inQueue: 0, quality: 0, length: 0, private: false, attributes: {} });
              ctxMenu.open(e);
            }
          }}
        >
          <ResultsList rows={visibleRows} onRowTap={setSheetRow} grouping={settings.searches.group_searches} expand={settings.searches.expand_results} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="material-symbols-outlined text-5xl text-outline">travel_explore</span>
            <p className="font-headline text-xl text-on-surface">Search the network</p>
            <p className="font-body text-sm text-on-surface-variant">
              Enter a query above to search Soulseek. Each search opens in its own tab.
            </p>
            {settings.searches.enable_history && settings.searches.history.length > 0 ? (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {settings.searches.history.slice(0, 8).map((h) => (
                  <button
                    key={h}
                    onClick={() => startSearch(h)}
                    className="rounded-full bg-surface-container-high px-3 py-1 text-xs text-on-surface-variant hover:text-primary"
                  >
                    {h}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="w-full max-w-md">
            <WishlistManager />
          </div>
          <div className="text-[11px] text-on-surface-variant">
            Grouping: {settings.searches.group_searches} · Expand: {settings.searches.expand_results} · Filters {settings.searches.enablefilters ? "on" : "off"}
          </div>
        </div>
      )}

      {/* Action sheet */}
      {sheetRow ? (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/40"
          onClick={() => setSheetRow(null)}
        >
          <div
            className="w-full max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface-container p-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-outline-variant" />
            <div className="px-2 pb-3">
              <div className="truncate font-body text-sm font-semibold text-on-surface">
                {sheetRow.filename}
              </div>
              <div className="truncate font-label text-xs text-on-surface-variant">
                {sheetRow.user} · {sheetRow.folder}
              </div>
            </div>
            <SheetAction
              icon="download"
              label={isDemo ? "Download (disabled in demo)" : "Download"}
              onClick={() => {
                if (isDemo) {
                  flash("Demo — downloads are disabled on Vercel.");
                  setSheetRow(null);
                  return;
                }
                if (sheetRow) {
                  requestDownload({ username: sheetRow.user, virtualPath: sheetRow.path, size: sheetRow.size, fileName: sheetRow.filename });
                  flash(`Queued "${sheetRow.filename}" — see Downloads`);
                }
                setSheetRow(null);
              }}
            />
            <SheetAction
              icon="link"
              label="Copy file URL"
              onClick={() => {
                copyUrl(sheetRow, false);
                setSheetRow(null);
              }}
            />
            <SheetAction
              icon="folder"
              label="Copy folder URL"
              onClick={() => {
                copyUrl(sheetRow, true);
                setSheetRow(null);
              }}
            />
            <SheetAction
              icon="account_tree"
              label="Browse user's files"
              onClick={() => {
                if (sheetRow) router.push(`/browse/${encodeURIComponent(sheetRow.user)}`);
                setSheetRow(null);
              }}
            />
            <SheetAction
              icon="account_circle"
              label="View Profile"
              onClick={() => {
                if (sheetRow) router.push(`/profile/${encodeURIComponent(sheetRow.user)}`);
                setSheetRow(null);
              }}
            />
            <SheetAction icon="close" label="Cancel" muted onClick={() => setSheetRow(null)} />
          </div>
        </div>
      ) : null}

      {/* Toast — above BottomNav on mobile */}
      {toast ? (
        <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom,0px))] md:bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-inverse-surface px-4 py-2 text-center font-label text-xs text-inverse-on-surface shadow-lg">
          {toast}
        </div>
      ) : null}
      {ctxMenu.anchor && menuRow ? (
        <ContextMenu
          x={ctxMenu.anchor.x}
          y={ctxMenu.anchor.y}
          items={searchResultMenu(menuRow, {
            onDownload: () => {
              if (menuRow) {
                requestDownload({ username: menuRow.user, virtualPath: menuRow.path, size: menuRow.size, fileName: menuRow.filename });
                flash(`Queued "${menuRow.filename}"`);
              }
            },
          })}
          onClose={() => {
            ctxMenu.close();
            setMenuRow(null);
          }}
        />
      ) : null}
      {tabMenuAnchor ? (
        <ContextMenu
          x={tabMenuAnchor.x}
          y={tabMenuAnchor.y}
          items={searchTabMenu(tabMenuAnchor.tab, {
            onCopy: () => {
              navigator.clipboard.writeText(tabMenuAnchor.tab.query);
              flash("Search term copied");
            },
            onSearchAgain: () => startSearch(tabMenuAnchor.tab.query, { mode: tabMenuAnchor.tab.mode, target: tabMenuAnchor.tab.target }),
            onEdit: () => flash("Edit tab — use Search bar"),
            onClose: () => closeTab(tabMenuAnchor.tab.id),
            onCloseAll: () => tabs.forEach((t) => closeTab(t.id)),
          })}
          onClose={() => setTabMenuAnchor(null)}
        />
      ) : null}
    </div>
  );
}

function SheetAction({
  icon,
  label,
  onClick,
  muted,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-11 items-center gap-3 rounded-xl px-3 py-3.5 text-left font-body text-sm transition-colors active:bg-surface-container-high"
    >
      <span className={`material-symbols-outlined ${muted ? "text-outline" : "text-primary"}`}>
        {icon}
      </span>
      <span className={muted ? "text-on-surface-variant" : "text-on-surface"}>{label}</span>
    </button>
  );
}
