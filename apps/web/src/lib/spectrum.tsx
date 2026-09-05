"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isDemo } from "@/lib/demo";
import { DEMO_SPECTRUM_TRANSFER_ID } from "@/lib/demo/fixtures";
import { getWorkerHttpBase, requestWorkerSpectrum, workerFetchHeaders } from "@/lib/worker";

type SpectrumEntry = {
  id: string;
  token?: number;
  etag?: string;
  hash?: string;
  fullUrl?: string;
  zoomUrl?: string;
  status: "idle" | "queued" | "generating" | "done" | "error";
  error?: string;
  fromCache?: boolean;
  // blob urls for cached display
  fullBlobUrl?: string;
  zoomBlobUrl?: string;
};

export interface SpectrumRequestOpts {
  fileName: string;
  size?: number;
  token?: number;
}

interface SpectrumApi {
  entries: Map<string, SpectrumEntry>;
  requestSpectrum: (id: string, opts?: SpectrumRequestOpts) => void;
  getEntry: (id: string) => SpectrumEntry | undefined;
}

const SpectrumContext = createContext<SpectrumApi | null>(null);

const DEMO_FULL_URL = "/demo-spectra/kernkraft400-full.png";
const DEMO_ZOOM_URL = "/demo-spectra/kernkraft400-zoom.png";
const DEMO_ETAG = '"demo-kernkraft400"';

function getDemoEntry(): SpectrumEntry {
  return {
    id: DEMO_SPECTRUM_TRANSFER_ID,
    token: 99999,
    etag: DEMO_ETAG,
    hash: "demo",
    fullUrl: DEMO_FULL_URL,
    zoomUrl: DEMO_ZOOM_URL,
    status: "done",
    fromCache: true,
    // For demo we can use direct URLs as blob URLs too (no fetch needed)
    fullBlobUrl: DEMO_FULL_URL,
    zoomBlobUrl: DEMO_ZOOM_URL,
  };
}
function getDemoAudioEntry(id: string): SpectrumEntry | null {
  // id is absolute /data path in Files view, or any fileName basename
  const base = id.replace(/\\/g, "/").split("/").pop() ?? id;
  if (base === "01. DJ Satomi - Waves.ogg" || id === "/data/Music/Demo/01. DJ Satomi - Waves.ogg") {
    const full = "/demo-spectra/dj-satomi-waves-full.png";
    const zoom = "/demo-spectra/dj-satomi-waves-zoom.png";
    return { id, etag: '"demo-waves"', hash: "demo-waves", fullUrl: full, zoomUrl: zoom, status: "done" as const, fromCache: true as const, fullBlobUrl: full, zoomBlobUrl: zoom };
  }
  if (base === "12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg" || id === "/data/Music/Demo/12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg") {
    const full = "/demo-spectra/zombie-nation-kernkraft400-full.png";
    const zoom = "/demo-spectra/zombie-nation-kernkraft400-zoom.png";
    return { id, etag: '"demo-kern"', hash: "demo-kern", fullUrl: full, zoomUrl: zoom, status: "done" as const, fromCache: true as const, fullBlobUrl: full, zoomBlobUrl: zoom };
  }
  return null;
}

