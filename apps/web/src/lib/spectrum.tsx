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

export function SpectrumProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Map<string, SpectrumEntry>>(() => {
    if (isDemo) {
      const m = new Map<string, SpectrumEntry>();
      m.set(DEMO_SPECTRUM_TRANSFER_ID, getDemoEntry());
      return m;
    }
    return new Map();
  });
  const blobUrls = useRef<Map<string, { full?: string; zoom?: string }>>(new Map());

  const fetchAndCache = useCallback(async (id: string, etag: string, urls: { full: string; zoom: string }) => {
    const base = getWorkerHttpBase();
    const headers = { "If-None-Match": etag, ...workerFetchHeaders() };
    try {
      const [fullRes, zoomRes] = await Promise.all([
        fetch(`${base}${urls.full}`, { headers }),
        fetch(`${base}${urls.zoom}`, { headers }),
      ]);
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
    if (isDemo && id === DEMO_SPECTRUM_TRANSFER_ID) {
      // Demo: already have spectrum, just ensure it's done
      setEntries((prev) => {
        if (prev.has(id) && prev.get(id)?.status === "done") return prev;
        const next = new Map(prev);
        next.set(id, getDemoEntry());
        return next;
      });
      return;
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
