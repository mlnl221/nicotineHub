"use client";

import { useEffect, useRef, useState } from "react";
import type { FilterState } from "@/lib/protocol";

interface FilterBarProps {
  filters: FilterState;
  onChange: (partial: Partial<FilterState>) => void;
  onClear: () => void;
}

const FIELDS: Array<{ key: keyof FilterState; label: string; placeholder: string }> = [
  { key: "include", label: "Include text", placeholder: "regex, e.g. live" },
  { key: "exclude", label: "Exclude text", placeholder: "regex, e.g. live" },
  { key: "fileType", label: "File type", placeholder: "flac wav | !mp3" },
  { key: "size", label: "File size", placeholder: ">10.5m <1g" },
  { key: "bitrate", label: "Bitrate", placeholder: "256 <1412" },
  { key: "length", label: "Duration", placeholder: ">6:00 <12:00" },
  { key: "country", label: "Country code", placeholder: "US ES | !DE" },
  { key: "quality", label: "Quality", placeholder: "lossless | 320 | hi-res | !transcode" },
];

export function FilterBar({ filters, onChange, onClear }: FilterBarProps) {
  // local debounced text state 150ms — checkboxes bypass debounce
  const [local, setLocal] = useState<FilterState>(filters);
  useEffect(() => setLocal(filters), [filters]);
  const diffText = (from: FilterState, to: FilterState): Partial<FilterState> | null => {
    const diff: Partial<FilterState> = {};
    let changed = false;
    for (const k of Object.keys(to) as Array<keyof FilterState>) {
      if (k === "freeSlot" || k === "publicOnly") continue;
      if (to[k] !== from[k]) { (diff as Record<string, unknown>)[k] = to[k]; changed = true; }
    }
    return changed ? diff : null;
  };
  useEffect(() => {
    const t = setTimeout(() => {
      const diff = diffText(filters, local);
      if (diff) onChange(diff);
    }, 150);
    return () => clearTimeout(t);
  }, [local, filters, onChange]);
  // Flush pending keystrokes on unmount: typing then hitting Search (or
  // switching tabs) inside the debounce window remounts the bar via key and
  // would otherwise drop the text. No-op when nothing is pending.
  const latest = useRef({ local, filters, onChange });
  latest.current = { local, filters, onChange };
  useEffect(() => () => {
    const s = latest.current;
    const diff = diffText(s.filters, s.local);
    if (diff) s.onChange(diff);
  }, []);

  return (
    <div className="border-b border-outline-variant/30 bg-surface-container px-4 py-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key as string} className="flex flex-col gap-1">
            <span className="font-label text-xs tracking-wide text-on-surface-variant">{f.label}</span>
            <input
              value={local[f.key] as string}
              onChange={(e) => setLocal((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="rounded-xl bg-surface-container-lowest px-3 py-2.5 min-h-11 font-body text-base text-on-surface ghost-border transition-all focus:border-primary focus:outline-none md:text-sm"
            />
          </label>
        ))}

        <label className="flex items-center justify-between rounded-xl bg-surface-container-lowest px-3 py-3 min-h-11 ghost-border">
          <span className="font-label text-xs tracking-wide text-on-surface-variant">Free slot only</span>
          <input
            type="checkbox"
            checked={filters.freeSlot}
            onChange={(e) => onChange({ freeSlot: e.target.checked })}
            className="h-6 w-6 accent-[#094cb2] shrink-0"
          />
        </label>

        <label className="flex items-center justify-between rounded-xl bg-surface-container-lowest px-3 py-3 min-h-11 ghost-border">
          <span className="font-label text-xs tracking-wide text-on-surface-variant">Public files only</span>
          <input
            type="checkbox"
            checked={filters.publicOnly}
            onChange={(e) => onChange({ publicOnly: e.target.checked })}
            className="h-6 w-6 accent-[#094cb2] shrink-0"
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-4 py-2.5 min-h-9 font-label text-xs text-on-surface-variant transition-colors hover:text-primary"
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}
