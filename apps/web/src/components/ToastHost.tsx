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
      const titleEl = document.createElement("div");
      titleEl.className = "font-label text-sm font-semibold text-on-surface";
      titleEl.textContent = title;
      const bodyEl = document.createElement("div");
      bodyEl.className = "text-xs text-on-surface-variant line-clamp-2";
      bodyEl.textContent = body;
      el.appendChild(titleEl);
      el.appendChild(bodyEl);
      containerRef.current?.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    };
    window.addEventListener("nicotineHub:toast", handler as EventListener);
    return () => window.removeEventListener("nicotineHub:toast", handler as EventListener);
  }, []);

  return <div ref={containerRef} className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col items-end md:bottom-4" aria-live="polite" />;
}
