"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { renameFile } from "@/lib/worker";

type Props = {
  filePath: string;
  onClose: () => void;
  onRenamed: (newPath: string) => void;
};

function basename(p: string) {
  return p.split("/").pop() ?? p;
}

export function RenameModal({ filePath, onClose, onRenamed }: Props) {
  const initial = basename(filePath);
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(initial), [initial]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name cannot be empty"); return; }
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\x00")) {
      setError("Name cannot contain / or \\");
      return;
    }
    if (trimmed === initial) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await renameFile(filePath, trimmed);
      onRenamed(res.newPath);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface-container-lowest shadow-[0_24px_48px_rgba(0,0,0,0.16)] ghost-border" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rename file">
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-headline text-base font-bold tracking-tight">Rename file</h2>
            <p className="mt-0.5 truncate font-mono text-[11px] text-on-surface-variant" title={filePath}>{filePath}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-high hover:bg-surface-container-highest">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">New name (basename, extension kept if you omit it will keep original — enter full name)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
            autoFocus
            className="w-full rounded-xl bg-surface-container-lowest px-4 py-3 font-mono text-sm ghost-border outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            spellCheck={false}
          />
          {error ? <div className="rounded-xl bg-error-container/50 px-3 py-2 font-body text-xs text-on-error-container">{error}</div> : null}
          <p className="font-body text-[11px] leading-relaxed text-on-surface-variant">Files only. Invalid names (blank, / or \) are rejected. Collisions get auto-suffix (2), (3)… like downloads.</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-outline-variant/10 bg-surface-container-low px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-full bg-surface-container-high px-5 py-2.5 font-label text-xs font-semibold">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || !name.trim() || name.trim() === initial} className="rounded-full bg-gradient-to-r from-primary to-primary-container px-6 py-2.5 font-label text-xs font-bold uppercase tracking-widest text-on-primary hover:opacity-90 disabled:opacity-50">
            {saving ? "Renaming…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
