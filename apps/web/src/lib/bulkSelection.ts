"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function rangeSlice(allIds: string[], anchor: string | null, target: string, cap = 50): string[] {
  if (!anchor || !allIds.includes(anchor) || !allIds.includes(target)) return [target];
  const a = allIds.indexOf(anchor);
  const b = allIds.indexOf(target);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return allIds.slice(lo, hi + 1);
}

export function useBulkSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastAnchor, setLastAnchor] = useState<string | null>(null);

  const toggle = useCallback((id: string, allIds?: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastAnchor(id);
  }, []);

  const toggleRange = useCallback((id: string, allIds: string[]) => {
    if (!lastAnchor || !allIds.includes(lastAnchor) || !allIds.includes(id)) {
      toggle(id);
      return;
    }
    const slice = rangeSlice(allIds, lastAnchor, id);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const x of slice) next.add(x);
      return next;
    });
    setLastAnchor(id);
  }, [lastAnchor, toggle]);

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
    setLastAnchor(ids[ids.length - 1] ?? null);
  }, []);

  const setSelection = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
    setLastAnchor(ids[ids.length - 1] ?? null);
  }, []);

  const clear = useCallback(() => { setSelected(new Set()); setLastAnchor(null); }, []);
  const remove = useCallback((id: string) => setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; }), []);
  const has = useCallback((id: string) => selected.has(id), [selected]);

  return { selected, toggle, toggleRange, selectAll, setSelection, clear, remove, has, size: selected.size, lastAnchor };
}

export function useMarqueeSelection(onSelect: (ids: string[]) => void) {
  const elements = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const start = drag.current;
      if (!start) return;
      if (!start.active && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      start.active = true;
      const left = Math.min(start.x, e.clientX), right = Math.max(start.x, e.clientX);
      const top = Math.min(start.y, e.clientY), bottom = Math.max(start.y, e.clientY);
      const selected: string[] = [];
      elements.current.forEach((el, id) => {
        const rect = el.getBoundingClientRect();
        if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) selected.push(id);
      });
      onSelectRef.current(selected);
      document.body.style.userSelect = "none";
    };
    const up = () => {
      if (drag.current?.active) {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
      drag.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
    };
  }, []);

  return useCallback((id: string) => ({
    ref: (el: HTMLElement | null) => { if (el) elements.current.set(id, el); else elements.current.delete(id); },
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) drag.current = { x: e.clientX, y: e.clientY, active: false };
    },
    onClick: (e: React.MouseEvent) => {
      if (suppressClick.current) { e.preventDefault(); suppressClick.current = false; }
    },
  }), []);
}

export function naturalSortKey(name: string): [number, string] | [number, number, string] {
  const m = name.match(/^(\d+)/);
  if (m) return [0, parseInt(m[1], 10), name.toLowerCase()];
  return [1, name.toLowerCase()] as unknown as [number, string];
}
