"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, SectionSaveButton, TextFieldControl, RadioGroupControl } from "@/components/settings/controls";
import { useState } from "react";

const PLAYER_OPTIONS = [
  { value: "mpris", label: "MPRIS (Linux desktop) — stored-only" },
  { value: "other", label: "Other (custom command) — stored-only" },
] as const;

// Keep legacy values in config for compat but hide scrobblers in UI (lastfm/librefm/listenbrainz intentionally omitted per user request)
const LEGACY_PLAYERS = new Set(["lastfm", "librefm", "listenbrainz"]);

function formatNowPlaying(format: string, meta: Record<string,string>): string {
  let out = format || "$a - $t";
  const tokens: Record<string,string> = { $n: `${meta.a || "Artist"} - ${meta.t || "Title"}`, $t: meta.t || "Title", $a: meta.a || "Artist", $b: meta.b || "Album", $l: meta.l || "3:45", $r: meta.r || "320", $c: meta.c || "", $k: meta.k || "1", $y: meta.y || "2024", $f: meta.f || "track.mp3", $p: meta.p || "Player" };
  for (const [k,v] of Object.entries(tokens)) out = out.replaceAll(k, v);
  return out;
}

export function NowPlayingSection() {
  const { settings, setOption } = useConfig();
  const p = settings.players;

  const commandLabel =
    p.npplayer === "mpris"
      ? "Music player (e.g. amarok, audacious, exaile); leave empty to autodetect"
      : p.npplayer === "other"
        ? "Command"
        : p.npplayer === "lastfm"
          ? "Username;APIKEY"
          : "Username";

  const tokens =
    p.npplayer === "mpris"
      ? "$n $p $a $b $t $y $c $r $k $l $f"
      : p.npplayer === "other"
        ? "$n"
        : "$n $t $a $b";

  const [testOut, setTestOut] = useState("");
  const effectivePlayer = LEGACY_PLAYERS.has(p.npplayer) ? "mpris" as const : p.npplayer;

  return (
    <SectionCard
      title="Now Playing"
      description="Format for /np. Desktop backends (MPRIS/other) are browser-inapplicable — stored locally and usable with navigator.mediaSession later (preferences.py:3206, settings-mapping.md:244). Last.fm/Libre.fm/ListenBrainz scrobblers intentionally omitted — no browser API."
      actions={<SectionSaveButton section="players" />}
    >
      <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
        Tokens for current player: <span className="font-mono">{tokens}</span> — $n (now playing), $t (title), $a (artist), $b (album), $l (duration), $r (bitrate), $c (comment), $k (track), $y (year), $f (filename), $p (program). Example: <span className="font-mono">$a - $t</span>
      </div>
      {LEGACY_PLAYERS.has(p.npplayer) ? (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 font-body text-xs text-amber-900 dark:text-amber-200">
          Legacy player “{p.npplayer}” is intentionally omitted (no scrobbler polling in browser). Switched to MPRIS view; your stored value is kept for compat.
        </div>
      ) : null}
      <RadioGroupControl
        label="Player backend"
        description="MPRIS and Other are desktop-only (stored-only, not executed). Browser uses mediaSession. Last.fm/Libre.fm/ListenBrainz omitted per settings-mapping.md."
        value={effectivePlayer}
        onChange={(v) => setOption("players", "npplayer", v)}
        options={PLAYER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      />
      <TextFieldControl
        label="Format"
        description="Leave empty for default. Custom formats are saved to history."
        value={p.npformat}
        placeholder="$a - $t"
        onChange={(v) => setOption("players", "npformat", v)}
        onReset={() => setOption("players", "npformat", defaults.players.npformat)}
      />
      <TextFieldControl
        label={commandLabel}
        description={p.npplayer === "other" ? "Shell command for Other player (desktop-only, stored but not executed in browser)." : undefined}
        value={p.npothercommand}
        placeholder={p.npplayer === "other" ? "e.g. /usr/bin/player --now-playing" : "e.g. username or player name"}
        onChange={(v) => setOption("players", "npothercommand", v)}
      />
      <TextFieldControl
        label="Format history (one per line)"
        value={p.npformatlist.join("\n")}
        multiline
        onChange={(v) => setOption("players", "npformatlist", v.split("\n").map((s) => s.trim()).filter(Boolean))}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const fmt = p.npformat || "$a - $t";
            const out = formatNowPlaying(fmt, { a: "Artist", t: "Title", b: "Album", l: "3:45", r: "320", c: "Comment", k: "1", y: "2024", f: "track.mp3", p: "Player" });
            setTestOut(out);
          }}
          className="rounded-full bg-primary px-4 py-2 font-label text-xs font-semibold text-on-primary"
        >
          Test
        </button>
        {testOut ? <span className="font-mono text-xs bg-surface-container-high px-3 py-1.5 rounded-full">Preview: {testOut}</span> : <span className="font-body text-xs text-on-surface-variant">Formats sample $a - $t</span>}
      </div>
    </SectionCard>
  );
}
