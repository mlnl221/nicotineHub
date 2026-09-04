"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast, fetchTrackMeta } from "@/lib/player/urls";

export interface Track {
  title: string;
  artist?: string;
  src: string;
  formatLabel: string;
  /** Worker transcode in progress (first byte pending) — cleared on canplay. */
  transcoding: boolean;
  /** Tag/technical enrichment (filled async after play). */
  album?: string;
  year?: string;
  genre?: string;
  quality?: string;
  size?: number;
  /** Key for worker readTags (basename, DATA_DIR-relative, or /data path). Not displayed. */
  fileKey?: string;
}

interface PlayerApi {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  play: (track: Track) => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

// Module singleton — survives navigation, single audio element app-wide.
let sharedAudio: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "metadata";
  }
  return sharedAudio;
}

function setMediaSession(track: Track | null) {
  try {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession as unknown as {
      metadata: unknown;
      setActionHandler: (action: string, cb: (() => void) | null) => void;
    };
    ms.metadata = track
      ? new (window as unknown as { MediaMetadata: new (o: object) => unknown }).MediaMetadata({
          title: track.title,
          artist: track.artist ?? "",
          album: "Nicotine Hub",
        })
      : null;
  } catch {}
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const trackRef = useRef<Track | null>(null);
  trackRef.current = track;

  useEffect(() => {
    const el = audio();
    if (!el) return;
    const onTime = () => setTime(el.currentTime || 0);
    const onDur = () => {
      const d = el.duration;
      setDuration(Number.isFinite(d) ? d : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => {
      setLoading(false);
      setTrack((t) => (t && t.transcoding ? { ...t, transcoding: false } : t));
    };
    const onEnded = () => setPlaying(false);
    const onError = () => {
      setLoading(false);
      setPlaying(false);
      const t = trackRef.current;
      const msg = t ? `Cannot play ${t.title} (${t.formatLabel}) — file may be corrupt or the transcode failed.` : "Audio playback failed.";
      toast("Playback failed", msg);
      setTrack((prev) => (prev ? { ...prev, transcoding: false } : prev));
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    try {
      const ms = (navigator as unknown as { mediaSession?: { setActionHandler: (a: string, cb: (() => void) | null) => void } }).mediaSession;
      ms?.setActionHandler("play", () => void el.play().catch(() => {}));
      ms?.setActionHandler("pause", () => el.pause());
      ms?.setActionHandler("seekbackward", () => { el.currentTime = Math.max(0, el.currentTime - 10); });
      ms?.setActionHandler("seekforward", () => { el.currentTime = Math.min(el.duration || 0, el.currentTime + 10); });
      ms?.setActionHandler("seekto", (d) => {
        const det = d as unknown as { seekTime?: number };
        if (typeof det?.seekTime === "number") el.currentTime = det.seekTime;
      });
    } catch {}
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, []);

  const play = useCallback((t: Track) => {
    const el = audio();
    if (!el) return;
    setTrack(t);
    setMediaSession(t);
    setTime(0);
    setDuration(0);
    setLoading(true);
    try {
      if (el.src !== t.src) el.src = t.src;
      el.currentTime = 0;
      void el.play().catch(() => setLoading(false));
    } catch {
      setLoading(false);
    }
    // Enrich title/tags/technical async — never blocks playback.
    if (t.fileKey) {
      const src = t.src;
      void fetchTrackMeta(t.fileKey).then((meta) => {
        if (!meta || trackRef.current?.src !== src) return;
        setTrack((prev) => {
          if (!prev || prev.src !== src) return prev;
          const next = { ...prev };
          if (meta.title) next.title = meta.title;
          if (meta.artist) next.artist = meta.artist;
          if (meta.album) next.album = meta.album;
          if (meta.year) next.year = meta.year;
          if (meta.genre) next.genre = meta.genre;
          if (meta.quality) next.quality = meta.quality;
          return next;
        });
        const cur = trackRef.current;
        if (cur && cur.src === src) setMediaSession(cur);
      });
    }
  }, []);

  const toggle = useCallback(() => {
    const el = audio();
    if (!el || !trackRef.current) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const el = audio();
    if (!el) return;
    const d = el.duration;
    el.currentTime = Math.max(0, Math.min(Number.isFinite(d) ? d : seconds, seconds));
  }, []);

  const seekBy = useCallback((delta: number) => {
    const el = audio();
    if (!el) return;
    const d = el.duration;
    el.currentTime = Math.max(0, Math.min(Number.isFinite(d) ? d : el.currentTime + delta, el.currentTime + delta));
  }, []);

  const close = useCallback(() => {
    const el = audio();
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setTrack(null);
    setMediaSession(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
  }, []);

  const api = useMemo<PlayerApi>(
    () => ({ track, playing, loading, time, duration, play, toggle, seekTo, seekBy, close }),
    [track, playing, loading, time, duration, play, toggle, seekTo, seekBy, close],
  );
  return <PlayerContext.Provider value={api}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
