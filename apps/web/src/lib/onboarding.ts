"use client";

import { getLocal, setLocal } from "@/lib/storage";

const KEY = "nicotineHub.onboardingDone";

/** True once the user finished or skipped the setup guide. */
export function isOnboardingDone(): boolean {
  return getLocal(KEY) === "1";
}

export function markOnboardingDone(): void {
  setLocal(KEY, "1");
}

/** Clears the flag so the guide shows again (Settings → About replay). */
export function clearOnboardingDone(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}
