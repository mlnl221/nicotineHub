"use client";

export function formatStrftime(ts: number, fmt: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, string> = {
    "%X": d.toLocaleTimeString(),
    "%x": d.toLocaleDateString(),
    "%H": pad(d.getHours()),
    "%M": pad(d.getMinutes()),
    "%S": pad(d.getSeconds()),
    "%Y": String(d.getFullYear()),
    "%m": pad(d.getMonth() + 1),
    "%d": pad(d.getDate()),
  };
  let out = fmt;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

export function truncateMessages<T>(arr: T[], cap: number): T[] {
  if (cap <= 0) return arr;
  return arr.length > cap ? arr.slice(-cap) : arr;
}

export function censorText(text: string, censored: string[]): string {
  let out = text;
  for (const w of censored) {
    if (!w) continue;
    try {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      out = out.replace(re, "*".repeat(w.length));
    } catch {
      out = out.split(w).join("*".repeat(w.length));
    }
  }
  return out;
}

export function replaceText(text: string, repl: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(repl)) {
    if (!k) continue;
    out = out.split(k).join(v);
  }
  return out;
}

export function isMentioned(text: string, keywords: string[], watch: boolean, ownUser: string): boolean {
  if (!watch || !keywords.length) return false;
  const lower = text.toLowerCase();
  if (ownUser && lower.includes(ownUser.toLowerCase())) return true;
  return keywords.some((k) => k && lower.includes(k.toLowerCase()));
}
