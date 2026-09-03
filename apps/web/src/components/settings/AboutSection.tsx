"use client";

import { useEffect, useState } from "react";
import { appVersion, buildTag, soulseekClientVersion, shortSha, buildDate, displayVersion } from "@/lib/version";

export function AboutSection() {
  const [bridgeHealth, setBridgeHealth] = useState<{ version?: string; commitSha?: string; buildDate?: string; } | null>(null);
  useEffect(() => {
    // fetch bridge health for matching version (homelab) — optional, ignore errors (Vercel demo has no bridge)
    const url = typeof window !== "undefined" ? (localStorage.getItem("nicotineHub.bridgeUrl") || "") : "";
    const healthUrl = url ? url.replace(/\/ws\/?$/, "/health?json") : "/health?json";
    // try relative + absolute, but avoid CORS noise: only try same-origin when no custom url
    const target = healthUrl.startsWith("http") ? healthUrl : "/api/health-proxy?url=" + encodeURIComponent(healthUrl);
    // simpler: just fetch same-origin /health if bridge not custom
    fetch(url ? healthUrl : "/health?json", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.version) setBridgeHealth({ version: j.version, commitSha: j.commitSha, buildDate: j.buildDate }); })
      .catch(() => {});
  }, []);

  const tag = displayVersion();
  const isTagged = buildTag !== "0.1.0";
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-surface-container-low shadow-sm dark:bg-surface-container-high">
        <div className="border-b border-outline-variant/10 px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-headline text-lg font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">info</span>
                About Nicotine Hub
              </h3>
              <p className="font-body text-sm text-on-surface-variant dark:text-outline mt-1">
                Browser-first Soulseek client for your homelab. Not affiliated with Soulseek.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-fixed/20 border border-primary/10 px-3 py-1.5">
                <span className="material-symbols-outlined text-primary text-[16px]">sell</span>
                <span className="font-mono text-xs font-bold text-primary tracking-tight">{tag}</span>
                {isTagged ? <span className="font-label text-[10px] uppercase tracking-widest text-primary/70">BUILD TAG</span> : null}
              </div>
              <span className="font-mono text-[10px] text-outline/80">
                {shortSha ? `${shortSha} • ` : ""}
                {buildDate ? `${buildDate} • ` : ""}Soulseek {soulseekClientVersion}
              </span>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {/* Build tag — matches Docker GHCR TAG (TAG env) */}
          <div className="rounded-xl bg-surface-container-lowest dark:bg-surface-container p-4 ghost-border space-y-3">
            <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Build</h4>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-container/30 border border-primary/10 px-3 py-1 font-mono text-xs font-semibold text-on-surface-variant">
                <span className="material-symbols-outlined text-[14px] text-primary">tag</span> Web {tag}
              </span>
              {bridgeHealth?.version ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-tertiary-container/20 border border-outline-variant/10 px-3 py-1 font-mono text-xs text-on-surface-variant">
                  Bridge {bridgeHealth.version}{bridgeHealth.commitSha ? ` • ${bridgeHealth.commitSha}` : ""}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 font-mono text-[10px] text-outline">
                Next.js 15 • React 19 • Soulseek {soulseekClientVersion}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-outline/80">
              <span>Build Tag = Docker TAG (GHCR)</span>
              <span className="opacity-30">•</span>
              <button
                onClick={() => {
                  const v = bridgeHealth?.version ? `web ${tag} / bridge ${bridgeHealth.version}` : tag;
                  navigator.clipboard.writeText(v);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-[10px] font-semibold hover:bg-surface-container-high/80"
              >
                <span className="material-symbols-outlined text-[12px]">content_copy</span> Copy
              </button>
              <a href="https://github.com/mlnl221/nicotineHub/releases" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Releases</a>
            </div>
            <p className="font-label text-[11px] leading-relaxed text-outline/70">
              This matches <span className="font-mono">ghcr.io/mlnl221/nicotinehub-web:${"${TAG:-latest}"}</span> and <span className="font-mono">nicotinehub-bridge:${"${TAG:-latest}"}</span> from{" "}
              <a href="https://github.com/mlnl221/nicotineHub/pkgs/container/nicotinehub-web" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">GHCR</a>.
              {shortSha || bridgeHealth?.commitSha ? ` Commit ${shortSha || bridgeHealth?.commitSha}.` : ""}
              {buildDate || bridgeHealth?.buildDate ? ` Built ${buildDate || bridgeHealth?.buildDate}.` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed text-on-surface-variant/80 dark:text-outline/80">
            <span className="font-label uppercase tracking-widest">© 2025–2026 Nicotine Hub</span>
            <span className="opacity-30">•</span>
            <a
              href="https://github.com/mlnl221/nicotineHub"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-4 hover:text-primary"
            >
              Source on GitHub
            </a>
            <span className="opacity-30">•</span>
            <a
              href="https://github.com/mlnl221/nicotineHub/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-4 hover:text-primary"
            >
              GPL-3.0-or-later
            </a>
            <span className="opacity-30">•</span>
            <a
              href="https://github.com/mlnl221/nicotineHub/blob/main/ATTRIBUTION.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-4 hover:text-primary"
            >
              Attribution
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] opacity-70 leading-relaxed text-on-surface-variant/80 dark:text-outline/60">
            <span>
              Based on{" "}
              <a href="https://github.com/nicotine-plus/nicotine-plus" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
                Nicotine+
              </a>{" "}
              — thanks to the Nicotine+ team.
            </span>
            <span className="hidden sm:inline opacity-30">•</span>
            <span>
              Not affiliated with{" "}
              <a href="https://www.slsknet.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
                Soulseek
              </a>
              .
            </span>
            <span className="opacity-30">•</span>
            <a href="https://www.slsknet.org/news/node/681" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              Rules
            </a>
            <a href="https://www.slsknet.org/news/node/682" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              ToS
            </a>
          </div>
          <div className="rounded-xl bg-surface-container-lowest dark:bg-surface-container p-4 ghost-border">
            <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-2">License</h4>
            <p className="font-body text-sm leading-relaxed text-on-surface-variant">
              GPL-3.0-or-later — see <a href="https://github.com/mlnl221/nicotineHub/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">LICENSE</a> and <a href="https://github.com/mlnl221/nicotineHub/blob/main/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">ATTRIBUTION.md</a> for full notices. This project is not affiliated with Soulseek.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
