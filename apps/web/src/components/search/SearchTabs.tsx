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
    <div className="flex gap-2 overflow-x-auto px-3 pb-2">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const badge = modeBadge(tab.mode, tab.target);
        return (
          <div
            key={tab.id}
            className={`group flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-label text-xs transition-colors ${
              active
                ? "bg-primary-container text-on-primary-container"
                : "bg-surface-container-lowest text-on-surface-variant ghost-border"
            }`}
          >
            <span className="material-symbols-outlined text-[12px] opacity-70">{modeIcon(tab.mode)}</span>
            <button type="button" onClick={() => setActive(tab.id)} className="max-w-[40vw] truncate">
              {badge ? <span className="mr-1 opacity-60">[{badge}]</span> : null}
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
