"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useConfig } from "@/lib/config/provider";
import { useSaveSection } from "@/lib/config/save";
import { useSession } from "@/lib/session";
import { useTheme } from "@/components/ThemeProvider";
import { isDemo } from "@/lib/demo";
import { getWorkerHealth } from "@/lib/worker";
import type { SharedFolder } from "@/lib/config/defaults";

const FileExplorer = dynamic(() => import("@/components/files/FileExplorer").then((m) => m.FileExplorer), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-xl bg-surface-container-high" />,
});

export interface StepNav {
  onNext: () => void;
  onBack: () => void;
  isFirst: boolean;
}

/* ---------- shared primitives (Alexandria tokens, no new deps) ---------- */

export function StepHead({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="mb-6 text-center">
      <div className="mb-2 font-label text-[11px] font-bold uppercase tracking-widest text-tertiary dark:text-tertiary-fixed">
        {kicker}
      </div>
      <h1 className="font-headline text-3xl font-bold leading-tight tracking-tight text-on-surface dark:text-inverse-on-surface">
        {title}
      </h1>
      <p className="mt-3 font-body text-sm leading-relaxed text-on-surface-variant dark:text-outline">{body}</p>
    </div>
  );
}

export function InfoTip({ label = "Why this matters", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl bg-surface-container-high px-4 py-3 dark:bg-surface-container-highest/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-label text-xs font-semibold uppercase tracking-widest text-tertiary dark:text-tertiary-fixed">
        <span className="material-symbols-outlined text-[16px]">lightbulb</span>
        {label}
        <span className="material-symbols-outlined ml-auto text-[16px] transition-transform group-open:rotate-180">expand_more</span>
      </summary>
      <div className="mt-2 font-body text-xs leading-relaxed text-on-surface-variant dark:text-outline">{children}</div>
    </details>
  );
}

