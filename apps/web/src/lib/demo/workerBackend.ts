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

export function demoReadTags(fileName: string): TagReadResult | null {
  return demoTagResult(fileName);
}

export function demoWriteTags(fileName: string): null {
  if (isDemoAudioPath(fileName)) throw new Error("Tags are read-only in demo — not saved.");
  return null;
}

export function demoScrapeTags(fileName: string, url: string, apply: boolean): TagScrapeResult | null {
  const r = demoScrapeResult(fileName, url, apply);
  if (r) return r;
  // Non-demo file: fall through to the real worker (unreachable in demo UI).
  return null;
}

export function demoBulkReadTags(files: string[]): Array<{ fileName: string; tags?: Record<string, string>; info?: Record<string, unknown>; coverArtApplied?: boolean; error?: string }> | null {
  const mapped = files.map((f) => {
    const r = demoTagResult(f);
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

export function demoMediainfo(fileName: string): MediainfoResult | null {
  return demoMediainfoResult(fileName);
}

export function demoBulkSpectrum(files: Array<{ fileName: string; size?: number; token?: number }>): Array<{ fileName: string; ok: boolean; etag?: string; error?: string }> | null {
  const demoOnly = files.every((f) => demoSpectrumUrls(f.fileName));
  if (demoOnly) return files.map((f) => ({ fileName: f.fileName, ok: true, etag: '"demo-vorbis"' }));
  return null;
}
