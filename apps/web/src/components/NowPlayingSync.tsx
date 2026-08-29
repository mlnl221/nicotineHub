"use client";
import { useNowPlaying } from "@/lib/nowplaying";
export function NowPlayingSync() {
  useNowPlaying();
  return null;
}
