"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, TextFieldControl, RadioGroupControl } from "@/components/settings/controls";

const PLAYER_OPTIONS = [
  { value: "mpris", label: "MPRIS (Linux desktop)" },
  { value: "lastfm", label: "Last.fm" },
  { value: "librefm", label: "Libre.fm" },
  { value: "listenbrainz", label: "ListenBrainz" },
  { value: "other", label: "Other (custom command)" },
] as const;

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

  return (
    <SectionCard
      title="Now Playing"
      description="Format for /np. Desktop backends (MPRIS/other) are browser-inapplicable — stored locally and usable with navigator.mediaSession later (preferences.py:3206, settings-mapping.md:244)."
    >
      <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
        Tokens for current player: <span className="font-mono">{tokens}</span> — $n (now playing), $t (title), $a (artist), $b (album), $l (duration), $r (bitrate), $c (comment), $k (track), $y (year), $f (filename), $p (program). Example: <span className="font-mono">$a - $t</span>
      </div>
      <RadioGroupControl
        label="Player backend"
        description="MPRIS and Other are desktop-only (hidden on non-Linux / isolated). Browser keeps format history."
        value={p.npplayer}
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
    </SectionCard>
  );
}
