"use client";

import { bridgeFetchUrl } from "@/lib/bridgeHttp";
import { getWorkerHttpBase, getWorkerToken } from "@/lib/worker";

/** Mirror of bridge AUDIO_MIME keys (apps/bridge/src/files.ts) — plays natively in <audio>. */
const NATIVE_EXTS = new Set(["mp3", "flac", "ogg", "oga", "opus", "wav", "m4a", "aac"]);
/** Mirror of bridge TRANSCODE_EXTS — worker /audio converts these to opus. */
const TRANSCODE_EXTS = new Set(["wma", "wv", "ape", "aiff", "aif", "alac", "mp2"]);

export type Playability = "native" | "transcode" | "no";

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export function playabilityOf(name: string): Playability {
  const ext = extOf(name);
  if (NATIVE_EXTS.has(ext)) return "native";
  if (TRANSCODE_EXTS.has(ext)) return "transcode";
  return "no";
}

export function formatLabelOf(name: string): string {
  const ext = extOf(name);
  return ext ? ext.toUpperCase() : "AUDIO";
}

/** Finished download (/files/:token) → playable URL. fileName needed for the worker transcode path. */
export function downloadPlayUrl(downloadUrl: string, fileName: string): { url: string; viaWorker: boolean } | null {
  const play = playabilityOf(fileName);
  if (play === "no") return null;
  if (play === "native") return { url: bridgeFetchUrl(downloadUrl), viaWorker: false };
  return { url: workerAudioUrl(fileName), viaWorker: true };
}

/** Absolute /data path (FileExplorer) → playable URL. */
export function dataFilePlayUrl(absPath: string): { url: string; viaWorker: boolean } | null {
  const play = playabilityOf(absPath);
  if (play === "no") return null;
  // Demo: two real Vorbis samples live in public/demo-audio, no bridge needed
  if (process.env.NEXT_PUBLIC_DEMO === "true") {
    const base = absPath.replace(/\\/g, "/").split("/").pop() ?? "";
    if (base === "01. DJ Satomi - Waves.ogg") return { url: "/demo-audio/01-dj-satomi-waves.ogg", viaWorker: false };
    if (base === "12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg") return { url: "/demo-audio/12-zombie-nation-kernkraft-400.ogg", viaWorker: false };
    if (absPath === "/data/Music/Demo/01. DJ Satomi - Waves.ogg") return { url: "/demo-audio/01-dj-satomi-waves.ogg", viaWorker: false };
    if (absPath === "/data/Music/Demo/12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg") return { url: "/demo-audio/12-zombie-nation-kernkraft-400.ogg", viaWorker: false };
  }
  if (play === "native") return { url: bridgeFetchUrl(`/api/files/raw?path=${encodeURIComponent(absPath)}`), viaWorker: false };
  return { url: workerAudioUrl(absPath), viaWorker: true };
}

export function workerAudioUrl(file: string): string {
  const base = getWorkerHttpBase();
  const tok = getWorkerToken();
  return `${base}/audio?file=${encodeURIComponent(file)}${tok ? `&token=${encodeURIComponent(tok)}` : ""}`;
}

export function toast(title: string, body: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title, body } }));
  }
}

/** "Artist - Title.mp3" → {artist, title}; else title = basename. */
export function splitArtistTitle(name: string): { artist?: string; title: string } {
  const base = name.split("/").pop() ?? name;
  const noExt = base.replace(/\.[a-z0-9]+$/i, "");
  const m = noExt.match(/^\s*(.+?)\s*-\s*(.+?)\s*$/);
  if (m) return { artist: m[1], title: m[2] };
  return { title: noExt.replace(/_/g, " ") };
}

export interface TrackMeta {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  /** Preformatted technical line, e.g. "320 kbps · 44.1 kHz · 16-bit". */
  quality?: string;
}

const metaCache = new Map<string, TrackMeta>();

/**
 * Best-effort tag + technical enrichment via worker readTags (same resolver
 * the tag editor uses — accepts basename, DATA_DIR-relative, or /data path).
 * Cached per fileKey; failures resolve to {} so playback never blocks.
 */
export async function fetchTrackMeta(fileKey: string): Promise<TrackMeta> {
  const hit = metaCache.get(fileKey);
  if (hit) return hit;
  const meta: TrackMeta = {};
  try {
    const { readTags } = await import("@/lib/worker");
    const res = await readTags(fileKey);
    const tags = res.tags ?? {};
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = tags[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return undefined;
    };
    const title = pick("title");
    const artist = pick("artist", "albumartist");
    const album = pick("album");
    const genre = pick("genre");
    const date = pick("date", "year", "originaldate");
    if (title) meta.title = title;
    if (artist) meta.artist = artist;
    if (album) meta.album = album;
    if (genre) meta.genre = genre;
    if (date) meta.year = date.slice(0, 4);
    const info = (res.info ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof info.bitrate === "number" && info.bitrate > 0) parts.push(`${info.bitrate} kbps`);
    if (typeof info.sampleRate === "number" && info.sampleRate > 0) {
      parts.push(info.sampleRate >= 1000 ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : `${info.sampleRate} Hz`);
    }
    if (typeof info.bitDepth === "number" && info.bitDepth > 0) parts.push(`${info.bitDepth}-bit`);
    if (parts.length) meta.quality = parts.join(" · ");
  } catch {
    // Offline worker / untagged file — caller falls back to filename.
  }
  metaCache.set(fileKey, meta);
  return meta;
}
