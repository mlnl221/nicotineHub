"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import type { SpectrumReadyMessage, SpectrumStatusMessage, SpectrumErrorMessage } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { DEMO_SPECTRUM_TRANSFER_ID } from "@/lib/demo/fixtures";

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

interface SpectrumApi {
  entries: Map<string, SpectrumEntry>;
  requestSpectrum: (id: string) => void;
  getEntry: (id: string) => SpectrumEntry | undefined;
}

const SpectrumContext = createContext<SpectrumApi | null>(null);

function bridgeHttpBase(): string {
  // Derive from WS url or NEXT_PUBLIC_BRIDGE_URL
  try {
    const ls = typeof window !== "undefined" ? window.localStorage.getItem("nicotineHub.bridgeUrl") : null;
    const env = process.env.NEXT_PUBLIC_BRIDGE_URL as string | undefined;
    const raw = ls || env || "ws://localhost:8787/ws";
    // ws://host:8787/ws -> http://host:8787
    const u = new URL(raw);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return "http://localhost:8787";
  }
}

function buildUrl(path: string, token?: string): string {
  const base = bridgeHttpBase();
  const t = token ? `?token=${encodeURIComponent(token)}` : "";
  // Try to get BRIDGE_TOKEN from localStorage? For homelab token auth
  if (typeof window !== "undefined") {
    const tok = window.localStorage.getItem("nicotineHub.bridgeToken") || window.localStorage.getItem("nicotine.bridgeToken");
    if (tok) return `${base}${path}${t ? t + "&" : "?"}token=${encodeURIComponent(tok)}`;
  }
  return `${base}${path}${t}`;
}

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
  const { send, subscribe } = useSession();
  const [entries, setEntries] = useState<Map<string, SpectrumEntry>>(() => {
    if (isDemo) {
      const m = new Map<string, SpectrumEntry>();
      m.set(DEMO_SPECTRUM_TRANSFER_ID, getDemoEntry());
      return m;
    }
    return new Map();
  });
  const blobUrls = useRef<Map<string, { full?: string; zoom?: string }>>(new Map());

  const fetchAndCache = useCallback(async (id: string, token: number, etag: string, urls: { full: string; zoom: string }) => {
    const base = bridgeHttpBase();
    const mkUrl = (p: string) => {
      // attach BRIDGE_TOKEN if present
      let u = `${base}${p}`;
      if (typeof window !== "undefined") {
        const tok = window.localStorage.getItem("nicotineHub.bridgeToken") || window.localStorage.getItem("nicotine.bridgeToken");
        if (tok) u += (u.includes("?") ? "&" : "?") + `token=${encodeURIComponent(tok)}`;
      }
      return u;
    };
    try {
      const [fullRes, zoomRes] = await Promise.all([
        fetch(mkUrl(urls.full), { headers: { "If-None-Match": etag } }),
        fetch(mkUrl(urls.zoom), { headers: { "If-None-Match": etag } }),
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

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "spectrum:status") {
        const m = msg as SpectrumStatusMessage;
        setEntries((prev) => {
          const next = new Map(prev);
          const cur = next.get(m.id) ?? { id: m.id, status: "idle" as const };
          next.set(m.id, { ...cur, status: m.phase === "done" ? "done" : m.phase === "missing" ? "idle" : m.phase === "queued" ? "queued" : "generating" });
          return next;
        });
      } else if (msg.type === "spectrum:ready") {
        const m = msg as SpectrumReadyMessage;
        setEntries((prev) => {
          const next = new Map(prev);
          next.set(m.id, {
            id: m.id,
            token: m.token,
            etag: m.etag,
            hash: m.hash,
            fullUrl: m.urls.full,
            zoomUrl: m.urls.zoom,
            status: "done",
            fromCache: m.fromCache,
          });
          return next;
        });
        // fetch and cache blobs
        fetchAndCache(m.id, m.token, m.etag, m.urls);
      } else if (msg.type === "spectrum:error") {
        const m = msg as SpectrumErrorMessage;
        setEntries((prev) => {
          const next = new Map(prev);
          const cur = next.get(m.id) ?? { id: m.id, status: "idle" as const };
          next.set(m.id, { ...cur, status: "error", error: m.error });
          return next;
        });
      }
    });
    return unsub;
  }, [subscribe, fetchAndCache]);

  // cleanup blobUrls on unmount
  useEffect(() => {
    return () => {
      for (const v of blobUrls.current.values()) {
        if (v.full) try { URL.revokeObjectURL(v.full); } catch {}
        if (v.zoom) try { URL.revokeObjectURL(v.zoom); } catch {}
      }
    };
  }, []);

  const requestSpectrum = useCallback((id: string) => {
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
    setEntries((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { id, status: "idle" as const };
      next.set(id, { ...cur, status: "queued", error: undefined });
      return next;
    });
    send({ type: "spectrum:request", id });
  }, [send]);

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
