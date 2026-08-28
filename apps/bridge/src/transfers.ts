/**
 * Minimal in-memory transfer manager for the bridge (Phase 2 stub).
 *
 * Mirrors nicotine-plus Transfers but without real F sockets. Each download
 * cycles Queued → Getting status → Transferring → Finished, emitting
 * `transfer:update` WebSocket messages driven by timers. Uploads are
 * enqueued as Queued and stay there unless shares are configured, matching
 * the "visible but disabled when no shares" requirement.
 *
 * Data layout intentionally mirrors `apps/web/src/lib/protocol.ts:Transfer`.
 */

export type TransferStatus =
  | "Queued"
  | "Getting status"
  | "Transferring"
  | "Paused"
  | "Cancelled"
  | "Filtered"
  | "Finished"
  | "User logged off"
  | "Connection closed"
  | "Connection timeout"
  | "Download folder error"
  | "Local file error"
  | "Banned"
  | "File not shared."
  | "File read error."
  | "Pending shutdown."
  | "Too many files"
  | "Too many megabytes";

export interface BridgeTransfer {
  id: string;
  username: string;
  virtualPath: string;
  fileName: string;
  size: number;
  current: number;
  speed: number;
  avgSpeed: number;
  timeLeft: number | null;
  status: TransferStatus;
  queuePosition: number | null;
  isUpload: boolean;
  // internal
  _timer?: Timer;
  _startTime?: number;
  _transferredAtStart?: number;
}

export type TransferUpdateCb = (t: BridgeTransfer) => void;
export type TransferRemovedCb = (id: string) => void;
export type TransferStatsCb = (stats: {
  downloadSpeed: number;
  uploadSpeed: number;
  activeDownloads: number;
  activeUploads: number;
  queuedDownloads: number;
  queuedUploads: number;
}) => void;

function fileNameOf(virtualPath: string): string {
  const parts = virtualPath.split("\\");
  return parts[parts.length - 1] || virtualPath;
}

export class TransferManager {
  private transfers = new Map<string, BridgeTransfer>();
  private onUpdate: TransferUpdateCb;
  private onRemoved: TransferRemovedCb;
  private onStats: TransferStatsCb;
  private statsTimer: Timer | null = null;
  private dataDir: string;

  constructor(opts: {
    dataDir?: string;
    onUpdate: TransferUpdateCb;
    onRemoved: TransferRemovedCb;
    onStats: TransferStatsCb;
  }) {
    this.onUpdate = opts.onUpdate;
    this.onRemoved = opts.onRemoved;
    this.onStats = opts.onStats;
    this.dataDir = opts.dataDir || process.env.DATA_DIR || "/data";

    // Ensure volume directories exist (best-effort)
    try {
      const { mkdirSync, existsSync } = require("node:fs");
      for (const sub of ["", "downloads", "incomplete", "uploads"]) {
        const p = sub ? `${this.dataDir}/${sub}` : this.dataDir;
        if (!existsSync(p)) mkdirSync(p, { recursive: true });
      }
      this.loadFromDisk();
    } catch {
      // fallback — in-memory only if volume not writable
    }

    // Demo uploads: two queued examples to show UI when bridge starts.
    // In real mode uploads would only appear when peers QueueUpload us.
    this.seedDemoUploads();

    this.statsTimer = setInterval(() => this.emitStats(), 2000);
  }

  private persist() {
    try {
      const { writeFileSync } = require("node:fs");
      const serial = [...this.transfers.values()].map(({ _timer: _t, _startTime: _s, _transferredAtStart: _a, ...rest }) => rest);
      writeFileSync(`${this.dataDir}/transfers.json`, JSON.stringify(serial, null, 2));
    } catch {}
  }

  private loadFromDisk() {
    try {
      const { readFileSync, existsSync } = require("node:fs");
      const p = `${this.dataDir}/transfers.json`;
      if (!existsSync(p)) return;
      const raw = JSON.parse(readFileSync(p, "utf8")) as BridgeTransfer[];
      for (const t of raw) {
        // Reset transient progress timers; persisted status stays
        if (t.status === "Transferring") t.status = "Paused";
        t.current = t.current ?? 0;
        t.speed = 0;
        this.transfers.set(t.id, t as BridgeTransfer);
      }
    } catch {}
  }

  private seedDemoUploads() {
    const demo: BridgeTransfer[] = [
      {
        id: "CollabNode01::Music\\Project_Zephyr_Render_V4.mp4",
        username: "CollabNode01",
        virtualPath: "Music\\Project_Zephyr_Render_V4.mp4",
        fileName: "Project_Zephyr_Render_V4.mp4",
        size: 1_200_000_000,
        current: 300_000_000,
        speed: 4_100_000,
        avgSpeed: 3_800_000,
        timeLeft: 920,
        status: "Transferring",
        queuePosition: null,
        isUpload: true,
      },
      {
        id: "peer2::Dataset_Analytics_2023.csv",
        username: "peer2",
        virtualPath: "Dataset_Analytics_2023.csv",
        fileName: "Dataset_Analytics_2023.csv",
        size: 45_000_000,
        current: 0,
        speed: 0,
        avgSpeed: 0,
        timeLeft: null,
        status: "Queued",
        queuePosition: 2,
        isUpload: true,
      },
    ];
    for (const t of demo) this.transfers.set(t.id, t);
    // emit after construction tick
    setTimeout(() => {
      for (const t of this.transfers.values()) if (t.isUpload) this.onUpdate({ ...t });
      this.emitStats();
    }, 100);
  }

  private emit(t: BridgeTransfer) {
    const { _timer: _t, _startTime: _s, _transferredAtStart: _a, ...publicT } = t;
    this.onUpdate(publicT as BridgeTransfer);
    this.persist();
  }

