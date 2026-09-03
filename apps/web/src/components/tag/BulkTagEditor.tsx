"use client";

import { useEffect, useState } from "react";
import { bulkReadTags, writeTags } from "@/lib/worker";

type Props = {
  open: boolean;
  files: string[];
  onClose: () => void;
  onSaved?: () => void;
};

type PerFile = { fileName: string; title: string; artist: string; error?: string };

export function BulkTagEditor({ open, files, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perFile, setPerFile] = useState<PerFile[]>([]);
  const [uniform, setUniform] = useState<{ album: string; albumartist: string; genre: string; date: string; discnumber: string; comment: string }>({ album: "", albumartist: "", genre: "", date: "", discnumber: "", comment: "" });
  const [mixed, setMixed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open || !files.length) return;
    setLoading(true);
    setError(null);
    bulkReadTags(files.slice(0, 50))
      .then((res) => {
        const results = res.results;
        const pf: PerFile[] = [];
        const albumVals = new Set<string>();
        const aaVals = new Set<string>();
        const genreVals = new Set<string>();
        const dateVals = new Set<string>();
        const discVals = new Set<string>();
        const commentVals = new Set<string>();
        for (const r of results) {
          if (r.error) {
            pf.push({ fileName: r.fileName, title: "", artist: "", error: r.error });
            continue;
          }
          const t = r.tags || {};
          pf.push({ fileName: r.fileName, title: t.title || t.TIT2 || "", artist: t.artist || t.TPE1 || "" });
          albumVals.add(t.album || t.TALB || "");
          aaVals.add(t.albumartist || t.TPE2 || "");
          genreVals.add(t.genre || t.TCON || "");
          dateVals.add(t.date || t.year || t.TYER || "");
          discVals.add(t.discnumber || t.TPOS || "");
          commentVals.add(t.comment || "");
        }
        setPerFile(pf);
        const pick = (s: Set<string>) => s.size === 1 ? [...s][0] : "";
        const isMixed = (s: Set<string>) => s.size > 1;
        setUniform({ album: pick(albumVals), albumartist: pick(aaVals), genre: pick(genreVals), date: pick(dateVals), discnumber: pick(discVals), comment: pick(commentVals) });
        setMixed({ album: isMixed(albumVals), albumartist: isMixed(aaVals), genre: isMixed(genreVals), date: isMixed(dateVals), discnumber: isMixed(discVals), comment: isMixed(commentVals) });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, files]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // uniform + per-file title/artist: apply to each file sequentially (ponytail: 50× loop LAN fine)
      for (let i = 0; i < perFile.length; i++) {
        const pf = perFile[i];
        if (pf.error) continue;
        const tags: Record<string, string | null> = {};
        // uniform (only non-empty → overwrite)
        if (uniform.album) tags.album = uniform.album;
        if (uniform.albumartist) tags.albumartist = uniform.albumartist;
        if (uniform.genre) tags.genre = uniform.genre;
        if (uniform.date) tags.date = uniform.date;
        if (uniform.discnumber) tags.discnumber = uniform.discnumber;
        if (uniform.comment) tags.comment = uniform.comment;
        // per-file title/artist
        if (pf.title.trim()) tags.title = pf.title.trim();
        if (pf.artist.trim()) tags.artist = pf.artist.trim();
        // skip if nothing to write
        if (Object.keys(tags).length === 0) continue;
        await writeTags(pf.fileName, tags);
      }
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Bulk tags saved", body: `${perFile.length} files` } }));
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Bulk edit tags">
      <div className="w-full max-w-[720px] max-h-[92dvh] md:max-h-[85dvh] flex flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface-container-lowest shadow-xl dark:bg-surface-container-high ghost-border" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-outline-variant/10 bg-surface-container-low/40 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-headline text-lg font-bold">Bulk Edit Tags</h2>
              <p className="font-mono text-xs text-outline">{files.length} files · title+artist per-file, others uniform (smoked-salmon parity)</p>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high"><span className="material-symbols-outlined text-[18px]">close</span></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-4 min-h-0">
          {loading ? <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div> : (
            <>
              {error ? <div className="rounded-xl bg-error-container/50 px-4 py-3 font-body text-xs text-on-error-container">{error}</div> : null}
              <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-3">
                <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Uniform (applied to all)</h4>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { k: "album", label: "Album" },
                    { k: "albumartist", label: "Album Artist" },
                    { k: "genre", label: "Genre" },
                    { k: "date", label: "Year/Date" },
                    { k: "discnumber", label: "Disc" },
                    { k: "comment", label: "Comment" },
                  ] as const).map((f) => (
                    <label key={f.k} className="flex flex-col gap-1">
                      <span className="font-label text-xs font-semibold text-on-surface-variant">{f.label} {mixed[f.k] ? <span className="text-outline font-normal">— mixed —</span> : null}</span>
                      <input value={uniform[f.k]} onChange={(e) => setUniform((p) => ({ ...p, [f.k]: e.target.value }))} placeholder={mixed[f.k] ? "— mixed — (leave to keep)" : ""} className="w-full rounded-xl bg-surface-container-lowest px-3 py-2 min-h-11 font-body text-sm ghost-border focus:border-primary outline-none" />
                    </label>
                  ))}
                </div>
                <p className="font-body text-[11px] text-outline">Blank uniform = no overwrite. Mixed = files differ; filling overwrites all.</p>
              </div>

              <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-3">
                <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Per-file (title + artist)</h4>
                <div className="space-y-2 max-h-[32vh] overflow-auto overscroll-contain pr-1">
                  {perFile.map((pf, idx) => (
                    <div key={pf.fileName} className="flex flex-col gap-1 rounded-xl bg-surface-container-lowest p-3 ghost-border">
                      <span className="font-mono text-[10px] text-outline truncate" title={pf.fileName}>{pf.fileName.split("/").pop()?.split("\\").pop() || pf.fileName} {pf.error ? `· ${pf.error}` : ""}</span>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={pf.title} onChange={(e) => setPerFile((prev) => { const n = [...prev]; n[idx] = { ...n[idx], title: e.target.value }; return n; })} placeholder="Title" className="rounded-xl bg-surface-container-low px-2 py-2 font-body text-sm ghost-border outline-none" disabled={!!pf.error} />
                        <input value={pf.artist} onChange={(e) => setPerFile((prev) => { const n = [...prev]; n[idx] = { ...n[idx], artist: e.target.value }; return n; })} placeholder="Artist" className="rounded-xl bg-surface-container-low px-2 py-2 font-body text-sm ghost-border outline-none" disabled={!!pf.error} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-outline-variant/10 bg-surface-container-low/60 flex justify-between gap-3 shrink-0">
          <button onClick={onClose} className="rounded-full bg-surface-container-high px-5 py-2.5 font-label text-xs font-semibold">Cancel</button>
          <button disabled={loading || saving} onClick={handleSave} className="rounded-full bg-primary px-6 py-2.5 font-label text-xs font-bold text-on-primary disabled:opacity-40 flex items-center gap-2">{saving ? <span className="h-3 w-3 animate-spin rounded-full border border-on-primary border-t-transparent" /> : <span className="material-symbols-outlined text-[16px]">save</span>} Save {perFile.length} files</button>
        </div>
      </div>
    </div>
  );
}
