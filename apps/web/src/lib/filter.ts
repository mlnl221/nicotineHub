import type { FilterState, SearchRow } from "@/lib/protocol";

type FileTypeToken = "audio" | "video" | "image" | "document" | "archive" | "exe" | "any";

function parseSize(token: string): number | null {
  const m = token.trim().match(/^([<>]=?)\s*([\d.]+)\s*(b|k|kb|m|mb|g|gb|t|tb)$/i);
  if (!m) return null;
  const op = m[1];
  let value = parseFloat(m[2]);
  const unit = m[3].toLowerCase();
  const mult: Record<string, number> = {
    b: 1,
    k: 1024,
    kb: 1024,
    m: 1024 * 1024,
    mb: 1024 * 1024,
    g: 1024 * 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    t: 1024 * 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
  };
  value *= mult[unit] ?? 1;
  return op === ">" || op === ">=" ? value : op === "<" || op === "<=" ? -value : value;
}

function compareNumeric(value: number, spec: number): boolean {
  if (spec < 0) return value < -spec;
  if (spec > 0) return value > spec;
  return value === spec;
}

function parseTime(token: string): number | null {
  const m = token.trim().match(/^([<>]=?)\s*(\d+):(\d+)$/);
  if (!m) return null;
  const op = m[1];
  const seconds = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  return op === ">" || op === ">=" ? seconds : op === "<" || op === "<=" ? -seconds : seconds;
}

function matchTokenList(value: string, spec: string): boolean {
  const tokens = spec
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const lower = value.toLowerCase();
  let included = tokens.some((t) => !t.startsWith("!") && t.toLowerCase() === lower);
  const excluded = tokens.some((t) => t.startsWith("!") && t.slice(1).toLowerCase() === lower);
  if (excluded) return false;
  if (tokens.some((t) => t.startsWith("!"))) return true;
  return included;
}

function attrValue(row: SearchRow, type: number): number | null {
  if (type === 0) return row.attributes.bitrate ?? null;
  if (type === 1) return row.attributes.length ?? null;
  if (type === 2) return row.attributes.vbr ?? null;
  if (type === 4) return row.attributes.sampleRate ?? null;
  if (type === 5) return row.attributes.bitDepth ?? null;
  return null;
}

export function applyFilters(rows: SearchRow[], f: FilterState): SearchRow[] {
  const out: SearchRow[] = [];

  const includeRe = f.include.trim() ? safeRegex(f.include) : null;
  const excludeRe = f.exclude.trim() ? safeRegex(f.exclude) : null;
  const sizeSpec = f.size.trim() ? parseSize(f.size) : null;
  const bitrateSpec = f.bitrate.trim()
    ? parseSize(f.bitrate.replace(/kbps?/gi, "k"))
    : null;
  const lengthSpec = f.length.trim() ? parseTime(f.length) : null;
  const fileTypeTokens = f.fileType
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const countryTokens = f.country.trim() ? f.country : "";

  for (const row of rows) {
    const lowerName = row.filename.toLowerCase();

    if (includeRe && !includeRe.test(row.filename)) continue;
    if (excludeRe && excludeRe.test(row.filename)) continue;

    if (sizeSpec && !compareNumeric(row.size, sizeSpec)) continue;

    if (fileTypeTokens.length > 0) {
      const ft = fileTypeForExt(row.fileType) as FileTypeToken;
      let matched = false;
      let excluded = false;
      for (const tok of fileTypeTokens) {
        const negate = tok.startsWith("!");
        const base = (negate ? tok.slice(1) : tok).toLowerCase();
        const hit = base === "any" || ft === base;
        if (hit && negate) excluded = true;
        if (hit && !negate) matched = true;
      }
      if (excluded || !matched) continue;
    }

    if (bitrateSpec) {
      const br = attrValue(row, 0);
      if (br == null || !compareNumeric(br, bitrateSpec)) continue;
    }

    if (lengthSpec) {
      const len = attrValue(row, 1);
      const lenSec = len ? Math.round(len / 1000) : null;
      if (lenSec == null || !compareNumeric(lenSec, lengthSpec)) continue;
    }

    if (countryTokens) {
      const cc = (row as SearchRow & { country?: string }).country;
      if (!cc || !matchTokenList(cc, countryTokens)) continue;
    }

    if (f.freeSlot && !row.slotFree) continue;
    if (f.publicOnly && row.private) continue;

    out.push(row);
  }
  return out;
}

function fileTypeForExt(ext: string): string {
  const e = ext.toLowerCase();
  const map: Record<string, string> = {
    mp3: "audio",
    flac: "audio",
    wav: "audio",
    ogg: "audio",
    m4a: "audio",
    aac: "audio",
    opus: "audio",
    ape: "audio",
    wma: "audio",
    alac: "audio",
    mp4: "video",
    mkv: "video",
    avi: "video",
    mov: "video",
    wmv: "video",
    flv: "video",
    webm: "video",
    m4v: "video",
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    bmp: "image",
    webp: "image",
    svg: "image",
    pdf: "document",
    doc: "document",
    docx: "document",
    txt: "document",
    rtf: "document",
    zip: "archive",
    rar: "archive",
    "7z": "archive",
    tar: "archive",
    gz: "archive",
    iso: "archive",
    exe: "exe",
    msi: "exe",
    apk: "exe",
  };
  return map[e] ?? "any";
}

function safeRegex(src: string): RegExp | null {
  try {
    return new RegExp(src, "i");
  } catch {
    return null;
  }
}
