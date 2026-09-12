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
import { workerFetch } from "@/lib/worker";

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
  /** Nicotine-plus parity bulk clear (list entries only). statuses null = everything in direction. */
  clearMany: (isUpload: boolean, statuses: string[] | null) => void;
  /** Abort: downloads -> pause, uploads -> cancel (nicotine abort semantics). */
  abortTransfer: (id: string, isUpload: boolean) => void;
  banUser: (username: string) => void;
  /** Private-message every distinct user (uploads "Message All"). */
  messageAll: (usernames: string[], message: string) => void;
}

// Nicotine-plus parity clear sets (pynicotine gtkgui/downloads.py + uploads.py).
// "Deleted" (Finished + file missing on disk) omitted — browser cannot stat files.
export const DOWNLOAD_CLEAR_SETS: Record<string, string[] | null> = {
  "finished-filtered": ["Finished", "Filtered"],
  finished: ["Finished"],
  paused: ["Paused"],
  filtered: ["Filtered"],
  queued: ["Queued"],
  all: null,
};
export const UPLOAD_CLEAR_SETS: Record<string, string[] | null> = {
  "finished-cancelled-failed": ["Cancelled", "Finished", "Connection timeout", "Local file error"],
  "finished-cancelled": ["Cancelled", "Finished"],
  finished: ["Finished"],
  cancelled: ["Cancelled"],
  failed: ["Connection timeout", "Local file error"],
  "logged-off": ["User logged off"],
  queued: ["Queued"],
  all: null,
};

const TransfersContext = createContext<TransfersApi | null>(null);

const STORAGE_KEY = "nicotineHub.transfers.mock";

