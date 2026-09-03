"use client";

import { useCallback, useState } from "react";

export function useBulkSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastAnchor, setLastAnchor] = useState<string | null>(null);

  const toggle = useCallback((id: string, allIds?: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 50) {
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Selection limit", body: "Maximum 50 files can be selected for bulk operations." } }));
          return prev;
        }
        next.add(id);
      }
      return next;
    });
    setLastAnchor(id);
  }, []);

  const toggleRange = useCallback((id: string, allIds: string[]) => {
    if (!lastAnchor || !allIds.includes(lastAnchor) || !allIds.includes(id)) {
      toggle(id);
      return;
    }
    const a = allIds.indexOf(lastAnchor);
    const b = allIds.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const slice = allIds.slice(lo, hi + 1);
    setSelected((prev) => {
      const next = new Set(prev);
      let added = 0;
      for (const x of slice) {
        if (!next.has(x)) {
          if (next.size + added >= 50) {
            if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Selection limit", body: "Maximum 50 files — first 50 selected." } }));
            break;
          }
          next.add(x);
          added++;
        }
      }
      return next;
    });
    setLastAnchor(id);
  }, [lastAnchor, toggle]);

  const selectAll = useCallback((ids: string[]) => {
    const cap = ids.slice(0, 50);
    if (ids.length > 50 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Selection limit", body: "Maximum 50 files — first 50 selected." } }));
    setSelected(new Set(cap));
    setLastAnchor(cap[cap.length - 1] ?? null);
  }, []);

  const clear = useCallback(() => { setSelected(new Set()); setLastAnchor(null); }, []);
  const remove = useCallback((id: string) => setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; }), []);
  const has = useCallback((id: string) => selected.has(id), [selected]);

  return { selected, toggle, toggleRange, selectAll, clear, remove, has, size: selected.size, lastAnchor };
}

export function naturalSortKey(name: string): [number, string] | [number, number, string] {
  const m = name.match(/^(\d+)/);
  if (m) return [0, parseInt(m[1], 10), name.toLowerCase()];
  return [1, name.toLowerCase()] as unknown as [number, string];
}
