"use client";

import { mockBuddies, mockBrowseFolders, mockDemoTransfers, DEMO_BROWSE_USERS, DEMO_PROFILE_USERS } from "./fixtures";
import type { Transfer } from "@/lib/protocol";

/**
 * Demo localStorage keys seeded on first login and cleared on logout.
 * Mirrors the keys used by browse/profile/buddies/transfers providers.
 */
const BROWSE_KEY = "nicotine.browseTabs";
const PROFILE_KEY = "nicotine.profileTabs";
const BUDDIES_KEY = "nicotine.buddies";
const TRANSFERS_KEY = "nicotine.transfers.mock";
const PRIVATE_KEY = "nicotine.privatechats";
const RECENT_BROWSE_KEY = "nicotine.recentBrowse";
const RECENT_PROFILES_KEY = "nicotine.recentProfiles";
const DEMO_FLAG = "nicotine.demoSeeded";

export const DEMO_STORAGE_KEYS = [BROWSE_KEY, PROFILE_KEY, BUDDIES_KEY, TRANSFERS_KEY, PRIVATE_KEY, RECENT_BROWSE_KEY, RECENT_PROFILES_KEY, DEMO_FLAG] as const;

export function isDemoSeeded(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG) === "1";
  } catch { return false; }
}

export function seedDemoStorage(): void {
  try {
    if (localStorage.getItem(DEMO_FLAG) === "1") return;

    // Buddies — two trusted peers (overwrite empty array too)
    const buddiesRaw = localStorage.getItem(BUDDIES_KEY);
    if (!buddiesRaw || buddiesRaw === "[]") {
      localStorage.setItem(BUDDIES_KEY, JSON.stringify(mockBuddies()));
    }

    // Browse tabs — two shares (persisted as ids + usernames, folders load via mock)
    if (!localStorage.getItem(BROWSE_KEY)) {
      const tabs = [...DEMO_BROWSE_USERS].map((username, i) => ({ id: `b${i + 1}`, username }));
      localStorage.setItem(BROWSE_KEY, JSON.stringify({ tabs, activeId: tabs[0]?.id ?? null }));
    }
    if (!localStorage.getItem(RECENT_BROWSE_KEY)) {
      localStorage.setItem(RECENT_BROWSE_KEY, JSON.stringify([...DEMO_BROWSE_USERS]));
    }

    // Profile tabs
    if (!localStorage.getItem(PROFILE_KEY)) {
      const tabs = [...DEMO_PROFILE_USERS].map((username, i) => ({ id: `p${i + 1}`, username }));
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ tabs, activeId: tabs[0]?.id ?? null }));
    }
    if (!localStorage.getItem(RECENT_PROFILES_KEY)) {
      localStorage.setItem(RECENT_PROFILES_KEY, JSON.stringify([...DEMO_PROFILE_USERS]));
    }

    // Transfers — one download + one upload (overwrite [] written by TransfersProvider before login)
    const transfersRaw = localStorage.getItem(TRANSFERS_KEY);
    if (!transfersRaw || transfersRaw === "[]" || transfersRaw === "null") {
      localStorage.setItem(TRANSFERS_KEY, JSON.stringify(mockDemoTransfers() as Transfer[]));
    }

    // Private chats list (provider will hydrate messages from fixtures)
    if (!localStorage.getItem(PRIVATE_KEY)) {
      localStorage.setItem(PRIVATE_KEY, JSON.stringify([...DEMO_PROFILE_USERS]));
    }

    localStorage.setItem(DEMO_FLAG, "1");
  } catch {}
}

export function clearDemoStorage(): void {
  try {
    for (const k of DEMO_STORAGE_KEYS) localStorage.removeItem(k);
    // Also clear session-scoped seeds so next login re-seeds
    sessionStorage.removeItem("__demoSearchSeeded");
    sessionStorage.removeItem("__demoBrowseSeeded");
    sessionStorage.removeItem("__demoProfileSeeded");
    sessionStorage.removeItem("__demoTransfersSeeded");
    sessionStorage.removeItem("__demoPrivateSeeded");
    sessionStorage.removeItem("__demoBuddiesSeeded");
    sessionStorage.removeItem("__mockTransfers");
  } catch {}
}
