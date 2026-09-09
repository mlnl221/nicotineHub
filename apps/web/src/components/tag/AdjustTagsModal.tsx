"use client";

import { useEffect, useState } from "react";
import { bulkReadTags, coverArt, scrapeTags, type TagScrapeResult } from "@/lib/worker";
import { useConfig } from "@/lib/config/provider";

type Props = {
  open: boolean;
  files: string[];
  onClose: () => void;
  onRenamed?: (newPaths: string[]) => void;
};

function naturalSortFiles(list: string[]): string[] {
  return [...list].sort((a, b) => {
    const an = a.split("/").pop()?.split("\\").pop() || a;
    const bn = b.split("/").pop()?.split("\\").pop() || b;
    const am = an.match(/^(\d+)/);
    const bm = bn.match(/^(\d+)/);
    const ai = am ? parseInt(am[1], 10) : NaN;
    const bi = bm ? parseInt(bm[1], 10) : NaN;
    const aNum = Number.isNaN(ai) ? null : ai;
    const bNum = Number.isNaN(bi) ? null : bi;
    if (aNum !== null && bNum !== null) return aNum - bNum;
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    return an.toLowerCase().localeCompare(bn.toLowerCase());
  });
}

function basename(p: string): string {
  return p.split("/").pop()?.split("\\").pop() || p;
}

