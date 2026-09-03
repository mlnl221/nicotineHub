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
  const scheme = window.location.protocol === "https:" ? "https:" : "http:";
  const host = window.location.hostname || "localhost";
  // Worktree quad: web 3001 -> worker 8789, web 3002 -> worker 8791
  const port = window.location.port === "3001" ? "8789" : window.location.port === "3002" ? "8791" : "8789";
  return `${scheme}//${host}:${port}`;
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
  const res = await workerFetch("/spectrum/request", { method: "POST", body: JSON.stringify(opts) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail || `Spectrum failed (${res.status})`);
  return body as SpectrumRequestResult;
}

export async function getWorkerHealth(): Promise<{ ok: boolean; version?: string; sources?: string[] } | null> {
  try {
    const base = getWorkerHttpBase();
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { ok: boolean; version?: string; sources?: string[] };
  } catch {
    return null;
  }
}
