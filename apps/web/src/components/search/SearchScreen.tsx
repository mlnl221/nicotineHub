"use client";

import { useMemo, useState } from "react";
import { useSearches } from "@/lib/search";
import { applyFilters } from "@/lib/filter";
import type { SearchRow } from "@/lib/protocol";
import { SearchBar } from "./SearchBar";
import { SearchTabs } from "./SearchTabs";
import { FilterBar } from "./FilterBar";
import { ResultsList } from "./ResultsList";

export function SearchScreen() {
  const { activeTab, activeId, startSearch, stopSearch, setFilters, clearFilters } = useSearches();
  const [showFilters, setShowFilters] = useState(false);
  const [sheetRow, setSheetRow] = useState<SearchRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const visibleRows = useMemo(
    () => (activeTab ? applyFilters(activeTab.rows, activeTab.filters) : []),
    [activeTab],
  );

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
    <div className="flex min-h-screen flex-col bg-surface-container-low">
      <header className="sticky top-0 z-20 bg-surface-container-low/95 backdrop-blur">
        <SearchBar
          onSearch={startSearch}
          onToggleFilters={() => setShowFilters((v) => !v)}
          activeFilterCount={activeFilterCount}
          searching={activeTab != null && activeTab.status === "searching"}
          onStop={() => activeId && stopSearch(activeId)}
        />
        <SearchTabs />
        {showFilters && activeTab ? (
          <FilterBar
            filters={activeTab.filters}
            onChange={(partial) => activeId && setFilters(activeId, partial)}
            onClear={() => activeId && clearFilters(activeId)}
          />
        ) : null}
      </header>

      {activeTab ? (
        <div className="flex items-center justify-between px-4 py-2 font-label text-xs text-on-surface-variant">
          <span>
            {visibleRows.length} of {activeTab.total} results
            {activeTab.status === "searching" ? " · searching…" : ""}
            {activeTab.reason === "max_results" ? " · limit reached" : ""}
          </span>
        </div>
      ) : null}

      {activeTab ? (
        <ResultsList rows={visibleRows} onRowTap={setSheetRow} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-20 text-center">
          <span className="material-symbols-outlined text-5xl text-outline">travel_explore</span>
          <p className="font-headline text-xl text-on-surface">Search the network</p>
          <p className="font-body text-sm text-on-surface-variant">
            Enter a query above to search Soulseek. Each search opens in its own tab.
          </p>
        </div>
      )}

      {sheetRow ? (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/40"
          onClick={() => setSheetRow(null)}
        >
          <div
            className="w-full rounded-t-2xl bg-surface-container p-3 pb-6"
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
              label="Download"
              onClick={() => {
                flash(`Queued "${sheetRow.filename}" (transfers not implemented yet)`);
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
                flash(`Browse ${sheetRow.user} (not implemented yet)`);
                setSheetRow(null);
              }}
            />
            <SheetAction icon="close" label="Cancel" muted onClick={() => setSheetRow(null)} />
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-inverse-surface px-4 py-2 font-label text-xs text-inverse-on-surface shadow-lg">
          {toast}
        </div>
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
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left font-body text-sm transition-colors active:bg-surface-container-high"
    >
      <span className={`material-symbols-outlined ${muted ? "text-outline" : "text-primary"}`}>
        {icon}
      </span>
      <span className={muted ? "text-on-surface-variant" : "text-on-surface"}>{label}</span>
    </button>
  );
}
