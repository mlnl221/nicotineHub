"use client";

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12" aria-live="polite" aria-busy="true">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" style={{ animationDuration: "0.9s" }} />
        <span className="material-symbols-outlined text-2xl text-primary animate-pulse">hourglass_top</span>
      </div>
      <p className="font-label text-xs uppercase tracking-widest text-on-surface-variant animate-pulse">{label}</p>
      <div className="w-full max-w-sm space-y-2 pt-2">
        <div className="h-3 w-full animate-pulse rounded-full bg-surface-container-high" style={{ animationDelay: "0ms" }} />
        <div className="h-3 w-5/6 animate-pulse rounded-full bg-surface-container-high" style={{ animationDelay: "150ms" }} />
        <div className="h-3 w-4/6 animate-pulse rounded-full bg-surface-container-high" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

export function SectionLoader() {
  return (
    <div className="space-y-3 py-2" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-transparent border-t-primary border-r-primary/30" style={{ animationDuration: "0.8s" }} />
        <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant animate-pulse">Loading section…</span>
      </div>
      <div className="space-y-2 pt-1">
        <div className="h-4 w-3/4 animate-pulse rounded-lg bg-surface-container-high" />
        <div className="h-20 animate-pulse rounded-xl bg-surface-container-high" />
        <div className="h-12 animate-pulse rounded-xl bg-surface-container-high" style={{ animationDelay: "120ms" }} />
      </div>
    </div>
  );
}

export function TabSwitchLoader() {
  return (
    <div className="flex items-center justify-center gap-2 py-6" aria-live="polite" aria-busy="true">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-primary" style={{ animationDuration: "0.7s" }} />
      <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Switching…</span>
    </div>
  );
}
