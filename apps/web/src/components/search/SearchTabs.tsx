"use client";

import { useSearches } from "@/lib/search";

export function SearchTabs() {
  const { tabs, activeId, setActive, closeTab, stopSearch } = useSearches();

  if (tabs.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-3 pb-2">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`group flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-label text-xs transition-colors ${
              active
                ? "bg-primary-container text-on-primary-container"
                : "bg-surface-container-lowest text-on-surface-variant ghost-border"
            }`}
          >
            <button type="button" onClick={() => setActive(tab.id)} className="max-w-[40vw] truncate">
              {tab.query}
              {tab.status === "searching" ? <span className="ml-1 animate-pulse">•</span> : null}
            </button>
            <button
              type="button"
              aria-label="Close search"
              onClick={(e) => {
                e.stopPropagation();
                if (tab.status === "searching") stopSearch(tab.id);
                closeTab(tab.id);
              }}
              className="flex h-4 w-4 items-center justify-center rounded-full text-on-surface-variant/70 hover:text-error"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
