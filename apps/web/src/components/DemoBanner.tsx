"use client";

import { useEffect, useRef, useState } from "react";
import { isDemo } from "@/lib/demo";

const STORAGE_KEY = "nicotineHub.demoBannerDismissed";

export function DemoBanner() {
  const ref = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "0") setDismissed(false);
      else setDismissed(true);
    } catch {
      setDismissed(true);
    }
  }, []);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const upd = () => setIsMobile(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  useEffect(() => {
    if (!isDemo) return;
    const html = document.documentElement;
    if (dismissed) {
      html.style.setProperty("--demo-banner-h", "0px");
      return;
    }
    if (isMobile) {
      html.style.setProperty("--demo-banner-h", "0px");
      return;
    }
    const el = ref.current;
    if (!el) {
      html.dataset.demo = "true";
      html.style.setProperty("--demo-banner-h", "32px");
      return;
    }
    const set = () => {
      const h = el.offsetHeight;
      html.dataset.demo = "true";
      html.style.setProperty("--demo-banner-h", `${h}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    window.addEventListener("resize", set);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", set);
    };
  }, [dismissed, isMobile]);

  if (!isDemo) return null;
  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, "0");
          } catch {}
          setDismissed(false);
          if (!isMobile) document.documentElement.style.setProperty("--demo-banner-h", "32px");
        }}
        data-testid="demo-banner-restore"
        aria-label="Show demo banner"
        className="fixed bottom-[calc(76px+env(safe-area-inset-bottom,0px))] right-2 z-[60] flex items-center gap-1 rounded-full bg-tertiary-fixed px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-on-tertiary-fixed shadow-sm hover:brightness-95 md:bottom-auto md:top-2">
        <span className="material-symbols-outlined text-[14px]">science</span> Demo
      </button>
    );
  }
  if (isMobile) {
    return (
      <div
        ref={ref}
        data-demo-banner
        data-testid="demo-banner"
        className="fixed top-[calc(56px+env(safe-area-inset-top,0px)+8px)] left-2 right-2 z-[60] flex items-center justify-center gap-2 rounded-xl bg-tertiary-fixed px-3 py-2 pr-10 text-center text-on-tertiary-fixed shadow-lg md:hidden"
      >
        <span className="material-symbols-outlined text-[16px] shrink-0">science</span>
        <span className="font-label text-xs font-semibold uppercase tracking-widest">
          Demo — 2 searches, 2 chats, 2 shares, 2 profiles, 2 buddies &amp; transfer preview mocked •{" "}
          <a href="https://github.com/mlnl221/nicotineHub" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
            GitHub
          </a>
        </span>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, "1");
            } catch {}
            setDismissed(true);
            document.documentElement.style.setProperty("--demo-banner-h", "0px");
          }}
          data-testid="demo-banner-dismiss"
          aria-label="Dismiss demo banner"
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-on-tertiary-fixed hover:bg-black/10 active:scale-95"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      data-demo-banner
      data-testid="demo-banner"
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-tertiary-fixed px-3 py-2 pr-10 text-center text-on-tertiary-fixed shadow-sm md:pr-3">
      <span className="material-symbols-outlined text-[16px] shrink-0">science</span>
      <span className="font-label text-xs font-semibold uppercase tracking-widest">
        Demo — 2 searches, 2 chats, 2 shares, 2 profiles, 2 buddies &amp; transfer preview mocked •{" "}
        <a href="https://github.com/mlnl221/nicotineHub" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
          GitHub
        </a>
      </span>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, "1");
          } catch {}
          setDismissed(true);
          document.documentElement.style.setProperty("--demo-banner-h", "0px");
        }}
        data-testid="demo-banner-dismiss"
        aria-label="Dismiss demo banner"
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-on-tertiary-fixed hover:bg-black/10 active:scale-95 md:right-2">
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}
