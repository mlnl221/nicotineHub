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
}

interface StatsApi {
  total: StatsData | null;
  session: StatsData | null;
  refresh: () => void;
  loading: boolean;
}

const StatsContext = createContext<StatsApi | null>(null);

export function StatisticsProvider({ children }: { children: React.ReactNode }) {
  const { send, subscribe, state } = useSession();
  const [total, setTotal] = useState<StatsData | null>(null);
  const [sessionStat, setSessionStat] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (state.status !== "connected") return;
    setLoading(true);
    send({ type: "statistics:request" } as unknown as never);
    setTimeout(() => setLoading(false), 1200);
  }, [send, state.status]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      const m = msg as unknown as { type: string; total?: StatsData; session?: StatsData };
      if (m.type === "statistics:response") {
        if (m.total) setTotal(m.total);
        if (m.session) setSessionStat(m.session);
        setLoading(false);
      }
    });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    if (state.status === "connected") refresh();
  }, [state.status, refresh]);

  return <StatsContext.Provider value={{ total, session: sessionStat, refresh, loading }}>{children}</StatsContext.Provider>;
}

export function useStatistics() {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error("useStatistics must be used within StatisticsProvider");
  return ctx;
}
