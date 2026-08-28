"use client";

import { useState } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  onToggleFilters: () => void;
  activeFilterCount: number;
  searching: boolean;
  onStop: () => void;
}

export function SearchBar({ onSearch, onToggleFilters, activeFilterCount, searching, onStop }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const submit = () => {
    const q = query.trim();
    if (q.length >= 3) onSearch(q);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-3">
      <div className="flex flex-1 items-center gap-2 rounded-full bg-surface-container-lowest px-4 py-2.5 ghost-border transition-all focus-within:border-primary">
        <span className="material-symbols-outlined text-outline">search</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Search the Soulseek network…"
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
      ) : null}
    </div>
  );
}
