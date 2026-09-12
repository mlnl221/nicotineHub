"use client";

import { useState, type ReactNode } from "react";
import { scopeRowVisible, wishlistDefaultOpen } from "../../lib/mobile-help";

export { scopeRowVisible, wishlistDefaultOpen };

// Mobile-only progressive disclosure for helper text. Desktop renders
// children inline (unchanged); mobile shows `short` + an info button that
// expands in-flow. In-flow on purpose: an absolute tooltip would be clipped
// by sticky/overflow-hidden ancestors (search sticky bar, search card).
export function MobileHelp({
  short,
  children,
  testId,
}: {
  short: string;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span className="inline-flex items-center gap-1.5 font-label text-xs text-on-surface-variant md:hidden">
        <span>{short}</span>
        <button
          type="button"
          data-testid={testId}
          aria-label="More info"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[16px]">info</span>
        </button>
      </span>
      <div data-testid={testId ? `${testId}-detail` : undefined} className={open ? "mt-1 block" : "hidden md:block"}>
        {children}
      </div>
    </div>
  );
}
