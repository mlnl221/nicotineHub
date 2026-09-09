"use client";

import { useState } from "react";
import { scrapeTags, type ScrapeTrack } from "@/lib/worker";
import { useConfig } from "@/lib/config/provider";
import { isDemo } from "@/lib/demo";

type Props = {
  open: boolean;
  files: string[];
  onClose: () => void;
  onRenamed?: (newPaths: string[]) => void;
};

// natural sort: numeric prefix then lexicographic (positional match order)
function naturalSortFiles(list: string[]): string[] {
  return [...list].sort((a, b) => {
    const an = a.split("/").pop()?.split("\\").pop() || a;
    const bn = b.split("/").pop()?.split("\\").pop() || b;
    const am = an.match(/^(\d+)/);
    const bm = bn.match(/^(\d+)/);
    if (am && bm) return parseInt(am[1], 10) - parseInt(bm[1], 10);
    if (am) return -1;
    if (bm) return 1;
    return an.toLowerCase().localeCompare(bn.toLowerCase());
  });
}

export function BulkScrapeModal({ open, files, onClose, onRenamed }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<null | { artist: string; album: string; year: string | number | null; source: string; track_count: number | null; tracklist: ScrapeTrack[] | null }>(null);
  const [trackMap, setTrackMap] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const { settings } = useConfig();
  const autoRenameEnabled = !!(settings as unknown as { transfers?: { auto_rename_enabled?: boolean } }).transfers?.auto_rename_enabled;
  const renameTemplate = (settings as unknown as { transfers?: { rename_template?: string } }).transfers?.rename_template || "{track}. {artist} - {title}";

  if (!open) return null;

  const handlePreview = async () => {
    const u = url.trim();
    if (!u) { setError("Enter URL"); return; }
    if (files.length === 0) { setError("No files selected"); return; }
    setLoading(true);
    setError(null);
    setPreview(null);
    setDone(null);
    try {
      // Use first file as representative for preview (worker tag/scrape needs fileName)
      const r = await scrapeTags(files[0], u, false);
      const list = r.tracklist ?? null;
      setPreview({ artist: r.artist, album: r.album, year: r.year, source: r.source, track_count: r.track_count, tracklist: list });
      // Default map: positional (file i → track i), clamped into range
      if (list?.length) {
        const init: Record<string, number> = {};
        naturalSortFiles(files).forEach((f, i) => { init[f] = Math.min(i, list.length - 1); });
        setTrackMap(init);
      } else {
        setTrackMap({});
      }
      if (r.track_count && Math.abs(r.track_count - files.length) > 1) {
        setError(`Warning: track count ${r.track_count} differs from selected ${files.length} (tolerance ±1). Apply will still set uniform album/artist.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const u = url.trim();
    if (!u) { setError("Enter URL"); return; }
    setApplying(true);
    setError(null);
    setDone(null);
    try {
      let ok = 0;
      let renamed = 0;
      let skipped = 0;
      const newPaths: string[] = [];
      const renameOpt = autoRenameEnabled ? { enabled: true, template: renameTemplate } : undefined;
      const listLen = preview?.tracklist?.length ?? 0;
      for (const f of files.slice(0, 50)) {
        const ti = listLen ? Math.min(trackMap[f] ?? 0, listLen - 1) : undefined;
        const r = await scrapeTags(f, u, true, renameOpt, ti);
        if (r.applied) ok++;
        if (r.rename?.renamed) {
          renamed++;
          if (r.newPath) newPaths.push(r.newPath);
          else if (r.rename.newPath) newPaths.push(r.rename.newPath);
        } else if (r.rename?.skipped) {
          skipped++;
        }
      }
      const isDemoDir = isDemo && files.some((f) => f.includes("Waves") || f.includes("Kernkraft"));
      const parts = [`Applied to ${ok}/${files.length} files: ${preview?.artist ?? ""} — ${preview?.album ?? ""}${isDemoDir ? " (demo — not saved)" : ""}`];
      if (autoRenameEnabled) {
        parts.push(`Renamed ${renamed}${skipped ? `, skipped ${skipped} (missing tags)` : ""} using ${renameTemplate}`);
      }
      setDone(parts.join(" · "));
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: isDemoDir ? "Scrape preview (demo)" : "Scrape applied", body: `${ok} files${isDemoDir ? " (demo — not saved)" : ""}${renamed ? `, ${renamed} renamed` : ""}` } }));
      if (newPaths.length && onRenamed) onRenamed(newPaths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const sorted = naturalSortFiles(files);

  const autoMapInOrder = () => {
    const list = preview?.tracklist;
    if (!list?.length) return;
    const init: Record<string, number> = {};
    sorted.forEach((f, i) => { init[f] = Math.min(i, list.length - 1); });
    setTrackMap(init);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-[720px] max-h-[92dvh] flex flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface-container-lowest shadow-xl ghost-border" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-outline-variant/10 shrink-0">
          <div className="flex justify-between gap-3">
            <div>
              <h2 className="font-headline text-lg font-bold">Bulk Scrape (1 URL)</h2>
              <p className="font-mono text-xs text-outline">{files.length} files → one release URL (one directory = one release, positional match ±1)</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-full bg-surface-container-high flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">close</span></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-4 min-h-0">
          {error ? <div className="rounded-xl bg-error-container/50 px-4 py-3 font-body text-xs text-on-error-container">{error}</div> : null}
          {done ? <div className="rounded-xl bg-green-100 dark:bg-green-900/30 px-4 py-3 font-body text-xs text-green-800 dark:text-green-200">{done}</div> : null}
          <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-3">
            <label className="font-label text-xs font-semibold">Release URL (Discogs/Bandcamp/MusicBrainz/Deezer/Beatport/Apple/Qobuz/Tidal) — 1 URL only</label>
            {isDemo && files.some((f) => f.includes("Waves") || f.includes("Kernkraft")) ? (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-3 py-2 space-y-1 ghost-border">
                <div className="font-label text-[11px] font-semibold text-amber-900 dark:text-amber-200">Demo — try: <span className="font-mono break-all">https://www.discogs.com/release/3681871-DJ-Satomi-Waves</span> (Waves) or <span className="font-mono break-all">https://www.discogs.com/release/131668-Zombie-Nation-Kernkraft-400</span> (Kernkraft) — offline mock, not saved.</div>
              </div>
            ) : null}
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.discogs.com/release/..." className="w-full rounded-xl bg-surface-container-lowest px-3 py-2.5 min-h-11 font-body text-sm ghost-border outline-none" />
            <div className="flex gap-2">
              <button disabled={loading || !url.trim()} onClick={handlePreview} className="flex-1 rounded-xl bg-surface-container-high px-4 py-2 font-label text-xs font-semibold disabled:opacity-40">{loading ? "Fetching…" : "Preview"}</button>
              <button disabled={loading || applying || !url.trim() || !preview} onClick={handleApply} className="flex-1 rounded-xl bg-primary px-4 py-2 font-label text-xs font-bold text-on-primary disabled:opacity-40">{applying ? "Applying…" : "Apply to all"}</button>
            </div>
            {preview ? <div className="rounded-xl bg-surface-container-lowest p-3 ghost-border font-body text-xs"><div><span className="font-semibold">Found:</span> {preview.source} — {preview.artist} — {preview.album} ({preview.year ?? "?"}) · tracks {preview.track_count ?? "?"}</div><div className="font-mono text-[10px] text-outline">Positional match (natural sort) — files sorted by numeric prefix then lexicographic.</div></div> : null}
            {autoRenameEnabled ? <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-3 py-2 font-body text-xs text-amber-900 dark:text-amber-200">Auto-rename enabled: <span className="font-mono">{renameTemplate}</span> — files will be renamed after tags are written. Manage in Settings → Shares.</div> : null}
          </div>
          <div className="rounded-xl bg-surface-container-low p-3 ghost-border space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-label text-xs font-semibold uppercase tracking-widest">Files → track map</h4>
              {preview?.tracklist?.length ? <button onClick={autoMapInOrder} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-[11px] font-semibold">Auto-map in order</button> : null}
            </div>
            <div className="max-h-[28vh] overflow-auto space-y-1 pr-1">
              {sorted.map((f, i) => (
                <div key={f} className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-3 py-2">
                  <span className="font-mono text-[10px] text-outline w-6 shrink-0">{i + 1}</span>
                  <span className="font-mono text-xs truncate flex-1" title={f}>{f.split("/").pop()?.split("\\").pop() || f}</span>
                  {preview?.tracklist?.length ? (
                    <select
                      aria-label={`Track for ${f.split("/").pop()}`}
                      value={Math.min(trackMap[f] ?? Math.min(i, preview.tracklist.length - 1), preview.tracklist.length - 1)}
                      onChange={(e) => setTrackMap((m) => ({ ...m, [f]: parseInt(e.target.value, 10) }))}
                      className="min-h-9 max-w-[45%] rounded-lg bg-surface-container-high px-2 py-1.5 font-body text-xs outline-none"
                    >
                      {preview.tracklist.map((t, ti) => (
                        <option key={ti} value={ti}>{t.pos ? `${t.pos} — ` : `#${ti + 1} — `}{t.title || "(untitled)"}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="font-body text-[11px] text-outline">{preview?.tracklist?.length ? "Each file maps to one release track (title/artist/tracknumber); album/artist/year apply to all." : "Preview a release URL to map each file to its track."}</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline-variant/10 bg-surface-container-low/60 flex justify-between gap-3 shrink-0">
          <button onClick={onClose} className="rounded-full bg-surface-container-high px-5 py-2.5 font-label text-xs font-semibold">Close</button>
          <span className="font-mono text-[10px] text-outline self-center">1 URL at a time (spec 4.2)</span>
        </div>
      </div>
    </div>
  );
}
