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

  return (
    <SectionCard
      title="Now Playing"
      description="Format for /np. Desktop backends (MPRIS/other) are not available in the browser — format is stored locally and can be used with navigator.mediaSession later."
    >
      <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
        Tokens: $n (now playing), $t (title), $a (artist), $b (album), $l (duration), $r (bitrate), $c (comment), $k (track), $y (year), $f (filename), $p (program). Example: <span className="font-mono">$a - $t</span>
      </div>
      <RadioGroupControl
        label="Player backend"
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
        label="Custom command (for Other player)"
        value={p.npothercommand}
        placeholder="e.g. /usr/bin/player --now-playing"
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
