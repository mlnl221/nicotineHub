"use client";

/**
 * Thin HTTP client for the worker service (scrape/spectrum/tag/verify/analyze).
 * Mirrors lib/bridgeHttp.ts: localStorage.nicotineHub.workerUrl > NEXT_PUBLIC_WORKER_URL > hostname:8789.
 * Auth via WORKER_TOKEN Bearer header (localStorage.nicotineHub.workerToken > NEXT_PUBLIC_WORKER_TOKEN).
 * The web never imports scraping/parsing deps — all heavy work stays in apps/worker.
 */

export function getWorkerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = window.localStorage.getItem("nicotineHub.workerToken");
    if (ls) return ls;
  } catch {}
  return process.env.NEXT_PUBLIC_WORKER_TOKEN || null;
}

export function getWorkerHttpBase(): string {
  if (typeof window === "undefined") return "http://localhost:8789";
  try {
    const override = window.localStorage.getItem("nicotineHub.workerUrl");
    if (override) return override.replace(/\/$/, "");
  } catch {}
  const configured = process.env.NEXT_PUBLIC_WORKER_URL;
  if (configured) return configured.replace(/\/$/, "");
  // Same-origin default: /api/worker on the web origin (proxied to the
  // worker), so worker :8789 needs no published host port. Remote-worker
  // setups keep working via localStorage override or NEXT_PUBLIC_WORKER_URL.
  return "/api/worker";
}

export function workerFetchHeaders(extra?: Record<string, string>): Record<string, string> {
  const tok = getWorkerToken();
  return { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(extra || {}) };
}

export async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getWorkerHttpBase();
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...workerFetchHeaders(), ...(init?.headers || {}) },
  });
}

export interface ScrapeResult {
  artist: string;
  album: string;
  year: number | string | null;
  track_count: number | null;
  query: string;
  source: string;
  confidence: number;
  url: string;
}

