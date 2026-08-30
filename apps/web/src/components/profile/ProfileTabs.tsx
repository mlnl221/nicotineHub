"use client";

import { useConfig } from "@/lib/config/provider";
import { useProfileTabs } from "@/lib/profile-tabs";

export function ProfileTabs() {
  const { tabs, activeId, setActive, closeProfile } = useProfileTabs();
  const { settings } = useConfig();
  const showClose = settings.ui.tabclosers ?? true;
  if (tabs.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto overflow-y-hidden hide-scrollbar px-3 pb-2 scroll-px-3 snap-x max-w-full">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`group flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 font-label text-xs transition-colors min-h-9 text-left cursor-pointer ${
              active ? "bg-primary-container text-on-primary-container" : "bg-surface-container-lowest text-on-surface-variant ghost-border hover:bg-surface-container-low"
            }`}
          >
            <span className="material-symbols-outlined text-[14px] opacity-70 shrink-0 pointer-events-none">account_circle</span>
            <span className="max-w-[28vw] truncate whitespace-nowrap min-h-[28px] flex items-center gap-1 pointer-events-none">
              <span className="truncate">{tab.username}</span>
              {tab.loading ? <span className="ml-1 animate-pulse">•</span> : null}
            </span>
            {showClose ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="Close profile"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeProfile(tab.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); closeProfile(tab.id); } }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant/70 hover:text-error hover:bg-surface-container-high -mr-1"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
