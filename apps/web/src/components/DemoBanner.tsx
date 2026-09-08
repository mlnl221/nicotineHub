"use client";

import { useEffect, useRef, useState } from "react";
import { isDemo } from "@/lib/demo";
import { getLocal, setLocal } from "@/lib/storage";

const STORAGE_KEY = "nicotineHub.demoBannerDismissed";
const POS_KEY = "nicotineHub.demoBannerPos";
const DRAG_THRESHOLD = 6;
const PAD = 8;

type XY = { x: number; y: number };

// Clamp candidate translate offset so el stays inside the viewport.
function clampOffset(el: HTMLElement, cur: XY, cand: XY): XY {
  const r = el.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minL = PAD;
  const maxL = vw - w - PAD;
  const minT = PAD;
  const maxT = vh - h - PAD;
  const left = Math.min(Math.max(r.left + (cand.x - cur.x), Math.min(minL, maxL)), Math.max(minL, maxL));
  const top = Math.min(Math.max(r.top + (cand.y - cur.y), Math.min(minT, maxT)), Math.max(minT, maxT));
  return { x: cur.x + (left - r.left), y: cur.y + (top - r.top) };
}

function readPos(): Partial<Record<"pill" | "banner", XY>> {
  try {
    const raw = getLocal(POS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<"pill" | "banner", XY>> = {};
    for (const k of ["pill", "banner"] as const) {
      const v = p[k] as XY | undefined;
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) out[k] = { x: v.x, y: v.y };
    }
    return out;
  } catch {
    return {};
  }
}

function useDraggable<T extends HTMLElement>(kind: "pill" | "banner") {
  const ref = useRef<T | null>(null);
  const [offset, setOffset] = useState<XY>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const cur = useRef<XY>({ x: 0, y: 0 });
  const moved = useRef(false);

  const apply = (next: XY) => {
    cur.current = next;
    setOffset(next);
  };

  const persist = () => {
    try {
      setLocal(POS_KEY, JSON.stringify({ ...readPos(), [kind]: cur.current }));
    } catch {}
  };

  // Load persisted pos after mount (SSR-safe: first paint matches SSR at 0,0).
  useEffect(() => {
    const el = ref.current;
    const saved = readPos()[kind];
    if (el && saved && (saved.x !== 0 || saved.y !== 0)) apply(clampOffset(el, cur.current, saved));
    const onResize = () => {
      const node = ref.current;
      if (node) {
        const clamped = clampOffset(node, cur.current, cur.current);
        cur.current = clamped;
        setOffset(clamped);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Banner links/close button keep working — drag starts from background only.
    if (kind === "banner" && (e.target as HTMLElement).closest("a,button")) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const startClient = { x: e.clientX, y: e.clientY };
    const startOff = { ...cur.current };
    moved.current = false;
    setDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    const onMove = (ev: PointerEvent) => {
      const cand = { x: startOff.x + ev.clientX - startClient.x, y: startOff.y + ev.clientY - startClient.y };
      if (Math.hypot(cand.x - startOff.x, cand.y - startOff.y) > DRAG_THRESHOLD) moved.current = true;
      const clamped = clampOffset(el, cur.current, cand);
      cur.current = clamped;
      setOffset(clamped);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(false);
      persist();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const reset = () => {
    cur.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
    persist();
  };

  const nudge = (dx: number, dy: number) => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampOffset(el, cur.current, { x: cur.current.x + dx, y: cur.current.y + dy });
    cur.current = clamped;
    setOffset(clamped);
    persist();
  };

  return { ref, offset, dragging, moved, onPointerDown, reset, nudge };
}

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(true);
  const pill = useDraggable<HTMLButtonElement>("pill");
  const banner = useDraggable<HTMLDivElement>("banner");

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) !== "0");
    } catch {
      setDismissed(true);
    }
  }, []);

  // Floating pill/banner occupy no layout flow — never push content.
  useEffect(() => {
    if (!isDemo) return;
    const html = document.documentElement;
    html.style.setProperty("--demo-banner-h", "0px");
    delete html.dataset.demo;
  }, [dismissed]);

  if (!isDemo) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setDismissed(true);
  };

  if (dismissed) {
    return (
      <button
        ref={pill.ref}
        type="button"
        onPointerDown={pill.onPointerDown}
        onDoubleClick={pill.reset}
        onKeyDown={(e) => {
          const s = 16;
          if (e.key === "ArrowUp") { e.preventDefault(); pill.nudge(0, -s); }
          else if (e.key === "ArrowDown") { e.preventDefault(); pill.nudge(0, s); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); pill.nudge(-s, 0); }
          else if (e.key === "ArrowRight") { e.preventDefault(); pill.nudge(s, 0); }
        }}
        onClick={() => {
          // Suppress restore click after a drag.
          if (pill.moved.current) {
            pill.moved.current = false;
            return;
          }
          try {
            localStorage.setItem(STORAGE_KEY, "0");
          } catch {}
          setDismissed(false);
        }}
        data-testid="demo-banner-restore"
        aria-label="Show demo banner"
        title="Drag to move • double-click to reset"
        style={{ transform: `translate(${pill.offset.x}px, ${pill.offset.y}px)` }}
        className={`fixed bottom-[calc(76px+env(safe-area-inset-bottom,0px))] right-2 z-[60] flex touch-none select-none items-center gap-1 rounded-full bg-tertiary-fixed px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-on-tertiary-fixed shadow-sm hover:brightness-95 md:bottom-auto md:top-2 ${pill.dragging ? "cursor-grabbing" : "cursor-move"}`}>
        <span className="material-symbols-outlined text-[14px]">science</span> Demo
      </button>
    );
  }

  return (
    <div
      ref={banner.ref}
      data-demo-banner
      data-testid="demo-banner"
      onPointerDown={banner.onPointerDown}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        banner.reset();
      }}
      title="Drag to move • double-click background to reset"
      style={{ transform: `translate(${banner.offset.x}px, ${banner.offset.y}px)` }}
      className={`fixed left-2 right-2 top-[calc(64px+env(safe-area-inset-top,0px))] z-[60] flex touch-none select-none items-center justify-center gap-2 rounded-xl bg-tertiary-fixed px-3 py-2 pr-10 text-center text-on-tertiary-fixed shadow-lg md:top-2 ${banner.dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <span className="material-symbols-outlined text-[16px] shrink-0">science</span>
      <span className="font-label text-xs font-semibold uppercase tracking-widest">
        Demo — 2 searches, 2 chats, 2 shares, 2 profiles, 2 buddies &amp; transfer preview mocked • 🔊 <a href="/files" className="underline hover:no-underline">/data/Music/Demo</a> playable (Waves / Kernkraft 400) — try Play / Analyze / Mediainfo / Spectrum / Scrape •{" "}
        <a href="https://github.com/mlnl221/nicotineHub" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
          GitHub
        </a>
      </span>
      <button
        type="button"
        onClick={dismiss}
        data-testid="demo-banner-dismiss"
        aria-label="Dismiss demo banner"
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-on-tertiary-fixed hover:bg-black/10 active:scale-95 md:right-2">
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}
