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

const STORAGE_KEY = "nicotineHub.browseTabs";
const MAX_TABS = 10;

function loadPersisted(): { tabs: Array<{ id: string; username: string }>; activeId: string | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY.replace("nicotineHub.", "nicotine.")));
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
  const pendingOpenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // track pending folder request per tab to avoid cross-tab stale updates when same username in multiple tabs
  const pendingFolderRef = useRef<Map<string, string>>(new Map());

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

  // Subscribe to browse messages — multiplex by username, folder precise to avoid stale cross-tab updates
  useEffect(() => {
    const unsub = subscribe((msg) => {
      const rawType = (msg as unknown as { type: string }).type;
      // normalize: server may send "browse-error" for legacy, bridge now sends "browse:shares" with error
      const isSharesMsg = rawType === "browse:shares" || rawType === "browse-error";
      const isFolderMsg = rawType === "browse:folder";
      // legacy browse-error with token is actually a folder error
      const isLegacyFolderError = rawType === "browse-error" && (msg as unknown as { token?: number }).token !== undefined;
      if (isSharesMsg && !isLegacyFolderError) {
        const m = msg as unknown as { username: string; folders?: BrowseFolder[]; error?: string };
        // treat legacy browse-error as error even if no explicit error field
        const hasError = !!m.error || rawType === "browse-error";
        const errMsg = m.error || (rawType === "browse-error" ? "Timed out fetching shares" : undefined);
        console.log("[browse-tabs] shares recv", m.username, "error", errMsg || "none", "isDemo", isDemo, "rawType", rawType);
        const lower = m.username.toLowerCase();
        const existingTimer = [...timersRef.current.entries()].find(([id]) => {
          const t = tabsRef.current.find((x) => x.id === id);
          return t?.username.toLowerCase() === lower;
        });
        setTabs((prev) => prev.map((t) => {
          if (t.username.toLowerCase() !== lower) return t;
          const timer = timersRef.current.get(t.id);
          if (timer) { clearTimeout(timer); timersRef.current.delete(t.id); }
          if (hasError) return { ...t, loading: false, error: errMsg || "Failed to fetch shares" };
          return { ...t, loading: false, error: null, folders: m.folders || [] };
        }));
      } else if (isFolderMsg || isLegacyFolderError) {
        const m = msg as unknown as { username: string; folder: string; token: number; files: BrowseFile[]; error?: string };
        const lower = m.username.toLowerCase();
        const hasError = !!m.error || isLegacyFolderError;
        setTabs((prev) => prev.map((t) => {
          if (t.username.toLowerCase() !== lower) return t;
          // only update the tab that actually requested this folder (prevents stale files in other tab with same user)
          const pending = pendingFolderRef.current.get(t.id);
          const shouldUpdate = pending ? pending === m.folder : t.currentFolder === m.folder;
          // if no pending and no currentFolder match, but single tab for user -> still update (legacy)
          const singleTabForUser = prev.filter((x) => x.username.toLowerCase() === lower).length === 1;
          if (!shouldUpdate && !singleTabForUser) return t;
          if (pending === m.folder) pendingFolderRef.current.delete(t.id);
          if (hasError) return { ...t, error: m.error || "Failed to fetch folder", currentFiles: null };
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
            setTabs((prev) => prev.map((x) => {
              if (x.id !== t.id || !x.loading) return x;
              if (x.folders.length) return { ...x, loading: false, error: null };
              return { ...x, loading: false, error: "Timed out — user may be offline or not sharing." };
            }));
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
    const lower = username.toLowerCase();
    if (pendingOpenRef.current.has(lower)) {
      const ex = tabsRef.current.find((t) => t.username.toLowerCase() === lower);
      if (ex) setActiveId(ex.id);
      return;
    }
    const existing = tabsRef.current.find((t) => t.username.toLowerCase() === lower);
    if (existing) { setActiveId(existing.id); return; }
    if (tabsRef.current.length >= MAX_TABS) return;
    pendingOpenRef.current.add(lower);
    const id = `b${++counter.current}`;
    const tab: BrowseTab = { id, username, loading: true, error: null, folders: [], currentFolder: null, currentFiles: null, query: "" };
    setTabs((prev) => {
      if (prev.some((t) => t.username.toLowerCase() === lower)) return prev;
      return [...prev, tab];
    });
    setActiveId(id);
    if (state.status === "connected") {
      send({ type: "browse", action: "shares", username });
      const timer = setTimeout(() => {
        setTabs((prev) => prev.map((x) => {
          if (x.id !== id || !x.loading) return x;
          if (x.folders.length) return { ...x, loading: false, error: null };
          return { ...x, loading: false, error: "Timed out — user may be offline or not sharing." };
        }));
        timersRef.current.delete(id);
      }, 32000);
      timersRef.current.set(id, timer);
    }
    setTimeout(() => pendingOpenRef.current.delete(lower), 600);
  }, [send, state.status]);

  const closeBrowse = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    pendingFolderRef.current.delete(id);
    const idx = tabsRef.current.findIndex((t) => t.id === id);
    const next = tabsRef.current.filter((t) => t.id !== id);
    setTabs(next);
    setActiveId((cur) => {
      if (cur !== id) return cur;
      if (next.length === 0) return null;
      let preferPrev = true;
      try {
        const raw = localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings");
        if (raw) {
          const parsed = JSON.parse(raw) as { ui?: { tab_select_previous?: boolean } };
          if (typeof parsed?.ui?.tab_select_previous === "boolean") preferPrev = parsed.ui.tab_select_previous;
        }
      } catch {}
      if (preferPrev && idx > 0) return tabsRef.current[idx - 1]?.id ?? next[next.length - 1]?.id ?? null;
      if (!preferPrev && idx < tabsRef.current.length - 1) return tabsRef.current[idx + 1]?.id ?? next[next.length - 1]?.id ?? null;
      return next[next.length - 1]?.id ?? null;
    });
  }, []);

  const setActive = useCallback((id: string) => { setActiveId(id); }, []);

  const setQuery = useCallback((id: string, q: string) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, query: q } : t));
  }, []);

  const openFolder = useCallback((id: string, folder: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    // Demo: resolve locally from cached folders — no bridge round-trip needed; avoids stale currentFiles races
    if (isDemo) {
      const f = tab.folders.find((x) => x.name === folder);
      setTabs((prev) => prev.map((t) => t.id === id ? { ...t, currentFolder: folder, currentFiles: f ? f.files : null, error: null } : t));
      return;
    }
    pendingFolderRef.current.set(id, folder);
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
      setTabs((prev) => prev.map((x) => {
        if (x.id !== id || !x.loading) return x;
        if (x.folders.length) return { ...x, loading: false, error: null };
        return { ...x, loading: false, error: "Timed out — user may be offline or not sharing." };
      }));
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
