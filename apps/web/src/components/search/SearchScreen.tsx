"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { buildInitialFilters, useSearches, type SearchMode } from "@/lib/search";
import { applyFilters } from "@/lib/filter";
import { sortSearchRows, type SearchSortMode } from "@/lib/sort";
import { useTransfers } from "@/lib/transfers";
import { type FilterState, type SearchRow } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { useConfig } from "@/lib/config/provider";
import { WishlistManager } from "@/components/WishlistManager";
import { SearchBar } from "./SearchBar";
import { SearchTabs } from "./SearchTabs";
import { FilterBar } from "./FilterBar";
import { ResultsList, searchRowId } from "./ResultsList";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { searchResultMenu, searchTabMenu } from "@/lib/context-menu/menus";
import { useContextMenu } from "@/lib/context-menu/useContextMenu";
import { useWishlist } from "@/lib/wishlist";
import { humanLength, humanQuality, humanSize } from "@/lib/format";
import { useBulkSelection } from "@/lib/bulkSelection";

export function SearchScreen() {
  const { activeTab, activeId, tabs, setActive, closeTab, startSearch, stopSearch, retrySearch, setFilters, clearFilters } = useSearches();
  const { requestDownload } = useTransfers();
  const { settings, setOption } = useConfig();
  const { getIgnored, markSeen } = useWishlist();
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(() => settings.searches.filters_visible ?? false);
  useEffect(() => { setShowFilters(settings.searches.filters_visible ?? false); }, [settings.searches.filters_visible]);
  // Sticky zero-tab draft: FilterBar stays usable with no tabs, and the next
  // user-initiated search (from empty state) seeds from it. Seeded from the
  // same defaults as new tabs so the panel shows what the search will use.
  // Per-tab filters take over once a tab exists.
  const [draft, setDraft] = useState<FilterState>(() => buildInitialFilters(settings.searches.defilter, settings.searches.enablefilters));
  // Keep draft publicOnly in line with the persisted default (e.g. header
  // toggle on a tab); no-op when already equal so typing never re-renders.
  useEffect(() => {
    const next = settings.searches.defilter.publicFiles ?? true;
    setDraft((d) => (d.publicOnly === next ? d : { ...d, publicOnly: next }));
  }, [settings.searches.defilter.publicFiles]);
  // Refs keep the async SearchBar scrape path (resolves after render) on the
  // latest branch/seed instead of a stale closure.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const noTabsRef = useRef(!activeTab);
  noTabsRef.current = !activeTab;
  // New searches from empty state carry the visible draft; with tabs open the
  // panel shows the active tab instead, so leave seeding at defaults there.
  const startWithDraft = (query: string, opts?: { mode?: SearchMode; target?: string }) =>
    startSearch(query, noTabsRef.current ? { ...opts, filters: draftRef.current } : opts);
  // Stable identities: FilterBar debounces 150ms on [local, filters, onChange],
  // so a fresh arrow each render would starve commits while results stream.
  const handleFilterChange = useCallback(
    (partial: Partial<FilterState>) => (activeId ? setFilters(activeId, partial) : setDraft((d) => ({ ...d, ...partial }))),
    [activeId, setFilters],
  );
  const handleFilterClear = useCallback(
    () => (activeId ? clearFilters(activeId) : setDraft(buildInitialFilters(settings.searches.defilter, settings.searches.enablefilters))),
    [activeId, clearFilters, settings.searches.defilter, settings.searches.enablefilters],
  );
  const [sheetRow, setSheetRow] = useState<SearchRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const ctxMenu = useContextMenu();
  const [menuRow, setMenuRow] = useState<SearchRow | null>(null);
  const [propsRow, setPropsRow] = useState<SearchRow | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const bulk = useBulkSelection();
  const [tabMenuAnchor, setTabMenuAnchor] = useState<{ x: number; y: number; tab: import("@/lib/search").SearchTab } | null>(null);
  // Desktop (fine pointer) starts in select mode so single click toggles
  // rows instead of opening the sheet. Touch starts sheet-first; long-press
  // enters select mode. Read in effects only (never rendered) so SSR/CSR
  // mismatch cannot leak into hydration.
  const isFinePointer = useMemo(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer:fine)").matches,
    [],
  );

  const deferredRows = useDeferredValue(activeTab?.rows ?? []);
  useEffect(() => { bulk.clear(); setSelectMode(isFinePointer); }, [activeId, bulk.clear, isFinePointer]);
  const deferredFilters = useDeferredValue(activeTab?.filters ?? null);
  // ponytail: inline filtering — useDeferredValue already de-janks 500+ rows, no worker/comlink needed
  const [sortMode, setSortMode] = useState<SearchSortMode>("best");

  const visibleRows = useMemo(
    () => {
      let rows: typeof deferredRows;
      if (activeTab && deferredFilters) rows = applyFilters(deferredRows, deferredFilters);
      else if (activeTab) rows = applyFilters(activeTab.rows, activeTab.filters);
      else rows = [];
      // wishlist seen filtering: hide previously seen users
      if (activeTab?.mode === "wishlist") {
        const ignored = getIgnored(activeTab.query);
        if (ignored.size) rows = rows.filter((r) => !ignored.has(r.user));
      }
      return sortSearchRows(rows, sortMode);
    },
    [activeTab, deferredRows, deferredFilters, getIgnored, sortMode],
  );
  const visibleUsers = useMemo(() => [...new Set(visibleRows.map((r) => r.user))], [visibleRows]);
  const visibleIds = useMemo(() => visibleRows.map(searchRowId), [visibleRows]);
  const selectedRows = useMemo(() => visibleRows.filter((row) => bulk.has(searchRowId(row))), [visibleRows, bulk]);
  const isStale = activeTab ? deferredRows !== activeTab.rows || deferredFilters !== activeTab.filters : false;

  const activeFilterCount = useMemo(() => {
    const f = activeTab?.filters ?? draft;
    let n = 0;
    if (f.include.trim()) n++;
    if (f.exclude.trim()) n++;
    if (f.fileType.trim()) n++;
    if (f.size.trim()) n++;
    if (f.bitrate.trim()) n++;
    if (f.length.trim()) n++;
    if (f.country.trim()) n++;
    if (f.quality.trim()) n++;
    if (f.freeSlot) n++;
    if (f.publicOnly) n++;
    return n;
  }, [activeTab, draft]);

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

  const downloadRow = (row: SearchRow) => {
    if (isDemo) {
      flash("Demo — downloads are disabled on Vercel.");
      return;
    }
    requestDownload({ username: row.user, virtualPath: row.path, size: row.size, fileName: row.filename });
    flash(`Queued "${row.filename}" — see Downloads`);
  };

  // Client fan-out: queue every visible result sharing the row's user+folder,
  // staggered like BrowseView downloadFolder to avoid hammering the peer.
  const downloadFolderFor = (row: SearchRow) => {
    if (isDemo) {
      flash("Demo — downloads are disabled on Vercel.");
      return;
    }
    const matches = visibleRows.filter((r) => r.user === row.user && r.folder === row.folder);
    if (matches.length === 0) {
      flash("No files in this folder");
      return;
    }
    matches.forEach((m, idx) => {
      setTimeout(() => requestDownload({ username: m.user, virtualPath: m.path, size: m.size, fileName: m.filename }), idx * 150);
    });
    flash(`Queued ${matches.length} file${matches.length === 1 ? "" : "s"} from "${row.folder || "(root)"}"`);
  };

  const downloadSelected = () => {
    if (isDemo || !selectedRows.length) return;
    if (selectedRows.length > 1 && !window.confirm(`Download ${selectedRows.length} selected files?`)) return;
    selectedRows.forEach((row, idx) => setTimeout(() => requestDownload({ username: row.user, virtualPath: row.path, size: row.size, fileName: row.filename }), idx * 150));
    flash(`Queued ${selectedRows.length} selected file${selectedRows.length === 1 ? "" : "s"}`);
  };

  const downloadSelectedFolders = () => {
    const folders = new Map<string, SearchRow>();
    for (const row of selectedRows) folders.set(`${row.user}:${row.folder}`, row);
    if (selectedRows.length > 1 && !window.confirm(`Download ${selectedRows.length} selected files from ${folders.size} folder${folders.size === 1 ? "" : "s"}?`)) return;
    for (const row of folders.values()) downloadFolderFor(row);
  };

  const searchForFile = (row: SearchRow) => {
    const base = row.filename.replace(/\.[^.]+$/, "");
    const ignored = new Set(["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "mp4", "mkv", "avi", "vbr", "cbr", "kbps", "x264", "x265", "bluray", "web-dl"]);
    const query = base.split(/[\s_.()[\]{}-]+/).map((token) => token.trim()).filter((token) => token && !ignored.has(token.toLowerCase()) && !/^\d{1,4}$/.test(token)).join(" ").trim() || base;
    startSearch(query);
    flash(`Searching for "${query}"`);
  };

  const toggleSelected = (row: SearchRow) => bulk.toggle(searchRowId(row));
  const rangeSelected = (row: SearchRow) => bulk.toggleRange(searchRowId(row), visibleIds);
  const longPressSelected = (row: SearchRow) => { setSelectMode(true); bulk.toggle(searchRowId(row)); };

  const searchSubtitle = activeTab
    ? `${visibleRows.length} of ${activeTab.total} results${activeTab.status === "searching" ? " · searching…" : ""}${activeTab.mode !== "global" ? ` · ${activeTab.mode}${activeTab.target ? `:${activeTab.target}` : ""}` : ""} • ${tabs.length} tabs`
    : `Find files across the network • ${tabs.length} tabs`;

  return (
    <div className="flex min-h-screen max-w-full overflow-x-hidden flex-col bg-surface-container-low dark:bg-inverse-surface" data-custom-menu>
      <PageHeader title="Search" subtitle={searchSubtitle} settingsHref="/settings?tab=searches#searches" />
      <div className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-surface-container-low/95 backdrop-blur dark:bg-inverse-surface/95 border-b border-outline-variant/10">
        <SearchBar
          onSearch={startWithDraft}
          onToggleFilters={() => {
            const next = !showFilters;
            setShowFilters(next);
            setOption("searches", "filters_visible", next);
          }}
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
        {showFilters ? (
          <FilterBar
            key={activeId ?? "draft"}
            filters={activeTab?.filters ?? draft}
            onChange={handleFilterChange}
            onClear={handleFilterClear}
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
            {activeTab.mode === "wishlist" && visibleRows.length > 0 ? (
              <button
                type="button"
                title="Mark visible users as seen"
                onClick={() => markSeen(activeTab.query, visibleUsers)}
                className="min-h-11 rounded-full bg-surface-container-high px-3 py-2 text-xs font-semibold text-on-surface-variant outline-none active:bg-surface-container-highest"
              >
                Dismiss new ({visibleRows.length})
              </button>
            ) : null}
            <button
              type="button"
              aria-pressed={activeTab.filters.publicOnly}
              title={activeTab.filters.publicOnly ? "Showing public files only — tap to show private results" : "Private results visible — tap to hide private shares"}
              onClick={() => {
                if (!activeId) return;
                const next = !activeTab.filters.publicOnly;
                setFilters(activeId, { publicOnly: next });
                setOption("searches", "defilter", { ...settings.searches.defilter, publicFiles: next });
              }}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold outline-none ${
                activeTab.filters.publicOnly
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant"
              }`}
            >
              {activeTab.filters.publicOnly ? "Public only" : "Hide private"}
            </button>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SearchSortMode)}
              className="rounded-full bg-surface-container-high px-2 py-1 text-[10px] font-semibold text-on-surface-variant outline-none"
              title="Sort: Best = free slots, fastest first"
            >
              <option value="best">Best first</option>
              <option value="speed">Fastest</option>
              <option value="queue">Shortest queue</option>
              <option value="arrival">Arrival order</option>
            </select>
            <select
              value={settings.searches.group_searches}
              onChange={(e) => setOption("searches", "group_searches", e.target.value)}
              className="rounded-full bg-surface-container-high px-2 py-1 text-[10px] font-semibold text-on-surface-variant outline-none"
              title="Grouping"
            >
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
        visibleRows.length === 0 && activeTab.status === "ended" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-outline">search_off</span>
            <p className="font-body text-sm font-semibold text-on-surface">
              {activeTab.reason === "error" ? "Connection lost — retry?"
                : activeTab.reason === "timeout" && activeTab.total === 0
                  ? "No results — check your listening port"
                : activeTab.reason === "max_results"
                  ? "Search limit reached — no matching results"
                  : "No results"}
            </p>
            <p className="max-w-md font-body text-xs leading-relaxed text-on-surface-variant">
              {activeTab.reason === "error" ? (
                <>Search ended because the connection dropped. Your previous results are kept — <button onClick={() => retrySearch(activeTab.id)} className="text-primary underline">Retry</button> will continue the same tab.</>
              ) : activeTab.reason === "timeout" && activeTab.total === 0 ? (
                <>
                  Soulseek returns results peer-to-peer to your listening port (currently <code className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-[11px]">{settings.server.portrange[0] ?? 60754}</code>). If this port isn&apos;t forwarded through your VPN/router and into WSL, searches will time out with 0 results.
                  <br />
                  Check <a href="/settings?tab=network#network" className="text-primary underline">Settings → Network</a> and your VPN port-forward / OS port-proxy settings.
                </>
              ) : activeTab.total === 0 ? (
                "Try a different query or widen your filters. Results are live — some queries return nothing if peers are offline."
              ) : (
                "All results are filtered out. Try clearing filters."
              )}
            </p>
            {activeTab.reason === "timeout" && activeTab.total === 0 ? (
              <div className="mt-2 rounded-lg bg-error-container/20 px-3 py-2 font-label text-[11px] text-on-error-container">
                Search ended: timeout (no peer could connect back). This is expected if {settings.server.portrange[0] ?? 60754} isn&apos;t reachable.
              </div>
            ) : null}
            {activeTab.reason === "error" ? (
              <button onClick={() => retrySearch(activeTab.id)} className="mt-2 rounded-full bg-primary px-4 py-2 font-label text-xs font-semibold text-on-primary">Retry</button>
            ) : (
              <button onClick={() => retrySearch(activeTab.id)} className="mt-2 rounded-full bg-primary px-4 py-2 font-label text-xs font-semibold text-on-primary">Search again</button>
            )}
          </div>
        ) : (
          <div
            onContextMenu={(e) => {
              const rowEl = (e.target as HTMLElement).closest("[data-row-user]") as HTMLElement | null;
              if (rowEl?.dataset.rowUser) {
                e.preventDefault();
                // Claimed: keep the event from reaching document/window
                // closers (GlobalContextMenu, stale ContextMenu) — the row
                // menu owns this right-click.
                e.stopPropagation();
                const user = rowEl.dataset.rowUser;
                const path = rowEl.dataset.rowPath || "";
                // resolve full row from visibleRows to get mocked attributes/size
                const full = visibleRows.find((r) => r.user === user && r.path === path) || null;
                if (full) setMenuRow(full);
                else {
                  const filename = rowEl.dataset.rowFilename || "";
                  const folder = rowEl.dataset.rowFolder || "";
                  const size = Number(rowEl.dataset.rowSize || "0");
                  setMenuRow({ user, path, filename, folder, size, fileType: "", slotFree: false, speed: 0, inQueue: 0, quality: 0, length: 0, private: false, attributes: {} });
                }
                ctxMenu.open(e);
              }
            }}
          >
            <ResultsList
              rows={visibleRows}
              onRowTap={setSheetRow}
              onRowDoubleClick={downloadRow}
              selectMode={selectMode}
              selectedIds={bulk.selected}
              onToggleSelect={toggleSelected}
              onRangeSelect={rangeSelected}
              onSelectIds={bulk.setSelection}
              onLongPress={longPressSelected}
              grouping={settings.searches.group_searches}
              expand={settings.searches.expand_results}
            />
          </div>
        )
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
                    onClick={() => startWithDraft(h)}
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

      {/* Action sheet — z-[70] keeps it above Sidebar/TopBar/BottomNav */}
      {sheetRow ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center"
          onClick={() => setSheetRow(null)}
        >
          <div
            className="w-full max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface-container p-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] md:max-w-md md:rounded-2xl"
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
                if (sheetRow) downloadRow(sheetRow);
                setSheetRow(null);
              }}
            />
            <SheetAction
              icon="folder_download"
              label="Download Folder"
              onClick={() => { if (sheetRow) downloadFolderFor(sheetRow); setSheetRow(null); }}
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
              label="Browse Folder"
              onClick={() => {
                if (sheetRow) router.push(`/browse/${encodeURIComponent(sheetRow.user)}?folder=${encodeURIComponent(sheetRow.folder)}`);
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
            <SheetAction icon="chat_bubble" label="Message User" onClick={() => { if (sheetRow) router.push(`/private-chat?user=${encodeURIComponent(sheetRow.user)}`); setSheetRow(null); }} />
            <SheetAction icon="search" label="Search for This File (Experimental)" onClick={() => { if (sheetRow) searchForFile(sheetRow); setSheetRow(null); }} />
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
              if (menuRow && bulk.has(searchRowId(menuRow)) && selectedRows.length > 1) downloadSelected();
              else if (menuRow) downloadRow(menuRow);
            },
            onDownloadFolder: () => {
              if (menuRow && bulk.has(searchRowId(menuRow)) && selectedRows.length > 1) downloadSelectedFolders();
              else if (menuRow) downloadFolderFor(menuRow);
             },
             onDownloadSelected: downloadSelected,
             selectedCount: selectedRows.length > 1 && menuRow && bulk.has(searchRowId(menuRow)) ? selectedRows.length : 1,
             onBrowse: () => {
               if (menuRow) router.push(`/browse/${encodeURIComponent(menuRow.user)}?folder=${encodeURIComponent(menuRow.folder)}`);
            },
            onProfile: () => {
              if (menuRow) router.push(`/profile/${encodeURIComponent(menuRow.user)}`);
            },
             onMessage: () => {
              if (menuRow) router.push(`/private-chat?user=${encodeURIComponent(menuRow.user)}`);
             },
             onSearchFile: () => { if (menuRow) searchForFile(menuRow); },
            onProps: () => {
              if (menuRow) setPropsRow(menuRow);
            },
          })}
          onClose={() => {
            ctxMenu.close();
            setMenuRow(null);
          }}
         />
       ) : null}
      {bulk.size > 0 ? (
        <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px))] md:bottom-4 left-1/2 z-40 flex w-[min(94vw,560px)] -translate-x-1/2 items-center gap-2 rounded-2xl bg-surface-container-highest p-3 shadow-xl ghost-border">
          <span className="flex-1 font-label text-xs font-bold">{bulk.size} selected</span>
          <button onClick={downloadSelected} disabled={isDemo} className="rounded-full bg-primary px-3 py-2 font-label text-xs font-bold text-on-primary disabled:opacity-50">Download</button>
          <button onClick={downloadSelectedFolders} disabled={isDemo} className="rounded-full bg-surface-container-high px-3 py-2 font-label text-xs">Folders</button>
          <button onClick={() => bulk.clear()} className="rounded-full bg-surface-container-high px-3 py-2 font-label text-xs">Clear</button>
        </div>
      ) : null}
      {propsRow ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4" onClick={() => setPropsRow(null)}>
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-xl max-h-[80vh] overflow-y-auto ghost-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-headline text-lg font-bold truncate">{propsRow.filename}</h3>
              <button onClick={() => setPropsRow(null)} className="rounded-full p-2 hover:bg-surface-container-high"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="mt-1 font-label text-xs text-on-surface-variant truncate">{propsRow.user} · {propsRow.folder}</div>
            <div className="mt-4 space-y-3 font-body text-sm">
              <div className="flex justify-between gap-4"><span className="text-on-surface-variant shrink-0">Full path</span><span className="font-mono text-xs truncate max-w-[60%] text-right">{propsRow.path}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Size</span><span>{humanSize(propsRow.size)}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Type</span><span>{propsRow.fileType || propsRow.filename.split(".").pop() || "—"}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Quality</span><span>{humanQuality(propsRow.attributes) || (propsRow.quality ? `${propsRow.quality} kbps` : "—")}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Length</span><span>{humanLength(propsRow.length) || "—"}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Slot</span><span className={propsRow.slotFree ? "text-tertiary font-semibold" : ""}>{propsRow.slotFree ? "Free" : `Queued (pos ${propsRow.inQueue ?? "?"})`}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Speed</span><span>{propsRow.speed ? humanSize(propsRow.speed) + "/s" : "—"}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Folder</span><span className="font-mono text-xs truncate max-w-[60%] text-right">{propsRow.folder}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Virtual path</span><button onClick={() => { navigator.clipboard.writeText(propsRow.path); flash("Path copied"); }} className="font-mono text-xs text-primary hover:underline">Copy</button></div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => {
                  if (propsRow) downloadRow(propsRow);
                  setPropsRow(null);
                }}
                className={`flex-1 rounded-xl py-3 font-label text-xs font-bold ${isDemo ? "bg-surface-container-high text-outline" : "bg-primary text-on-primary hover:bg-primary-container"}`}
              >
                {isDemo ? "Download disabled in demo" : "Download"}
              </button>
              <button onClick={() => setPropsRow(null)} className="rounded-xl bg-surface-container-high px-6 py-3 font-label text-xs">Close</button>
            </div>
          </div>
        </div>
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