export function StepNavButtons({
  onBack,
  onNext,
  isFirst,
  nextLabel = "Continue",
  busy = false,
  disabled = false,
}: {
  onBack: () => void;
  onNext: () => void;
  isFirst: boolean;
  nextLabel?: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="mt-6 flex items-center gap-3">
      {!isFirst ? (
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="h-12 shrink-0 rounded-xl bg-surface-container-high px-5 font-label text-xs font-bold uppercase tracking-widest text-primary dark:bg-surface-container-highest/60 dark:text-primary-fixed disabled:opacity-50"
        >
          Back
        </button>
      ) : null}
      <button
        type="button"
        onClick={onNext}
        disabled={busy || disabled}
        className="h-12 flex-1 rounded-xl bg-gradient-to-r from-primary to-primary-container px-6 font-label text-sm font-bold uppercase tracking-widest text-on-primary btn-glow disabled:opacity-50"
      >
        {busy ? "Saving…" : nextLabel}
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-surface-container-highest dark:bg-surface-variant"
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface-container-lowest shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

const inputClass =
  "w-full rounded-xl bg-surface-container-lowest px-4 py-3 font-body text-sm text-on-surface placeholder:text-outline ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/* ---------- 1 — Welcome ---------- */

export function WelcomeStep({ onNext, onBack, isFirst }: StepNav) {
  return (
    <div>
      <div className="mb-6 flex justify-center">
        <img src="/logo.png" alt="Nicotine Hub" width={160} height={88} className="h-auto w-[160px] object-contain" />
      </div>
      <StepHead
        kicker="Setup guide"
        title="Build your music library"
        body="Five short stops and you're sharing. Soulseek runs on give and take — hosts who share get faster queues and fewer blocks."
      />
      <ul className="space-y-2">
        {[
          ["folder", "Share", "Point the app at your music folder"],
          ["shield", "Community", "Fair-share guards and human checks"],
          ["palette", "Appearance", "Light or dark reading room"],
          ["memory", "Metadata", "Optional keys for richer lookups"],
        ].map(([icon, title, sub]) => (
          <li key={title} className="flex items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3 dark:bg-surface-container">
            <span className="material-symbols-outlined text-primary">{icon}</span>
            <div>
              <div className="font-label text-sm font-semibold text-on-surface dark:text-inverse-on-surface">{title}</div>
              <div className="font-body text-xs text-on-surface-variant dark:text-outline">{sub}</div>
            </div>
          </li>
        ))}
      </ul>
      <StepNavButtons onBack={onBack} onNext={onNext} isFirst={isFirst} nextLabel="Get started" />
    </div>
  );
}

/* ---------- 2 — Shares ---------- */

function normalizeFolderPath(p: string): string {
  let s = p.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function basenameOf(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || "Shared";
}

type Perm = "public" | "buddy" | "trusted";
const PERM_KEY: Record<Perm, "shared" | "buddyshared" | "trustedshared"> = {
  public: "shared",
  buddy: "buddyshared",
  trusted: "trustedshared",
};

export function SharesStep({ onNext, onBack, isFirst }: StepNav) {
  const { settings, setOption } = useConfig();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const saveSection = useSaveSection();
  const { send, subscribe, state } = useSession();
  const [path, setPath] = useState("");
  const [perm, setPerm] = useState<Perm>("public");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ dirs: number; files: number } | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [unavailable, setUnavailable] = useState<[string, string][] | null>(null);

  useEffect(() => {
    return subscribe((msg) => {
      if ((msg as { type: string }).type === "shares:rescanned") {
        const m = msg as unknown as { counts?: { dirs: number; files: number }; unavailable?: [string, string][] };
        setRescanning(false);
        if (m.counts) setCounts(m.counts);
        setUnavailable(m.unavailable?.length ? m.unavailable : null);
      } else if ((msg as { type: string }).type === "error" && rescanning) {
        setRescanning(false);
      }
    });
  }, [subscribe, rescanning]);

  const t = settings.transfers;
  const all: { v: string; p: string; perm: Perm }[] = [
    ...t.shared.map(([v, p]): { v: string; p: string; perm: Perm } => ({ v, p, perm: "public" })),
    ...t.buddyshared.map(([v, p]): { v: string; p: string; perm: Perm } => ({ v, p, perm: "buddy" })),
    ...t.trustedshared.map(([v, p]): { v: string; p: string; perm: Perm } => ({ v, p, perm: "trusted" })),
  ];

  const add = useCallback(() => {
    const norm = normalizeFolderPath(path);
    if (!norm) {
      setError("Enter a folder path first.");
      return;
    }
    const lower = norm.toLowerCase();
    const dup = all.some((s) => s.p.toLowerCase() === lower);
    if (dup) {
      setError("That folder is already shared.");
      return;
    }
    const existingNames = new Set(all.map((s) => s.v));
    let v = basenameOf(norm).replace(/[/\\]/g, "_");
    let i = 1;
    while (existingNames.has(v)) {
      v = `${basenameOf(norm)}${i}`;
      i += 1;
    }
    const entry: SharedFolder = [v, norm];
    setOption("transfers", PERM_KEY[perm], [...settingsRef.current.transfers[PERM_KEY[perm]], entry]);
    setPath("");
    setError(null);
  }, [path, perm, all, setOption]);

  const remove = (folderPath: string, virtual: string) => {
    const lower = normalizeFolderPath(folderPath).toLowerCase();
    (Object.keys(PERM_KEY) as Perm[]).forEach((pm) => {
      const key = PERM_KEY[pm];
      const cur = settingsRef.current.transfers[key];
      const next = cur.filter(([v, p]) => normalizeFolderPath(p).toLowerCase() !== lower && v !== virtual);
      if (next.length !== cur.length) setOption("transfers", key, next);
    });
  };

  const rescan = () => {
    if (state.status !== "connected" || rescanning) return;
    setRescanning(true);
    setUnavailable(null);
    send({ type: "shares:rescan" });
    setTimeout(() => setRescanning((v) => (v ? false : v)), 30_000);
  };

  const cont = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveSection("transfers", () => settingsRef.current);
      if (state.status === "connected") send({ type: "shares:rescan" });
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <StepHead
        kicker="Step 1 of 5 · Share"
        title="Share your music"
        body="No shares, no network. Other users can only download from you — and many will only upload to you — when you share."
      />
      <InfoTip>
        Docker: mount the host folder into the container first (e.g. <span className="font-mono">-v /home/you/Music:/data/Music:ro</span>),
        then share <span className="font-mono">/data/Music</span>. Local dev: use an absolute path the bridge can see
        (e.g. <span className="font-mono">/home/magnus/Music</span>). Use Browse to pick from what the bridge sees. A rescan
        showing 1 dirs · 0 files means the path was not found.
      </InfoTip>
      <div className="mt-4 flex gap-2">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/data/Music"
          spellCheck={false}
          className={`${inputClass} min-w-0 flex-1 font-mono`}
        />
        <button
          type="button"
          onClick={() => setBrowseOpen(true)}
          className="h-[46px] shrink-0 rounded-xl bg-surface-container-high px-4 font-label text-xs font-bold uppercase tracking-widest text-primary dark:bg-surface-container-highest/60"
        >
          Browse
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {(Object.keys(PERM_KEY) as Perm[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPerm(p)}
            className={`min-h-11 flex-1 rounded-xl font-label text-xs font-bold uppercase tracking-widest ${
              perm === p ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant dark:bg-surface-container-highest/60"
            }`}
          >
            {p === "public" ? "Public" : p === "buddy" ? "Buddies" : "Trusted"}
          </button>
        ))}
        <button
          type="button"
          onClick={add}
          className="min-h-11 shrink-0 rounded-xl bg-secondary-container px-4 font-label text-xs font-bold uppercase tracking-widest text-on-secondary-container"
        >
          Add
        </button>
      </div>
      {error ? <div className="mt-2 rounded-xl bg-error-container px-3 py-2 font-body text-xs text-on-error-container">{error}</div> : null}
      {all.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {all.map((s) => (
            <li key={`${s.v}:${s.p}`} className="flex items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2 dark:bg-surface-container">
              <span className="material-symbols-outlined shrink-0 text-[18px] text-tertiary">folder</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-body text-sm text-on-surface dark:text-inverse-on-surface">{s.v}</div>
                <div className="truncate font-mono text-[11px] text-on-surface-variant dark:text-outline">
                  {s.p} · {s.perm}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(s.p, s.v)}
                aria-label={`Remove ${s.v}`}
                className="shrink-0 rounded-lg bg-error-container px-3 py-1.5 font-label text-[11px] uppercase tracking-widest text-on-error-container"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-xl bg-surface-container-low px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container">
          Nothing shared yet — add at least one folder. You can refine permissions later in Settings → Shares.
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={rescan}
          disabled={state.status !== "connected" || rescanning}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-surface-container-high px-4 font-label text-xs font-bold uppercase tracking-widest text-primary disabled:opacity-50 dark:bg-surface-container-highest/60"
        >
          <span className={`material-symbols-outlined text-[18px] ${rescanning ? "animate-spin" : ""}`}>
            {rescanning ? "progress_activity" : "refresh"}
          </span>
          {rescanning ? "Scanning…" : "Test rescan"}
        </button>
        <span className="font-body text-xs text-on-surface-variant dark:text-outline">
          {counts ? `${counts.dirs} dirs · ${counts.files} files` : state.status !== "connected" ? "Log in to rescan" : ""}
        </span>
      </div>
      {unavailable && unavailable.length > 0 ? (
        <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 font-body text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Not found on bridge: <span className="font-mono">{unavailable.map(([, p]) => p).join(", ")}</span> — fix the path or mount, then rescan.
        </div>
      ) : null}
      {browseOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setBrowseOpen(false)}>
          <div
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface-container-lowest p-4 sm:rounded-2xl dark:bg-surface-container"
            onClick={(e) => e.stopPropagation()}
          >
            <FileExplorer
              initialPath="/data"
              selectable="directories"
              onSelect={(p) => {
                setPath(p);
                setBrowseOpen(false);
              }}
              onClose={() => setBrowseOpen(false)}
            />
          </div>
        </div>
      ) : null}
      <StepNavButtons onBack={onBack} onNext={cont} isFirst={isFirst} busy={busy} />
    </div>
  );
}

/* ---------- shared leech-plugin draft ---------- */

const PLUGIN_PRIMARY = "leech_detector";
const PLUGIN_FALLBACK = "anti_leecher";

function useLeechDraft() {
  const { send, subscribe, state } = useSession();
  const [pluginName, setPluginName] = useState(PLUGIN_PRIMARY);
  const [enabled, setEnabled] = useState(true);
  const [remote, setRemote] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (state.status !== "connected") return;
    const unsub = subscribe((msg) => {
      if (msg.type === "plugin:list") {
        const list = (msg as unknown as { plugins: { name: string; enabled: boolean; settings: Record<string, unknown> }[] }).plugins;
        const p = list.find((x) => x.name === PLUGIN_PRIMARY) ?? list.find((x) => x.name === PLUGIN_FALLBACK);
        if (p) {
          setPluginName(p.name);
          setEnabled(p.enabled);
          setRemote(p.settings ?? {});
        }
        setLoading(false);
      } else if (msg.type === "plugin:toggled") {
        const m = msg as unknown as { name: string; enabled: boolean };
        if (m.name === PLUGIN_PRIMARY || m.name === PLUGIN_FALLBACK) setEnabled(m.enabled);
      }
    });
    send({ type: "plugin:list" });
    return unsub;
  }, [send, subscribe, state.status]);

  const commit = useCallback(
    (patch: Record<string, unknown>) => {
      send({ type: "plugin:settings", name: pluginName, settings: { ...(remote ?? {}), ...patch } });
    },
    [send, pluginName, remote],
  );

  const togglePlugin = useCallback(() => {
    send({ type: "plugin:toggle", name: pluginName });
  }, [send, pluginName]);

  return { enabled, togglePlugin, remote, commit, loading, connected: state.status === "connected" };
}

