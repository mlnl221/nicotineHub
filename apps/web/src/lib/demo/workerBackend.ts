"use client";

/**
 * Demo backend for the worker service (Vercel demo / NEXT_PUBLIC_DEMO=true).
 *
 * Single home for ALL demo worker logic: apps/web/src/lib/worker.ts demo
 * branches only route here (one dynamic import target, one lazy chunk) and
 * never contain fixture logic inline. Every function mirrors the real worker
 * endpoint's return type (imported as `import type`, erased at compile, so
 * there is no runtime cycle with lib/worker.ts).
 *
 * Conventions (match apps/worker/app.py):
 * - Unknown/non-demo files → return null → caller falls through to fetch
 *   (unreachable in the demo UI, which only lists demo files).
 * - Deliberate demo rejections → throw Error with user-facing copy.
 */

import type {
  MediainfoResult,
  ScrapeResult,
  SpectrumRequestResult,
  TagReadResult,
  TagScrapeResult,
} from "@/lib/worker";
import {
  demoAnalyzeResult,
  demoMediainfoResult,
  demoReleaseScrape,
  demoScrapeResult,
  demoSpectrumUrls,
  demoTagResult,
  demoVerifyResult,
  isDemoAudioPath,
  spliceRenamePath,
  validateRenameBasename,
} from "./fixtures";

export function demoScrapeRelease(url: string): ScrapeResult {
  return demoReleaseScrape(url);
}

export function demoRequestSpectrum(opts: { fileName: string; size?: number; token?: number }): SpectrumRequestResult | null {
  const urls = demoSpectrumUrls(opts.fileName);
  if (urls) return { etag: '"demo-vorbis"', hash: "demo-vorbis", urls, fromCache: true };
  return null;
}

// Session-only tag overlays (demo): writeTags persists here, readTags merges
// over fixtures. Module-level Map — survives SPA navigations, gone on reload.
const tagOverlays = new Map<string, Record<string, string>>();
const coverApplied = new Set<string>();

export function demoReadTags(fileName: string): TagReadResult | null {
  const base = demoTagResult(fileName);
  if (!base) return null;
  const overlay = tagOverlays.get(fileName);
  if (!overlay && !coverApplied.has(fileName)) return base;
  return {
    ...base,
    tags: overlay ? { ...overlay } : { ...base.tags },
    coverArtApplied: coverApplied.has(fileName) || base.coverArtApplied,
  };
}

export function demoWriteTags(
  fileName: string,
  tags: Record<string, string | null> = {},
  removeTags: string[] = [],
): TagReadResult | null {
  if (!isDemoAudioPath(fileName)) return null;
  const base = demoTagResult(fileName);
  const current: Record<string, string> = { ...(tagOverlays.get(fileName) ?? base?.tags ?? {}) };
  for (const [k, v] of Object.entries(tags)) {
    if (v === null || v === undefined) delete current[k];
    else current[k] = v;
  }
  for (const k of removeTags) delete current[k];
  tagOverlays.set(fileName, current);
  return {
    tags: { ...current },
    info: base?.info,
    coverArtApplied: coverApplied.has(fileName) || !!base?.coverArtApplied,
    fileName,
    path: fileName,
  };
}

export function demoScrapeTags(fileName: string, url: string, apply: boolean, trackIndex?: number): TagScrapeResult | null {
  const r = demoScrapeResult(fileName, url, apply, trackIndex);
  if (r) return { ...r, catalog_no: "88697 19512 1", country: "US", label: "Columbia", genre: ["Electronic", "Rock"], style: ["Synth-pop", "Indie Rock"], media_type: "Vinyl (LP, Album, Stereo)", release_id: "1304590", cover_url: null as unknown as string };
  // Non-demo file: fall through to the real worker (unreachable in demo UI).
  return null;
}

export function demoCoverArt(fileName: string, url: string, _opts?: { embed?: boolean; saveFile?: boolean }): { embedded: boolean; folderJpg: boolean; size: number } | null {
  if (!isDemoAudioPath(fileName)) return null;
  // In-memory echo only — nothing fetched, nothing written to disk.
  coverApplied.add(fileName);
  return { embedded: true, folderJpg: false, size: url.length || 1 };
}

export function demoBulkReadTags(files: string[]): Array<{ fileName: string; tags?: Record<string, string>; info?: Record<string, unknown>; coverArtApplied?: boolean; error?: string }> | null {
  const mapped = files.map((f) => {
    const r = demoReadTags(f);
    return r ? { fileName: f, tags: r.tags, info: r.info, coverArtApplied: r.coverArtApplied } : null;
  });
  if (mapped.every(Boolean)) {
    return mapped as Array<{ fileName: string; tags?: Record<string, string>; info?: Record<string, unknown>; coverArtApplied?: boolean; error?: string }>;
  }
  return null;
}

export function demoBulkAnalyze(files: string[]): Array<Record<string, unknown>> | null {
  const mapped = files.map((f) => demoAnalyzeResult(f));
  if (mapped.every(Boolean)) return mapped.map((r, i) => ({ fileName: files[i], ...(r as Record<string, unknown>) }));
  return null;
}

export function demoVerify(fileName: string): { flacOk: boolean | null; mqa: boolean | null } | null {
  return demoVerifyResult(fileName) as { flacOk: boolean | null; mqa: boolean | null } | null;
}

