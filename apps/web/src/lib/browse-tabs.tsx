"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import type { BrowseFolder, BrowseFile } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { DEMO_BROWSE_USERS, mockBrowseFolders } from "@/lib/demo/fixtures";

export interface BrowseTab {
  id: string;
  username: string;
  loading: boolean;
  error: string | null;
  folders: BrowseFolder[];
  currentFolder: string | null;
  currentFiles: BrowseFile[] | null;
  query: string;
}

interface BrowseTabsApi {
  tabs: BrowseTab[];
  activeId: string | null;
  activeTab: BrowseTab | null;
  openBrowse: (username: string) => void;
  closeBrowse: (id: string) => void;
  setActive: (id: string) => void;
  setQuery: (id: string, q: string) => void;
  openFolder: (id: string, folder: string) => void;
  retry: (id: string) => void;
}

const BrowseTabsContext = createContext<BrowseTabsApi | null>(null);

const STORAGE_KEY = "nicotine.browseTabs";
const MAX_TABS = 10;

function loadPersisted(): { tabs: Array<{ id: string; username: string }>; activeId: string | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs?: Array<{ id: string; username: string }>; activeId?: string | null };
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs.filter((t) => typeof t.username === "string" && t.username.trim()).slice(0, MAX_TABS);
    return { tabs, activeId: typeof parsed.activeId === "string" ? parsed.activeId : null };
  } catch { return null; }
}

