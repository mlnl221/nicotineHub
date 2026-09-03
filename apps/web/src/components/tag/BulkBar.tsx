"use client";

import { useEffect } from "react";

type BulkBarProps = {
  count: number;
  onClear: () => void;
  onEdit: () => void;
  onVerify: () => void;
  onAnalyze: () => void;
  onSpectrum: () => void;
  onScrape: () => void;
};

export function BulkBar({ count, onClear, onEdit, onVerify, onAnalyze, onSpectrum, onScrape }: BulkBarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClear]);

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom,0px))] md:bottom-4 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex max-w-[640px] w-full flex-col gap-2 rounded-2xl bg-surface-container-highest shadow-xl ghost-border p-3 dark:bg-surface-container-high">
        <div className="flex items-center justify-between gap-2">
          <span className="font-label text-xs font-bold text-on-surface-variant">{count} selected</span>
          <button onClick={onClear} className="rounded-full bg-surface-container-high px-3 py-1 font-label text-xs">Clear</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={onEdit} className="flex-1 min-w-[72px] rounded-full bg-primary px-3 py-2 font-label text-xs font-bold text-on-primary">Edit Tags</button>
          <button onClick={onScrape} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2 font-label text-xs font-semibold">Scrape (1 URL)</button>
          <button onClick={onVerify} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2 font-label text-xs font-semibold">Verify</button>
          <button onClick={onAnalyze} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2 font-label text-xs font-semibold">Analyze</button>
          <button onClick={onSpectrum} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2 font-label text-xs font-semibold">Spectrum</button>
        </div>
        <p className="font-body text-[10px] leading-relaxed text-outline">Bulk ops: title+artist per-file, others uniform. Limit 50. Select toggle persists per-page. Shift+click / Shift+↑/↓ extends range.</p>
      </div>
    </div>
  );
}
