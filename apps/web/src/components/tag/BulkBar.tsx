"use client";

import { useEffect } from "react";
import { BulkBarShell } from "@/components/ui/BulkBarShell";

type BulkBarProps = {
  count: number;
  onClear: () => void;
  onEdit: () => void;
  onVerify: () => void;
  onAnalyze: () => void;
  onSpectrum: () => void;
  onScrape: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRemove?: () => void;
};

export function BulkBar({ count, onClear, onEdit, onVerify, onAnalyze, onSpectrum, onScrape, onPause, onResume, onRemove }: BulkBarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClear]);

  if (count === 0) return null;

  return (
    <BulkBarShell
      count={count}
      onClear={onClear}
      actions={
        <>
          {onPause ? <button onClick={onPause} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2.5 min-h-11 font-label text-xs font-semibold">Pause</button> : null}
          {onResume ? <button onClick={onResume} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2.5 min-h-11 font-label text-xs font-semibold">Resume</button> : null}
          {onRemove ? <button onClick={onRemove} className="flex-1 min-w-[72px] rounded-full bg-error-container px-3 py-2.5 min-h-11 font-label text-xs font-semibold text-on-error-container">Remove</button> : null}
          <button onClick={onEdit} className="flex-1 min-w-[72px] rounded-full bg-primary px-3 py-2.5 min-h-11 font-label text-xs font-bold text-on-primary">Edit Tags</button>
          <button onClick={onScrape} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2.5 min-h-11 font-label text-xs font-semibold">Scrape (1 URL)</button>
          <button onClick={onVerify} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2.5 min-h-11 font-label text-xs font-semibold">Verify</button>
          <button onClick={onAnalyze} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2.5 min-h-11 font-label text-xs font-semibold">Analyze</button>
          <button onClick={onSpectrum} className="flex-1 min-w-[72px] rounded-full bg-surface-container-high px-3 py-2.5 min-h-11 font-label text-xs font-semibold">Spectrum</button>
        </>
      }
      note={<p className="font-body text-[10px] leading-relaxed text-outline">Bulk ops: title+artist per-file, others uniform. Tag ops use first 50. Select toggle persists per-page. Shift+click / Shift+↑/↓ extends range.</p>}
    />
  );
}
