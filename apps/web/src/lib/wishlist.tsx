"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/session";

const STORAGE_KEY = "nicotineHub.wishlist";

export type WishlistEntry = {
  term: string;
  auto: boolean;
  ignoredUsers: string[];
  timeAdded: number;
};

function readStored(): WishlistEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY.replace("nicotineHub.", "nicotine.")));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // migrate string[] → WishlistEntry[]
    if (arr.length && typeof arr[0] === "string") {
      return (arr as string[]).filter((s) => typeof s === "string" && s.trim()).map((s) => ({ term: s, auto: true, ignoredUsers: [], timeAdded: Date.now() }));
    }
    return (arr as WishlistEntry[]).filter((e) => typeof e?.term === "string" && e.term.trim()).map((e) => ({
      term: e.term,
      auto: e.auto ?? true,
      ignoredUsers: Array.isArray(e.ignoredUsers) ? e.ignoredUsers.slice(0, 500) : [],
      timeAdded: e.timeAdded ?? Date.now(),
    }));
  } catch {}
  return [];
}

interface WishlistApi {
  terms: string[];
  entries: WishlistEntry[];
  addTerm: (term: string) => void;
  removeTerm: (term: string) => void;
  clearAll: () => void;
  interval: number | null;
  toggleAuto: (term: string) => void;
  resetSeen: (term: string) => void;
  markSeen: (term: string, users: string[]) => void;
  getIgnored: (term: string) => Set<string>;
}

const WishlistContext = createContext<WishlistApi | null>(null);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<WishlistEntry[]>(() => readStored());
  const terms = useMemo(() => entries.map((e) => e.term), [entries]);
  const [interval, setIntervalSec] = useState<number | null>(null);
  const { send, subscribe, state } = useSession();
  const didSync = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
  }, [entries]);

  // Sync to bridge when connected — only auto terms cycle server-side
  useEffect(() => {
    if (state.status !== "connected") return;
    send({ type: "wishlist:update", terms } as unknown as never);
    didSync.current = true;
  }, [terms, state.status, send]);

  // On reconnect, resync
  useEffect(() => {
    if (state.status === "connected" && !didSync.current && terms.length) {
      send({ type: "wishlist:update", terms } as unknown as never);
    }
    if (state.status === "connected") didSync.current = false;
  }, [state.status, terms, send]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      const m = msg as unknown as { type: string; wishlistInterval?: number; event?: { type: string; wishlistInterval?: number } };
      if (m.type === "userinfo:event" && m.event?.type === "wishlist-interval" && typeof m.event.wishlistInterval === "number") {
        setIntervalSec(m.event.wishlistInterval);
      }
    });
    return unsub;
  }, [subscribe]);

  const addTerm = useCallback((term: string) => {
    const clean = term.trim();
    if (!clean || entries.some((e) => e.term === clean)) return;
    setEntries((prev) => [...prev, { term: clean, auto: true, ignoredUsers: [], timeAdded: Date.now() }]);
  }, [entries]);

  const removeTerm = useCallback((term: string) => {
    setEntries((prev) => prev.filter((t) => t.term !== term));
  }, []);

  const clearAll = useCallback(() => setEntries([]), []);

  const toggleAuto = useCallback((term: string) => {
    setEntries((prev) => prev.map((e) => (e.term === term ? { ...e, auto: !e.auto } : e)));
  }, []);

  const resetSeen = useCallback((term: string) => {
    setEntries((prev) => prev.map((e) => (e.term === term ? { ...e, ignoredUsers: [] } : e)));
  }, []);

  const markSeen = useCallback((term: string, users: string[]) => {
    if (!users.length) return;
    setEntries((prev) => prev.map((e) => {
      if (e.term !== term) return e;
      const set = new Set(e.ignoredUsers);
      users.forEach((u) => set.add(u));
      return { ...e, ignoredUsers: [...set].slice(-500) };
    }));
  }, []);

  const getIgnored = useCallback((term: string) => {
    const e = entries.find((x) => x.term === term);
    return new Set(e?.ignoredUsers ?? []);
  }, [entries]);

  const api = useMemo(() => ({ terms, entries, addTerm, removeTerm, clearAll, interval, toggleAuto, resetSeen, markSeen, getIgnored }), [terms, entries, addTerm, removeTerm, clearAll, interval, toggleAuto, resetSeen, markSeen, getIgnored]);

  return <WishlistContext.Provider value={api}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}
