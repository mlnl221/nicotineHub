// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export function Footer() {
  return (
    <footer className="w-full border-t border-outline-variant/10 bg-surface-container-lowest/40 px-4 py-4 text-center text-[11px] leading-relaxed text-on-surface-variant/80 dark:bg-surface-container-low/40 dark:text-outline md:ml-72 md:w-[calc(100%-18rem)] pb-[calc(1rem+env(safe-area-inset-bottom,0px)+68px)] md:pb-4">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="font-label uppercase tracking-widest">© 2025–2026 Nicotine Hub</span>
        <span className="hidden sm:inline opacity-30">•</span>
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
      <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] opacity-70">
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
    </footer>
  );
}
