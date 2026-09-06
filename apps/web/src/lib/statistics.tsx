"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSession } from "@/lib/session";

export interface StatsData {
  since_timestamp: number;
  started_downloads: number;
  completed_downloads: number;
  downloaded_size: number;
  started_uploads: number;
  completed_uploads: number;
  uploaded_size: number;
  failed_downloads?: number;
  cancelled_downloads?: number;
  failed_uploads?: number;
  cancelled_uploads?: number;
}

export interface LiveStats {
  downloadSpeed: number;
  uploadSpeed: number;
  activeDownloads: number;
  activeUploads: number;
  queuedDownloads: number;
  queuedUploads: number;
}

export interface SharesSummary {
  dirs: number;
  files: number;
  unavailable: number;
}

interface StatsApi {
  total: StatsData | null;
  session: StatsData | null;
  live: LiveStats | null;
  shares: SharesSummary | null;
  refresh: () => void;
  loading: boolean;
}

const StatsContext = createContext<StatsApi | null>(null);

export function StatisticsProvider({ children }: { children: React.ReactNode }) {
  const { send, subscribe, state } = useSession();
  const [total, setTotal] = useState<StatsData | null>(null);
  const [sessionStat, setSessionStat] = useState<StatsData | null>(null);
  const [live, setLive] = useState<LiveStats | null>(null);
  const [shares, setShares] = useState<SharesSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (state.status !== "connected") return;
    setLoading(true);
    send({ type: "statistics:request" } as unknown as never);
    setTimeout(() => setLoading(false), 1200);
  }, [send, state.status]);

  const reset = useCallback(() => {
    if (state.status !== "connected") return;
    send({ type: "statistics:reset" } as unknown as never);
    setLoading(true);
    setTimeout(() => setLoading(false), 800);
  }, [send, state.status]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      const m = msg as unknown as { type: string; total?: StatsData; session?: StatsData; live?: LiveStats; shares?: SharesSummary };
      if (m.type === "statistics:response") {
        if (m.total) setTotal(m.total);
        if (m.session) setSessionStat(m.session);
        if (m.live) setLive(m.live);
        if (m.shares) setShares(m.shares);
        setLoading(false);
      }
      // Live queue/speed snapshot also arrives every 2s as transfer:stats — reuse it.
      if (m.type === "transfer:stats") {
        const s = m as unknown as LiveStats;
        if (typeof s.downloadSpeed === "number") setLive({ downloadSpeed: s.downloadSpeed, uploadSpeed: s.uploadSpeed, activeDownloads: s.activeDownloads, activeUploads: s.activeUploads, queuedDownloads: s.queuedDownloads, queuedUploads: s.queuedUploads });
      }
      if ((m as unknown as { type: string }).type === "statistics:reset:ok") {
        // avoid calling refresh() which would capture stale closure — re-request directly
        send({ type: "statistics:request" } as unknown as never);
        setLoading(true);
        setTimeout(() => setLoading(false), 1200);
      }
    });
    return unsub;
  }, [subscribe, send]);

  useEffect(() => {
    if (state.status === "connected") refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return <StatsContext.Provider value={{ total, session: sessionStat, live, shares, refresh, reset, loading } as StatsApi & { reset: () => void }}>{children}</StatsContext.Provider>;
}

export function useStatistics() {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error("useStatistics must be used within StatisticsProvider");
  return ctx as StatsApi & { reset: () => void };
}
