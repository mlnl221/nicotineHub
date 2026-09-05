/**
 * Full-parity result filtering, mirroring nicotine's filter bar.
 * See docs/architecture.md Search filters for the exact syntax.
 */
import type { FilterState, SearchRow } from "@/lib/protocol";

const GENERIC_TYPES: Record<string, string[]> = {
  audio: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "ape", "wma", "alac", "m4p"],
  image: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "svg", "heic", "avif"],
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ogv"],
  document: ["pdf", "doc", "docx", "txt", "rtf", "odt", "ppt", "pptx", "xls", "xlsx", "epub", "mobi", "azw", "azw3", "cbz", "cbr"],
  text: ["txt", "md", "nfo", "srt", "ass", "vtt", "log", "csv"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg", "lz", "zst"],
  executable: ["exe", "msi", "apk", "deb", "rpm", "app", "jar", "dll", "bin", "sh"],
};

function safeRegex(text: string): RegExp | null {
  try {
    return new RegExp(text, "i");
  } catch {
    return null;
  }
}

function matchText(row: SearchRow, expr: string, positive: boolean): boolean {
  if (!expr.trim()) return true;
  const re = safeRegex(expr);
  if (!re) return true; // invalid regex: don't hide results
  const hit = re.test(row.path) || re.test(row.user);
  return positive ? hit : !hit;
}

function matchFileType(row: SearchRow, expr: string): boolean {
  if (!expr.trim()) return true;
  const tokens = expr.split(/[\s|&]+/).filter(Boolean);
  const ext = row.fileType.toLowerCase();
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const t of tokens) {
    if (t.startsWith("!")) excludes.push(t.slice(1).toLowerCase());
    else includes.push(t.toLowerCase());
  }
  if (includes.length) {
    const ok = includes.some(
      (tok) => tok === ext || tok === "*" || (GENERIC_TYPES[tok]?.includes(ext) ?? false),
    );
    if (!ok) return false;
  }
  if (excludes.some((tok) => tok === ext || (GENERIC_TYPES[tok]?.includes(ext) ?? false))) {
    return false;
  }
  return true;
}