export async function scrapeRelease(url: string): Promise<ScrapeResult> {
  const res = await workerFetch("/scrape", { method: "POST", body: JSON.stringify({ url }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Scrape failed (${res.status})`);
  return body as ScrapeResult;
}

export interface SpectrumRequestResult {
  etag: string;
  hash: string;
  urls: { full: string; zoom: string };
  fromCache: boolean;
}

export async function requestWorkerSpectrum(opts: { fileName: string; size?: number; token?: number }): Promise<SpectrumRequestResult> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try {
      const { demoSpectrumUrls } = await import("@/lib/demo/fixtures");
      const urls = demoSpectrumUrls(opts.fileName);
      if (urls) return { etag: '"demo-vorbis"', hash: "demo-vorbis", urls, fromCache: true };
    } catch {}
    const base = opts.fileName.replace(/\\/g, "/").split("/").pop() ?? "";
    if (base === "01. DJ Satomi - Waves.ogg") return { etag: '"demo-waves"', hash: "demo-waves", urls: { full: "/demo-spectra/dj-satomi-waves-full.png", zoom: "/demo-spectra/dj-satomi-waves-zoom.png" }, fromCache: true };
    if (base === "12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg") return { etag: '"demo-kern"', hash: "demo-kern", urls: { full: "/demo-spectra/zombie-nation-kernkraft400-full.png", zoom: "/demo-spectra/zombie-nation-kernkraft400-zoom.png" }, fromCache: true };
  }
  const res = await workerFetch("/spectrum/request", { method: "POST", body: JSON.stringify(opts) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Spectrum failed (${res.status})`);
  return body as SpectrumRequestResult;
}

export async function getWorkerHealth(): Promise<{
  ok: boolean; version?: string; sources?: string[]; auth?: { discogs: boolean; tidal: boolean; qobuz: boolean };
} | null> {
  try {
    const base = getWorkerHttpBase();
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { ok: boolean; version?: string; sources?: string[] };
  } catch {
    return null;
  }
}

export interface TagReadResult {
  tags: Record<string, string>;
  info?: Record<string, unknown>;
  coverArtApplied: boolean;
  tracklist?: unknown;
  fileName?: string;
  path?: string;
}

export async function readTags(fileName: string): Promise<TagReadResult> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoTagResult } = await import("@/lib/demo/fixtures"); const r = demoTagResult(fileName); if (r) return r; } catch {}
  }
  const res = await workerFetch("/tag", { method: "POST", body: JSON.stringify({ fileName }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Tag read failed (${res.status})`);
  return body as TagReadResult;
}

export async function writeTags(fileName: string, tags: Record<string, string | null>, removeTags: string[] = []): Promise<TagReadResult> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { isDemoAudioPath } = await import("@/lib/demo/fixtures"); if (isDemoAudioPath(fileName)) throw new Error("Tags are read-only in demo — not saved."); } catch (e) { if (e instanceof Error && e.message.includes("read-only")) throw e; }
  }
  const res = await workerFetch("/tag/write", { method: "POST", body: JSON.stringify({ fileName, tags, removeTags }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Tag write failed (${res.status})`);
  return body as TagReadResult;
}

export interface TagScrapeResult {
  artist: string;
  album: string;
  year: number | string | null;
  track_count: number | null;
  source: string;
  confidence: number;
  url: string;
  suggested: Record<string, string>;
  applied: boolean;
  tags?: Record<string, string>;
  info?: Record<string, unknown>;
  newPath?: string;
  rename?: { renamed?: boolean; skipped?: boolean; reason?: string; newPath?: string; suffixed?: boolean };
}

export async function scrapeTags(fileName: string, url: string, apply = false, rename?: { enabled: boolean; template: string }): Promise<TagScrapeResult> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoScrapeResult } = await import("@/lib/demo/fixtures"); const r = demoScrapeResult(fileName, url, apply); if (r) return r; } catch (e) { if (e instanceof Error) throw e; }
    // If demo file but unknown URL, let the throw above surface; otherwise fall through
    try { const { isDemoAudioPath } = await import("@/lib/demo/fixtures"); if (isDemoAudioPath(fileName)) throw new Error("Demo scrape supports the two linked Discogs releases only."); } catch (e) { if (e instanceof Error && e.message.includes("Demo scrape")) throw e; }
  }
  const payload: Record<string, unknown> = { fileName, url, apply };
  if (rename) { payload.renameEnabled = rename.enabled; payload.renameTemplate = rename.template; }
  const res = await workerFetch("/tag/scrape", { method: "POST", body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Scrape failed (${res.status})`);
  return body as TagScrapeResult;
}

export async function bulkReadTags(files: string[]): Promise<{ results: Array<{ fileName: string; tags?: Record<string, string>; info?: Record<string, unknown>; coverArtApplied?: boolean; error?: string }> }> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoTagResult } = await import("@/lib/demo/fixtures"); const mapped = files.map((f) => { const r = demoTagResult(f); return r ? { fileName: f, tags: r.tags, info: r.info, coverArtApplied: r.coverArtApplied } : null; }); if (mapped.every(Boolean)) return { results: mapped as Array<{ fileName: string; tags?: Record<string, string>; info?: Record<string, unknown>; coverArtApplied?: boolean; error?: string }> }; } catch {}
  }
  const res = await workerFetch("/tag/bulk", { method: "POST", body: JSON.stringify({ files }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Bulk tag read failed (${res.status})`);
  return body as { results: Array<{ fileName: string; tags?: Record<string, string>; info?: Record<string, unknown>; coverArtApplied?: boolean; error?: string }> };
}

