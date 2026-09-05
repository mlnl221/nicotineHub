"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { bridgeFetchUrl } from "@/lib/bridgeHttp";

type Props = {
  absPath: string;
  fileName: string;
  children: React.ReactNode;
};

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico"]);

function isImage(name: string): boolean {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTS.has(ext);
}

export function ImageHoverCard({ absPath, fileName, children }: Props) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(true);

  if (!isImage(fileName)) {
    return <>{children}</>;
  }

  const previewUrl = bridgeFetchUrl(`/api/files/raw?path=${encodeURIComponent(absPath)}&preview=1`);
  const fullUrl = bridgeFetchUrl(`/api/files/raw?path=${encodeURIComponent(absPath)}`);

  const onMouseEnter = (e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    setOpen(true);
    setImgError(null);
    setImgLoading(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!open) return;
    setPos({ x: e.clientX, y: e.clientY });
  };
  const onMouseLeave = () => setOpen(false);
  const onClick = () => setModal(true);

  return (
    <>
      <div
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        className="cursor-zoom-in"
        title="Hover to preview • Click for full view"
      >
        {children}
      </div>

      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[60] pointer-events-none hidden md:block"
              style={{
                left: Math.min(pos.x + 16, window.innerWidth - 360),
                top: Math.min(pos.y + 16, window.innerHeight - 280),
              }}
            >
              <div className="rounded-xl bg-surface-container-lowest shadow-xl ghost-border overflow-hidden w-[340px]">
                <div className="px-3 py-2 flex items-center justify-between bg-surface-container-high">
                  <span className="font-label text-xs font-semibold truncate" title={fileName}>
                    {fileName}
                  </span>
                  <span className="font-label text-[10px] text-outline">preview</span>
                </div>
                <div className="bg-black flex items-center justify-center min-h-[180px] max-h-[260px] overflow-hidden">
                  {imgError ? (
                    <div className="p-4 font-label text-xs text-error text-center">{imgError}</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt={`Preview ${fileName}`}
                      className="w-full h-auto max-h-[260px] object-contain"
                      loading="eager"
                      onLoad={() => setImgLoading(false)}
                      onError={() => {
                        setImgLoading(false);
                        setImgError("No preview — too large or unsupported");
                      }}
                    />
                  )}
                  {imgLoading && !imgError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    </div>
                  )}
                </div>
                <div className="px-3 py-1.5 bg-surface-container-lowest font-label text-[10px] text-outline text-center">
                  Click for full view • Download available
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {modal
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
                      {fileName}
                    </h3>
                    <p className="font-mono text-[11px] text-outline truncate">{absPath}</p>
                  </div>
                  <button
                    aria-label="Close"
                    onClick={() => setModal(false)}
                    className="ml-3 p-2 rounded-full hover:bg-surface-container-high min-h-11 min-w-11 flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-2 min-h-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fullUrl} alt={fileName} className="max-w-full h-auto object-contain" />
                </div>

                <div className="px-4 py-2.5 flex justify-end gap-2 bg-surface-container-low shrink-0">
                  <a
                    href={fullUrl}
                    download={fileName}
                    className="px-4 py-2 rounded-full bg-surface-container-high font-label text-xs font-semibold"
                  >
                    Download
                  </a>
                  <button
                    onClick={() => setModal(false)}
                    className="px-4 py-2 rounded-full bg-primary text-on-primary font-label text-xs font-semibold"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
