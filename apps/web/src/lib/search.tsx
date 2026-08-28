"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SearchRow, FilterState } from "@/lib/protocol";
import { emptyFilters } from "@/lib/protocol";
import { useSession } from "@/lib/session";
import { applyFilters } from "@/lib/filter";

export interface SearchTab {
  id: number;
  query: string;
  rows: SearchRow[];
  total: number;
  filters: FilterState;
  status: "searching" | "ended";
  reason: string | null;
}

interface SearchesApi {
  tabs: SearchTab[];
  activeId: number | null;
  activeTab: SearchTab | null;
  startSearch: (query: string) => void;
  stopSearch: (id: number) => void;
  setActive: (id: number) => void;
  closeTab: (id: number) => void;
  setFilters: (id: number, partial: Partial<FilterState>) => void;
  clearFilters: (id: number) => void;
}

const SearchesContext = createContext<SearchesApi | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const { send, subscribe } = useSession();
  const [tabs, setTabs] = useState<SearchTab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const nextId = useRef(1);
  const byId = useRef(new Map<number, SearchTab>());
  const tabsRef = useRef<SearchTab[]>([]);
  tabsRef.current = tabs;

  const sync = useCallback((next: SearchTab[]) => {
    const map = new Map(next.map((t) => [t.id, t]));
    byId.current = map;
    setTabs(next);
  }, []);

  const appendRows = useCallback(
    (id: number, rows: SearchRow[]) => {
      const tab = byId.current.get(id);
      if (!tab) return;
      sync(
        tabsRef.current.map((t) =>
          t.id === id
            ? { ...t, rows: [...t.rows, ...rows].slice(0, 5000), total: t.total + rows.length }
            : t,
        ),
      );
    },
    [sync],
  );

  const endTab = useCallback(
    (id: number, reason: string) => {
      const tab = byId.current.get(id);
      if (!tab) return;
      sync(tabsRef.current.map((t) => (t.id === id ? { ...t, status: "ended", reason } : t)));
    },
    [sync],
  );

  const startSearch = useCallback(
    (query: string) => {
      const id = nextId.current++;
      const tab: SearchTab = {
        id,
        query,
        rows: [],
        total: 0,
        filters: emptyFilters(),
        status: "searching",
        reason: null,
      };
      byId.current.set(id, tab);
      sync([...tabsRef.current, tab]);
      setActiveId(id);
      send({ type: "search", searchId: String(id), query });
    },
    [send, sync],
  );

  const stopSearch = useCallback(
    (id: number) => {
      send({ type: "search:stop", searchId: String(id) });
      endTab(id, "aborted");
    },
    [send, endTab],
  );

  const setActive = useCallback((id: number) => setActiveId(id), []);

  const closeTab = useCallback(
    (id: number) => {
      const wasActive = activeId === id;
      const remaining = tabsRef.current.filter((t) => t.id !== id);
      byId.current.delete(id);
      sync(remaining);
      if (wasActive) {
        const nextActive = remaining[remaining.length - 1];
        setActiveId(nextActive ? nextActive.id : null);
      }
    },
    [activeId, sync],
  );

  const setFilters = useCallback(
    (id: number, partial: Partial<FilterState>) => {
      sync(
        tabsRef.current.map((t) =>
          t.id === id ? { ...t, filters: { ...t.filters, ...partial } } : t,
        ),
      );
    },
    [sync],
  );

  const clearFilters = useCallback(
    (id: number) => {
      sync(tabsRef.current.map((t) => (t.id === id ? { ...t, filters: emptyFilters() } : t)));
    },
    [sync],
  );

  // Wire bridge search messages into tabs.
  useEffect(
    () =>
      subscribe((msg) => {
        if (msg.type === "search:result") {
          const id = Number(msg.searchId);
          if (!Number.isNaN(id)) appendRows(id, msg.rows);
        } else if (msg.type === "search:end") {
          const id = Number(msg.searchId);
          if (!Number.isNaN(id)) endTab(id, msg.reason);
        }
      }),
    [subscribe, appendRows, endTab],
  );

  const activeTab = activeId == null ? null : byId.current.get(activeId) ?? null;

  const api: SearchesApi = {
    tabs,
    activeId,
    activeTab,
    startSearch,
    stopSearch,
    setActive,
    closeTab,
    setFilters,
    clearFilters,
  };

  return <SearchesContext.Provider value={api}>{children}</SearchesContext.Provider>;
}

export function useSearches(): SearchesApi {
  const ctx = useContext(SearchesContext);
  if (!ctx) throw new Error("useSearches must be used within SearchProvider");
  return ctx;
}

export { applyFilters };
