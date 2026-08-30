"use client";

import { useEffect, useRef } from "react";
import { isDemo } from "@/lib/demo";

export function DemoBanner() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isDemo) return;
    const el = ref.current;
    if (!el) return;
    const set = () => {
      const h = el.offsetHeight;
      document.documentElement.dataset.demo = "true";
      document.documentElement.style.setProperty("--demo-banner-h", `${h}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    window.addEventListener("resize", set);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", set);
    };
  }, []);
  if (!isDemo) return null;
  return (
    <div
      ref={ref}
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-tertiary-fixed px-3 py-2 text-center text-on-tertiary-fixed shadow-sm">
      <span className="material-symbols-outlined text-[16px]">science</span>
      <span className="font-label text-xs font-semibold uppercase tracking-widest">
        Demo — 2 searches, 2 chats, 2 shares, 2 profiles, 2 buddies &amp; transfer preview mocked •{" "}
        <a href="https://github.com/mlnl221/nicotineHub" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">GitHub</a>
      </span>
    </div>
  );
}
