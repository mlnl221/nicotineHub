"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/lib/session";
import type { Transfer, TransferStatsMessage } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { mockDemoTransfers } from "@/lib/demo/fixtures";

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

const STORAGE_KEY = "nicotineHub.transfers.mock";

function loadInitial(): Transfer[] {
  if (typeof window === "undefined") return [];
  // In prod (non-demo) never hydrate demo mock transfers — they are vercel-demo only
  if (!isDemo) {
    try {
      const raw = (window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(STORAGE_KEY.replace("nicotineHub.", "nicotine.")));
      if (raw && (raw.includes("jazzcat::") || raw.includes("vinyl_hunter::") || raw.includes("Summer Rain") || raw.includes("Midnight Groove"))) {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(STORAGE_KEY.replace("nicotineHub.", "nicotine."));
      }
      window.localStorage.removeItem("nicotineHub.demoSeeded");
      window.localStorage.removeItem("nicotine.demoSeeded");
      window.sessionStorage.removeItem("__demoTransfersSeeded");
      // Only clear __mockTransfers if it contains demo fixtures — preserve e2e mock transfers (alice/bob) used in playwright
      try {
        const mockRaw = window.sessionStorage.getItem("__mockTransfers");
        if (mockRaw && (mockRaw.includes("jazzcat::") || mockRaw.includes("vinyl_hunter::") || mockRaw.includes("Midnight Groove") || mockRaw.includes("Summer Rain"))) {
          window.sessionStorage.removeItem("__mockTransfers");
        }
      } catch {}
    } catch {}
    // Playwright e2e cross-navigation: hydrate from sessionStorage mock (alice/bob) if present
    try {
      const mockRaw = window.sessionStorage.getItem("__mockTransfers");
      if (mockRaw && (mockRaw.includes("alice::") || mockRaw.includes("bob::") || mockRaw.includes("Archive_Collection") || mockRaw.includes("HighRes_Audio"))) {
        const parsed = JSON.parse(mockRaw);
        if (Array.isArray(parsed) && parsed.length) return parsed as Transfer[];
      }
    } catch {}
    return [];
  }
  try {
    const raw = (window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(STORAGE_KEY.replace("nicotineHub.", "nicotine.")));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Transfer[];
    return [];
  } catch {
    return [];
  }
}

export function TransfersProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, state } = useSession();
  // Hydration-safe: start with defaults ([]) on both server & first client render,
  // then hydrate from localStorage after mount. See config/provider.tsx pattern.
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [stats, setStats] = useState<TransferStatsMessage | null>(null);
  const hydrated = useRef(false);
  const demoAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const loaded = loadInitial();
    setTransfers(loaded);
    hydrated.current = true;
  }, []);

  // Prod safeguard: if not in demo, immediately purge any demo transfers that may have leaked (HMR / stale storage)
  useEffect(() => {
    if (isDemo) return;
    if (!hydrated.current) return;
    const demoIds = new Set(mockDemoTransfers().map((t) => t.id));
    if (transfers.some((t) => demoIds.has(t.id))) {
      setTransfers((prev) => prev.filter((t) => !demoIds.has(t.id)));
    }
  }, [transfers]);

  // Persist mock transfers for demo refresh (skip initial write)
  // In demo we throttle writes to avoid churn from animation (updates every ~900ms)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated.current) return;
    // Demo animation throttles persist to once per 3s via timeout
    if (isDemo) {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers)); } catch {}
      }, 1200);
      return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers));
    } catch {
      // ignore
    }
  }, [transfers]);

  // Demo: inject two fake transfers (download + upload) if empty after hydrate
  useEffect(() => {
    if (!isDemo) return;
    if (!hydrated.current) return;
    if (transfers.length !== 0) return;
    if (state.status !== "connected") return;
    try {
      if (sessionStorage.getItem("__demoTransfersSeeded")) return;
      sessionStorage.setItem("__demoTransfersSeeded", "1");
    } catch {}
    const seeded = mockDemoTransfers();
    setTransfers(seeded);
  }, [state.status, transfers.length]);

  // Demo: animate Transferring progress so downloads/uploads look live
  useEffect(() => {
    if (!isDemo) return;
    if (transfers.length === 0) return;
    const hasTransferring = transfers.some((t) => t.status === "Transferring");
    if (!hasTransferring) {
      if (demoAnimRef.current) { clearInterval(demoAnimRef.current); demoAnimRef.current = null; }
      return;
    }
    if (demoAnimRef.current) return; // already running
    demoAnimRef.current = setInterval(() => {
      setTransfers((prev) =>
        prev.map((t) => {
          if (t.status !== "Transferring") return t;
          // increment by ~0.8s worth of speed, with jitter
          const jitter = 0.85 + Math.random() * 0.3;
          const inc = Math.floor(t.speed * 0.9 * jitter);
          const nextCurrent = Math.min(t.size, t.current + inc);
          const nextSpeed = Math.floor(t.speed * (0.88 + Math.random() * 0.24));
          const remaining = t.size - nextCurrent;
          const timeLeft = nextSpeed ? Math.ceil(remaining / nextSpeed) : null;
          if (nextCurrent >= t.size) {
            return { ...t, current: t.size, speed: 0, timeLeft: null, status: "Finished" as const };
          }
          return {
            ...t,
            current: nextCurrent,
            speed: nextSpeed,
            avgSpeed: Math.floor((t.avgSpeed + nextSpeed) / 2),
            timeLeft,
          };
        }),
      );
    }, 900);
    return () => {
      if (demoAnimRef.current) { clearInterval(demoAnimRef.current); demoAnimRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, transfers.length]);

  // Demo: clear on logout
  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "idle") return;
    if (demoAnimRef.current) { clearInterval(demoAnimRef.current); demoAnimRef.current = null; }
    setTransfers([]);
    try { sessionStorage.removeItem("__demoTransfersSeeded"); } catch {}
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, [state.status]);

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
      if (isDemo) return;
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