function toBytes(value: string): number | null {
  const m = value.match(/^(\d+(?:\.\d+)?)\s*([kKmMgG])?i?b?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  const mult = unit === "g" ? 1024 ** 3 : unit === "m" ? 1024 ** 2 : unit === "k" ? 1024 : 1;
  return Math.round(n * mult);
}

function toSeconds(value: string): number | null {
  const time = value.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (time) {
    const h = time[1] ? parseInt(time[1], 10) : 0;
    return h * 3600 + parseInt(time[2], 10) * 60 + parseInt(time[3], 10);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseValue(value: string, kind: "size" | "bitrate" | "length"): number | null {
  if (kind === "size") return toBytes(value);
  if (kind === "length") return toSeconds(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compare(value: number, op: string, target: number): boolean {
  switch (op) {
    case "<":
      return value < target;
    case "<=":
      return value <= target;
    case "==":
      return value === target;
    case "!=":
      return value !== target;
    case ">=":
      return value >= target;
    case ">":
      return value > target;
    default:
      return true;
  }
}

function matchCountry(row: SearchRow, expr: string): boolean {
  if (!expr.trim()) return true;
  const tokens = expr.split(/[,;\s|]+/).filter(Boolean);
  const cc = (row.country || "").toUpperCase();
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const t of tokens) {
    const raw = t.trim().toUpperCase();
    if (raw.startsWith("!") || raw.startsWith("-")) excludes.push(raw.slice(1));
    else includes.push(raw);
  }
  if (includes.length && !includes.includes(cc)) return false;
  if (excludes.includes(cc)) return false;
  return true;
}

function matchDigit(expr: string, value: number, kind: "size" | "bitrate" | "length"): boolean {
  const orGroups = expr.split("|").map((g) => g.trim()).filter(Boolean);
  if (!orGroups.length) return true;
  return orGroups.some((group) => {
    const parts = group.split(/[\s&]+/).filter(Boolean);
    const conds = parts.map((p) => {
      const m = p.match(/^(<=|>=|==|!=|<|>|=|!)?(.*)$/);
      let op = m?.[1] ?? "";
      const valStr = m?.[2] ?? "";
      if (op === "=") op = "==";
      else if (op === "!") op = "!=";
      else if (op === "") op = ">=";
      const target = parseValue(valStr, kind);
      return target === null ? null : { op, target };
    });
    if (conds.some((c) => c === null)) return true; // invalid group: no constraint
    return conds.every((c) => compare(value, c!.op, c!.target));
  });
}

function matchQuality(row: SearchRow, expr: string): boolean {
  if (!expr.trim()) return true;
  const tokens = expr.split(/[\s|&]+/).filter(Boolean);
  if (!tokens.length) return true;
  const lower = expr.toLowerCase();
  // negotiation: ! prefix means exclude (row must NOT match)
  const attrs = row.attributes || {};
  const bitrate = attrs.bitrate ?? row.quality ?? 0;
  const sampleRate = attrs.sampleRate ?? 0;
  const bitDepth = attrs.bitDepth ?? 0;
  const vbr = attrs.vbr ? 1 : 0;
  const ext = row.fileType?.toLowerCase() ?? "";
  const isLossless = (sampleRate && bitDepth) || (["flac", "wav", "aiff", "alac", "ape", "wv"].includes(ext) && row.quality === 0);
  const isHiRes = sampleRate > 48000 || bitDepth > 16;

  const evalToken = (tok: string): boolean => {
    let neg = false;
    let t = tok.toLowerCase();
    if (t.startsWith("!")) { neg = true; t = t.slice(1); }
    if (!t) return true;
    let hit = false;
    if (t === "lossless") hit = !!isLossless;
    else if (t === "lossy") hit = !isLossless;
    else if (t === "hi-res" || t === "hires" || t === "hi_res") hit = !!isHiRes;
    else if (t === "vbr") hit = !!vbr;
    else if (t === "cbr") hit = !vbr && bitrate > 0;
    else if (t === "flac" || t === "mp3" || t === "wav" || t === "aiff" || t === "ogg" || t === "m4a" || t === "opus" || t === "wma" || t === "ape" || t === "wv" || t === "alac") hit = ext === t;
    else if (/^\d+$/.test(t)) hit = bitrate === parseInt(t, 10);
    else if (/^\d+\.\d+\/\d+$/.test(t)) {
      const [srStr, bdStr] = t.split("/");
      const sr = Math.round(parseFloat(srStr) * 1000);
      const bd = parseInt(bdStr, 10);
      hit = sampleRate === sr && bitDepth === bd;
    } else if (t === "320") hit = bitrate === 320;
    else if (t === "44.1/16") hit = sampleRate === 44100 && bitDepth === 16;
    else {
      // unknown token: treat as substring on ext or lossless flag
      hit = ext.includes(t);
    }
    return neg ? !hit : hit;
  };

  // Support OR via | already split, but also treat space as AND: all tokens must match (with ! handling)
  // For simplicity, if any token with | semantics already split, we treat OR across groups again
  const orGroups = expr.split("|").map(g => g.trim()).filter(Boolean);
  if (orGroups.length > 1) {
    return orGroups.some(group => group.split(/[\s&]+/).filter(Boolean).every(evalToken));
  }
  return tokens.every(evalToken);
}

/** Apply the full filter set to a list of rows (live, client-side). */
export function applyFilters(rows: SearchRow[], f: FilterState): SearchRow[] {
  return rows.filter((row) => {
    if (!matchText(row, f.include, true)) return false;
    if (!matchText(row, f.exclude, false)) return false;
    if (!matchFileType(row, f.fileType)) return false;
    if (f.size && !matchDigit(f.size, row.size, "size")) return false;
    if (f.bitrate && !matchDigit(f.bitrate, row.quality, "bitrate")) return false;
    if (f.length && !matchDigit(f.length, row.length, "length")) return false;
    if (f.country.trim() && !matchCountry(row, f.country)) return false;
    if (f.quality && !matchQuality(row, f.quality)) return false;
    if (f.freeSlot && !row.slotFree) return false;
    if (f.publicOnly && row.private) return false;
    return true;
  });
}

/** Count how many of the filter fields are active (for the badge). */
export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.include.trim()) n++;
  if (f.exclude.trim()) n++;
  if (f.fileType.trim()) n++;
  if (f.size.trim()) n++;
  if (f.bitrate.trim()) n++;
  if (f.length.trim()) n++;
  if (f.country.trim()) n++;
  if (f.quality.trim()) n++;
  if (f.freeSlot) n++;
  if (f.publicOnly) n++;
  return n;
}