/* ---------- 3 — Leechers ---------- */

export function LeechersStep({ onNext, onBack, isFirst }: StepNav) {
  const { enabled, togglePlugin, remote, commit, loading } = useLeechDraft();
  const [ban, setBan] = useState(true);
  const [ignore, setIgnore] = useState(true);
  useEffect(() => {
    if (!remote) return;
    if (typeof remote.ban_leechers === "boolean") setBan(remote.ban_leechers);
    if (typeof remote.ignore_leechers === "boolean") setIgnore(remote.ignore_leechers);
  }, [remote]);

  const cont = () => {
    commit({ ban_leechers: ban, ignore_leechers: ignore });
    onNext();
  };

  return (
    <div>
      <StepHead
        kicker="Step 2 of 5 · Community"
        title="Keep leechers out"
        body="Some users download everything and share nothing. Flag accounts sharing too little so your uploads go to real sharers."
      />
      <InfoTip>
        A leecher shares fewer files or folders than your minimum (defaults 10 files / 1 folder, tunable in Settings →
        Leecher). <span className="font-semibold">Ban</span> blocks their uploads; <span className="font-semibold">Ignore</span> hides
        their messages. Buddies are always exempt — never flagged, banned, or challenged.
      </InfoTip>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-4 py-3 dark:bg-surface-container">
          <div>
            <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">Enable leech detector</div>
            <div className="font-body text-xs text-on-surface-variant dark:text-outline">
              {loading ? "Loading…" : "Flips the bridge plugin on/off now."}
            </div>
          </div>
          <Toggle checked={enabled} onChange={togglePlugin} label="Enable leech detector" />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-4 py-3 dark:bg-surface-container">
          <div>
            <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">Ban leechers</div>
            <div className="font-body text-xs text-on-surface-variant dark:text-outline">Refuse uploads from flagged users.</div>
          </div>
          <Toggle checked={ban} onChange={setBan} label="Ban leechers" />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-4 py-3 dark:bg-surface-container">
          <div>
            <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">Ignore leechers</div>
            <div className="font-body text-xs text-on-surface-variant dark:text-outline">Mute flagged users in chat.</div>
          </div>
          <Toggle checked={ignore} onChange={setIgnore} label="Ignore leechers" />
        </div>
      </div>
      <StepNavButtons onBack={onBack} onNext={cont} isFirst={isFirst} />
    </div>
  );
}