// Clears that may never have reached the bridge (reload drops the in-memory
// send queue). Flushed on reconnect; resend is a no-op for ids already gone.
const PENDING_CLEAR_KEY = "nicotineHub.transfers.pendingClear";
interface PendingClear { id: string; isUpload: boolean }
function loadPendingClear(): PendingClear[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_CLEAR_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.id === "string").slice(0, 100);
  } catch { return []; }
}
function savePendingClear(list: PendingClear[]) {
  try { window.localStorage.setItem(PENDING_CLEAR_KEY, JSON.stringify(list)); } catch {}
}

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

  // trigger worker media scan on finished download (fire-and-forget, tab-open only)
  const triggerScan = useCallback((t: Transfer | { id: string; fileName: string; size: number; downloadUrl?: string; username?: string; virtualPath?: string }) => {
    const id = t.id;
    const username = (t as Transfer).username ?? id.split("::")[0] ?? "";
    const virtualPath = (t as Transfer).virtualPath ?? id.split("::").slice(1).join("::") ?? "";
    const fileName = (t as Transfer).fileName ?? (t as { fileName: string }).fileName ?? virtualPath.split("\\").pop() ?? "";
    const size = (t as Transfer).size ?? (t as { size: number }).size ?? 0;
    const downloadUrl = (t as { downloadUrl?: string }).downloadUrl ?? "";
    const destinationPath = ""; // worker will resolve via DATA_DIR if needed
    // Do not block — log and swallow
    workerFetch("/scan", {
      method: "POST",
      body: JSON.stringify({ fileName, size, username, virtualPath, transferId: id, downloadUrl, destinationPath }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "transfer:update") {
        const becameFinished = msg.transfer.status === "Finished" && !msg.transfer.isUpload;
        setTransfers((prev) => {
          const idx = prev.findIndex((t) => t.id === msg.transfer.id);
          const wasFinished = idx >= 0 ? prev[idx].status === "Finished" : false;
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.transfer;
            return next;
          }
          return [...prev, msg.transfer];
        });
        if (becameFinished) triggerScan(msg.transfer);
      } else if (msg.type === "transfer:queue") {
        setTransfers((prev) => prev.map((t) => (t.id === msg.id ? { ...t, queuePosition: msg.place, status: "Queued" as const } : t)));
      } else if (msg.type === "transfer:finished") {
        const finishedUrl = (msg as { downloadUrl?: string }).downloadUrl;
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === msg.id
              ? { ...t, status: "Finished" as const, current: t.size, speed: 0, timeLeft: null, queuePosition: null, ...(finishedUrl ? { downloadUrl: finishedUrl } : null) }
              : t,
          ),
        );
        // fire worker scan for finished download
        const dummy: Transfer = {
          id: msg.id,
          username: msg.id.split("::")[0] ?? "",
          virtualPath: msg.id.split("::").slice(1).join("::") ?? msg.fileName,
          fileName: msg.fileName,
          size: msg.size,
          current: msg.size,
          speed: 0,
          avgSpeed: 0,
          timeLeft: null,
          status: "Finished",
          queuePosition: null,
          isUpload: false,
        };
        triggerScan({ ...dummy, downloadUrl: (msg as { downloadUrl?: string }).downloadUrl } as unknown as Transfer);
        // Optionally trigger browser download via hidden link (Phase 5 OPFS handling deferred)
        // We keep it non-intrusive: UI will show Finished with downloadUrl available
      } else if (msg.type === "transfer:removed") {
        savePendingClear(loadPendingClear().filter((p) => p.id !== msg.id));
        setTransfers((prev) => prev.filter((t) => t.id !== msg.id));
      } else if (msg.type === "transfer:stats") {
        setStats(msg);
      }
    });
    return unsub;
  }, [subscribe, triggerScan]);

  // Flush clears that predated a reload/reconnect. No-op for ids already gone.
  useEffect(() => {
    if (isDemo || state.status !== "connected") return;
    const pending = loadPendingClear();
    if (!pending.length) return;
    for (const p of pending) {
      try {
        if (p.isUpload) send({ type: "upload:control", id: p.id, action: "clear" });
        else send({ type: "download:control", id: p.id, action: "clear" });
      } catch {}
    }
    savePendingClear([]);
  }, [state.status, send]);

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
      // Durable intent: if this never reaches the bridge (offline/reload),
      // the reconnect flush resends it so the row can't resurrect.
      const pending = loadPendingClear();
      if (!pending.some((p) => p.id === id)) {
        pending.push({ id, isUpload });
        savePendingClear(pending);
      }
      // Bridge denies Queued uploads on clear so the peer can't requeue them.
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

  const clearMany = useCallback(
    (isUpload: boolean, statuses: string[] | null) => {
      send({ type: "transfer:clear-many", isUpload, statuses });
      // optimistic: drop matching rows locally
      setTransfers((prev) =>
        prev.filter((t) => {
          if (t.isUpload !== isUpload) return true;
          if (!statuses || statuses.length === 0) return false;
          return !statuses.includes(t.status);
        }),
      );
    },
    [send],
  );

  const abortTransfer = useCallback(
    (id: string, isUpload: boolean) => {
      if (isUpload) {
        send({ type: "upload:control", id, action: "cancel" });
        setTransfers((prev) => prev.map((t) => (t.id === id && t.isUpload ? { ...t, status: "Cancelled" as const } : t)));
      } else {
        send({ type: "download:control", id, action: "pause" });
        setTransfers((prev) => prev.map((t) => (t.id === id && !t.isUpload ? { ...t, status: "Paused" as const } : t)));
      }
    },
    [send],
  );

  const banUser = useCallback(
    (username: string) => {
      const name = username.trim();
      if (!name) return;
      send({ type: "ban:add", username: name });
    },
    [send],
  );

  const messageAll = useCallback(
    (usernames: string[], message: string) => {
      const msg = message.trim().slice(0, 5000);
      if (!msg) return;
      [...new Set(usernames.map((u) => u.trim()).filter(Boolean))].forEach((u) => send({ type: "chat:private", action: "send", username: u, message: msg }));
    },
    [send],
  );

  const downloads = useMemo(() => transfers.filter((t) => !t.isUpload), [transfers]);
  const uploads = useMemo(() => transfers.filter((t) => t.isUpload), [transfers]);

  const api = useMemo<TransfersApi>(
    () => ({ transfers, downloads, uploads, stats, requestDownload, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer, cancelUpload, clearMany, abortTransfer, banUser, messageAll }),
    [transfers, downloads, uploads, stats, requestDownload, cancelDownload, pauseDownload, resumeDownload, retryDownload, clearTransfer, cancelUpload, clearMany, abortTransfer, banUser, messageAll],
  );

  return <TransfersContext.Provider value={api}>{children}</TransfersContext.Provider>;
}

export function useTransfers(): TransfersApi {
  const ctx = useContext(TransfersContext);
  if (!ctx) throw new Error("useTransfers must be used within TransfersProvider");
  return ctx;
}
