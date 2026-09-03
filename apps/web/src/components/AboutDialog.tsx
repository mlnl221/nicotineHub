"use client";

import { useEffect, useState } from "react";
import { buildTag, shortSha, buildDate, displayVersion, soulseekClientVersion } from "@/lib/version";

// Small excerpt of nicotine-plus AUTHORS / TRANSLATORS — keep concise for web, link to full ATTRIBUTION.md
const AUTHORS = [
  "Nicotine Hub — browser-first Soulseek client (GPL-3.0-or-later).",
  "Based on Nicotine+ (© 2004–2026 Nicotine+ Contributors) — thanks to the Nicotine+ Team.",
  "Hub contributors: see GitHub Contributors.",
];
const TRANSLATORS = [
  "Web UI uses Inter / Noto Serif / Public Sans + Material Symbols — no separate translators yet. Volunteer via GitHub Discussions.",
];

type Tab = "about" | "authors" | "translators" | "license";

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("about");
  const [bridgeVersion, setBridgeVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    // try to fetch bridge version via same logic as AboutSection
    const custom = typeof window !== "undefined" ? localStorage.getItem("nicotineHub.bridgeUrl") : "";
    const url = custom ? custom.replace(/\/ws\/?$/, "/health?json") : "/health?json";
    fetch(url, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.version) setBridgeVersion(j.version); })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const tag = displayVersion();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label="About Nicotine Hub">
      <div
        className="w-full max-w-[520px] max-h-[85dvh] flex flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl dark:bg-surface-container-high ghost-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — icon + title + version like nicotine-plus about.py application_version_label */}
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/10 bg-surface-container-low/40">
          <div className="flex items-start gap-4">
            <img src="/icon-512.png" alt="" width={56} height={56} className="h-14 w-14 rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 className="font-headline text-xl font-bold tracking-tight">Nicotine Hub</h2>
              <p className="font-mono text-xs font-semibold text-primary">{tag}</p>
              <p className="font-label text-[11px] text-outline">
                GTK Backport → Next.js 15 • React 19 • Soulseek {soulseekClientVersion}
              </p>
              <p className="font-body text-[10px] leading-relaxed text-on-surface-variant/70 mt-1">© 2025–2026 Nicotine Hub • GPL-3.0-or-later</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high hover:bg-surface-variant text-on-surface-variant shrink-0">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Build tag row */}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-fixed/20 border border-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary">
              <span className="material-symbols-outlined text-[13px]">sell</span> {tag}
            </span>
            {shortSha ? <span className="inline-flex items-center rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[10px] text-outline">{shortSha}</span> : null}
            {buildDate ? <span className="inline-flex items-center rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[10px] text-outline">{buildDate}</span> : null}
            {bridgeVersion ? <span className="inline-flex items-center rounded-full bg-tertiary-container/20 border border-outline-variant/10 px-2.5 py-1 font-mono text-[10px] text-on-surface-variant">bridge {bridgeVersion}</span> : null}
          </div>
          <p className="mt-2 font-label text-[11px] leading-relaxed text-outline">
            Build Tag = Docker <span className="font-mono">GHCR TAG</span> (<span className="font-mono">{"${TAG:-latest}"}</span>). Matches{" "}
            <span className="font-mono">ghcr.io/mlnl221/nicotinehub-web</span> + <span className="font-mono">bridge</span>.
          </p>
        </div>

        {/* Tabs like nicotine-plus notebook */}
        <div className="flex gap-1 px-3 pt-3 border-b border-outline-variant/10 bg-surface-container-lowest/80 backdrop-blur-sm shrink-0">
          {(["about", "authors", "translators", "license"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 font-label text-xs font-semibold capitalize rounded-t-lg border-b-2 transition-colors ${tab === t ? "border-primary text-primary bg-primary-fixed/10" : "border-transparent text-outline hover:text-on-surface-variant hover:bg-surface-container-low"}`}
            >
              {t}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1 pb-1">
            <button
              onClick={() => {
                const v = bridgeVersion ? `web ${tag} / bridge ${bridgeVersion}` : tag;
                navigator.clipboard.writeText(v);
              }}
              className="hidden sm:inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px] hover:bg-surface-variant"
            >
              <span className="material-symbols-outlined text-[12px]">content_copy</span> Copy
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-4 min-h-0" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
          {tab === "about" ? (
            <>
              <p className="font-body text-sm leading-relaxed text-on-surface-variant">
                Browser-first Soulseek client for your homelab. Not affiliated with Soulseek. Port of Nicotine+ framing and settings — see Attribution.
              </p>
              <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-2">
                <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Links</h4>
                <div className="flex flex-wrap gap-2">
                  <a href="https://github.com/mlnl221/nicotineHub" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs hover:bg-surface-variant">
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span> GitHub
                  </a>
                  <a href="https://github.com/mlnl221/nicotineHub/releases" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs hover:bg-surface-variant">
                    Releases
                  </a>
                  <a href="https://nicotine-plus.org" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs hover:bg-surface-variant">
                    nicotine-plus.org
                  </a>
                  <a href="https://www.slsknet.org/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs hover:bg-surface-variant">
                    slsknet.org
                  </a>
                </div>
                <div className="flex flex-wrap gap-3 pt-2 text-[11px] font-mono text-outline">
                  <span>Next.js 15.5</span> <span className="opacity-30">•</span> <span>React 19</span> <span className="opacity-30">•</span> <span>Bun 1.4</span> <span className="opacity-30">•</span> <span>Tailwind v4</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <a href="/settings?tab=about#about" onClick={onClose} className="font-label text-xs font-semibold text-primary hover:underline">
                  Open full About page →
                </a>
                <span className="font-mono text-[10px] text-outline">Soulseek {soulseekClientVersion} • 160/3</span>
              </div>
            </>
          ) : tab === "authors" ? (
            <div className="space-y-3">
              <p className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Authors & Credits</p>
              {AUTHORS.map((line, i) => (
                <p key={i} className="font-body text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">{line}</p>
              ))}
              <p className="font-body text-xs leading-relaxed text-outline">
                Full credits: <a href="https://github.com/mlnl221/nicotineHub/blob/main/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">ATTRIBUTION.md</a> •{" "}
                <a href="https://github.com/nicotine-plus/nicotine-plus/blob/master/AUTHORS.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Nicotine+ AUTHORS</a>
              </p>
            </div>
          ) : tab === "translators" ? (
            <div className="space-y-3">
              <p className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Translators</p>
              {TRANSLATORS.map((line, i) => (
                <p key={i} className="font-body text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">{line}</p>
              ))}
              <p className="font-body text-xs text-outline">
                Help translate: <a href="https://nicotine-plus.org/doc/TRANSLATIONS" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">nicotine-plus.org/doc/TRANSLATIONS</a>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">License</p>
              <p className="font-body text-sm leading-relaxed text-on-surface-variant">
                GPL-3.0-or-later — see <a href="https://github.com/mlnl221/nicotineHub/blob/main/COPYING" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">COPYING</a> and{" "}
                <a href="https://github.com/mlnl221/nicotineHub/blob/main/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">ATTRIBUTION.md</a> for full notices.
                This project is not affiliated with Soulseek. Based on Nicotine+ — thanks to the Nicotine+ Team.
              </p>
              <ul className="list-disc pl-5 font-body text-xs leading-relaxed text-on-surface-variant">
                <li><a href="https://mutagen.readthedocs.io/" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">mutagen</a> — GPL-2.0-or-later (worker tag read/write) — TinyTag parity</li>
                <li><a href="https://github.com/madebybowtie/FlagKit" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">FlagKit</a> — MIT</li>
                <li>IP2Location LITE — CC-BY-SA-4.0</li>
              </ul>
              <p className="font-mono text-[10px] text-outline pt-2">© 2025–2026 Nicotine Hub • © 2004–2026 Nicotine+ Contributors</p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-outline-variant/10 bg-surface-container-low/60 flex items-center justify-between shrink-0">
          <a href="https://github.com/mlnl221/nicotineHub" target="_blank" rel="noopener noreferrer" className="font-label text-xs text-primary hover:underline">
            github.com/mlnl221/nicotineHub
          </a>
          <button onClick={onClose} className="rounded-full bg-primary px-4 py-2 font-label text-xs font-bold text-on-primary hover:bg-primary-container">Close</button>
        </div>
      </div>
    </div>
  );
}