/* ---------- 4 — Captcha (ProveIt) ---------- */

export function CaptchaStep({ onNext, onBack, isFirst }: StepNav) {
  const { remote, commit } = useLeechDraft();
  const [proveit, setProveit] = useState(true);
  const [word, setWord] = useState("download");
  useEffect(() => {
    if (!remote) return;
    if (typeof remote.enable_proveit === "boolean") setProveit(remote.enable_proveit);
    if (typeof remote.proveit_captcha_word === "string" && remote.proveit_captcha_word) setWord(remote.proveit_captcha_word);
  }, [remote]);

  const cont = () => {
    commit({ enable_proveit: proveit, proveit_captcha_word: word.trim() || "download" });
    onNext();
  };

  return (
    <div>
      <StepHead
        kicker="Step 3 of 5 · Human check"
        title="Prove they're human"
        body="Before a stranger's queue continues, ask them to type one word in chat. Bots fail, humans pass, verified users never see it again."
      />
      <InfoTip>
        When enabled, flagged downloaders get your first message and must reply with the captcha word (default{" "}
        <span className="font-mono">download</span>, case-insensitive). Correct answers auto-retry their queued uploads; buddies skip
        the challenge entirely. Turn the whole thing off here or tune messages in Settings → Leecher.
      </InfoTip>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-4 py-3 dark:bg-surface-container">
          <div>
            <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">Enable ProveIt challenge</div>
            <div className="font-body text-xs text-on-surface-variant dark:text-outline">Challenge flagged users with the word below.</div>
          </div>
          <Toggle checked={proveit} onChange={setProveit} label="Enable ProveIt challenge" />
        </div>
        <div className="rounded-xl bg-surface-container-low px-4 py-3 dark:bg-surface-container">
          <label htmlFor="ob-captcha" className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
            Captcha word
          </label>
          <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">Short, easy to type, hard to guess.</div>
          <input
            id="ob-captcha"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="download"
            spellCheck={false}
            className={inputClass}
          />
        </div>
      </div>
      <StepNavButtons onBack={onBack} onNext={cont} isFirst={isFirst} />
    </div>
  );
}

