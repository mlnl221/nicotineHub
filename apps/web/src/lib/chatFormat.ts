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

export function highlightKeywords(text: string, keywords: string[], watch: boolean): string | null {
  if (!watch || !keywords.length) return null;
  let out = text;
  let changed = false;
  for (const kw of keywords) {
    if (!kw) continue;
    try {
      const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      if (re.test(out)) {
        out = out.replace(re, `<mark class="bg-amber-200 dark:bg-amber-800 rounded px-0.5">$1</mark>`);
        changed = true;
      }
    } catch {}
  }
  return changed ? out : null;
}

export function usernameHotspotClass(isHotspot: boolean, style: string): string {
  if (!isHotspot) return "text-on-surface";
  switch (style) {
    case "bold": return "font-bold text-primary";
    case "italic": return "italic text-primary";
    case "underline": return "underline text-primary";
    case "hyperlinks": return "underline decoration-dotted text-primary hover:text-primary-container cursor-pointer";
    case "none": return "text-on-surface";
    default: return "font-bold text-primary";
  }
}

/** Get current UI settings for username/path formatting (reads localStorage sync, SSR-safe). */
export function getUiSettings(): { usernamehotspots: boolean; usernamestyle: string; reverse: boolean; fileSizeUnit: string } {
  try {
    const raw = typeof localStorage !== "undefined" ? (localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings")) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { ui?: { usernamehotspots?: boolean; usernamestyle?: string; reverse_file_paths?: boolean; file_size_unit?: string } };
      return {
        usernamehotspots: parsed?.ui?.usernamehotspots ?? true,
        usernamestyle: parsed?.ui?.usernamestyle ?? "bold",
        reverse: parsed?.ui?.reverse_file_paths ?? true,
        fileSizeUnit: parsed?.ui?.file_size_unit ?? "",
      };
    }
  } catch {}
  return { usernamehotspots: true, usernamestyle: "bold", reverse: true, fileSizeUnit: "" };
}
