"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSpectrum } from "@/lib/spectrum";

type Props = {
  transferId: string;
  fileName: string;
  children: React.ReactNode;
};

export function SpectrumHoverCard({ transferId, fileName, children }: Props) {
  const { getEntry } = useSpectrum();
  const entry = getEntry(transferId);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"full" | "zoom">("full");
  const hoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const hasSpectrum = entry?.status === "done" && (!!entry.fullBlobUrl || !!entry.fullUrl);
  const isGenerating = entry?.status === "queued" || entry?.status === "generating";
  const isError = entry?.status === "error";

  // For hover positioning: track mouse
  const onMouseEnter = (e: React.MouseEvent) => {
    if (!hasSpectrum) return;
    setPos({ x: e.clientX, y: e.clientY });
    setOpen(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!open) return;
    setPos({ x: e.clientX, y: e.clientY });
  };
  const onMouseLeave = () => setOpen(false);

  // Also support touch long-press? For now click opens modal if hasSpectrum
  const onClick = () => {
    if (hasSpectrum) setModal(true);
  };

  const imgSrc = entry?.fullBlobUrl || (entry?.fullUrl ? entry.fullUrl : null);
  const fullSrc = entry?.fullBlobUrl || null;
  const zoomSrc = entry?.zoomBlobUrl || null;

  // Preload on hover open
  useEffect(() => {
    if (open && entry?.fullUrl && !entry.fullBlobUrl) {
      // already handled by provider fetch; just ensure we show loading
    }
  }, [open, entry]);

  return (
    <>
      <div
        ref={hoverRef}
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={hasSpectrum ? onClick : undefined}
        className={hasSpectrum ? "cursor-pointer" : undefined}
        title={hasSpectrum ? "Click to view spectrum (Full + Zoom)" : undefined}
      >
        {children}
        {hasSpectrum ? (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-container/60 px-2 py-0.5 font-label text-[10px] font-semibold text-on-primary-container">
              <span className="material-symbols-outlined text-[12px]">graphic_eq</span> SPECTRUM ✓
            </span>
            <span className="font-label text-[10px] text-outline hidden sm:inline">Hover to preview • Click for Full + Zoom</span>
          </div>
        ) : isGenerating ? (
          <div className="mt-1 flex items-center gap-1.5 font-label text-[10px] text-primary animate-pulse">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> Generating spectrum…
          </div>
        ) : isError ? (
          <div className="mt-1 font-label text-[10px] text-error truncate" title={entry?.error}>
            Spectrum error: {entry?.error?.slice(0, 80)}
          </div>
        ) : null}
      </div>

      {open && hasSpectrum && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[60] pointer-events-none hidden md:block"
              style={{
                left: Math.min(pos.x + 16, window.innerWidth - 420),
                top: Math.min(pos.y + 16, window.innerHeight - 260),
              }}
            >
              <div className="rounded-xl bg-surface-container-lowest shadow-xl ghost-border overflow-hidden w-[400px]">
                <div className="px-3 py-2 flex items-center justify-between bg-surface-container-high">
                  <span className="font-label text-xs font-semibold truncate" title={fileName}>
                    {fileName}
                  </span>
                  <span className="font-label text-[10px] text-outline">Full</span>
                </div>
                <div className="bg-black flex items-center justify-center min-h-[180px]">
                  {imgSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imgSrc}
                      alt={`Spectrum Full for ${fileName}`}
                      className="w-full h-auto max-h-[220px] object-contain"
                      loading="eager"
                    />
                  ) : (
                    <div className="p-6 font-label text-xs text-on-surface-variant">Loading…</div>
                  )}
                </div>
                <div className="px-3 py-1.5 bg-surface-container-lowest font-label text-[10px] text-outline text-center">
                  Cached in /tmp • Click card for Zoom
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {modal && hasSpectrum
        ? createPortal(
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4" onClick={() => setModal(false)}>
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div
                className="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden ghost-border"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 shrink-0">
                  <div className="min-w-0">
                    <h3 className="font-headline text-sm font-semibold truncate" title={fileName}>
                      Spectrum — {fileName}
                    </h3>
                    <p className="font-label text-[11px] text-outline">sox Kaiser • -z 120 • cached in /tmp (wiped on reboot)</p>
                  </div>
                  <button
                    aria-label="Close"
                    onClick={() => setModal(false)}
                    className="ml-3 p-2 rounded-full hover:bg-surface-container-high min-h-11 min-w-11 flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="flex gap-1 p-2 bg-surface-container-low shrink-0">
                  <button
                    onClick={() => setActiveTab("full")}
                    className={`flex-1 py-2.5 rounded-xl font-label text-xs font-semibold ${activeTab === "full" ? "bg-primary text-on-primary shadow" : "bg-surface-container-high text-on-surface-variant"}`}
                  >
                    Full
                  </button>
                  <button
                    onClick={() => setActiveTab("zoom")}
                    className={`flex-1 py-2.5 rounded-xl font-label text-xs font-semibold ${activeTab === "zoom" ? "bg-primary text-on-primary shadow" : "bg-surface-container-high text-on-surface-variant"}`}
                  >
                    Zoom
                  </button>
                </div>

                <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-2 min-h-0">
                  {activeTab === "full" ? (
                    fullSrc || imgSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={(fullSrc || imgSrc)!} alt={`Full spectrum ${fileName}`} className="max-w-full h-auto object-contain" />
                    ) : (
                      <span className="text-on-surface-variant font-label text-sm">No Full image</span>
                    )
                  ) : zoomSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={zoomSrc} alt={`Zoom spectrum ${fileName}`} className="max-w-full h-auto object-contain" />
                  ) : (
                    <span className="text-on-surface-variant font-label text-sm">No Zoom image</span>
                  )}
                </div>

                <div className="px-4 py-2.5 flex flex-wrap gap-2 justify-between items-center bg-surface-container-low shrink-0">
                  <span className="font-label text-[11px] text-outline">Tip: cutoff ~16 kHz → likely lossy transcode</span>
                  <div className="flex gap-2">
                    {fullSrc ? (
                      <a href={fullSrc} download={`${fileName}-Full.png`} className="px-3 py-2 rounded-full bg-surface-container-high font-label text-xs font-semibold">
                        Download Full
                      </a>
                    ) : null}
                    {zoomSrc ? (
                      <a href={zoomSrc} download={`${fileName}-Zoom.png`} className="px-3 py-2 rounded-full bg-primary text-on-primary font-label text-xs font-semibold">
                        Download Zoom
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
