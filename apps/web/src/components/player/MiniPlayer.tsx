"use client";

import { usePlayer } from "@/lib/player/store";
import { humanLength, humanSize } from "@/lib/format";
import { useSidebarCollapsed } from "@/components/SidebarContext";

/**
 * Alexandria glass mini-player — floating bar above BottomNav/footer.
 * Glass (80% + 20px blur), tonal surface, no 1px borders, rounded-2xl.
 * One primary action (gradient play/pause); ±10s + close are tertiary.
 * Serif title, Public Sans metadata, archival-gold format/transcode chip.
 * Desktop (webmode): spans the content width (left follows sidebar state)
 * with a second metadata line (tags + technical); mobile stays compact.
 */
export function MiniPlayer() {
  const { track, playing, loading, time, duration, toggle, seekTo, seekBy, close } = usePlayer();
  const { collapsed } = useSidebarCollapsed();
  if (!track) return null;

  const transcoding = track.transcoding && !duration;
  const fmt = (s: number) => {
    const v = Math.floor(s || 0);
    return v <= 0 ? "0:00" : humanLength(v);
  };
  const tagBits = [track.album, track.year, track.genre].filter(Boolean) as string[];
  const techBits = [...(track.quality ? [track.quality] : []), ...(typeof track.size === "number" && track.size > 0 ? [humanSize(track.size)] : [])];
  const hasMeta = tagBits.length > 0 || techBits.length > 0;

  return (
    <div
      className={`fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 rounded-2xl bg-surface-container-high/80 shadow-[0_8px_40px_4px_rgb(0_0_0/0.06)] backdrop-blur-[20px] ghost-border dark:bg-surface-container-highest/80 md:inset-x-auto md:bottom-6 md:right-6 md:w-auto ${collapsed ? "md:left-[88px]" : "md:left-[312px]"}`}
      role="region"
      aria-label="Audio player"
    >
      <div className="flex items-center gap-3 px-4 pt-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary transition-transform active:scale-95"
        >
          <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            {playing ? "pause" : "play_arrow"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => seekBy(-10)}
          aria-label="Back 10 seconds"
          className="shrink-0 rounded-full px-1 py-2 font-label text-xs text-on-surface-variant hover:underline"
        >
          <span className="material-symbols-outlined text-[22px]">replay_10</span>
        </button>
        <button
          type="button"
          onClick={() => seekBy(10)}
          aria-label="Forward 10 seconds"
          className="shrink-0 rounded-full px-1 py-2 font-label text-xs text-on-surface-variant hover:underline"
        >
          <span className="material-symbols-outlined text-[22px]">forward_10</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-headline text-sm font-semibold text-on-surface dark:text-inverse-on-surface md:whitespace-normal md:line-clamp-2 md:text-base md:leading-snug">
            {track.title}
          </div>
          <div className="truncate font-label text-[11px] text-on-surface-variant dark:text-outline md:text-xs">
            {track.artist ? `${track.artist} · ` : ""}{track.formatLabel}
          </div>
          {hasMeta ? (
            <div className="mt-0.5 hidden truncate font-label text-[11px] text-on-surface-variant dark:text-outline md:block">
              {tagBits.length > 0 ? <span>{tagBits.join(" · ")}</span> : null}
              {tagBits.length > 0 && techBits.length > 0 ? <span className="mx-1.5 opacity-50">|</span> : null}
              {techBits.length > 0 ? <span className="tabular-nums">{techBits.join(" · ")}</span> : null}
            </div>
          ) : null}
        </div>
        {transcoding || loading ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-tertiary-container px-2 py-1 font-label text-[10px] uppercase tracking-widest text-tertiary dark:text-tertiary-fixed">
            <span className="material-symbols-outlined animate-spin text-[14px]">sync</span>
            {transcoding ? "Transcoding" : "Loading"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-tertiary-container px-2 py-1 font-label text-[10px] uppercase tracking-widest text-tertiary dark:text-tertiary-fixed">
            {track.formatLabel}
          </span>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close player"
          className="shrink-0 rounded-full px-1 py-2 font-label text-xs text-on-surface-variant hover:underline"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <div className="flex items-center gap-2 px-4 pb-3 pt-1">
        <span className="w-10 shrink-0 text-right font-label text-[11px] tabular-nums text-on-surface-variant">{fmt(time)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={Math.min(time, duration || 0)}
          disabled={!duration}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          className="flex-1 accent-primary"
        />
        <span className="w-10 shrink-0 font-label text-[11px] tabular-nums text-on-surface-variant">{fmt(duration)}</span>
      </div>
    </div>
  );
}