export function SpectrumProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Map<string, SpectrumEntry>>(() => {
    if (isDemo) {
      const m = new Map<string, SpectrumEntry>();
      m.set(DEMO_SPECTRUM_TRANSFER_ID, getDemoEntry());
      // Pre-seed the two demo audio files so Analyze Spectrum is instant
      const waves = getDemoAudioEntry("/data/Music/Demo/01. DJ Satomi - Waves.ogg");
      const kern = getDemoAudioEntry("/data/Music/Demo/12. Zombie Nation - Kernkraft 400 (DJ Gius Video Cut).ogg");
      if (waves) m.set(waves.id, waves);
      if (kern) m.set(kern.id, kern);
      return m;
    }
    return new Map();
  });
  const blobUrls = useRef<Map<string, { full?: string; zoom?: string }>>(new Map());

  const fetchAndCache = useCallback(async (id: string, etag: string, urls: { full: string; zoom: string }) => {
    const base = getWorkerHttpBase();
    // ponytail: no If-None-Match on first fetch — 304 would leave blobUrls empty and fallback to relative /spectrum (web 404)
    const headers = { ...workerFetchHeaders() } as Record<string, string>;
    const fetchPair = async (hdrs: Record<string, string>) => Promise.all([
      fetch(`${base}${urls.full}`, { headers: hdrs }),
      fetch(`${base}${urls.zoom}`, { headers: hdrs }),
    ]);
    try {
      let [fullRes, zoomRes] = await fetchPair(headers);
      // If worker returns 304 (etag match), retry without If-None-Match to actually get the pngs
      if (fullRes.status === 304 || zoomRes.status === 304) {
        [fullRes, zoomRes] = await fetchPair({ ...workerFetchHeaders() } as Record<string, string>);
      }
      if (fullRes.ok && zoomRes.ok) {
        const [fullBlob, zoomBlob] = await Promise.all([fullRes.blob(), zoomRes.blob()]);
        const fullBlobUrl = URL.createObjectURL(fullBlob);
        const zoomBlobUrl = URL.createObjectURL(zoomBlob);
        // revoke previous
        const prev = blobUrls.current.get(id);
        if (prev?.full) try { URL.revokeObjectURL(prev.full); } catch {}
        if (prev?.zoom) try { URL.revokeObjectURL(prev.zoom); } catch {}
        blobUrls.current.set(id, { full: fullBlobUrl, zoom: zoomBlobUrl });
        setEntries((prev) => {
          const next = new Map(prev);
          const cur = next.get(id);
          if (cur) next.set(id, { ...cur, fullBlobUrl, zoomBlobUrl });
          return next;
        });
      } else if (fullRes.status === 304 || zoomRes.status === 304) {
        // 304 without blob — keep existing blob if any, otherwise mark done with absolute URLs as fallback
        setEntries((prev) => {
          const next = new Map(prev);
          const cur = next.get(id);
          if (cur && !cur.fullBlobUrl) {
            const base2 = getWorkerHttpBase();
            next.set(id, { ...cur, fullBlobUrl: `${base2}${urls.full}`, zoomBlobUrl: `${base2}${urls.zoom}` } as unknown as SpectrumEntry);
          }
          return next;
        });
      }
    } catch {}
  }, []);

  // cleanup blobUrls on unmount
  useEffect(() => {
    return () => {
      for (const v of blobUrls.current.values()) {
        if (v.full) try { URL.revokeObjectURL(v.full); } catch {}
        if (v.zoom) try { URL.revokeObjectURL(v.zoom); } catch {}
      }
    };
  }, []);

  const requestSpectrum = useCallback((id: string, opts?: SpectrumRequestOpts) => {
    if (isDemo) {
      if (id === DEMO_SPECTRUM_TRANSFER_ID) {
        // Demo: already have spectrum, just ensure it's done
        setEntries((prev) => {
          if (prev.has(id) && prev.get(id)?.status === "done") return prev;
          const next = new Map(prev);
          next.set(id, getDemoEntry());
          return next;
        });
        return;
      }
      const demoAudio = getDemoAudioEntry(id) ?? (opts?.fileName ? getDemoAudioEntry(opts.fileName) : null);
      if (demoAudio) {
        setEntries((prev) => {
          if (prev.has(id) && prev.get(id)?.status === "done") return prev;
          const next = new Map(prev);
          next.set(id, { ...demoAudio, id });
          return next;
        });
        return;
      }
    }
    if (!opts?.fileName) {
      setEntries((prev) => {
        const next = new Map(prev);
        const cur = next.get(id) ?? { id, status: "idle" as const };
        next.set(id, { ...cur, status: "error", error: "No file info for spectrum request" });
        return next;
      });
      return;
    }
    setEntries((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { id, status: "idle" as const };
      next.set(id, { ...cur, status: "queued", error: undefined });
      return next;
    });
    // Direct web -> worker HTTP (bridge no longer serves spectrum)
    const { fileName, size, token } = opts;
    requestWorkerSpectrum({ fileName, size, token })
      .then((res) => {
        setEntries((prev) => {
          const next = new Map(prev);
          next.set(id, {
            id, token, etag: res.etag, hash: res.hash,
            fullUrl: res.urls.full, zoomUrl: res.urls.zoom,
            status: "done", fromCache: res.fromCache,
          });
          return next;
        });
        return fetchAndCache(id, res.etag, res.urls);
      })
      .catch((e: unknown) => {
        setEntries((prev) => {
          const next = new Map(prev);
          const cur = next.get(id) ?? { id, status: "idle" as const };
          next.set(id, { ...cur, status: "error", error: e instanceof Error ? e.message.slice(0, 300) : "Spectrum failed" });
          return next;
        });
      });
  }, [fetchAndCache]);

  const getEntry = useCallback((id: string) => entries.get(id), [entries]);

  const api = useMemo<SpectrumApi>(() => ({ entries, requestSpectrum, getEntry }), [entries, requestSpectrum, getEntry]);

  return <SpectrumContext.Provider value={api}>{children}</SpectrumContext.Provider>;
}

export function useSpectrum(): SpectrumApi {
  const ctx = useContext(SpectrumContext);
  if (!ctx) throw new Error("useSpectrum must be used within SpectrumProvider");
  return ctx;
}

export function useSpectrumEntry(id: string): SpectrumEntry | undefined {
  const { entries } = useSpectrum();
  return entries.get(id);
}

/** Parse a bridge downloadUrl (/files/:token) into a numeric token, if present. */
export function parseDownloadToken(t: { downloadUrl?: string }): number | undefined {
  const m = t.downloadUrl?.match(/\/files\/(\d+)/);
  return m ? Number(m[1]) : undefined;
}
