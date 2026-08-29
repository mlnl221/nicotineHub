"use client";
import { useEffect } from "react";
import { useConfig } from "@/lib/config/provider";
import { useSession } from "@/lib/session";

/**
 * Now Playing — uses navigator.mediaSession if available.
 * Formats via players.npformat ($t $a $b etc) similar to nicotine nowplaying.py.
 */
function formatNowPlaying(format: string, meta: { title?: string; artist?: string; album?: string }): string {
  if (!format) return `${meta.artist ? `${meta.artist} - ` : ""}${meta.title ?? "Unknown"}`;
  const map: Record<string, string> = {
    $t: meta.title ?? "",
    $a: meta.artist ?? "",
    $b: meta.album ?? "",
    $n: meta.title ?? "",
    $l: meta.album ?? "",
  };
  let out = format;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  // Clean $p etc not supported
  out = out.replace(/\$[a-z]/g, "").replace(/\s+/g, " ").trim();
  return out || `${meta.artist ? `${meta.artist} - ` : ""}${meta.title ?? ""}`;
}

export function useNowPlaying() {
  const { settings } = useConfig();
  const { send, state } = useSession();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const handler = () => {
      try {
        const md = (navigator as unknown as { mediaSession: { metadata?: { title?: string; artist?: string; album?: string } } }).mediaSession.metadata;
        if (!md) return;
        const text = formatNowPlaying(settings.players.npformat, { title: md.title, artist: md.artist, album: md.album });
        if (!text || state.status !== "connected") return;
        // Optionally share as chat status? For now log via browser-log
        send({ type: "diagnostics:browser-log", level: "info", scope: "system", msg: `Now playing: ${text}` } as unknown as never);
      } catch {}
    };
    // Poll mediaSession every 5s if available
    const id = setInterval(handler, 5000);
    return () => clearInterval(id);
  }, [settings.players.npformat, send, state.status]);
}
