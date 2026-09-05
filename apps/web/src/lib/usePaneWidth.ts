"use client";

import { useCallback, useEffect, useState } from "react";
import { getLocal, setLocal } from "./storage";

export function usePaneWidth(key: string, fallback = 320, min = 240, max = 640) {
  const [w, setW] = useState<number>(() => {
    try {
      const raw = getLocal(key);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    } catch { return fallback; }
  });
  useEffect(() => { try { setLocal(key, String(w)); } catch {} }, [key, w]);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = w;
    const target = e.currentTarget as HTMLElement;
    try { (target as unknown as { setPointerCapture: (id:number)=>void }).setPointerCapture(e.pointerId); } catch {}
    const onMove = (ev: PointerEvent) => setW(Math.min(max, Math.max(min, startW + ev.clientX - startX)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [w, min, max]);
  return [w, onPointerDown] as const;
}
