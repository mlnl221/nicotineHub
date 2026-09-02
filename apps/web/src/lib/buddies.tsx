"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import type { UserInfoEvent, UserInfoStats, UserInfoStatus } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { DEMO_BUDDY_USERS, mockBuddies } from "@/lib/demo/fixtures";

export interface Buddy {
  username: string;
  note?: string;
  trusted?: boolean;
  notify?: boolean;
  status?: number; // 0 offline,1 away,2 online
  privileged?: boolean;
  country?: string;
  avgspeed?: number;
  files?: number;
  dirs?: number;
  lastSeen?: string;
}

const BUDDIES_KEY = "nicotineHub.buddies";
const MAX_BUDDIES = 100;

function loadBuddies(): Buddy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = (localStorage.getItem(BUDDIES_KEY) ?? localStorage.getItem(BUDDIES_KEY.replace("nicotineHub.", "nicotine.")));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let list = parsed.filter((x: unknown) => typeof (x as Buddy).username === "string").slice(0, MAX_BUDDIES);
    if (!isDemo) {
      const demoSet = new Set(DEMO_BUDDY_USERS.map((u) => u.toLowerCase()));
      const filtered = list.filter((b) => !demoSet.has(b.username.toLowerCase()));
      if (filtered.length !== list.length) {
        try { localStorage.setItem(BUDDIES_KEY, JSON.stringify(filtered)); } catch {}
        try { sessionStorage.removeItem("__demoBuddiesSeeded"); } catch {}
        list = filtered;
      }
    }
    return list;
  } catch {
    return [];
  }
}
function saveBuddies(list: Buddy[]) {
  try {
    localStorage.setItem(BUDDIES_KEY, JSON.stringify(list.slice(0, MAX_BUDDIES)));
  } catch {}
}

export function useBuddies() {
  const { send, subscribe, state } = useSession();
  const [buddies, setBuddies] = useState<Buddy[]>(() => loadBuddies());
  const [filter, setFilter] = useState("");

  // Persist + watch/unwatch on change
  useEffect(() => {
    saveBuddies(buddies);
  }, [buddies]);

  // Demo: seed 2 buddies on first connect
  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "connected") return;
    if (buddies.length !== 0) return;
    try { if (sessionStorage.getItem("__demoBuddiesSeeded")) return; } catch {}
    try { sessionStorage.setItem("__demoBuddiesSeeded", "1"); } catch {}
    const seeded = mockBuddies();
    setBuddies(seeded);
  }, [state.status, buddies.length]);

  // Demo: clear on logout
  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "idle") return;
    setBuddies([]);
    try { sessionStorage.removeItem("__demoBuddiesSeeded"); } catch {}
  }, [state.status]);

  // Prod: purge demo users if they somehow persisted (e.g. visited demo build then prod)
  useEffect(() => {
    if (isDemo) return;
    const demoSet = new Set(DEMO_BUDDY_USERS.map((u) => u.toLowerCase()));
    setBuddies((prev) => {
      const filtered = prev.filter((b) => !demoSet.has(b.username.toLowerCase()));
      if (filtered.length !== prev.length) {
        try { sessionStorage.removeItem("__demoBuddiesSeeded"); } catch {}
        return filtered;
      }
      return prev;
    });
  }, []);

  // Subscribe to user-status/stats/watch-user updates
  useEffect(() => {
    if (state.status !== "connected") return;
    // watch all buddies on connect
    for (const b of buddies) {
      send({ type: "userinfo", action: "watch", username: b.username });
    }
    const unsub = subscribe((msg) => {
      if (msg.type !== "userinfo:event") return;
      const ev: UserInfoEvent = msg.event;
      if (!ev.username) return;
      const uname = ev.username;
      // Only track buddies
      setBuddies((prev) => {
        const idx = prev.findIndex((b) => b.username === uname);
        if (idx === -1) return prev;
        const cur = prev[idx];
        let next: Buddy = { ...cur };
        let changed = false;
        if (ev.type === "user-status" && ev.status) {
          next.status = ev.status.status;
          next.privileged = ev.status.privileged;
          const now = new Date().toLocaleString();
          if (ev.status.status === 0) next.lastSeen = now;
          changed = true;
        } else if (ev.type === "user-stats" && ev.stats) {
          next.avgspeed = ev.stats.avgspeed;
          next.files = ev.stats.files;
          next.dirs = ev.stats.dirs;
          changed = true;
        } else if (ev.type === "watch-user" && ev.watchUser) {
          const w = ev.watchUser;
          if (w.exists) {
            next.status = w.status;
            next.avgspeed = w.avgspeed;
            next.files = w.files;
            next.dirs = w.dirs;
            next.country = w.country;
            changed = true;
          } else {
            next.status = 0;
            changed = true;
          }
        } else if (ev.type === "privileged-users" && ev.privilegedUsers) {
          next.privileged = ev.privilegedUsers.includes(uname);
          changed = true;
        }
        if (!changed) return prev;
        const out = [...prev];
        out[idx] = next;
        return out;
      });
    });
    return () => {
      unsub();
    };
  }, [state.status, subscribe, send, buddies.length]);

  const addBuddy = useCallback(
    (username: string, note?: string) => {
      const u = username.trim();
      if (!u) return false;
      if (buddies.some((b) => b.username.toLowerCase() === u.toLowerCase())) return false;
      const nb: Buddy = { username: u, note: note?.trim() || undefined, trusted: false, notify: true, status: 0 };
      setBuddies((prev) => [nb, ...prev].slice(0, MAX_BUDDIES));
      if (state.status === "connected") send({ type: "userinfo", action: "watch", username: u });
      return true;
    },
    [buddies, state.status, send],
  );

  const removeBuddy = useCallback(
    (username: string) => {
      setBuddies((prev) => prev.filter((b) => b.username !== username));
      if (state.status === "connected") send({ type: "userinfo", action: "unwatch", username });
    },
    [state.status, send],
  );

  const setTrusted = useCallback((username: string, trusted: boolean) => {
    setBuddies((prev) => prev.map((b) => (b.username === username ? { ...b, trusted } : b)));
  }, []);

  const setNotify = useCallback((username: string, notify: boolean) => {
    setBuddies((prev) => prev.map((b) => (b.username === username ? { ...b, notify } : b)));
  }, []);

  const setNote = useCallback((username: string, note: string) => {
    setBuddies((prev) => prev.map((b) => (b.username === username ? { ...b, note: note || undefined } : b)));
  }, []);

  const filtered = filter
    ? buddies.filter(
        (b) =>
          b.username.toLowerCase().includes(filter.toLowerCase()) ||
          (b.note && b.note.toLowerCase().includes(filter.toLowerCase())),
      )
    : buddies;

  return { buddies: filtered, allBuddies: buddies, filter, setFilter, addBuddy, removeBuddy, setTrusted, setNotify, setNote };
}
