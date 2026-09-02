"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import type { UserInfoEvent, UserInfoInterests, UserInfoProfile, UserInfoStats, UserInfoStatus } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { DEMO_PROFILE_USERS, mockProfile } from "@/lib/demo/fixtures";

export interface UserProfile {
  username: string;
  status?: UserInfoStatus;
  stats?: UserInfoStats;
  interests?: UserInfoInterests;
  info?: UserInfoProfile;
  country?: string;
  watchUser?: { exists: boolean; status?: number; avgspeed?: number; files?: number; dirs?: number; country?: string };
}

export interface ProfileTab {
  id: string;
  username: string;
  profile: UserProfile;
  loading: boolean;
  error: string | null;
}

interface ProfileTabsApi {
  tabs: ProfileTab[];
  activeId: string | null;
  activeTab: ProfileTab | null;
  openProfile: (username: string) => void;
  closeProfile: (id: string) => void;
  setActive: (id: string) => void;
  refresh: (id: string) => void;
}

const ProfileTabsContext = createContext<ProfileTabsApi | null>(null);

const STORAGE_KEY = "nicotineHub.profileTabs";
const MAX_TABS = 10;

// Module-level cache survives provider remount (e.g. navigating away from /profile and back)
// so we don't redo the slsk UserInfo/Interests/Stats calls until user hits Refresh.
const profileCache = new Map<string, UserProfile>();
function getCachedProfile(username: string): UserProfile | undefined {
  return profileCache.get(username.toLowerCase());
}
function setCachedProfile(username: string, profile: UserProfile) {
  profileCache.set(username.toLowerCase(), profile);
}

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