/* ---------- 5 — Appearance ---------- */

export function AppearanceStep({ onNext, onBack, isFirst }: StepNav) {
  const { theme, setTheme } = useTheme();
  const { settings, setOption } = useConfig();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const saveSection = useSaveSection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (t: "light" | "dark") => {
    if (t !== theme) setTheme(t);
    setOption("ui", "dark_mode", t === "dark");
  };

  const cont = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveSection("ui", () => settingsRef.current);
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <StepHead
        kicker="Step 4 of 5 · Appearance"
        title="Set the mood"
        body="A quiet reading room for dense crates. Pick how it looks — you can change this anytime in Settings."
      />
      <InfoTip>
        Alexandria theme by design: serif headlines, calm surfaces, one accent blue. No custom colors or fonts — the palette stays
        consistent everywhere on purpose.
      </InfoTip>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(["light", "dark"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => pick(t)}
            aria-pressed={theme === t}
            className={`rounded-2xl p-4 text-left ${
              theme === t
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface dark:bg-surface-container dark:text-inverse-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[28px]">{t === "light" ? "light_mode" : "dark_mode"}</span>
            <div className="mt-2 font-label text-sm font-bold uppercase tracking-widest">{t}</div>
            <div className={`font-body text-xs ${theme === t ? "opacity-80" : "text-on-surface-variant dark:text-outline"}`}>
              {t === "light" ? "Paper-bright shelves" : "Late-night digging"}
            </div>
          </button>
        ))}
      </div>
      {error ? <div className="mt-2 rounded-xl bg-error-container px-3 py-2 font-body text-xs text-on-error-container">{error}</div> : null}
      <StepNavButtons onBack={onBack} onNext={cont} isFirst={isFirst} busy={busy} />
    </div>
  );
}

/* ---------- 6 — Scraper keys (optional finish) ---------- */

const SCRAPER_FIELDS = [
  { key: "discogs_token", label: "Discogs token", hint: "discogs.com/settings/developers — raises rate limits" },
  { key: "tidal_token", label: "Tidal token", hint: "Required for Tidal album lookup" },
  { key: "tidal_country", label: "Tidal country", hint: "e.g. US, DE, GB", secret: false },
  { key: "qobuz_app_id", label: "Qobuz app ID", hint: "Public app ID for album lookup" },
  { key: "qobuz_user_auth_token", label: "Qobuz user auth token", hint: "X-User-Auth-Token for authenticated calls" },
];

export function ScraperStep({ onNext, onBack, isFirst }: StepNav) {
  const { send, subscribe, state } = useSession();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [auth, setAuth] = useState<{ discogs?: boolean; tidal?: boolean; qobuz?: boolean } | null>(null);

  useEffect(() => {
    getWorkerHealth().then((h) => {
      if (h?.auth) setAuth(h.auth as { discogs?: boolean; tidal?: boolean; qobuz?: boolean });
    }).catch(() => {});
  }, []);

  const finish = () => {
    const keys = SCRAPER_FIELDS.map((f) => f.key).filter((k) => (values[k] ?? "").trim() !== "");
    if (isDemo || state.status !== "connected" || keys.length === 0) {
      onNext();
      return;
    }
    setBusy(true);
    setStatus(null);
    let done = 0;
    const timer = setTimeout(() => {
      unsub();
      setBusy(false);
      setStatus("Bridge was slow to confirm — keys may still have saved. Check Settings → Worker.");
      onNext();
    }, 6000);
    const unsub = subscribe((msg) => {
      const t = (msg as { type?: string }).type;
      if (t === "config:updated" && (msg as { section?: string }).section === "worker") {
        done += 1;
        if (done >= keys.length) {
          clearTimeout(timer);
          unsub();
          setBusy(false);
          onNext();
        }
      } else if (t === "error") {
        clearTimeout(timer);
        unsub();
        setBusy(false);
        setStatus((msg as { error?: string }).error || "Save failed — you can add keys later in Settings → Worker.");
      }
    });
    try {
      for (const k of keys) send({ type: "config:update", section: "worker", key: k, value: values[k].trim() } as unknown as never);
    } catch {
      clearTimeout(timer);
      unsub();
      setBusy(false);
      onNext();
    }
  };

  const badge = (ok?: boolean) =>
    ok == null ? null : ok ? (
      <span className="font-semibold text-green-600 dark:text-green-400"> ✓</span>
    ) : null;

  return (
    <div>
      <StepHead
        kicker="Step 5 of 5 · Metadata (optional)"
        title="Richer record cards"
        body="Paste-link lookups work out of the box. Keys unlock authenticated sources — skip freely, add later in Settings → Worker."
      />
      <InfoTip>
        Without keys, Discogs, MusicBrainz, Bandcamp, Apple and Deezer still work anonymously — only Qobuz and Tidal need theirs.
        Keys store write-only on the bridge (<span className="font-mono">worker.json</span>, mode 0600) and are never shown back;
        only “configured” checkmarks return.
      </InfoTip>
      {auth ? (
        <div className="mt-3 font-body text-xs text-on-surface-variant dark:text-outline">
          Already configured:{auth.discogs ? <span> Discogs{badge(true)}</span> : null}
          {auth.tidal ? <span> · Tidal{badge(true)}</span> : null}
          {auth.qobuz ? <span> · Qobuz{badge(true)}</span> : null}
          {!auth.discogs && !auth.tidal && !auth.qobuz ? " none yet" : null}
        </div>
      ) : null}
      <div className="mt-3 space-y-3">
        {SCRAPER_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`ob-${f.key}`} className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
              {f.label}
            </label>
            <div className="mb-1 font-body text-xs text-on-surface-variant dark:text-outline">{f.hint}</div>
            <input
              id={`ob-${f.key}`}
              type={f.key === "tidal_country" ? "text" : "password"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder="Leave blank to skip"
              spellCheck={false}
              autoComplete="off"
              className={`${inputClass} font-mono`}
            />
          </div>
        ))}
      </div>
      {status ? <div className="mt-2 rounded-xl bg-error-container px-3 py-2 font-body text-xs text-on-error-container">{status}</div> : null}
      <StepNavButtons onBack={onBack} onNext={finish} isFirst={isFirst} nextLabel="Start searching" busy={busy} />
    </div>
  );
}
