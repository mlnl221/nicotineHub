"use client";

import { useEffect, useRef, useState } from "react";

export function InfoTooltip({ text, testId }: { text: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        data-testid={testId}
        aria-label="More info"
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest dark:bg-surface-variant dark:text-outline"
      >
        <span className="material-symbols-outlined text-[16px]">info</span>
      </button>
      {open && (
        <div
          role="tooltip"
          data-testid={testId ? `${testId}-tooltip` : undefined}
          className="absolute left-1/2 top-full z-[70] mt-2 w-[280px] max-w-[320px] -translate-x-1/2 rounded-xl bg-surface-container-highest p-3 shadow-lg ghost-border dark:bg-surface-variant text-left"
        >
          <div className="font-body text-xs leading-relaxed text-on-surface-variant dark:text-outline">
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

function splitFirstSentence(text: string): [string, string] {
  const m = text.match(/^[^.!?]+[.!?]\s*/);
  if (!m) return [text, text];
  return [m[0].trim(), text];
}

export function useInfoSplit(description?: string): { isLong: boolean; first: string; full: string } {
  if (!description) return { isLong: false, first: "", full: "" };
  const isLong = description.length > 80 || description.split(/[.!?]+/).filter((s) => s.trim()).length > 1;
  const [first] = splitFirstSentence(description);
  return { isLong, first, full: description };
}
