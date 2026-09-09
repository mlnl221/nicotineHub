"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import {
  UNREAD_STORE_KEY,
  emptyUnread,
  parseUnreadStored,
  unreadKeyForMessage,
  unreadKeyForRoute,
  type UnreadKey,
  type UnreadState,
} from "@/lib/unread-dots";

interface UnreadApi {
  unread: UnreadState;
  clear: (key: UnreadKey) => void;
}

const UnreadContext = createContext<UnreadApi | null>(null);

function loadStored(): UnreadState {
  if (typeof window === "undefined") return emptyUnread();
  try {
    return parseUnreadStored(localStorage.getItem(UNREAD_STORE_KEY));
  } catch {
    return emptyUnread();
  }
}

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { subscribe, state } = useSession();
  const pathname = usePathname();
  const [unread, setUnread] = useState<UnreadState>(() => loadStored());

  useEffect(() => {
    try {
      localStorage.setItem(UNREAD_STORE_KEY, JSON.stringify(unread));
    } catch {}
  }, [unread]);

  // Set dots from bridge events (single fanout listener).
  useEffect(() => {
    const unsub = subscribe((msg) => {
      const key = unreadKeyForMessage(msg as unknown as { type: string });
      if (!key) return;
      setUnread((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    });
    return unsub;
  }, [subscribe]);

  // Visiting a tab clears its dot.
  useEffect(() => {
    const key = unreadKeyForRoute(pathname ?? "");
    if (!key) return;
    setUnread((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
  }, [pathname]);

  // Clear on logout — not on initial mount (persisted dots survive reload).
  const hasConnectedRef = useRef(false);
  useEffect(() => {
    if (state.status === "connected") hasConnectedRef.current = true;
    if (state.status !== "idle") return;
    if (!hasConnectedRef.current) return;
    setUnread(emptyUnread());
    try {
      localStorage.removeItem(UNREAD_STORE_KEY);
    } catch {}
  }, [state.status]);

  const clear = useCallback((key: UnreadKey) => {
    setUnread((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
  }, []);

  return <UnreadContext.Provider value={{ unread, clear }}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadApi {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error("useUnread must be used within UnreadProvider");
  return ctx;
}

export type { UnreadKey, UnreadState };
