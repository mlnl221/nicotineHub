"use client";

import { isDemo } from "@/lib/demo";

export function DemoBanner() {
  if (!isDemo) return null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-tertiary-fixed px-3 py-2 text-center text-on-tertiary-fixed">
      <span className="material-symbols-outlined text-[16px]">science</span>
      <span className="font-label text-xs font-semibold uppercase tracking-widest">
        Demo — search, chat, profiles &amp; browse are mocked • Downloads/uploads disabled •{" "}
        <a href="https://github.com/anomalyco/nicotine_mobile" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">GitHub</a>
      </span>
    </div>
  );
}
