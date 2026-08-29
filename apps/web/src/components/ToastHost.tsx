"use client";
import { useEffect, useRef } from "react";

export function ToastHost() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ title: string; body: string }>;
      const { title, body } = ce.detail;
      const el = document.createElement("div");
      el.className = "pointer-events-auto mb-2 max-w-sm rounded-2xl bg-surface-container-high px-4 py-3 shadow-lg dark:bg-surface-container-high";
      el.innerHTML = `<div class="font-label text-sm font-semibold text-on-surface">${title}</div><div class="text-xs text-on-surface-variant line-clamp-2">${body}</div>`;
      containerRef.current?.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    };
    window.addEventListener("nicotine:toast", handler as EventListener);
    return () => window.removeEventListener("nicotine:toast", handler as EventListener);
  }, []);

  return <div ref={containerRef} className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col items-end md:bottom-4" aria-live="polite" />;
}
