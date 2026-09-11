"use client";

import type { ReactNode } from "react";

// Page-level empty state: centered icon + serif title + helper + optional action.
// One pattern for all mobile pages. Keep title strings stable — e2e asserts on
// several ("Search the network", "No active downloads", ...).
export function EmptyState({
  icon,
  title,
  helper,
  action,
  testId,
  className,
}: {
  icon: string;
  title: string;
  helper?: ReactNode;
  action?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div role="status" data-testid={testId} className={`flex flex-col items-center justify-center gap-3 px-8 py-8 text-center ${className ?? ""}`}>
      <span aria-hidden className="material-symbols-outlined text-5xl text-outline">
        {icon}
      </span>
      <p className="font-headline text-xl text-on-surface">{title}</p>
      {helper ? <div className="max-w-md font-body text-sm text-on-surface-variant">{helper}</div> : null}
      {action}
    </div>
  );
}

// Inline empty/note inside scroll flow or cards: compact, stays out of the way.
// For page-level empties use EmptyState instead.
export function CompactEmpty({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <p role="status" data-testid={testId} className="rounded-xl bg-surface-container-low px-4 py-3 text-center font-body text-xs text-on-surface-variant">
      {children}
    </p>
  );
}

// Eyebrow section label. span-based on purpose: real section headings keep
// proper h-elements; this is for kickers and list captions only.
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
      {children}
    </p>
  );
}