export function demoAnalyze(fileName: string): {
  bitrate: number | null; vbr: string | null; sampleRate: number | null; bitDepth: number | null;
  cutoffHz: number | null; likelyTranscode: boolean | null; confidence: number;
} | null {
  return demoAnalyzeResult(fileName);
}

export function demoBulkVerify(files: string[]): Array<Record<string, unknown>> | null {
  const mapped = files.map((f) => demoVerifyResult(f));
  if (mapped.every(Boolean)) return mapped.map((r, i) => ({ fileName: files[i], ...(r as Record<string, unknown>) }));
  return null;
}

/**
 * Demo rename — pure in-memory path splice (no fetch, nothing persisted).
 * Mirrors apps/worker/app.py rename_file return shape: fileName is the
 * BASENAME (dest.name), suffixed reports auto-suffixing. Collision suffixing
 * itself is applied by the UI layer via uniqueDemoName(), which knows the
 * sibling names — pass them in when available.
 */
export function demoRename(
  fileName: string,
  newName: string,
  siblings: string[] = [],
): { ok: boolean; newPath: string; fileName: string; suffixed: boolean } {
  const validated = validateRenameBasename(newName);
  const { dir, base } = spliceRenamePath(fileName, validated);
  if (validated === base) return { ok: true, newPath: fileName, fileName: base, suffixed: false };
  // Honor collisions like _unique_dest ("stem (2).ext") when siblings known.
  let name = validated;
  let suffixed = false;
  if (siblings.length && siblings.filter((s) => s !== base).includes(validated)) {
    const dot = validated.lastIndexOf(".");
    const stem = dot === -1 ? validated : validated.slice(0, dot);
    const suffix = dot === -1 ? "" : validated.slice(dot);
    for (let n = 2; n < 1000; n++) {
      const alt = `${stem} (${n})${suffix}`;
      if (!siblings.filter((s) => s !== base).includes(alt)) { name = alt; suffixed = true; break; }
    }
  }
  return { ok: true, newPath: `${dir}${name}`, fileName: name, suffixed };
}

const RENAME_TOKENS = new Set(["track", "artist", "title"]);

/**
 * Demo rename preview — renders {track}/{artist}/{title} from overlay-merged
 * tags, then routes through demoRename for validation + collision suffixing.
 * Mirrors apps/worker/app.py tag_rename_preview (subset).
 */
export function demoRenamePreview(
  files: string[],
  template: string,
): { results: Array<{ file: string; newName: string | null; skipped?: string; suffixed?: boolean }> } {
  const tmpl = template.trim();
  const found = new Set([...tmpl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  if (!found.size) throw new Error("rename template must contain at least one of {track} {artist} {title}");
  for (const t of found) {
    if (!RENAME_TOKENS.has(t)) throw new Error("unknown template token — allowed: track, artist, title");
  }
  const siblings = files.map((f) => f.replace(/\\/g, "/").split("/").pop() ?? f);
  const results = files.map((file) => {
    const base = demoReadTags(file);
    if (!base) return { file, newName: null as string | null, skipped: "file not found" };
    const tags = base.tags ?? {};
    const trackRaw = tags.tracknumber || tags.track || "";
    const tm = /^\s*(\d+)/.exec(trackRaw);
    const track = tm ? String(parseInt(tm[1], 10)).padStart(2, "0") : trackRaw.trim();
    const artist = (tags.artist || tags.albumartist || "").replace(/[/\\]/g, "-").trim();
    const title = (tags.title || "").replace(/[/\\]/g, "-").trim();
    const vals: Record<string, string> = { track, artist, title };
    for (const t of found) {
      if (!vals[t]) return { file, newName: null as string | null, skipped: "missing track/artist/title tag for template" };
    }
    let desired = tmpl;
    for (const [k, v] of Object.entries(vals)) desired = desired.split(`{${k}}`).join(v);
    if (desired.includes("{") || desired.includes("}")) return { file, newName: null as string | null, skipped: "invalid filename from template" };
    desired = desired.trim();
    if (!desired) return { file, newName: null as string | null, skipped: "invalid filename from template" };
    const rawBase = file.replace(/\\/g, "/").split("/").pop() ?? file;
    const dot = rawBase.lastIndexOf(".");
    const ext = dot === -1 ? "" : rawBase.slice(dot);
    if (ext && !desired.toLowerCase().endsWith(ext.toLowerCase())) desired += ext;
    try {
      const r = demoRename(file, desired, siblings);
      return { file, newName: r.fileName, suffixed: r.suffixed };
    } catch (e) {
      return { file, newName: null as string | null, skipped: e instanceof Error ? e.message : String(e) };
    }
  });
  return { results };
}

export function demoMediainfo(fileName: string): MediainfoResult | null {
  return demoMediainfoResult(fileName);
}

export function demoBulkSpectrum(files: Array<{ fileName: string; size?: number; token?: number }>): Array<{ fileName: string; ok: boolean; etag?: string; error?: string }> | null {
  const demoOnly = files.every((f) => demoSpectrumUrls(f.fileName));
  if (demoOnly) return files.map((f) => ({ fileName: f.fileName, ok: true, etag: '"demo-vorbis"' }));
  return null;
}
