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
import {
  emptyFilters,
  type FilterState,
  type SearchRow,
} from "@/lib/protocol";

export type SearchMode = "global";

export interface SearchTab {
  id: string;
  query: string;
  mode: SearchMode;
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
  startSearch: (query: string, mode?: SearchMode) => void;
  stopSearch: (id: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setFilters: (id: string, partial: Partial<FilterState>) => void;
  clearFilters: (id: string) => void;
}

const SearchContext = createContext<SearchApi | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const { send, subscribe } = useSession();
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
    (query: string, mode: SearchMode = "global") => {
      const id = `s${++counter.current}`;
      setTabs((prev) => [
        ...prev,
        { id, query, mode, status: "searching", rows: [], total: 0, filters: emptyFilters() },
      ]);
      setActiveId(id);
      send({ type: "search", searchId: id, query });
    },
    [send],
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
