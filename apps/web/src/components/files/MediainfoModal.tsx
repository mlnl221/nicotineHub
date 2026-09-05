"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getMediainfo, type MediainfoResult } from "@/lib/worker";

type Props = {
  filePath: string;
  onClose: () => void;
};

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Copied", body: "Mediainfo copied to clipboard" } }));
    }).catch(() => {});
  }
}

export function MediainfoModal({ filePath, onClose }: Props) {
  const [data, setData] = useState<MediainfoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    getMediainfo(filePath)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filePath]);

  const summary = data?.summary;
  const raw = data?.raw ?? "";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <div
        className="relative flex w-full max-w-3xl max-h-[85vh] md:max-h-[78vh] flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface-container-lowest shadow-[0_24px_48px_rgba(0,0,0,0.16)] ghost-border"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Mediainfo"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant/10 px-5 py-4 md:px-6">
          <div className="min-w-0">
            <h2 className="font-headline text-base font-bold tracking-tight text-on-surface md:text-lg">Mediainfo</h2>
            <p className="mt-0.5 truncate font-mono text-[11px] text-on-surface-variant" title={filePath}>{filePath}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-high hover:bg-surface-container-highest"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="font-label text-xs text-on-surface-variant">Reading file…</span>
            </div>
          )}
          {!loading && error && (
            <div className="px-5 py-6 md:px-6">
              <div className="rounded-2xl bg-error-container/50 px-4 py-3 ghost-border">
                <div className="font-label text-sm font-semibold text-on-error-container">Could not read mediainfo</div>
                <div className="mt-1 font-body text-xs leading-relaxed text-on-error-container/80 break-words">{error}</div>
              </div>
              <p className="mt-3 font-body text-xs leading-relaxed text-on-surface-variant">
                Tip: if the worker is unreachable, check <span className="font-mono">NEXT_PUBLIC_WORKER_URL</span> / <span className="font-mono">localStorage.nicotineHub.workerUrl</span>. On Docker the worker must be at <span className="font-mono">:8789</span>.
              </p>
            </div>
          )}
          {!loading && !error && data && (
            <div className="space-y-4 px-5 py-4 md:px-6">
              {/* Summary — surface tiers, no explicit borders (DESIGN.md no-line rule) */}
              <section className="space-y-2">
                <h3 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Summary</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <SummaryCell label="Format" value={summary?.format} />
                  <SummaryCell label="Duration" value={summary?.duration} />
                  <SummaryCell label="Size" value={summary?.fileSize} />
                  <SummaryCell label="Overall bitrate" value={summary?.overallBitRate} />
                  <SummaryCell label="Video streams" value={summary?.video ? String(summary.video.length) : summary?.video === null ? "—" : null} />
                  <SummaryCell label="Audio streams" value={summary?.audio ? String(summary.audio.length) : summary?.audio === null ? "—" : null} />
                </div>
                {summary?.video?.length ? (
                  <div className="space-y-1.5">
                    <div className="font-label text-[11px] uppercase tracking-widest text-on-surface-variant">Video</div>
                    {summary.video.map((v, i) => (
                      <div key={i} className="rounded-xl bg-surface-container-low px-3 py-2.5">
                        <div className="font-body text-xs font-medium text-on-surface">{String(v.format ?? "—")} {v.width && v.height ? `· ${v.width}×${v.height}` : ""}</div>
                        <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-on-surface-variant">
                          {[v.codecId ? `codec ${v.codecId}` : null, v.frameRate ? `${v.frameRate}` : null, v.bitRate ? `${v.bitRate}` : null, v.duration ? `${v.duration}` : null].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {summary?.audio?.length ? (
                  <div className="space-y-1.5">
                    <div className="font-label text-[11px] uppercase tracking-widest text-on-surface-variant">Audio</div>
                    {summary.audio.map((a, i) => (
                      <div key={i} className="rounded-xl bg-surface-container-low px-3 py-2.5">
                        <div className="font-body text-xs font-medium text-on-surface">{String(a.format ?? "—")} {a.channels ? `· ${a.channels}` : ""}</div>
                        <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-on-surface-variant">
                          {[a.codecId ? `codec ${a.codecId}` : null, a.samplingRate ? `${a.samplingRate}` : null, a.bitRate ? `${a.bitRate}` : null, a.bitDepth ? `${a.bitDepth}-bit` : null, a.duration ? `${a.duration}` : null].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {summary?.textCount ? (
                  <div className="font-mono text-[11px] text-on-surface-variant">Text/subtitle streams: {summary.textCount}</div>
                ) : null}
              </section>

              {/* Raw MediaInfo — scrollable mono block */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant">Raw output</h3>
                  <button
                    type="button"
                    onClick={() => copyText(raw)}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs font-medium text-on-surface-variant hover:bg-surface-container-highest"
                  >
                    <span className="material-symbols-outlined text-[14px]">content_copy</span> Copy
                  </button>
                </div>
                <pre className="max-h-[36vh] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface-container-low p-4 font-mono text-[11px] leading-relaxed text-on-surface dark:bg-surface-container-high">
                  {raw || "—"}
                </pre>
              </section>
            </div>
          )}
        </div>

        {/* Footer — one primary action per DESIGN.md */}
        <div className="flex items-center justify-end gap-2 border-t border-outline-variant/10 bg-surface-container-low px-5 py-3 md:px-6">
          {data?.raw ? (
            <button
              type="button"
              onClick={() => copyText(data.raw)}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-4 py-2.5 font-label text-xs font-semibold text-on-surface-variant hover:bg-surface-container-highest"
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span> Copy raw
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-primary to-primary-container px-6 py-2.5 font-label text-xs font-bold uppercase tracking-widest text-on-primary hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SummaryCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl bg-surface-container-low px-3 py-2.5 dark:bg-surface-container-high/50">
      <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">{label}</div>
      <div className="mt-1 truncate font-body text-xs font-medium text-on-surface" title={value ?? undefined}>{value ?? "—"}</div>
    </div>
  );
}