function persist(tabs: ProfileTab[], activeId: string | null) {
  try {
    const data = { tabs: tabs.map((t) => ({ id: t.id, username: t.username })), activeId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, state } = useSession();
  const [tabs, setTabs] = useState<ProfileTab[]>(() => {
    const p = loadPersisted();
    if (p && p.tabs.length) {
      return p.tabs.map((t) => {
        const cached = getCachedProfile(t.username);
        if (cached) {
          return { id: t.id, username: t.username, profile: cached, loading: false, error: null };
        }
        return { id: t.id, username: t.username, profile: { username: t.username }, loading: true, error: null };
      });
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
        const n = parseInt(t.id.replace(/^p/, ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
    }
    return tabs.reduce((m: number, t: ProfileTab) => {
      const n = parseInt(t.id.replace(/^p/, ""), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
  })();
  const counter = useRef<number>(initialMax);
  const tabsRef = useRef<ProfileTab[]>([]);
  tabsRef.current = tabs;
  // Guard against rapid double-open of same username (e.g., ?user effect firing twice)
  const pendingOpenRef = useRef<Set<string>>(new Set());

  useEffect(() => { persist(tabs, activeId); }, [tabs, activeId]);

  // Cache profiles in module Map so remount (navigate away/back) doesn't refetch slsk
  useEffect(() => {
    for (const t of tabs) {
      if (!t.loading && !t.error && t.profile && (t.profile.info || t.profile.stats || t.profile.interests || t.profile.status)) {
        setCachedProfile(t.username, t.profile);
      }
    }
  }, [tabs]);

  // Demo: seed 2 fake profiles (jazzcat + vinyl_hunter) with mocked data
  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "connected") return;
    if (tabs.length !== 0) return;
    try { if (sessionStorage.getItem("__demoProfileSeeded")) return; } catch {}
    try { sessionStorage.setItem("__demoProfileSeeded", "1"); } catch {}
    const newTabs: ProfileTab[] = [...DEMO_PROFILE_USERS].map((username) => {
      const id = `p${++counter.current}`;
      const bundle = mockProfile(username);
      const profile: UserProfile = {
        username,
        status: bundle.status,
        stats: bundle.stats,
        interests: bundle.interests,
        info: bundle.info,
        country: bundle.country,
        watchUser: bundle.watchUser,
      };
      return { id, username, profile, loading: false, error: null };
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
    try { sessionStorage.removeItem("__demoProfileSeeded"); } catch {}
  }, [state.status]);

  // Clear module cache on logout (all modes) so next login starts fresh
  useEffect(() => {
    if (state.status !== "idle") return;
    profileCache.clear();
  }, [state.status]);

  // Subscribe to userinfo events
  useEffect(() => {
    if (state.status !== "connected") return;
    const unsub = subscribe((msg) => {
      if (msg.type === "user-info-response") {
        const lower = msg.username.toLowerCase();
        setTabs((prev) => prev.map((t) => {
          if (t.username.toLowerCase() !== lower) return t;
          return { ...t, loading: false, error: null, profile: { ...t.profile, info: { username: msg.username, descr: msg.descr, pic: msg.pic, totalupl: msg.totalupl, queuesize: msg.queuesize, slotsavail: msg.slotsavail, uploadallowed: msg.uploadallowed } } };
        }));
        return;
      }
      if (msg.type === "user-info-failed") {
        const lower = msg.username.toLowerCase();
        setTabs((prev) => prev.map((t) => {
          if (t.username.toLowerCase() !== lower) return t;
          const hasAnyData = !!(t.profile.info || t.profile.stats || t.profile.interests || t.profile.watchUser?.exists || t.profile.status || t.profile.country);
          if (hasAnyData) return { ...t, loading: false, error: null };
          return { ...t, loading: false, error: "Could not load this user's profile." };
        }));
        return;
      }
      if (msg.type !== "userinfo:event") return;
      const ev = msg.event as UserInfoEvent & { username?: string };
      const uname = (ev.username || (ev as unknown as { username?: string }).username || "") as string;
      if (!uname) {
        // For some events like check-privileges without username, ignore per-tab routing
        return;
      }
      const lower = uname.toLowerCase();
      switch (ev.type) {
        case "user-status":
          setTabs((prev) => prev.map((t) => t.username.toLowerCase() === lower ? { ...t, profile: { ...t.profile, status: ev.status }, loading: false, error: null } : t));
          break;
        case "user-stats":
          setTabs((prev) => prev.map((t) => t.username.toLowerCase() === lower ? { ...t, profile: { ...t.profile, stats: ev.stats }, loading: false, error: null } : t));
          break;
        case "user-interests":
          setTabs((prev) => prev.map((t) => t.username.toLowerCase() === lower ? { ...t, profile: { ...t.profile, interests: ev.interests }, loading: false, error: null } : t));
          break;
        case "watch-user":
          setTabs((prev) => prev.map((t) => {
            if (t.username.toLowerCase() !== lower) return t;
            const np: UserProfile = { ...t.profile, watchUser: ev.watchUser, country: ev.watchUser?.country || t.profile.country };
            if (ev.watchUser?.exists && ev.watchUser.status !== undefined) {
              np.status = { username: t.username, status: ev.watchUser.status, privileged: t.profile.status?.privileged || false };
            }
            return { ...t, profile: np, loading: false, error: null };
          }));
          break;
        case "user-info-response":
          setTabs((prev) => prev.map((t) => t.username.toLowerCase() === lower ? { ...t, profile: { ...t.profile, info: ev.info }, loading: false, error: null } : t));
          break;
        case "user-info-failed":
          setTabs((prev) => prev.map((t) => {
            if (t.username.toLowerCase() !== lower) return t;
            const hasAnyData = !!(t.profile.info || t.profile.stats || t.profile.interests || t.profile.watchUser?.exists || t.profile.status || t.profile.country);
            if (hasAnyData) return { ...t, loading: false, error: null };
            return { ...t, error: "Could not load this user's profile.", loading: false };
          }));
          break;
        default:
          break;
      }
    });
    return unsub;
  }, [subscribe, state.status]);

  // Trigger fetch for persisted tabs on connect
  const pendingRefetch = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (state.status !== "connected") return;
    for (const t of tabs) {
      if (t.loading && !pendingRefetch.current.has(t.id)) {
        pendingRefetch.current.add(t.id);
        const delay = [...tabs].indexOf(t) * 300;
        setTimeout(() => {
          send({ type: "userinfo", action: "watch", username: t.username });
          send({ type: "userinfo", action: "interests", username: t.username });
          send({ type: "userinfo", action: "get", username: t.username });
          // also trigger a timeout that will clear loading if no response
          setTimeout(() => {
            setTabs((prev) => prev.map((x) => {
              if (x.id !== t.id || !x.loading) return x;
              const hasAnyData = !!(x.profile.info || x.profile.stats || x.profile.interests || x.profile.watchUser?.exists || x.profile.status || x.profile.country);
              if (hasAnyData) return { ...x, loading: false, error: null };
              return { ...x, loading: false, error: x.error || "Could not load this user's profile." };
            }));
          }, 25000);
          pendingRefetch.current.delete(t.id);
        }, delay);
      }
    }
  }, [state.status, tabs, send]);

  const openProfile = useCallback((usernameRaw: string) => {
    const username = usernameRaw.trim();
    if (!username) return;
    const lower = username.toLowerCase();
    // Prevent duplicate tab creation when effect fires twice quickly (e.g., ?user handling)
    if (pendingOpenRef.current.has(lower)) {
      const ex = tabsRef.current.find((t) => t.username.toLowerCase() === lower);
      if (ex) setActiveId(ex.id);
      return;
    }
    const existing = tabsRef.current.find((t) => t.username.toLowerCase() === lower);
    if (existing) { setActiveId(existing.id); return; }
    if (tabsRef.current.length >= MAX_TABS) return;
    pendingOpenRef.current.add(lower);
    const id = `p${++counter.current}`;
    // If we have a cached profile, restore instantly without slsk round-trip
    const cached = getCachedProfile(username);
    if (cached) {
      const tab: ProfileTab = { id, username, profile: cached, loading: false, error: null };
      setTabs((prev) => {
        if (prev.some((t) => t.username.toLowerCase() === lower)) return prev;
        return [...prev, tab];
      });
      setActiveId(id);
      try {
        const key = "nicotineHub.recentProfiles";
        const raw = (localStorage.getItem(key) ?? localStorage.getItem(key.replace ? key.replace("nicotineHub.", "nicotine.") : key));
        const list: string[] = raw ? JSON.parse(raw) : [];
        const next = [username, ...list.filter((x: string) => x.toLowerCase() !== lower)].slice(0, 20);
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      setTimeout(() => pendingOpenRef.current.delete(lower), 600);
      return;
    }
    const tab: ProfileTab = { id, username, profile: { username }, loading: true, error: null };
    setTabs((prev) => {
      // Re-check inside functional update in case another call slipped between tabsRef check and setTabs
      if (prev.some((t) => t.username.toLowerCase() === lower)) return prev;
      return [...prev, tab];
    });
    setActiveId(id);
    if (state.status === "connected") {
      send({ type: "userinfo", action: "watch", username });
      send({ type: "userinfo", action: "interests", username });
      send({ type: "userinfo", action: "get", username });
      setTimeout(() => {
        setTabs((prev) => prev.map((x) => {
          if (x.id !== id || !x.loading) return x;
          const hasAnyData = !!(x.profile.info || x.profile.stats || x.profile.interests || x.profile.watchUser?.exists || x.profile.status || x.profile.country);
          if (hasAnyData) return { ...x, loading: false, error: null };
          return { ...x, loading: false, error: x.error || "Could not load this user's profile." };
        }));
      }, 25000);
    }
    // also save recent
    try {
      const key = "nicotineHub.recentProfiles";
      const raw = (localStorage.getItem(key) ?? localStorage.getItem(key.replace ? key.replace("nicotineHub.", "nicotine.") : key));
      const list: string[] = raw ? JSON.parse(raw) : [];
      const next = [username, ...list.filter((x: string) => x.toLowerCase() !== lower)].slice(0, 20);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
    // Clear guard after a short delay so same user can be re-opened after close
    setTimeout(() => pendingOpenRef.current.delete(lower), 600);
  }, [send, state.status]);

  const closeProfile = useCallback((id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (tab && state.status === "connected") {
      try { send({ type: "userinfo", action: "unwatch", username: tab.username }); } catch {}
    }
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
  }, [send, state.status]);

  const setActive = useCallback((id: string) => setActiveId(id), []);

  const refresh = useCallback((id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, loading: true, error: null } : t));
    send({ type: "userinfo", action: "watch", username: tab.username });
    send({ type: "userinfo", action: "interests", username: tab.username });
    send({ type: "userinfo", action: "get", username: tab.username });
  }, [send]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  const api = useMemo<ProfileTabsApi>(() => ({
    tabs, activeId, activeTab, openProfile, closeProfile, setActive, refresh
  }), [tabs, activeId, activeTab, openProfile, closeProfile, setActive, refresh]);

  return <ProfileTabsContext.Provider value={api}>{children}</ProfileTabsContext.Provider>;
}

export function useProfileTabs(): ProfileTabsApi {
  const ctx = useContext(ProfileTabsContext);
  if (!ctx) throw new Error("useProfileTabs must be used within ProfileProvider");
  return ctx;
}