function formatDur(sec: number | null): string {
  if (sec === null || Number.isNaN(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function extractSeconds(info?: Record<string, unknown>, tags?: Record<string, string>): number | null {
  const cands: unknown[] = [];
  if (info) cands.push(info.duration, info.duration_sec, info.durationSec, info.length, info.length_seconds, info.seconds, info.playtime);
  if (tags) {
    for (const k of Object.keys(tags)) {
      const lk = k.toLowerCase();
      if (lk === "duration" || lk === "length" || lk === "tlen" || lk === "duration_sec") cands.push(tags[k]);
    }
  }
  for (const c of cands) {
    if (c === null || c === undefined) continue;
    if (typeof c === "number" && !Number.isNaN(c)) {
      const v = c > 10000 ? c / 1000 : c;
      return v;
    }
    if (typeof c === "string") {
      const t = c.trim();
      if (!t) continue;
      const mm = t.match(/^(\d+):(\d{1,2})(?:\.\d+)?$/);
      if (mm) {
        const m = parseInt(mm[1], 10);
        const s = parseInt(mm[2], 10);
        if (Number.isNaN(m) || Number.isNaN(s)) continue;
        return m * 60 + s;
      }
      const f = parseFloat(t);
      if (Number.isNaN(f)) continue;
      return f > 10000 ? f / 1000 : f;
    }
  }
  return null;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function AdjustTagsModal({ open, files, onClose, onRenamed }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<TagScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [saveCover, setSaveCover] = useState(true);
  const [order, setOrder] = useState<string[]>(() => naturalSortFiles(files.slice(0, 50)));
  const [selected, setSelected] = useState(0);
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const { settings } = useConfig();
  const autoRenameEnabled = !!(settings as unknown as { transfers?: { auto_rename_enabled?: boolean } }).transfers?.auto_rename_enabled;
  const renameTemplate = (settings as unknown as { transfers?: { rename_template?: string } }).transfers?.rename_template || "{track}. {artist} - {title}";

  useEffect(() => {
    if (!open) return;
    setOrder(naturalSortFiles(files.slice(0, 50)));
    setSelected(0);
    setDragIdx(null);
  }, [open, files]);

  useEffect(() => {
    if (!open || files.length === 0) return;
    let live = true;
    (async () => {
      try {
        const r = await bulkReadTags(files.slice(0, 50));
        if (!live) return;
        const map: Record<string, string> = {};
        for (const e of r.results) {
          map[e.fileName] = formatDur(extractSeconds(e.info as Record<string, unknown> | undefined, e.tags));
        }
        setDurations(map);
      } catch {
        if (!live) return;
        setDurations({});
      }
    })();
    return () => { live = false; };
  }, [open, files]);

  if (!open) return null;

  const tracks = preview?.tracklist ?? [];
  const capped = order.slice(0, 50);
  const mappedCount = Math.min(capped.length, tracks.length);
  const missing = Math.max(0, tracks.length - capped.length);
  const extra = Math.max(0, capped.length - tracks.length);
  const overflow = extra ? capped.slice(tracks.length) : [];
  const selFile = capped[selected] ?? null;
  const selTrack = selFile !== null && selected < tracks.length ? tracks[selected] : null;

  const src = (preview as unknown as { source?: string } | null)?.source;
  const toList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === "" ? [] : [String(v)]);
  const yearStr = preview?.year === null || preview?.year === undefined ? "" : (String(preview.year).match(/^\d{4}/)?.[0] ?? String(preview.year));
  const albumRows: Array<[string, string]> = preview ? [
    ["ALBUM", preview.album || ""],
    ["ARTIST", preview.artist || ""],
    ["CATALOGNUMBER", preview.catalog_no || ""],
    ["COUNTRY", preview.country || ""],
    [src ? `${src.toUpperCase()}_RELEASE_ID` : "RELEASE_ID", preview.release_id === undefined || preview.release_id === null ? "" : String(preview.release_id)],
    ["GENRE", toList((preview as unknown as { genre?: unknown }).genre).join(", ")],
    ["MEDIATYPE", preview.media_type || ""],
    ["PUBLISHER", preview.label || ""],
    ["STYLE", toList((preview as unknown as { style?: unknown }).style).join(", ")],
    ["WWW", preview.url || ""],
    ["YEAR", yearStr],
  ].filter((r): r is [string, string] => !!r[1]) : [];

  const handlePreview = async () => {
    const u = url.trim();
    if (!u) { setError("Enter URL"); return; }
    if (files.length === 0) { setError("No files selected"); return; }
    setLoading(true);
    setError(null);
    setPreview(null);
    setDone(null);
    try {
      const r = await scrapeTags(files[0], u, false);
      setPreview(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const u = url.trim();
    if (!u) { setError("Enter URL"); return; }
    if (!preview) { setError("Preview first"); return; }
    if (tracks.length > 0 && mappedCount === 0) { setError("Preview first"); return; }
    setApplying(true);
    setError(null);
    setDone(null);
    try {
      let ok = 0;
      let coverFailed = 0;
      const newPaths: string[] = [];
      const renameOpt = autoRenameEnabled ? { enabled: true, template: renameTemplate } : undefined;
      const hasCover = !!(saveCover && preview.cover_url);
      if (tracks.length === 0) {
        for (const f of capped) {
          const r = await scrapeTags(f, u, true, renameOpt, undefined);
          if (r.applied) ok++;
          if (hasCover) {
            try { await coverArt(f, u); } catch { coverFailed++; }
          }
          if (r.rename?.renamed) {
            if (r.newPath) newPaths.push(r.newPath);
            else if (r.rename.newPath) newPaths.push(r.rename.newPath);
          }
        }
        setDone(`Applied ${ok}, skipped 0 unmapped. No per-track data for this source — album tags only${coverFailed > 0 ? `, cover failed ${coverFailed}` : ""}`);
        if (newPaths.length && onRenamed) onRenamed(newPaths);
        return;
      }
      for (let i = 0; i < mappedCount; i++) {
        const f = capped[i];
        const r = await scrapeTags(f, u, true, renameOpt, i);
        if (r.applied) ok++;
        if (hasCover) {
          try { await coverArt(f, u); } catch { coverFailed++; }
        }
        if (r.rename?.renamed) {
          if (r.newPath) newPaths.push(r.newPath);
          else if (r.rename.newPath) newPaths.push(r.rename.newPath);
        }
      }
      const skipped = Math.abs(capped.length - tracks.length);
      setDone(`Applied ${ok}, skipped ${skipped} unmapped${coverFailed > 0 ? `, cover failed ${coverFailed}` : ""}`);
      if (newPaths.length && onRenamed) onRenamed(newPaths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const moveSelected = (dir: -1 | 1) => {
    setOrder((prev) => {
      const j = Math.max(0, Math.min(selected, prev.length - 1));
      const k = j + dir;
      if (k < 0 || k >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[j];
      next[j] = next[k];
      next[k] = tmp;
      return next;
    });
    setSelected((s) => Math.max(0, Math.min(capped.length - 1, s + dir)));
  };

  const dropAt = (target: number) => {
    if (dragIdx === null || dragIdx === target) return;
    setOrder((prev) => {
      if (dragIdx < 0 || dragIdx >= prev.length || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [mv] = next.splice(dragIdx, 1);
      next.splice(target, 0, mv);
      return next;
    });
    setSelected(target);
    setDragIdx(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-[960px] max-h-[92dvh] flex flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface-container-lowest shadow-xl ghost-border" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-outline-variant/10 shrink-0">
          <div className="flex justify-between gap-3">
            <div>
              <h2 className="font-headline text-lg font-bold">Adjust tag information</h2>
              <p className="font-mono text-xs text-outline">{capped.length} files → positional mapping (reorder to match)</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-full bg-surface-container-high flex items-center justify-center min-h-9 min-w-9"><span className="material-symbols-outlined text-[18px]">close</span></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-4 min-h-0">
          {error ? <div className="rounded-xl bg-error-container/50 px-4 py-3 font-body text-xs text-on-error-container">{error}</div> : null}
          {done ? <div className="rounded-xl bg-green-100 dark:bg-green-900/30 px-4 py-3 font-body text-xs text-green-800 dark:text-green-200">{done}</div> : null}
          <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-3">
            <label className="font-label text-xs font-semibold">Release URL (Discogs/Bandcamp/MusicBrainz/Deezer/Beatport/Apple/Qobuz/Tidal)</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.discogs.com/release/..." className="w-full rounded-xl bg-surface-container-lowest px-3 py-2.5 min-h-11 font-body text-sm ghost-border outline-none" />
            <div className="flex gap-2">
              <button disabled={loading || !url.trim()} onClick={handlePreview} className="flex-1 rounded-xl bg-surface-container-high px-4 py-2 min-h-9 font-label text-xs font-semibold disabled:opacity-40">{loading ? "Fetching…" : "Preview"}</button>
            </div>
            {autoRenameEnabled ? <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-3 py-2 font-body text-xs text-amber-900 dark:text-amber-200">Auto-rename enabled: <span className="font-mono">{renameTemplate}</span></div> : null}
          </div>
          {preview && tracks.length > 0 && (missing > 0 || extra > 0) ? (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-4 py-3 font-body text-xs text-amber-900 dark:text-amber-200 ghost-border">
              {missing > 0 ? `${missing} files short of ${tracks.length} tracks` : `${extra} extra file${extra === 1 ? "" : "s"}`}
            </div>
          ) : null}
          {preview ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl bg-surface-container-low p-3 ghost-border space-y-1">
                  <h4 className="font-label text-xs font-semibold uppercase tracking-widest">Selected track</h4>
                  {selTrack ? (
                    <div className="font-body text-xs space-y-1">
                      <div><span className="font-mono text-[10px] text-outline">TRACK </span>{selTrack.pos || "—"}</div>
                      <div><span className="font-mono text-[10px] text-outline">TITLE </span>{selTrack.title || "—"}</div>
                      <div><span className="font-mono text-[10px] text-outline">ARTIST </span>{selTrack.artist || "—"}</div>
                      <div><span className="font-mono text-[10px] text-outline">LENGTH </span>{selTrack.duration ? formatDur(extractSeconds({ duration: selTrack.duration })) : "—"}</div>
                    </div>
                  ) : <div className="font-body text-xs text-outline">— no file —</div>}
                </div>
                <div className="rounded-xl bg-surface-container-low p-3 ghost-border space-y-1">
                  <h4 className="font-label text-xs font-semibold uppercase tracking-widest">Album</h4>
                  <div className="space-y-1">
                    {albumRows.map(([k, v]) => (
                      <div key={k} className="flex gap-2 font-body text-xs">
                        <span className="font-mono text-[10px] text-outline w-28 shrink-0 pt-0.5">{k}</span>
                        <span className="truncate" title={v}>{k === "WWW" ? <a href={v} target="_blank" rel="noreferrer" className="underline break-all">{v}</a> : v}</span>
                      </div>
                    ))}
                  </div>
                  {preview.url ? <a href={preview.url} target="_blank" rel="noreferrer" className="font-mono text-[10px] underline break-all">{preview.url}</a> : null}
                </div>
                <div className="rounded-xl bg-surface-container-low p-3 ghost-border space-y-2">
                  <h4 className="font-label text-xs font-semibold uppercase tracking-widest">Cover</h4>
                  {preview.cover_url ? <img src={preview.cover_url} alt="cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} className="w-full max-h-48 object-contain rounded-lg bg-surface-container-lowest" /> : <div className="font-body text-xs text-outline">No cover</div>}
                  <label className="flex items-center gap-2 font-body text-xs min-h-9">
                    <input type="checkbox" checked={saveCover} onChange={(e) => setSaveCover(e.target.checked)} className="h-4 w-4" />
                    Save cover
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl bg-surface-container-low p-3 ghost-border space-y-2">
                  <h4 className="font-label text-xs font-semibold uppercase tracking-widest">{src ? cap(src) : "Release"} tracks</h4>
                  <div className="max-h-[30vh] overflow-auto space-y-1 pr-1">
                    {tracks.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-3 py-2 min-h-9">
                        <span className="font-mono text-[10px] text-outline w-10 shrink-0">{t.pos || `#${i + 1}`}</span>
                        <span className="font-body text-xs truncate flex-1" title={t.title}>{t.title || "(untitled)"}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-surface-container-low p-3 ghost-border space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-label text-xs font-semibold uppercase tracking-widest">Local files</h4>
                    <div className="flex gap-2">
                      <button onClick={() => moveSelected(-1)} className="rounded-full bg-surface-container-high px-3 py-1.5 min-h-9 font-label text-[11px] font-semibold">Move up</button>
                      <button onClick={() => moveSelected(1)} className="rounded-full bg-surface-container-high px-3 py-1.5 min-h-9 font-label text-[11px] font-semibold">Move down</button>
                    </div>
                  </div>
                  <div className="max-h-[30vh] overflow-auto space-y-1 pr-1">
                    {capped.map((f, i) => (
                      <div
                        key={f}
                        draggable
                        onDragStart={() => setDragIdx(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => dropAt(i)}
                        onClick={() => setSelected(i)}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 min-h-9 cursor-move ${i === selected ? "bg-surface-container-high ghost-border" : "bg-surface-container-lowest"}`}
                      >
                        <span className="font-mono text-[10px] text-outline w-6 shrink-0">{i + 1}</span>
                        <span className="font-mono text-[10px] text-outline w-10 shrink-0">{durations[f] ?? "—"}</span>
                        <span className="font-mono text-xs truncate flex-1" title={f}>{basename(f)}</span>
                      </div>
                    ))}
                    {Array.from({ length: missing }).map((_, k) => (
                      <div key={`ph-${k}`} className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-3 py-2 min-h-9 opacity-60">
                        <span className="font-mono text-[10px] text-outline w-6 shrink-0">{capped.length + k + 1}</span>
                        <span className="font-body text-xs text-outline">— no file —</span>
                      </div>
                    ))}
                  </div>
                  {overflow.length > 0 ? (
                    <div className="space-y-1">
                      <h5 className="font-label text-[11px] font-semibold uppercase tracking-widest">Unmapped files</h5>
                      {overflow.map((f) => (
                        <div key={f} className="rounded-lg bg-surface-container-lowest px-3 py-2 min-h-9 font-mono text-xs truncate" title={f}>{basename(f)}</div>
                      ))}
                    </div>
                  ) : null}
                  <p className="font-body text-[11px] text-outline">Row i → track i. Click selects, drag or Move reorders.</p>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <div className="px-6 py-4 border-t border-outline-variant/10 bg-surface-container-low/60 flex justify-between gap-3 shrink-0">
          <button onClick={onClose} className="rounded-full bg-surface-container-high px-5 py-2.5 min-h-9 font-label text-xs font-semibold">Cancel</button>
          <button disabled={loading || applying || !preview || capped.length === 0} onClick={handleApply} className="rounded-full bg-primary px-5 py-2.5 min-h-9 font-label text-xs font-bold text-on-primary disabled:opacity-40">{applying ? "Applying…" : "OK"}</button>
        </div>
      </div>
    </div>
  );
}
