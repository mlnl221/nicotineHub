"use client";

import { useSearches } from "@/lib/search";

function modeBadge(mode: string, target?: string) {
  if (mode === "global") return null;
  if (mode === "wishlist") return "★";
  if (mode === "buddies") return target ? `@${target}` : "buddies";
  if (target) return `${mode}:${target}`;
  return mode;
}

function modeIcon(mode: string): string {
  if (mode === "user") return "person";
  if (mode === "room") return "tag";
  if (mode === "wishlist") return "favorite";
  if (mode === "buddies") return "group";
  return "public";
}

export function SearchTabs() {
  const { tabs, activeId, setActive, closeTab, stopSearch } = useSearches();

  if (tabs.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto overflow-y-hidden hide-scrollbar px-3 pb-2 scroll-px-3 snap-x max-w-full">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const badge = modeBadge(tab.mode, tab.target);
        return (
          <button
            key={tab.id}
            type="button"
            data-tab-id={tab.id}
            onClick={() => setActive(tab.id)}
            className={`group flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 font-label text-xs transition-colors min-h-9 text-left cursor-pointer ${
              active
                ? "bg-primary-container text-on-primary-container"
                : "bg-surface-container-lowest text-on-surface-variant ghost-border hover:bg-surface-container-low"
            }`}
          >
            <span className="material-symbols-outlined text-[12px] opacity-70 shrink-0 pointer-events-none">{modeIcon(tab.mode)}</span>
            <span className="max-w-[40vw] truncate whitespace-nowrap min-h-[28px] flex items-center pointer-events-none">
              {badge ? <span className="mr-1 shrink-0 opacity-60">[{badge}]</span> : null}
              <span className="truncate">{tab.query}</span>
              {tab.status === "searching" ? <span className="ml-1 animate-pulse">•</span> : null}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Close search"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (tab.status === "searching") stopSearch(tab.id);
                closeTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (tab.status === "searching") stopSearch(tab.id);
                  closeTab(tab.id);
                }
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant/70 hover:text-error hover:bg-surface-container-high -mr-1"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
