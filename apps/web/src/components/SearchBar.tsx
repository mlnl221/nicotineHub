"use client";

import { useState } from "react";
import { useSearches } from "@/lib/search";

const FILTERS = ["Any Type", "Audio", "Video", "Software"] as const;

export function SearchBar() {
  const { startSearch, activeTab } = useSearches();
  const state = { searching: activeTab?.status === "searching" };
  const search = startSearch;
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>("Any Type");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    search(q);
  };

  return (
    <div className="relative z-10 w-full">
      <div className="relative glass-card rounded-full px-6 py-4 transition-all duration-300 focus-within:bg-surface-container-highest/10 focus-within:ring-2 focus-within:ring-primary-fixed dark:focus-within:bg-surface-container-highest/10">
        <div className="flex items-center">
          <span className="material-symbols-outlined mr-4 text-2xl text-on-surface-variant transition-colors group-focus-within:text-primary-fixed dark:text-outline">
            search
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(e)}
            placeholder="Search network nodes..."
            className="flex-1 bg-transparent font-body text-xl text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none dark:text-inverse-on-surface dark:placeholder:text-outline"
          />
          <div className="ml-4 flex items-center border-l border-outline-variant/30 pl-4">
            <button
              type="button"
              className="flex items-center rounded-full p-2 text-on-surface-variant transition-colors hover:text-primary dark:text-outline dark:hover:text-inverse-primary"
            >
              <span className="material-symbols-outlined">tune</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center space-x-3">
        <span className="mr-2 font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
          Filters:
        </span>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setActiveFilter(f)}
            className={
              f === activeFilter
                ? "rounded-full border-primary/30 bg-primary-container/10 px-4 py-1.5 font-label text-xs tracking-wide text-primary transition-colors dark:border-primary/30 dark:bg-primary-container/10 dark:text-primary-fixed"
                : "glass-card rounded-full px-4 py-1.5 font-label text-xs tracking-wide text-on-surface-variant transition-colors hover:text-primary hover:bg-surface-container-highest/20 dark:text-outline dark:hover:text-inverse-primary"
            }
          >
            {f}
          </button>
        ))}
      </div>

      {state.searching ? (
        <p className="mt-4 font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
          Searching the network…
        </p>
      ) : null}
    </div>
  );
}
