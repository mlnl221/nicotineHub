"use client";

import { useSession } from "@/lib/session";

export function ReconnectBanner() {
  const { state } = useSession();
  const showReconnecting = !!state.reconnecting;
  const showError = !showReconnecting && state.status === "connected" && !!state.error;
  if (!showReconnecting && !showError) return null;
  if (showReconnecting) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Reconnecting"
        className="fixed inset-x-0 z-40 flex items-center justify-center gap-2 border-b border-amber-500/15 bg-amber-50/90 px-3 py-1.5 text-xs font-medium text-amber-900 backdrop-blur-sm dark:border-amber-400/15 dark:bg-amber-950/40 dark:text-amber-100"
        style={{ top: "calc(var(--demo-banner-h, 0px) + env(safe-area-inset-top, 0px))" }}
      >
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-700/30 border-t-amber-700 dark:border-amber-300/30 dark:border-t-amber-300" aria-hidden />
        <span>Reconnecting…</span>
        <span className="hidden sm:inline font-normal opacity-70">you can keep browsing</span>
      </div>
    );
  }
  // Background Soulseek/bridge reconnect failed — keep UI interactive, surface error subtly
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-40 flex items-center justify-center gap-2 border-b border-red-500/15 bg-red-50/90 px-3 py-1.5 text-xs font-medium text-red-900 backdrop-blur-sm dark:border-red-400/15 dark:bg-red-950/40 dark:text-red-100"
      style={{ top: "calc(var(--demo-banner-h, 0px) + env(safe-area-inset-top, 0px))" }}
    >
      <span className="material-symbols-outlined text-[14px]" aria-hidden>
        warning
      </span>
      <span className="truncate max-w-[60vw]">Reconnect failed: {state.error}</span>
    </div>
  );
}