function persist(tabs: BrowseTab[], activeId: string | null) {
  try {
    const data = { tabs: tabs.map((t) => ({ id: t.id, username: t.username })), activeId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function BrowseProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, state } = useSession();
  const [tabs, setTabs] = useState<BrowseTab[]>(() => {
    const p = loadPersisted();
    if (p && p.tabs.length) {
      return p.tabs.map((t) => ({
        id: t.id,
        username: t.username,
        loading: true,
        error: null,
        folders: [],
        currentFolder: null,
        currentFiles: null,
        query: "",
      }));
    }
    return [];
  });
  const [activeId, setActiveId] = useState<string | null>(() => {
    const p = loadPersisted();
    return p?.activeId ?? (p?.tabs[0]?.id ?? null);
  });
  const initialMax = (() => {
    const p = loadPersisted();
    if (p && p.tabs.length) {
      return p.tabs.reduce((m: number, t: { id: string }) => {
        const n = parseInt(t.id.replace(/^b/, ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
    }
    return tabs.reduce((m: number, t: BrowseTab) => {
      const n = parseInt(t.id.replace(/^b/, ""), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
  })();
  const counter = useRef<number>(initialMax);
  const tabsRef = useRef<BrowseTab[]>([]);
  tabsRef.current = tabs;
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // persist on change (debounced via effect)
  useEffect(() => { persist(tabs, activeId); }, [tabs, activeId]);

  // Demo: seed 2 browse shares (jazzcat + vinyl_hunter) with mocked folders
  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "connected") return;
    if (tabs.length !== 0) return;
    try { if (sessionStorage.getItem("__demoBrowseSeeded")) return; } catch {}
    try { sessionStorage.setItem("__demoBrowseSeeded", "1"); } catch {}
    const newTabs: BrowseTab[] = [...DEMO_BROWSE_USERS].map((username) => {
      const id = `b${++counter.current}`;
      const folders = mockBrowseFolders(username);
      return { id, username, loading: false, error: null, folders, currentFolder: null, currentFiles: null, query: "" };
    });
    setTabs(newTabs);
    setActiveId(newTabs[0]?.id ?? null);
  }, [state.status, tabs.length]);

  // Demo: clear on logout
  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "idle") return;
    setTabs([]);
    setActiveId(null);
    counter.current = 0;
    try { sessionStorage.removeItem("__demoBrowseSeeded"); } catch {}
  }, [state.status]);

  // Subscribe to browse messages — multiplex by username
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "browse:shares") {
        const m = msg as unknown as { username: string; folders?: BrowseFolder[]; error?: string };
        const lower = m.username.toLowerCase();
        const existingTimer = [...timersRef.current.entries()].find(([id]) => {
          const t = tabsRef.current.find((x) => x.id === id);
          return t?.username.toLowerCase() === lower;
        });
        setTabs((prev) => prev.map((t) => {
          if (t.username.toLowerCase() !== lower) return t;
          const timer = timersRef.current.get(t.id);
          if (timer) { clearTimeout(timer); timersRef.current.delete(t.id); }
          if (m.error) return { ...t, loading: false, error: m.error };
          return { ...t, loading: false, error: null, folders: m.folders || [] };
        }));
      } else if (msg.type === "browse:folder") {
        const m = msg as unknown as { username: string; folder: string; token: number; files: BrowseFile[]; error?: string };
        const lower = m.username.toLowerCase();
        setTabs((prev) => prev.map((t) => {
          if (t.username.toLowerCase() !== lower) return t;
          if (m.error) return { ...t, error: m.error };
          return { ...t, currentFolder: m.folder, currentFiles: m.files, error: null };
        }));
      }
    });
    return unsub;
  }, [subscribe]);

  // On connected, re-trigger pending loads for persisted tabs that are still loading
  const pendingRefetch = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (state.status !== "connected") return;
    for (const t of tabs) {
      if (t.loading && !pendingRefetch.current.has(t.id)) {
        pendingRefetch.current.add(t.id);
        // stagger to avoid burst
        const delay = [...tabs].indexOf(t) * 400;
        setTimeout(() => {
          send({ type: "browse", action: "shares", username: t.username });
          const timer = setTimeout(() => {
            setTabs((prev) => prev.map((x) => x.id === t.id && x.loading ? { ...x, loading: false, error: x.folders.length ? null : "Timed out — user may be offline or not sharing." } : x));
            timersRef.current.delete(t.id);
          }, 32000);
          timersRef.current.set(t.id, timer);
          pendingRefetch.current.delete(t.id);
        }, delay);
      }
    }
  }, [state.status, tabs, send]);

  // cleanup timers on unmount
  useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const openBrowse = useCallback((usernameRaw: string) => {
    const username = usernameRaw.trim();
    if (!username) return;
    const existing = tabsRef.current.find((t) => t.username.toLowerCase() === username.toLowerCase());
    if (existing) { setActiveId(existing.id); return; }
    if (tabsRef.current.length >= MAX_TABS) return;
    const id = `b${++counter.current}`;
    const tab: BrowseTab = { id, username, loading: true, error: null, folders: [], currentFolder: null, currentFiles: null, query: "" };
    setTabs((prev) => [...prev, tab]);
    setActiveId(id);
    if (state.status === "connected") {
      send({ type: "browse", action: "shares", username });
      const timer = setTimeout(() => {
        setTabs((prev) => prev.map((x) => x.id === id && x.loading ? { ...x, loading: false, error: x.folders.length ? null : "Timed out — user may be offline or not sharing." } : x));
        timersRef.current.delete(id);
      }, 32000);
      timersRef.current.set(id, timer);
    }
  }, [send, state.status]);

  const closeBrowse = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    const next = tabsRef.current.filter((t) => t.id !== id);
    setTabs(next);
    setActiveId((cur) => cur === id ? (next[next.length - 1]?.id ?? null) : cur);
  }, []);

  const setActive = useCallback((id: string) => { setActiveId(id); }, []);

  const setQuery = useCallback((id: string, q: string) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, query: q } : t));
  }, []);

  const openFolder = useCallback((id: string, folder: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, currentFolder: folder, currentFiles: null } : t));
    send({ type: "browse", action: "folder", username: tab.username, folder });
  }, [send]);

  const retry = useCallback((id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, loading: true, error: null } : t));
    const existingTimer = timersRef.current.get(id);
    if (existingTimer) { clearTimeout(existingTimer); timersRef.current.delete(id); }
    send({ type: "browse", action: "shares", username: tab.username });
    const timer = setTimeout(() => {
      setTabs((prev) => prev.map((x) => x.id === id && x.loading ? { ...x, loading: false, error: x.folders.length ? null : "Timed out — user may be offline or not sharing." } : x));
      timersRef.current.delete(id);
    }, 32000);
    timersRef.current.set(id, timer);
  }, [send]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  const api = useMemo<BrowseTabsApi>(() => ({
    tabs, activeId, activeTab, openBrowse, closeBrowse, setActive, setQuery, openFolder, retry
  }), [tabs, activeId, activeTab, openBrowse, closeBrowse, setActive, setQuery, openFolder, retry]);

  return <BrowseTabsContext.Provider value={api}>{children}</BrowseTabsContext.Provider>;
}

export function useBrowseTabs(): BrowseTabsApi {
  const ctx = useContext(BrowseTabsContext);
  if (!ctx) throw new Error("useBrowseTabs must be used within BrowseProvider");
  return ctx;
}
