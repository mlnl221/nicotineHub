"use client";

export function AboutSection() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-surface-container-low shadow-sm dark:bg-surface-container-high">
        <div className="border-b border-outline-variant/10 px-6 py-4">
          <h3 className="font-headline text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">info</span>
            About Nicotine Hub
          </h3>
          <p className="font-body text-sm text-on-surface-variant dark:text-outline mt-1">
            Browser-first Soulseek client for your homelab. Not affiliated with Soulseek.
          </p>
        </div>
        <div className="p-6 space-y-6">
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
              href="https://github.com/mlnl221/nicotineHub/blob/main/COPYING"
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
              GPL-3.0-or-later — see <a href="https://github.com/mlnl221/nicotineHub/blob/main/COPYING" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">COPYING</a> and <a href="https://github.com/mlnl221/nicotineHub/blob/main/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">ATTRIBUTION.md</a> for full notices. This project is not affiliated with Soulseek.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
