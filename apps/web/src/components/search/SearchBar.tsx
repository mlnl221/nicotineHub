"use client";

import { useState } from "react";
import type { SearchMode } from "@/lib/search";
import { useConfig } from "@/lib/config/provider";
import { useRooms } from "@/lib/rooms";
import { scrapeRelease } from "@/lib/worker";
import { MobileHelp, scopeRowVisible } from "@/components/ui/MobileHelp";

interface SearchBarProps {
  onSearch: (query: string, opts?: { mode: SearchMode; target?: string }) => void;
  onToggleFilters: () => void;
  activeFilterCount: number;
  searching: boolean;
  onStop: () => void;
}

const MODES: Array<{ id: SearchMode; label: string; icon: string; desc: string }> = [
  { id: "global", label: "Global", icon: "public", desc: "Entire network" },
  { id: "user", label: "User", icon: "person", desc: "Single user" },
  { id: "room", label: "Room", icon: "chat_bubble", desc: "Chat room" },
  { id: "wishlist", label: "Wishlist", icon: "favorite", desc: "Auto re-search" },
  { id: "buddies", label: "Buddies", icon: "group", desc: "Your buddies" },
];

export function SearchBar({ onSearch, onToggleFilters, activeFilterCount, searching, onStop }: SearchBarProps) {
  const { settings } = useConfig();
  const { joinedRooms, roomList } = useRooms();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("global");
  const [target, setTarget] = useState("");
  const [roomError, setRoomError] = useState("");
  const [scraping, setScraping] = useState(false);

  const submit = () => {
    const q = query.trim();
    const min = settings.searches.min_search_chars ?? 3;
    if (q.length < min || scraping) return;
    if (mode === "user" && !target.trim()) return;
    if (mode === "room" && !target.trim()) return;
    if (mode === "room" && target.trim()) {
      const t = target.trim();
      const joined = Array.from(joinedRooms.values()).some(r => r.name.toLowerCase() === t.toLowerCase());
      const exists = roomList.some(r => r.name.toLowerCase() === t.toLowerCase());
      if (!joined && !exists) {
        setRoomError("Room not joined — join the room first or pick a public/joined room.");
        return;
      }
      setRoomError("");
    }
    // Paste-link scrape: a release URL in global mode goes through the worker
    // first (Discogs/Bandcamp/Apple/...) and searches the identified release.
    // Falls back to a raw query search when the worker is unreachable.
    if (mode === "global" && /^https?:\/\//i.test(q)) {
      setScraping(true);
      scrapeRelease(q)
        .then((res) => onSearch(res.query || q, { mode, target: target.trim() || undefined }))
        .catch(() => onSearch(q, { mode, target: target.trim() || undefined }))
        .finally(() => setScraping(false));
      return;
    }
    onSearch(q, { mode, target: target.trim() || undefined });
  };

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const [showHelp, setShowHelp] = useState(false);
  // Mobile collapses the scope row to one pill (global default); the select
  // stays the sole setMode path so non-global modes always show the row.
  const [scopeOpen, setScopeOpen] = useState(false);
  const showScope = scopeRowVisible(mode, scopeOpen);

  return (
    <div className="flex flex-col gap-2 px-3 pt-0 pb-1 md:px-3 md:py-3 max-w-full overflow-hidden">
      {/* Card container — keeps everything inside viewport */}
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-container-lowest ghost-border p-1.5 md:gap-2.5 md:p-3 shadow-sm max-w-full overflow-hidden">
        {/* Row 1: query + actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 max-w-full min-w-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-container-low px-3 sm:px-4 py-2.5 ghost-border transition-all focus-within:border-primary">
            <span className="material-symbols-outlined text-outline shrink-0">search</span>
            <input
              list="search-history"
              value={query}
              spellCheck={settings.ui.spellcheck}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={
                scraping ? "Identifying release…"
                : mode === "user" ? "Search term…"
                : mode === "room" ? "Search term…"
                : mode === "wishlist" ? "Wishlist term…"
                : "Search the Soulseek network or paste a release link…"
              }
              autoCapitalize="none"
              autoCorrect="off"
              className="flex-1 w-full min-w-0 bg-transparent font-body text-sm text-on-surface placeholder:text-outline focus:outline-none"
            />
            <datalist id="search-history">
              {settings.searches.history.slice(0, 200).map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </div>

          <button
            type="button"
            onClick={onToggleFilters}
            aria-label="Toggle filters"
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
              activeFilterCount > 0
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant ghost-border"
            }`}
          >
            <span className="material-symbols-outlined">tune</span>
            {activeFilterCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-tertiary px-1 font-label text-[10px] font-bold text-on-tertiary">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            aria-label="Filter help"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant ghost-border"
          >
            <span className="material-symbols-outlined">help</span>
          </button>

          {searching ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container"
            >
              <span className="material-symbols-outlined">stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              aria-label="Search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"
            >
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          )}
        </div>

        {/* Row 2: scope — one compact pill on mobile until expanded */}
        {!showScope ? (
          <button
            type="button"
            onClick={() => setScopeOpen(true)}
            aria-label="Change search scope"
            className="flex min-h-11 w-full items-center gap-2 rounded-full bg-surface-container-low ghost-border px-3 font-label text-sm font-medium text-on-surface md:hidden"
          >
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">{current.icon}</span>
            <span className="flex-1 truncate text-left">{current.label} — {current.desc}</span>
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">expand_more</span>
          </button>
        ) : null}
        <div className={`${showScope ? "flex" : "hidden"} items-center gap-2 max-w-full min-w-0 md:flex`}>
          <span className="hidden sm:inline-flex items-center gap-1 shrink-0 font-label text-[11px] uppercase tracking-widest text-on-surface-variant">
            <span className="material-symbols-outlined text-[14px]">tune</span>
            Scope
          </span>
          <div className="relative flex-1 min-w-0">
            <label htmlFor="search-mode" className="sr-only">Search scope</label>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-on-surface-variant">
              {current.icon}
            </span>
            <select
              id="search-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as SearchMode)}
              className="w-full min-h-11 h-11 appearance-none rounded-full bg-surface-container-low ghost-border pl-9 pr-9 font-label text-sm font-medium text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.desc}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[20px] text-on-surface-variant">
              expand_more
            </span>
          </div>
          <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-container-low px-2.5 py-1 font-label text-[11px] text-on-surface-variant">
            {current.label}
          </span>
          {mode === "global" ? (
            <button
              type="button"
              onClick={() => setScopeOpen(false)}
              aria-label="Collapse scope"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant ghost-border md:hidden"
            >
              <span className="material-symbols-outlined">expand_less</span>
            </button>
          ) : null}
        </div>

        {mode === "user" ? (
          <div className="flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2.5 ghost-border focus-within:border-primary min-h-11">
            <span className="material-symbols-outlined text-outline text-[18px] shrink-0">person</span>
            <input
              value={target}
              spellCheck={settings.ui.spellcheck}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Username…"
              autoCapitalize="none"
              autoCorrect="off"
              className="flex-1 w-full min-w-0 bg-transparent font-body text-sm text-on-surface placeholder:text-outline focus:outline-none"
            />
          </div>
        ) : null}
        {mode === "room" ? (
          <>
            <div className="flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2.5 ghost-border focus-within:border-primary min-h-11">
              <span className="material-symbols-outlined text-outline text-[18px] shrink-0">tag</span>
              <input
                value={target}
                spellCheck={settings.ui.spellcheck}
                onChange={(e) => { setTarget(e.target.value); if (roomError) setRoomError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="Room name… (joined or public rooms only)"
                list="room-autocomplete"
                autoCapitalize="none"
                autoCorrect="off"
                className="flex-1 w-full min-w-0 bg-transparent font-body text-sm text-on-surface placeholder:text-outline focus:outline-none"
              />
              <datalist id="room-autocomplete">
                {Array.from(joinedRooms.values()).slice(0, 50).map(r => <option key={`j-${r.name}`} value={r.name} />)}
                {roomList.slice(0, 50).map(r => <option key={`p-${r.name}`} value={r.name} />)}
              </datalist>
            </div>
            {roomError ? <p className="px-2 font-label text-xs text-error">{roomError}</p> : null}
          </>
        ) : null}
        {mode === "buddies" ? (
          <div className="px-2">
            <MobileHelp short="Searches each buddy (uses your buddy list)." testId="scope-buddies-help">
              <p className="font-label text-xs leading-relaxed text-on-surface-variant">Searches each buddy (uses your buddy list). Add target username for single buddy or leave blank for all.</p>
            </MobileHelp>
          </div>
        ) : null}
        {mode === "wishlist" ? (
          <div className="px-2">
            <MobileHelp short="Server re-runs this query periodically." testId="scope-wishlist-help">
              <p className="font-label text-xs leading-relaxed text-on-surface-variant">Wishlist search — server will periodically re-run this query.</p>
            </MobileHelp>
          </div>
        ) : null}
        {showHelp ? (
          <div className="rounded-xl bg-surface-container-high p-3 ghost-border">
            <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface">Filter syntax</h4>
            <ul className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed text-on-surface-variant">
              <li><span className="font-bold">Include:</span> <span className="bg-surface-container-lowest px-1 rounded">pink floyd</span> regex on path+username</li>
              <li><span className="font-bold">Exclude:</span> <span className="bg-surface-container-lowest px-1 rounded">remix</span> — hide matches</li>
              <li><span className="font-bold">Size:</span> <span className="bg-surface-container-lowest px-1 rounded">{`>10.5m <1g`}</span> <span className="bg-surface-container-lowest px-1 rounded">{`>500k`}</span> (k/m/g binary, B decimal, MiB)</li>
              <li><span className="font-bold">Bitrate:</span> <span className="bg-surface-container-lowest px-1 rounded">{`>192 <320`}</span> kbps</li>
              <li><span className="font-bold">Length:</span> <span className="bg-surface-container-lowest px-1 rounded">{`>6:00 <12:00`}</span> or seconds <span className="bg-surface-container-lowest px-1 rounded">{`>180`}</span></li>
              <li><span className="font-bold">Country:</span> <span className="bg-surface-container-lowest px-1 rounded">US !DE</span> (comma/semicolon/hyphen split, ! = exclude)</li>
              <li><span className="font-bold">File type:</span> <span className="bg-surface-container-lowest px-1 rounded">flac wav !mp3</span> or generic <span className="bg-surface-container-lowest px-1 rounded">audio/video/image/document/text/archive/executable</span></li>
              <li><span className="font-bold">Free slot:</span> toggle to show only users with free upload slot; <span className="font-bold">Public:</span> hide private shares</li>
            </ul>
            <button onClick={() => setShowHelp(false)} className="mt-2 font-label text-xs text-primary hover:underline">Close</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
