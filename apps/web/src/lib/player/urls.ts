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
