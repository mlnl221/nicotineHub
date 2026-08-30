"use client";

import { mockBuddies, mockBrowseFolders, mockDemoTransfers, DEMO_BROWSE_USERS, DEMO_PROFILE_USERS } from "./fixtures";
import type { Transfer } from "@/lib/protocol";

/**
 * Demo localStorage keys seeded on first login and cleared on logout.
 * Mirrors the keys used by browse/profile/buddies/transfers providers.
 */
const BROWSE_KEY = "nicotineHub.browseTabs";
const PROFILE_KEY = "nicotineHub.profileTabs";
const BUDDIES_KEY = "nicotineHub.buddies";
const TRANSFERS_KEY = "nicotineHub.transfers.mock";
const PRIVATE_KEY = "nicotineHub.privatechats";
const RECENT_BROWSE_KEY = "nicotineHub.recentBrowse";
const RECENT_PROFILES_KEY = "nicotineHub.recentProfiles";
const DEMO_FLAG = "nicotineHub.demoSeeded";

export const DEMO_STORAGE_KEYS = [BROWSE_KEY, PROFILE_KEY, BUDDIES_KEY, TRANSFERS_KEY, PRIVATE_KEY, RECENT_BROWSE_KEY, RECENT_PROFILES_KEY, DEMO_FLAG] as const;

export function isDemoSeeded(): boolean {
  try {
    return (localStorage.getItem(DEMO_FLAG) ?? localStorage.getItem(DEMO_FLAG.replace("nicotineHub.", "nicotine."))) === "1";
  } catch { return false; }
}

export function seedDemoStorage(): void {
  try {
    if ((localStorage.getItem(DEMO_FLAG) ?? localStorage.getItem(DEMO_FLAG.replace("nicotineHub.", "nicotine."))) === "1") return;

    // Buddies — two trusted peers (overwrite empty array too)
    const buddiesRaw = (localStorage.getItem(BUDDIES_KEY) ?? localStorage.getItem(BUDDIES_KEY.replace("nicotineHub.", "nicotine.")));
    if (!buddiesRaw || buddiesRaw === "[]") {
      localStorage.setItem(BUDDIES_KEY, JSON.stringify(mockBuddies()));
    }

    // Browse tabs — two shares (persisted as ids + usernames, folders load via mock)
    if (!(localStorage.getItem(BROWSE_KEY) ?? localStorage.getItem(BROWSE_KEY.replace("nicotineHub.", "nicotine.")))) {
      const tabs = [...DEMO_BROWSE_USERS].map((username, i) => ({ id: `b${i + 1}`, username }));
      localStorage.setItem(BROWSE_KEY, JSON.stringify({ tabs, activeId: tabs[0]?.id ?? null }));
    }
    if (!(localStorage.getItem(RECENT_BROWSE_KEY) ?? localStorage.getItem(RECENT_BROWSE_KEY.replace("nicotineHub.", "nicotine.")))) {
      localStorage.setItem(RECENT_BROWSE_KEY, JSON.stringify([...DEMO_BROWSE_USERS]));
    }

    // Profile tabs
    if (!(localStorage.getItem(PROFILE_KEY) ?? localStorage.getItem(PROFILE_KEY.replace("nicotineHub.", "nicotine.")))) {
      const tabs = [...DEMO_PROFILE_USERS].map((username, i) => ({ id: `p${i + 1}`, username }));
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ tabs, activeId: tabs[0]?.id ?? null }));
    }
    if (!(localStorage.getItem(RECENT_PROFILES_KEY) ?? localStorage.getItem(RECENT_PROFILES_KEY.replace("nicotineHub.", "nicotine.")))) {
      localStorage.setItem(RECENT_PROFILES_KEY, JSON.stringify([...DEMO_PROFILE_USERS]));
    }

    // Transfers — one download + one upload (overwrite [] written by TransfersProvider before login)
    const transfersRaw = (localStorage.getItem(TRANSFERS_KEY) ?? localStorage.getItem(TRANSFERS_KEY.replace("nicotineHub.", "nicotine.")));
    if (!transfersRaw || transfersRaw === "[]" || transfersRaw === "null") {
      localStorage.setItem(TRANSFERS_KEY, JSON.stringify(mockDemoTransfers() as Transfer[]));
    }

    // Private chats list (provider will hydrate messages from fixtures)
    if (!(localStorage.getItem(PRIVATE_KEY) ?? localStorage.getItem(PRIVATE_KEY.replace("nicotineHub.", "nicotine.")))) {
      localStorage.setItem(PRIVATE_KEY, JSON.stringify([...DEMO_PROFILE_USERS]));
    }

    localStorage.setItem(DEMO_FLAG, "1");
  } catch {}
}

export function clearDemoStorage(): void {
  try {
    for (const k of DEMO_STORAGE_KEYS) { localStorage.removeItem(k); localStorage.removeItem(k.replace("nicotineHub.", "nicotine.")); }
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
