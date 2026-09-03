"use client";

import { useEffect, useState } from "react";
import { readTags, writeTags, scrapeTags, verifyFile, analyzeFile, requestWorkerSpectrum, getWorkerHttpBase, workerFetchHeaders } from "@/lib/worker";

type Props = {
  open: boolean;
  fileName: string;
  onClose: () => void;
  onSaved?: () => void;
};

const FIELDS: Array<{ key: string; label: string; placeholder?: string }> = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumartist", label: "Album Artist" },
  { key: "composer", label: "Composer" },
  { key: "genre", label: "Genre" },
  { key: "date", label: "Year / Date", placeholder: "2024" },
  { key: "tracknumber", label: "Track (#/total)", placeholder: "5 or 5/12" },
  { key: "discnumber", label: "Disc (#/total)", placeholder: "1 or 1/2" },
  { key: "comment", label: "Comment" },
];

export function TagEditor({ open, fileName, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [cover, setCover] = useState(false);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);
  const [verifyRes, setVerifyRes] = useState<Record<string, unknown> | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [analyzeRes, setAnalyzeRes] = useState<Record<string, unknown> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [spectrum, setSpectrum] = useState<{ fullBlobUrl?: string; zoomBlobUrl?: string; etag?: string; loading?: boolean; error?: string } | null>(null);

  // Load tags when opened
  useEffect(() => {
    if (!open || !fileName) return;
    setLoading(true);
    setError(null);
    setScrapeResult(null);
    setVerifyRes(null);
    setAnalyzeRes(null);
    setSpectrum(null);
    readTags(fileName)
      .then((res) => {
        setTags(res.tags || {});
        setInfo((res.info as Record<string, unknown>) || null);
        setCover(!!res.coverArtApplied);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, fileName]);

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const res = await verifyFile(fileName);
      setVerifyRes(res as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  };
  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await analyzeFile(fileName);
      setAnalyzeRes(res as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };
  const handleSpectrum = async () => {
    setSpectrum({ loading: true });
    setError(null);
    try {
      const res = await requestWorkerSpectrum({ fileName });
      const base = getWorkerHttpBase();
      const headers = { "If-None-Match": res.etag, ...workerFetchHeaders() } as Record<string, string>;
      const [fullRes, zoomRes] = await Promise.all([fetch(`${base}${res.urls.full}`, { headers }), fetch(`${base}${res.urls.zoom}`, { headers })]);
      if (!fullRes.ok || !zoomRes.ok) throw new Error(`Spectrum fetch failed`);
      const [fullBlob, zoomBlob] = await Promise.all([fullRes.blob(), zoomRes.blob()]);
      const fullBlobUrl = URL.createObjectURL(fullBlob);
      const zoomBlobUrl = URL.createObjectURL(zoomBlob);
      setSpectrum({ fullBlobUrl, zoomBlobUrl, etag: res.etag });
    } catch (e) {
      setSpectrum({ error: e instanceof Error ? e.message : String(e) });
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await writeTags(fileName, tags);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Tags saved", body: fileName } }));
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleScrape = async (apply: boolean) => {
    const url = scrapeUrl.trim();
    if (!url) { setError("Enter a release URL to scrape"); return; }
    setScraping(true);
    setError(null);
    setScrapeResult(null);
    try {
      const res = await scrapeTags(fileName, url, apply);
      if (apply) {
        // re-read after apply
        setTags(res.tags || {});
        setInfo((res.info as Record<string, unknown>) || info);
        setScrapeResult(`Applied ${res.source}: ${res.artist} — ${res.album} (${res.year ?? "?"})`);
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Tags updated from scraper", body: `${res.source}: ${res.artist} — ${res.album}` } }));
      } else {
        // preview: fill form with suggested
        const sug = res.suggested || {};
        setTags((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(sug).filter(([k]) => !k.startsWith("_"))) }));
        setScrapeResult(`Found ${res.source}: ${res.artist} — ${res.album} (${res.year ?? "?"}) • Not yet saved`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScraping(false);
    }
  };

  const shortName = fileName.split("/").pop()?.split("\\").pop() || fileName;

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Edit tags">
      <div
        className="w-full max-w-[640px] max-h-[92dvh] md:max-h-[85dvh] flex flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface-container-lowest shadow-xl dark:bg-surface-container-high ghost-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-outline-variant/10 bg-surface-container-low/40 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-headline text-lg font-bold tracking-tight truncate">Edit Tags</h2>
              <p className="font-mono text-xs text-outline truncate" title={fileName}>{shortName}</p>
              <p className="font-mono text-[10px] text-outline/70 truncate" title={fileName}>{fileName}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high hover:bg-surface-variant text-on-surface-variant shrink-0">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          {info ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {info.format ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">{String(info.format).toUpperCase()}</span> : null}
              {info.duration ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">{Math.floor(Number(info.duration)/60)}:{String(Math.floor(Number(info.duration)%60)).padStart(2,"0")}</span> : null}
              {info.bitrate ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">{String(info.bitrate)} kbps</span> : null}
              {info.sampleRate ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">{String(info.sampleRate)} Hz</span> : null}
              {info.bitDepth ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">{String(info.bitDepth)}-bit</span> : null}
              {cover ? <span className="rounded-full bg-primary-container px-2 py-1 font-mono text-[10px] text-on-primary-container">cover ✓</span> : null}
            </div>
          ) : null}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-4 min-h-0" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="font-body text-sm text-outline">Loading tags…</p>
            </div>
          ) : (
            <>
              {error ? (
                <div className="rounded-xl border border-error/30 bg-error-container/50 px-4 py-3">
                  <p className="font-body text-xs text-on-error-container">{error}</p>
                </div>
              ) : null}
              {/* Tag fields */}
              <div className="grid grid-cols-1 gap-3">
                {FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="font-label text-xs font-semibold text-on-surface-variant">{f.label}</span>
                    <input
                      value={tags[f.key] || ""}
                      onChange={(e) => setTags((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full rounded-xl bg-surface-container-low px-3 py-2.5 min-h-11 font-body text-sm outline-none ghost-border focus:border-primary"
                    />
                  </label>
                ))}
              </div>

              {/* Scrape */}
              <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-3">
                <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Scrape tags</h4>
                <p className="font-body text-xs text-outline">Paste a release URL (Discogs / Bandcamp / MusicBrainz / Deezer / Beatport / Apple / Qobuz / Tidal) to fill artist/album/year.</p>
                <div className="flex gap-2">
                  <input
                    value={scrapeUrl}
                    onChange={(e) => setScrapeUrl(e.target.value)}
                    placeholder="https://www.discogs.com/release/..."
                    className="flex-1 min-w-0 rounded-xl bg-surface-container-lowest px-3 py-2.5 min-h-11 font-body text-sm outline-none ghost-border focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <button disabled={scraping || !scrapeUrl.trim()} onClick={() => handleScrape(false)} className="flex-1 rounded-xl bg-surface-container-high px-4 py-2.5 font-label text-xs font-semibold disabled:opacity-40">
                    {scraping ? "Scraping…" : "Preview"}
                  </button>
                  <button disabled={scraping || !scrapeUrl.trim()} onClick={() => handleScrape(true)} className="flex-1 rounded-xl bg-primary px-4 py-2.5 font-label text-xs font-bold text-on-primary disabled:opacity-40">
                    {scraping ? "…" : "Scrape & Apply"}
                  </button>
                </div>
                {scrapeResult ? <p className="font-body text-xs text-primary">{scrapeResult}</p> : null}
              </div>

              {/* Verify / Analyze / Spectrum — single inspector */}
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Verify</h4>
                    <button disabled={verifying} onClick={handleVerify} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs disabled:opacity-40">{verifying ? "Verifying…" : "Run Verify"}</button>
                  </div>
                  <p className="font-body text-xs text-outline">Checks <span className="font-mono">flacOk</span> + MQA tag sniff (worker <span className="font-mono">POST /verify</span>).</p>
                  {verifyRes ? (
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-1 font-mono text-[10px] ${verifyRes.flacOk ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : verifyRes.flacOk === false ? "bg-error-container text-on-error-container" : "bg-surface-container-high text-outline"}`}>flacOk: {String(verifyRes.flacOk ?? "—")}</span>
                      <span className={`rounded-full px-2 py-1 font-mono text-[10px] ${verifyRes.mqa ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40" : "bg-surface-container-high text-outline"}`}>mqa: {String(verifyRes.mqa ?? "—")}</span>
                      {verifyRes.upconvert != null ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">upconvert: {String(verifyRes.upconvert)}</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Analyze (transcode)</h4>
                    <button disabled={analyzing} onClick={handleAnalyze} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs disabled:opacity-40">{analyzing ? "Analyzing…" : "Run Analyze"}</button>
                  </div>
                  <p className="font-body text-xs text-outline">Worker <span className="font-mono">POST /analyze</span> <span className="font-mono">mutagen</span> + <span className="font-mono">ffmpeg</span> spectral knee <span className="font-mono">-40dB</span> → <span className="font-mono">cutoffHz</span>.</p>
                  {analyzeRes ? (
                    <div className="flex flex-wrap gap-1.5">
                      {analyzeRes.bitrate ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">{String(analyzeRes.bitrate)} kbps {analyzeRes.vbr ? `· ${String(analyzeRes.vbr)}` : ""}</span> : null}
                      {analyzeRes.cutoffHz ? <span className={`rounded-full px-2 py-1 font-mono text-[10px] ${Number(analyzeRes.cutoffHz) < 17000 ? "bg-error-container text-on-error-container" : "bg-green-100 text-green-800 dark:bg-green-900/40"}`}>cutoff {String(analyzeRes.cutoffHz)} Hz {analyzeRes.likelyTranscode ? "· likely transcode" : "· clean"}</span> : null}
                      {analyzeRes.confidence ? <span className="rounded-full bg-surface-container-high px-2 py-1 font-mono text-[10px]">conf {String(analyzeRes.confidence)}</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl bg-surface-container-low p-4 ghost-border space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Spectrum</h4>
                    <button disabled={!!spectrum?.loading} onClick={handleSpectrum} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs disabled:opacity-40">{spectrum?.loading ? "Generating…" : "Generate Spectrum"}</button>
                  </div>
                  <p className="font-body text-xs text-outline"><span className="font-mono">sox</span> Full <span className="font-mono">2000×513</span> + Zoom <span className="font-mono">500×1025</span> Kaiser <span className="font-mono">-z 120</span> via worker <span className="font-mono">POST /spectrum/request</span>.</p>
                  {spectrum?.error ? <p className="font-body text-xs text-error">{spectrum.error}</p> : null}
                  {spectrum?.fullBlobUrl ? (
                    <div className="space-y-2">
                      <img src={spectrum.fullBlobUrl} alt="Full spectrum" className="w-full rounded-xl ghost-border" />
                      {spectrum.zoomBlobUrl ? <img src={spectrum.zoomBlobUrl} alt="Zoom spectrum" className="w-full rounded-xl ghost-border" /> : null}
                      <p className="font-mono text-[10px] text-outline">etag {spectrum.etag}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <p className="font-body text-[11px] leading-relaxed text-outline">Nicotin-plus parity: TinyTag fields (artist, album, title, track, genre, year, composer, albumartist). Worker edits via <span className="font-mono">mutagen</span> with <span className="font-mono">DATA_DIR</span> containment.</p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-outline-variant/10 bg-surface-container-low/60 flex items-center justify-between gap-3 shrink-0">
          <button onClick={onClose} className="rounded-full bg-surface-container-high px-5 py-2.5 font-label text-xs font-semibold">Cancel</button>
          <button disabled={loading || saving} onClick={handleSave} className="rounded-full bg-primary px-6 py-2.5 font-label text-xs font-bold text-on-primary disabled:opacity-40 hover:bg-primary-container flex items-center gap-2">
            {saving ? <span className="h-3 w-3 animate-spin rounded-full border border-on-primary border-t-transparent" /> : <span className="material-symbols-outlined text-[16px]">save</span>}
            Save tags
          </button>
        </div>
      </div>
    </div>
  );
}
