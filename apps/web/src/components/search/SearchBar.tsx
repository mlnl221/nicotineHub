"use client";

import { useState } from "react";
import type { SearchMode } from "@/lib/search";

interface SearchBarProps {
  onSearch: (query: string, opts?: { mode: SearchMode; target?: string }) => void;
  onToggleFilters: () => void;
  activeFilterCount: number;
  searching: boolean;
  onStop: () => void;
}

const MODES: Array<{ id: SearchMode; label: string; icon: string }> = [
  { id: "global", label: "Global", icon: "public" },
  { id: "user", label: "User", icon: "person" },
  { id: "room", label: "Room", icon: "chat_bubble" },
  { id: "wishlist", label: "Wishlist", icon: "favorite" },
  { id: "buddies", label: "Buddies", icon: "group" },
];

export function SearchBar({ onSearch, onToggleFilters, activeFilterCount, searching, onStop }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("global");
  const [target, setTarget] = useState("");

  const submit = () => {
    const q = query.trim();
    if (q.length < 3) return;
    if (mode === "user" && !target.trim()) return;
    if (mode === "room" && !target.trim()) return;
    onSearch(q, { mode, target: target.trim() || undefined });
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-full bg-surface-container-lowest px-4 py-2.5 ghost-border transition-all focus-within:border-primary">
          <span className="material-symbols-outlined text-outline">search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={
              mode === "user" ? "Search term…"
              : mode === "room" ? "Search term…"
              : mode === "wishlist" ? "Wishlist term…"
              : "Search the Soulseek network…"
            }
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 bg-transparent font-body text-sm text-on-surface placeholder:text-outline focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={onToggleFilters}
          aria-label="Toggle filters"
          className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
            activeFilterCount > 0
              ? "bg-primary text-on-primary"
              : "bg-surface-container-lowest text-on-surface-variant ghost-border"
          }`}
        >
          <span className="material-symbols-outlined">tune</span>
          {activeFilterCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-tertiary px-1 font-label text-[10px] font-bold text-on-tertiary">
              {activeFilterCount}
            </span>
          ) : null}
        </button>

        {searching ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop search"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-on-error-container"
          >
            <span className="material-symbols-outlined">stop</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            aria-label="Search"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-primary"
          >
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 font-label text-xs transition-colors ${
              mode === m.id
                ? "bg-primary-container text-on-primary-container ghost-border border-primary"
                : "bg-surface-container-lowest text-on-surface-variant ghost-border"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      {mode === "user" ? (
        <div className="flex items-center gap-2 rounded-full bg-surface-container-lowest px-4 py-2 ghost-border focus-within:border-primary">
          <span className="material-symbols-outlined text-outline text-[18px]">person</span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Username…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 bg-transparent font-body text-sm text-on-surface placeholder:text-outline focus:outline-none"
          />
        </div>
      ) : null}
      {mode === "room" ? (
        <div className="flex items-center gap-2 rounded-full bg-surface-container-lowest px-4 py-2 ghost-border focus-within:border-primary">
          <span className="material-symbols-outlined text-outline text-[18px]">tag</span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Room name…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 bg-transparent font-body text-sm text-on-surface placeholder:text-outline focus:outline-none"
          />
        </div>
      ) : null}
      {mode === "buddies" ? (
        <p className="px-2 font-label text-xs text-on-surface-variant">Searches each buddy (uses your buddy list). Add target username for single buddy or leave blank for all.</p>
      ) : null}
      {mode === "wishlist" ? (
        <p className="px-2 font-label text-xs text-on-surface-variant">Wishlist search — server will periodically re-run this query.</p>
      ) : null}
    </div>
  );
}
