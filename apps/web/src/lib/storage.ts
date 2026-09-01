"use client";

// ponytail: single fallback helper for nicotineHub.* → nicotine.* rename
// Reads nicotineHub key first, falls back to legacy nicotine. prefix for backwards compat.

export function getLocal(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key) ?? window.localStorage.getItem(key.replace("nicotineHub.", "nicotine."));
  } catch {
    return null;
  }
}

export function setLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

export function getSession(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key) ?? window.sessionStorage.getItem(key.replace("nicotineHub.", "nicotine."));
  } catch {
    return null;
  }
}