  private emitStats() {
    const vals = [...this.transfers.values()];
    const activeDownloads = vals.filter((t) => !t.isUpload && t.status === "Transferring").length;
    const activeUploads = vals.filter((t) => t.isUpload && t.status === "Transferring").length;
    const queuedDownloads = vals.filter((t) => !t.isUpload && t.status === "Queued").length;
    const queuedUploads = vals.filter((t) => t.isUpload && t.status === "Queued").length;
    const downloadSpeed = vals.filter((t) => !t.isUpload && t.status === "Transferring").reduce((s, t) => s + t.speed, 0);
    const uploadSpeed = vals.filter((t) => t.isUpload && t.status === "Transferring").reduce((s, t) => s + t.speed, 0);
    this.onStats({ downloadSpeed, uploadSpeed, activeDownloads, activeUploads, queuedDownloads, queuedUploads });
  }

  list(): BridgeTransfer[] {
    return [...this.transfers.values()].map(({ _timer: _t, _startTime: _s, _transferredAtStart: _a, ...rest }) => rest as BridgeTransfer);
  }

  get(id: string): BridgeTransfer | undefined {
    return this.transfers.get(id);
  }

  requestDownload(username: string, virtualPath: string, size: number, fileName?: string) {
    const id = `${username}::${virtualPath}`;
    if (this.transfers.has(id)) {
      const existing = this.transfers.get(id)!;
      this.emit(existing);
      return existing;
    }
    const t: BridgeTransfer = {
      id,
      username,
      virtualPath,
      fileName: fileName ?? fileNameOf(virtualPath),
      size: size || 1_000_000,
      current: 0,
      speed: 0,
      avgSpeed: 0,
      timeLeft: null,
      status: "Queued",
      queuePosition: Math.max(1, [...this.transfers.values()].filter((x) => !x.isUpload && x.status === "Queued").length + 1),
      isUpload: false,
    };
    this.transfers.set(id, t);
    this.emit(t);
    this.emitStats();

    // Simulate queue → getting status → transferring
    setTimeout(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Queued") return;
      cur.status = "Getting status";
      this.emit(cur);
    }, 350);
    setTimeout(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Getting status") return;
      cur.status = "Transferring";
      cur._startTime = Date.now();
      cur._transferredAtStart = 0;
      this.startProgress(id);
      this.emit(cur);
      this.emitStats();
    }, 1200);
    return t;
  }

  private startProgress(id: string) {
    const t = this.transfers.get(id);
    if (!t) return;
    if (t._timer) clearInterval(t._timer);
    t._timer = setInterval(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Transferring") {
        if (cur?._timer) clearInterval(cur._timer);
        return;
      }
      // Simulated chunk: 2–5 MB/s varied
      const chunk = 2_000_000 + Math.random() * 3_000_000;
      const step = Math.min(chunk * 0.5, cur.size - cur.current);
      cur.current += step;
      const elapsed = (Date.now() - (cur._startTime ?? Date.now())) / 1000;
      cur.speed = step * 2; // per 0.5s
      cur.avgSpeed = elapsed > 0 ? cur.current / elapsed : cur.speed;
      cur.timeLeft = cur.speed > 0 ? Math.ceil((cur.size - cur.current) / cur.speed) : null;
      if (cur.current >= cur.size) {
        cur.current = cur.size;
        cur.status = "Finished";
        cur.speed = 0;
        cur.timeLeft = null;
        clearInterval(cur._timer!);
        cur._timer = undefined;
      }
      this.emit(cur);
      this.emitStats();
    }, 500);
  }

  controlDownload(id: string, action: "cancel" | "pause" | "resume" | "retry" | "clear") {
    const t = this.transfers.get(id);
    if (!t) return;
    if (t.isUpload) return;
    switch (action) {
      case "cancel":
        t.status = "Cancelled";
        if (t._timer) clearInterval(t._timer);
        t.speed = 0;
        this.emit(t);
        this.emitStats();
        break;
      case "pause":
        if (t.status === "Transferring" && t._timer) clearInterval(t._timer);
        t.status = "Paused";
        t.speed = 0;
        this.emit(t);
        this.emitStats();
        break;
      case "resume":
      case "retry":
        t.status = "Queued";
        t.queuePosition = 1;
        this.emit(t);
        setTimeout(() => {
          const cur = this.transfers.get(id);
          if (!cur || cur.status !== "Queued") return;
          cur.status = "Getting status";
          this.emit(cur);
        }, 300);
        setTimeout(() => {
          const cur = this.transfers.get(id);
          if (!cur || cur.status !== "Getting status") return;
          cur.status = "Transferring";
          cur._startTime = Date.now() - (cur.current / (cur.avgSpeed || 1_000_000)) * 1000;
          this.startProgress(id);
          this.emit(cur);
        }, 900);
        break;
      case "clear":
        if (t._timer) clearInterval(t._timer);
        this.transfers.delete(id);
        this.onRemoved(id);
        this.emitStats();
        this.persist();
        break;
    }
  }

  controlUpload(id: string, action: "cancel" | "clear") {
    const t = this.transfers.get(id);
    if (!t || !t.isUpload) return;
    if (action === "cancel") {
      t.status = "Cancelled";
      this.emit(t);
      this.emitStats();
      this.persist();
    } else if (action === "clear") {
      this.transfers.delete(id);
      this.onRemoved(id);
      this.emitStats();
      this.persist();
    }
  }

  close() {
    for (const t of this.transfers.values()) if (t._timer) clearInterval(t._timer);
    if (this.statsTimer) clearInterval(this.statsTimer);
  }
}
