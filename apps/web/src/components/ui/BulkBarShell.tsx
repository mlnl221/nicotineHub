import type { ReactNode } from "react";

type BulkBarShellProps = {
  count: number;
  onClear: () => void;
  actions: ReactNode;
  note?: ReactNode;
};

export function BulkBarShell({ count, onClear, actions, note }: BulkBarShellProps) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom,0px))] md:bottom-4 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex max-w-[640px] w-full flex-col gap-2 rounded-2xl bg-surface-container-highest shadow-xl ghost-border p-3 dark:bg-surface-container-high">
        <div className="flex items-center justify-between gap-2">
          <span className="font-label text-xs font-bold text-on-surface-variant">{count} selected</span>
          <button onClick={onClear} className="rounded-full bg-surface-container-high px-3 py-2 min-h-9 font-label text-xs">Clear</button>
        </div>
        <div className="flex flex-wrap gap-1.5">{actions}</div>
        {note ?? null}
      </div>
    </div>
  );
}