export async function bulkAnalyze(files: string[]): Promise<{ results: Array<Record<string, unknown>> }> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoAnalyzeResult } = await import("@/lib/demo/fixtures"); const mapped = files.map((f) => demoAnalyzeResult(f)); if (mapped.every(Boolean)) return { results: mapped.map((r, i) => ({ fileName: files[i], ...(r as Record<string, unknown>) })) }; } catch {}
  }
  const res = await workerFetch("/analyze/bulk", { method: "POST", body: JSON.stringify({ files }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Bulk analyze failed (${res.status})`);
  return body as { results: Array<Record<string, unknown>> };
}

export async function verifyFile(fileName: string): Promise<{ flacOk: boolean | null; mqa: boolean | null; upconvert?: unknown }> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoVerifyResult } = await import("@/lib/demo/fixtures"); const r = demoVerifyResult(fileName); if (r) return r as { flacOk: boolean | null; mqa: boolean | null }; } catch {}
  }
  const res = await workerFetch("/verify", { method: "POST", body: JSON.stringify({ fileName }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Verify failed (${res.status})`);
  return body as { flacOk: boolean | null; mqa: boolean | null };
}

export async function analyzeFile(fileName: string): Promise<{ bitrate: number | null; vbr: string | null; sampleRate: number | null; bitDepth: number | null; cutoffHz: number | null; likelyTranscode: boolean | null; confidence: number }> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoAnalyzeResult } = await import("@/lib/demo/fixtures"); const r = demoAnalyzeResult(fileName); if (r) return r as { bitrate: number | null; vbr: string | null; sampleRate: number | null; bitDepth: number | null; cutoffHz: number | null; likelyTranscode: boolean | null; confidence: number }; } catch {}
  }
  const res = await workerFetch("/analyze", { method: "POST", body: JSON.stringify({ fileName }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Analyze failed (${res.status})`);
  return body as { bitrate: number | null; vbr: string | null; sampleRate: number | null; bitDepth: number | null; cutoffHz: number | null; likelyTranscode: boolean | null; confidence: number };
}

export async function bulkVerify(files: string[]): Promise<{ results: Array<Record<string, unknown>> }> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoVerifyResult } = await import("@/lib/demo/fixtures"); const mapped = files.map((f) => demoVerifyResult(f)); if (mapped.every(Boolean)) return { results: mapped.map((r, i) => ({ fileName: files[i], ...(r as Record<string, unknown>) })) }; } catch {}
  }
  const res = await workerFetch("/verify/bulk", { method: "POST", body: JSON.stringify({ files }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Bulk verify failed (${res.status})`);
  return body as { results: Array<Record<string, unknown>> };
}

export interface MediainfoResult {
  fileName: string;
  path: string;
  tracks: Array<Record<string, unknown>>;
  summary: {
    format?: string | null;
    duration?: string | null;
    fileSize?: string | null;
    overallBitRate?: string | null;
    video?: Array<Record<string, unknown>> | null;
    audio?: Array<Record<string, unknown>> | null;
    textCount?: number;
  };
  raw: string;
}

export async function renameFile(fileName: string, newName: string): Promise<{ ok: boolean; newPath: string; fileName: string; suffixed: boolean }> {
  const res = await workerFetch("/rename", { method: "POST", body: JSON.stringify({ fileName, newName }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Rename failed (${res.status})`);
  return body as { ok: boolean; newPath: string; fileName: string; suffixed: boolean };
}

export async function getMediainfo(fileName: string): Promise<MediainfoResult> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try { const { demoMediainfoResult } = await import("@/lib/demo/fixtures"); const r = demoMediainfoResult(fileName); if (r) return r; } catch {}
  }
  const res = await workerFetch("/mediainfo", { method: "POST", body: JSON.stringify({ fileName }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Mediainfo failed (${res.status})`);
  return body as MediainfoResult;
}

export async function bulkRequestSpectrum(files: Array<{ fileName: string; size?: number; token?: number }>): Promise<Array<{ fileName: string; ok: boolean; etag?: string; error?: string }>> {
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    try {
      const { demoSpectrumUrls } = await import("@/lib/demo/fixtures");
      const demoOnly = files.every((f) => demoSpectrumUrls(f.fileName));
      if (demoOnly) return files.map((f) => ({ fileName: f.fileName, ok: true, etag: '"demo-vorbis"' }));
    } catch {}
  }
  const results: Array<{ fileName: string; ok: boolean; etag?: string; error?: string }> = [];
  for (const f of files) {
    try {
      const r = await requestWorkerSpectrum(f);
      results.push({ fileName: f.fileName, ok: true, etag: r.etag });
    } catch (e) {
      results.push({ fileName: f.fileName, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
