"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";
import {
  emptyFilters,
  type FilterState,
  type SearchRow,
} from "@/lib/protocol";

export type SearchMode = "global" | "user" | "room" | "wishlist" | "buddies";

export interface SearchTab {
  id: string;
  query: string;
  mode: SearchMode;
  target?: string; // username for user/buddies display, room for room
  status: "searching" | "ended";
  reason?: string;
  rows: SearchRow[];
  total: number;
  filters: FilterState;
}

interface SearchApi {
  tabs: SearchTab[];
  activeId: string | null;
  activeTab: SearchTab | null;
  startSearch: (query: string, opts?: { mode?: SearchMode; target?: string }) => void;
  stopSearch: (id: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setFilters: (id: string, partial: Partial<FilterState>) => void;
  clearFilters: (id: string) => void;
}

const SearchContext = createContext<SearchApi | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const { send, subscribe } = useSession();
  const { settings, setSection } = useConfig();
  const [tabs, setTabs] = useState<SearchTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const counter = useRef(0);
  const tabsRef = useRef<SearchTab[]>([]);
  tabsRef.current = tabs;

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "search:result") {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === msg.searchId ? { ...t, rows: [...t.rows, ...msg.rows], total: t.total + msg.rows.length } : t,
          ),
        );
      } else if (msg.type === "search:end") {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === msg.searchId ? { ...t, status: "ended", reason: msg.reason } : t,
          ),
        );
      }
    });
    return unsub;
  }, [subscribe]);

  const startSearch = useCallback(
    (query: string, opts?: { mode?: SearchMode; target?: string }) => {
      const trimmed = query.trim();
      if (trimmed.length < (settings.searches.min_search_chars ?? 3)) return;
      // History handling (nicotine searches.history 200)
      if (settings.searches.enable_history && trimmed) {
        const hist = settings.searches.history ?? [];
        const nextHist = [trimmed, ...hist.filter((h) => h !== trimmed)].slice(0, 200);
        setSection("searches", { history: nextHist });
      }
      const mode = opts?.mode ?? "global";
      const target = opts?.target?.trim();
      const id = `s${++counter.current}`;
      const defilter = settings.searches.defilter;
      const initialFilters: FilterState = settings.searches.enablefilters
        ? { include: defilter.include, exclude: defilter.exclude, size: defilter.fileSize, bitrate: defilter.bitrate, freeSlot: defilter.freeSlots, country: defilter.country, fileType: defilter.fileType, length: defilter.length, publicOnly: defilter.publicFiles }
        : emptyFilters();
      setTabs((prev) => [
        ...prev,
        { id, query: trimmed, mode, target, status: "searching", rows: [], total: 0, filters: initialFilters },
      ]);
      setActiveId(id);
      if (mode === "user" && target) {
        send({ type: "search:user", searchId: id, username: target, query } as unknown as never);
      } else if (mode === "room" && target) {
        send({ type: "search:room", searchId: id, room: target, query } as unknown as never);
      } else if (mode === "wishlist") {
        send({ type: "search:wishlist", searchId: id, query } as unknown as never);
      } else if (mode === "buddies") {
        let buddies: string[] = [];
        if (target) {
          buddies = target.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          // load from localStorage nicotine.buddies (up to 100)
          try {
            const raw = localStorage.getItem("nicotine.buddies");
            if (raw) {
              const arr = JSON.parse(raw) as Array<{ username?: string } | string>;
              buddies = arr.map((b) => typeof b === "string" ? b : b.username ?? "").filter(Boolean).slice(0, 20);
            }
          } catch {}
        }
        if (buddies.length) {
          for (const buddy of buddies) {
            send({ type: "search:user", searchId: id, username: buddy, query } as unknown as never);
          }
        } else {
          // no buddies: fallback to global with flash via tab label
          send({ type: "search", searchId: id, query });
        }
      } else {
        send({ type: "search", searchId: id, query: trimmed });
      }
    },
    [send, settings, setSection],
  );

  const stopSearch = useCallback(
    (id: string) => {
      send({ type: "search:stop", searchId: id });
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "ended", reason: "stopped" } : t)),
      );
    },
    [send],
  );

  const closeTab = useCallback(
    (id: string) => {
      send({ type: "search:stop", searchId: id });
      const next = tabsRef.current.filter((t) => t.id !== id);
      setTabs(next);
      setActiveId((curr) => (curr === id ? (next[next.length - 1]?.id ?? null) : curr));
    },
    [send],
  );

  const setFilters = useCallback((id: string, partial: Partial<FilterState>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, filters: { ...t.filters, ...partial } } : t)),
    );
  }, []);

  const clearFilters = useCallback((id: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, filters: emptyFilters() } : t)));
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId],
  );

  const api = useMemo<SearchApi>(
    () => ({ tabs, activeId, activeTab, startSearch, stopSearch, closeTab, setActive: setActiveId, setFilters, clearFilters }),
    [tabs, activeId, activeTab, startSearch, stopSearch, closeTab, setFilters, clearFilters],
  );

  return <SearchContext.Provider value={api}>{children}</SearchContext.Provider>;
}

export function useSearches(): SearchApi {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearches must be used within SearchProvider");
  return ctx;
}
