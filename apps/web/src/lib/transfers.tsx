"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/lib/session";
import type { Transfer, TransferStatsMessage } from "@/lib/protocol";

interface TransfersApi {
  transfers: Transfer[];
  downloads: Transfer[];
  uploads: Transfer[];
  stats: TransferStatsMessage | null;
  requestDownload: (opts: { username: string; virtualPath: string; size: number; fileName?: string }) => void;
  cancelDownload: (id: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  retryDownload: (id: string) => void;
  clearTransfer: (id: string, isUpload: boolean) => void;
  cancelUpload: (id: string) => void;
}

const TransfersContext = createContext<TransfersApi | null>(null);

const STORAGE_KEY = "nicotine.transfers.mock";

function loadInitial(): Transfer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Transfer[];
    return [];
  } catch {
    return [];
  }
}

export function TransfersProvider({ children }: { children: ReactNode }) {
  const { send, subscribe } = useSession();
  const [transfers, setTransfers] = useState<Transfer[]>(() => loadInitial());
  const [stats, setStats] = useState<TransferStatsMessage | null>(null);

  // Persist mock transfers for demo refresh
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers));
    } catch {
      // ignore
    }
  }, [transfers]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "transfer:update") {
        setTransfers((prev) => {
          const idx = prev.findIndex((t) => t.id === msg.transfer.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.transfer;
            return next;
          }
          return [...prev, msg.transfer];
        });
      } else if (msg.type === "transfer:queue") {
        setTransfers((prev) => prev.map((t) => (t.id === msg.id ? { ...t, queuePosition: msg.place, status: "Queued" as const } : t)));
      } else if (msg.type === "transfer:finished") {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === msg.id
              ? { ...t, status: "Finished" as const, current: t.size, speed: 0, timeLeft: null, queuePosition: null }
              : t,
          ),
        );
        // Optionally trigger browser download via hidden link (Phase 5 OPFS handling deferred)
        // We keep it non-intrusive: UI will show Finished with downloadUrl available
      } else if (msg.type === "transfer:removed") {
        setTransfers((prev) => prev.filter((t) => t.id !== msg.id));
      } else if (msg.type === "transfer:stats") {
        setStats(msg);
      }
    });
    return unsub;
  }, [subscribe]);

  const requestDownload = useCallback(
    (opts: { username: string; virtualPath: string; size: number; fileName?: string }) => {
      // Optimistic local add for immediate feedback when bridge is mocked
      const id = `${opts.username}::${opts.virtualPath}`;
      const fileName = opts.fileName ?? opts.virtualPath.split("\\").pop() ?? opts.virtualPath;
      const now: Transfer = {
        id,
        username: opts.username,
        virtualPath: opts.virtualPath,
        fileName,
        size: opts.size,
        current: 0,
        speed: 0,
        avgSpeed: 0,
        timeLeft: null,
        status: "Queued",
        queuePosition: null,
        isUpload: false,
      };
      setTransfers((prev) => (prev.find((t) => t.id === id) ? prev : [...prev, now]));
      send({ type: "download:request", username: opts.username, virtualPath: opts.virtualPath, size: opts.size, fileName });
    },
    [send],
  );

  const cancelDownload = useCallback(
    (id: string) => {
      send({ type: "download:control", id, action: "cancel" });
      // optimistic
      setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, status: "Cancelled" as const } : t)));
    },
    [send],
  );

  const pauseDownload = useCallback(
    (id: string) => {
      send({ type: "download:control", id, action: "pause" });
      setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, status: "Paused" as const } : t)));
    },
    [send],
  );

  const resumeDownload = useCallback(
    (id: string) => {
      send({ type: "download:control", id, action: "resume" });
      setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, status: "Queued" as const } : t)));
    },
    [send],
  );

  const retryDownload = useCallback(
    (id: string) => {
      send({ type: "download:control", id, action: "retry" });
      setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, status: "Queued" as const, queuePosition: 1 } : t)));
    },
    [send],
  );

  const clearTransfer = useCallback(
    (id: string, isUpload: boolean) => {
      if (isUpload) send({ type: "upload:control", id, action: "clear" });
      else send({ type: "download:control", id, action: "clear" });
      setTransfers((prev) => prev.filter((t) => t.id !== id));
    },
    [send],
  );

  const cancelUpload = useCallback(
    (id: string) => {
      send({ type: "upload:control", id, action: "cancel" });
      setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, status: "Cancelled" as const } : t)));
    },
    [send],
  );

  const downloads = useMemo(() => transfers.filter((t) => !t.isUpload), [transfers]);
  const uploads = useMemo(() => transfers.filter((t) => t.isUpload), [transfers]);

  const api = useMemo<TransfersApi>(
    () => ({ transfers, downloads, uploads, stats, requestDownload, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer, cancelUpload }),
    [transfers, downloads, uploads, stats, requestDownload, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer, cancelUpload],
  );

  return <TransfersContext.Provider value={api}>{children}</TransfersContext.Provider>;
}

export function useTransfers(): TransfersApi {
  const ctx = useContext(TransfersContext);
  if (!ctx) throw new Error("useTransfers must be used within TransfersProvider");
  return ctx;
}
