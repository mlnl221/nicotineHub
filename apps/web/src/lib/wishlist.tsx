"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/session";

const STORAGE_KEY = "nicotine.wishlist";

function readStored(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((s) => typeof s === "string" && s.trim());
  } catch {}
  return [];
}

interface WishlistApi {
  terms: string[];
  addTerm: (term: string) => void;
  removeTerm: (term: string) => void;
  clearAll: () => void;
  interval: number | null;
}

const WishlistContext = createContext<WishlistApi | null>(null);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [terms, setTerms] = useState<string[]>(() => readStored());
  const [interval, setIntervalSec] = useState<number | null>(null);
  const { send, subscribe, state } = useSession();
  const didSync = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(terms)); } catch {}
  }, [terms]);

  // Sync to bridge when connected
  useEffect(() => {
    if (state.status !== "connected") return;
    // Send terms via wishlist:update
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
    if (!clean || terms.includes(clean)) return;
    setTerms((prev) => [...prev, clean]);
  }, [terms]);

  const removeTerm = useCallback((term: string) => {
    setTerms((prev) => prev.filter((t) => t !== term));
  }, []);

  const clearAll = useCallback(() => setTerms([]), []);

  const api = useMemo(() => ({ terms, addTerm, removeTerm, clearAll, interval }), [terms, addTerm, removeTerm, clearAll, interval]);

  return <WishlistContext.Provider value={api}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}
