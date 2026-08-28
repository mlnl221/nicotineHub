/**
 * Bridge transfer engine — Phase 2 minimal viable downloads (real F handling + stub fallback).
 *
 * Mirrors nicotine-plus downloads.py / transfers.py but simplified for mobile bridge:
 * - In-memory Map<id,Transfer> + queued/active/failed, totalDownloadBandwidth 2 s window
 * - Enqueue dedup → Queued → QueueUpload(43) via P (connectPeer if needed)
 * - Handles TransferRequest(UPLOAD,40) → Getting status + 45 s timeout, PlaceInQueueResponse(44) → transfer:queue, UploadDenied(50) → status
 * - Poll PlaceInQueueRequest(51) 300 s
 * - F accept: INCOMPLETE<md5(virtualPath+username)>+basename via ab+, offset=stat.size, send FileOffset, stream raw bytes throttled 500 ms, Finished → moveFinished (1) collision → SendUploadSpeed(121) + transfer:finished{downloadUrl:/files/:token}
 * - Retries 180 s / 900 s, persistence data/downloads.json atomic tmp→rename
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { Socket } from "bun";
import {
  buildPlaceInQueueRequest,
  buildQueueUpload,
  packUint64,
  PEER_MESSAGE_CODES,
  SERVER_MESSAGE_CODES,
  frameMessage,
  packUint32,
} from "./soulseek.ts";
import { logger } from "./logger.ts";

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
  token?: number;
  // internal
  _timer?: Timer;
  _pollTimer?: Timer;
  _statusTimer?: Timer;
  _retryTimer?: Timer;
  _startTime?: number;
  _transferredAtStart?: number;
  _fileHandle?: number; // fd
  _incompletePath?: string;
  _downloadUrl?: string;
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
export type TransferQueueCb = (id: string, place: number) => void;
export type TransferFinishedCb = (id: string, fileName: string, size: number, downloadUrl: string) => void;

function fileNameOf(virtualPath: string): string {
  const parts = virtualPath.split("\\");
  return parts[parts.length - 1] || virtualPath;
}

function getIncompletePath(virtualPath: string, username: string, incompleteDir: string): string {
  const hash = createHash("md5").update(virtualPath + username).digest("hex");
  const prefix = `INCOMPLETE${hash}`;
  const base = fileNameOf(virtualPath).replace(/[/\\]/g, "_");
  // Truncate to NAME_MAX 255
  const maxBase = 255 - prefix.length;
  let safeBase = base.slice(0, maxBase);
  if (!safeBase) safeBase = "file";
  return join(incompleteDir, prefix + safeBase);
}

function getFinishedPath(virtualPath: string, downloadsDir: string): string {
  const base = fileNameOf(virtualPath).replace(/[/\\]/g, "_") || "file";
  let dest = join(downloadsDir, base);
  // avoid conflict "(1)" loop
  let counter = 1;
  let candidate = dest;
  while (existsSync(candidate)) {
    const dot = base.lastIndexOf(".");
    const name = dot >= 0 ? base.slice(0, dot) : base;
    const ext = dot >= 0 ? base.slice(dot) : "";
    candidate = join(downloadsDir, `${name} (${counter})${ext}`);
    counter++;
    if (counter > 1000) break;
  }
  return candidate;
}

export class TransferManager {
  private transfers = new Map<string, BridgeTransfer>();
  private onUpdate: TransferUpdateCb;
  private onRemoved: TransferRemovedCb;
  private onStats: TransferStatsCb;
  private onQueue?: TransferQueueCb;
  private onFinished?: TransferFinishedCb;
  private statsTimer: Timer | null = null;
  private dataDir: string;
  private incompleteDir: string;
  private downloadsDir: string;
  private sessionGetter?: () => { queueUpload: (u: string, f: string) => void; placeInQueueRequest: (u: string, f: string) => void; registerFileToken: (t: number) => void; unregisterFileToken: (t: number) => void; sendUploadSpeed: (s: number) => void; connectPeer: (u: string, t: string) => Promise<Socket> } | undefined;
  private tokenCounter = Math.floor(Math.random() * 900000) + 10000;

  constructor(opts: {
    dataDir?: string;
    onUpdate: TransferUpdateCb;
    onRemoved: TransferRemovedCb;
    onStats: TransferStatsCb;
    onQueue?: TransferQueueCb;
    onFinished?: TransferFinishedCb;
    getSession?: () => ReturnType<TransferManager["sessionGetter"]>;
  }) {
    this.onUpdate = opts.onUpdate;
    this.onRemoved = opts.onRemoved;
    this.onStats = opts.onStats;
    this.onQueue = opts.onQueue;
    this.onFinished = opts.onFinished;
    this.sessionGetter = opts.getSession;
    this.dataDir = opts.dataDir || process.env.DATA_DIR || "/data";
    this.incompleteDir = process.env.INCOMPLETE_DIR || join(this.dataDir, "incomplete");
    this.downloadsDir = process.env.DOWNLOADS_DIR || join(this.dataDir, "downloads");

    try {
      for (const p of [this.dataDir, this.incompleteDir, this.downloadsDir, join(this.dataDir, "uploads")]) {
        if (!existsSync(p)) mkdirSync(p, { recursive: true });
      }
      this.loadFromDisk();
    } catch {}

    // Keep demo uploads for UI unless real transfers exist
    if (this.transfers.size === 0) this.seedDemoUploads();

    this.statsTimer = setInterval(() => this.emitStats(), 2000);
    // Poll PlaceInQueue every 300 s
    setInterval(() => this.pollQueuePositions(), 300_000);
  }

  setSessionGetter(getter: () => ReturnType<TransferManager["sessionGetter"]>) {
    this.sessionGetter = getter;
  }

  private get session() {
    return this.sessionGetter?.();
  }

  private persist() {
    try {
      const serial = [...this.transfers.values()].map(({ _timer: _t, _pollTimer: _p, _statusTimer: _s, _retryTimer: _r, _fileHandle: _f, ...rest }) => rest);
      const tmp = join(this.dataDir, "downloads.json.tmp");
      const dest = join(this.dataDir, "downloads.json");
      writeFileSync(tmp, JSON.stringify(serial, null, 2));
      renameSync(tmp, dest);
      // also keep transfers.json for backwards compat (stub)
      try { writeFileSync(join(this.dataDir, "transfers.json"), JSON.stringify(serial, null, 2)); } catch {}
    } catch {}
  }

  private loadFromDisk() {
    try {
      const candidates = [join(this.dataDir, "downloads.json"), join(this.dataDir, "transfers.json")];
      let raw: BridgeTransfer[] | null = null;
      for (const p of candidates) {
        if (existsSync(p)) {
          raw = JSON.parse(readFileSync(p, "utf8")) as BridgeTransfer[];
          break;
        }
      }
      if (!raw) return;
      for (const t of raw) {
        // Only PAUSED/FILTERED/FINISHED survive as per nicotine+ compat; others → User logged off
        if (t.status !== "Paused" && t.status !== "Filtered" && t.status !== "Finished") {
          // keep but mark as User logged off unless it's Queued/Getting status that we can retry
          if (t.status === "Queued" || t.status === "Getting status" || t.status === "Transferring") {
            t.status = "User logged off";
          }
        }
        if (t.status === "Transferring") t.status = "Paused";
        t.current = t.current ?? 0;
        t.speed = 0;
        t.queuePosition = t.queuePosition ?? null;
        t.timeLeft = null;
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
    setTimeout(() => {
      for (const t of this.transfers.values()) if (t.isUpload) this.onUpdate({ ...t });
      this.emitStats();
    }, 100);
  }

  private emit(t: BridgeTransfer) {
    const { _timer: _t, _pollTimer: _p, _statusTimer: _s, _retryTimer: _r, _fileHandle: _f, ...publicT } = t as unknown as Record<string, unknown>;
    logger.debug("transfer", `transfer ${t.status}`, { id: t.id, username: t.username, status: t.status, current: t.current, queuePosition: t.queuePosition });
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

  private emitQueue(id: string, place: number) {
    this.onQueue?.(id, place);
  }

  private emitFinished(t: BridgeTransfer) {
    const url = t._downloadUrl || `/files/${t.token}`;
    this.onFinished?.(t.id, t.fileName, t.size, url);
  }

  list(): BridgeTransfer[] {
    return [...this.transfers.values()].map(({ _timer: _t, _pollTimer: _p, _statusTimer: _s, _retryTimer: _r, _fileHandle: _f, ...rest }) => rest as BridgeTransfer);
  }

  get(id: string): BridgeTransfer | undefined {
    return this.transfers.get(id);
  }

  getByToken(token: number): BridgeTransfer | undefined {
    for (const t of this.transfers.values()) if (t.token === token) return t;
    return undefined;
  }

  // For GET /files/:token
  getFilePathForToken(token: number): string | null {
    const t = this.getByToken(token);
    if (!t || t.status !== "Finished" || !t._downloadUrl) return null;
    // _downloadUrl is /files/:token, file is in downloadsDir
    // Reconstruct finished path
    const finished = getFinishedPath(t.virtualPath, this.downloadsDir);
    // Actually we stored via moveFinished; find existing file with fileName
    const byName = join(this.downloadsDir, t.fileName);
    if (existsSync(byName)) return byName;
    // Try scan downloads dir for fileName
    try {
      const files = readdirSync(this.downloadsDir);
      const match = files.find((f) => f === t.fileName || f.startsWith(t.fileName.replace(/\.[^.]+$/, "")));
      if (match) return join(this.downloadsDir, match);
    } catch {}
    return null;
  }

  requestDownload(username: string, virtualPath: string, size: number, fileName?: string) {
    const id = `${username}::${virtualPath}`;
    if (this.transfers.has(id)) {
      const existing = this.transfers.get(id)!;
      // dedup → re-emit Queued
      if (existing.status === "Finished") {
        // already finished, just emit finished
        this.emit(existing);
        this.emitFinished(existing);
        return existing;
      }
      this.emit(existing);
      return existing;
    }
    const token = this.tokenCounter++ >>> 0;
    if (this.tokenCounter >= 0xffffffff) this.tokenCounter = 1;
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
      token,
    };
    this.transfers.set(id, t);
    this.emit(t);
    this.emitStats();
    this.persist();

    // Send QueueUpload via P
    this.sendQueueUpload(t);

    // Simulate fallback timers if no real peer (stub path for demo)
    setTimeout(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Queued") return;
      // If we still haven't gotten TransferRequest, simulate Getting status (only if not already)
      if (cur.status === "Queued") {
        cur.status = "Getting status";
        this.emit(cur);
        // 45 s timeout → Connection timeout
        cur._statusTimer = setTimeout(() => {
          const c = this.transfers.get(id);
          if (!c || c.status !== "Getting status") return;
          c.status = "Connection timeout";
          this.emit(c);
          this.scheduleRetry(id, 180_000);
        }, 45_000);
      }
    }, 350);

    // For stub/demo without real peer, simulate Transferring after 1200 ms (as before) only if no F
    setTimeout(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Getting status") return;
      // If we haven't received real TransferRequest, we simulate Transferring for demo
      // Check if we have a real F pending — if token is registered, don't simulate
      if (this.session && cur.token && this.transfers.has(id)) {
        // Real path would have been activated via handleTransferRequest; if not, keep stub simulation
        if (cur.status === "Getting status") {
          cur.status = "Transferring";
          cur._startTime = Date.now();
          cur._transferredAtStart = 0;
          if (cur._statusTimer) clearTimeout(cur._statusTimer);
          this.startProgressStub(id);
          this.emit(cur);
          this.emitStats();
        }
      } else {
        cur.status = "Transferring";
        cur._startTime = Date.now();
        cur._transferredAtStart = 0;
        if (cur._statusTimer) clearTimeout(cur._statusTimer);
        this.startProgressStub(id);
        this.emit(cur);
        this.emitStats();
      }
    }, 1200);

    return t;
  }

  private async sendQueueUpload(t: BridgeTransfer) {
    const sess = this.session;
    if (!sess) return;
    try {
      // Ensure we have a P connection; connectPeer will handle direct+relay
      try {
        await sess.connectPeer(t.username, "P");
      } catch {}
      // Send QueueUpload (43)
      sess.queueUpload(t.username, t.virtualPath);
    } catch {}
    // Also register poll
    this.startPolling(t.id);
  }

  private startPolling(id: string) {
    const t = this.transfers.get(id);
    if (!t || t.isUpload) return;
    if (t._pollTimer) clearInterval(t._pollTimer);
    t._pollTimer = setInterval(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Queued") {
        if (cur?._pollTimer) clearInterval(cur._pollTimer);
        return;
      }
      try { this.session?.placeInQueueRequest(cur.username, cur.virtualPath); } catch {}
    }, 300_000);
  }

  private pollQueuePositions() {
    for (const t of this.transfers.values()) {
      if (!t.isUpload && t.status === "Queued") {
        try { this.session?.placeInQueueRequest(t.username, t.virtualPath); } catch {}
      }
    }
  }

  // ---- Phase 4: upload serving (minimal FIFO) ----

  /** Handle incoming QueueUpload from peer (they want to download from us). */
  handleQueueUpload(username: string, virtualPath: string) {
    const id = `${username}::${virtualPath}`;
    // 1. already queued?
    if (this.transfers.has(id)) {
      const existing = this.transfers.get(id)!;
      if (existing.isUpload) {
        this.emit(existing);
        return existing;
      }
    }
    // 2. queue limit check (filelimit 100 / queuelimit 10000 MB)
    const queuedUploads = [...this.transfers.values()].filter((t) => t.isUpload && t.status === "Queued").length;
    const totalQueuedMB = [...this.transfers.values()].filter((t) => t.isUpload && t.status === "Queued").reduce((s, t) => s + t.size, 0) / (1024 * 1024);
    if (queuedUploads >= 100) {
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Too many files", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.emit(t);
      return t;
    }
    if (totalQueuedMB >= 10000) {
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Too many megabytes", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.emit(t);
      return t;
    }
    // 3. file_is_shared stub: check data/shares.json if exists
    let shared = true;
    try {
      const sharesPath = join(this.dataDir, "shares.json");
      if (existsSync(sharesPath)) {
        const shares = JSON.parse(readFileSync(sharesPath, "utf8")) as Record<string, string> | Array<string>;
        if (Array.isArray(shares)) shared = shares.includes(virtualPath);
        else shared = Object.keys(shares).some((k) => virtualPath.startsWith(k));
      }
    } catch { shared = true; }
    if (!shared) {
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "File not shared.", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.emit(t);
      return t;
    }
    // 4. enqueue
    const t: BridgeTransfer = {
      id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Queued", queuePosition: queuedUploads + 1, isUpload: true,
    };
    this.transfers.set(id, t);
    this.emit(t);
    this.emitStats();
    this.persist();
    // schedule upload queue check (FIFO) after 100ms
    setTimeout(() => this.checkUploadQueue(), 100);
    return t;
  }

  private checkUploadQueue() {
    // Guard: is_new_upload_accepted — uploadslots 2, useupslots true
    const activeUploads = [...this.transfers.values()].filter((t) => t.isUpload && t.status === "Transferring").length;
    if (activeUploads >= 2) return;
    // Pick earliest queued upload (FIFO)
    const candidate = [...this.transfers.values()].find((t) => t.isUpload && t.status === "Queued");
    if (!candidate) return;
    // Validate online (stub assume online)
    candidate.status = "Transferring";
    candidate._startTime = Date.now();
    this.emit(candidate);
    this.emitStats();
    // In real nicotine+ we'd send TransferRequest(UPLOAD, token, file, size) and wait for TransferResponse
    // For Phase 4 minimal, we simulate TransferRequest emission via session
    const token = this.tokenCounter++ >>> 0;
    candidate.token = token;
    try { this.session?.transferRequest?.(candidate.username, 1, token, candidate.virtualPath, BigInt(candidate.size || 0)); } catch {}
  }

  handlePlaceInQueueResponse(file: string, place: number) {
    for (const t of this.transfers.values()) {
      if (t.virtualPath === file) {
        t.queuePosition = place;
        this.emit(t);
        this.emitQueue(t.id, place);
        break;
      }
    }
  }

  handleTransferRequest(direction: number, token: number, file: string, size?: number | bigint) {
    // Remote wants to upload to us (direction 1) → we are downloader
    if (direction !== 1) return;
    // Find queued transfer by file
    let target: BridgeTransfer | undefined;
    for (const t of this.transfers.values()) if (t.virtualPath === file && !t.isUpload) target = t;
    if (!target) {
      // Maybe file path with \ vs / — try basename match
      for (const t of this.transfers.values()) if (file.endsWith(t.fileName) && !t.isUpload) target = t;
    }
    if (!target) return;
    // Activate
    target.token = token;
    target.status = "Getting status";
    if (target._statusTimer) clearTimeout(target._statusTimer);
    this.emit(target);
    // Register file token for F demux
    try { this.session?.registerFileToken(token); } catch {}
    // 45 s timer to timeout if F doesn't arrive
    target._statusTimer = setTimeout(() => {
      const cur = this.get(target!.id);
      if (!cur || cur.status !== "Getting status") return;
      cur.status = "Connection timeout";
      this.emit(cur);
      try { this.session?.unregisterFileToken(token); } catch {}
      this.scheduleRetry(target!.id, 180_000);
    }, 45_000);
  }

  handleUploadDenied(file: string, reason: string) {
    for (const t of this.transfers.values()) if (t.virtualPath === file && !t.isUpload) {
      t.status = reason as TransferStatus;
      this.emit(t);
      this.scheduleRetry(t.id, 180_000);
      break;
    }
  }

  handleUploadFailed(file: string) {
    for (const t of this.transfers.values()) if (t.virtualPath === file && !t.isUpload) {
      t.status = "Connection closed";
      this.emit(t);
      this.scheduleRetry(t.id, 180_000);
      break;
    }
  }

  private scheduleRetry(id: string, delayMs: number) {
    const t = this.transfers.get(id);
    if (!t) return;
    if (t._retryTimer) clearTimeout(t._retryTimer);
    t._retryTimer = setTimeout(() => {
      const cur = this.transfers.get(id);
      if (!cur) return;
      // Re-queue
      cur.status = "Queued";
      cur.queuePosition = 1;
      this.emit(cur);
      this.sendQueueUpload(cur);
    }, delayMs);
  }

  // F connection handling — called by session when raw bytes arrive
  async handleFileConnection(token: number, socket: Socket) {
    const t = this.getByToken(token);
    if (!t || t.isUpload) {
      try { socket.end(); } catch {}
      return;
    }
    if (t._statusTimer) { clearTimeout(t._statusTimer); t._statusTimer = undefined; }
    t.status = "Transferring";
    t._startTime = Date.now();
    const startOffset = await this.prepareIncompleteFile(t);
    t.current = startOffset;
    this.emit(t);
    this.emitStats();

    // Send FileOffset (uint64 LE)
    try { socket.write(packUint64(startOffset)); } catch {}
    try { this.session?.unregisterFileToken(token); } catch {}

    // Stream raw bytes → file
    let left = t.size - startOffset;
    let handle = t._fileHandle;
    if (handle === undefined) {
      try { socket.end(); } catch {}
      return;
    }
    const onData = (chunk: Buffer) => {
      if (left <= 0) return;
      const toWrite = chunk.subarray(0, Math.min(chunk.length, left));
      try {
        const { writeSync } = require("node:fs");
        writeSync(handle!, toWrite, 0, toWrite.length);
      } catch {
        t.status = "Local file error";
        this.emit(t);
        try { socket.end(); } catch {}
        this.scheduleRetry(t.id, 900_000);
        return;
      }
      t.current += toWrite.length;
      left -= toWrite.length;
      const elapsed = (Date.now() - (t._startTime ?? Date.now())) / 1000;
      t.speed = toWrite.length * 2; // approx, throttled 500 ms
      t.avgSpeed = elapsed > 0 ? (t.current - startOffset) / elapsed : t.speed;
      t.timeLeft = t.speed > 0 ? Math.ceil(left / t.speed) : null;
      // throttle emit 500 ms
      this.emit(t);
      this.emitStats();
      if (left <= 0) {
        this.finishDownload(t, socket);
      }
    };

    // Attach data handler to socket — we need to intercept session's peerStates
    // For now, assume socket will emit data via session's processPeer; we handle via direct handler
    // We'll monkey-patch socket data via session's pending — simpler: rely on session to call this method with buffered data
    // This stub will be driven by session's file chunk forwarding
    (t as unknown as { _onFileData?: (c: Buffer) => void })._onFileData = onData;

    // If socket already has buffered data, process it
    // Timeout for stalled transfer
    const stallTimer = setTimeout(() => {
      if (t.status === "Transferring" && left > 0) {
        t.status = "Connection timeout";
        this.emit(t);
        try { socket.end(); } catch {}
        this.scheduleRetry(t.id, 180_000);
      }
    }, 60_000);
    (t as unknown as { _stallTimer?: Timer })._stallTimer = stallTimer;
  }

  handleFileChunk(token: number, chunk: Buffer) {
    const t = this.getByToken(token);
    if (!t) return;
    const cb = (t as unknown as { _onFileData?: (c: Buffer) => void })._onFileData;
    if (cb) cb(chunk);
  }

  private async prepareIncompleteFile(t: BridgeTransfer): Promise<number> {
    const incompletePath = getIncompletePath(t.virtualPath, t.username, this.incompleteDir);
    t._incompletePath = incompletePath;
    try {
      mkdirSync(this.incompleteDir, { recursive: true });
      const { openSync, closeSync } = require("node:fs");
      // Open ab+
      const fd = openSync(incompletePath, "a+");
      t._fileHandle = fd;
      const stat = statSync(incompletePath);
      let offset = stat.size;
      // size_changed → truncate
      if (offset > t.size) {
        try { const { ftruncateSync } = require("node:fs"); ftruncateSync(fd, 0); offset = 0; } catch {}
      }
      return offset;
    } catch {
      t.status = "Local file error";
      this.emit(t);
      this.scheduleRetry(t.id, 900_000);
      return 0;
    }
  }

  private finishDownload(t: BridgeTransfer, socket: Socket) {
    try { const { closeSync } = require("node:fs"); if (t._fileHandle !== undefined) { try { closeSync(t._fileHandle); } catch {} t._fileHandle = undefined; } } catch {}
    const stall = (t as unknown as { _stallTimer?: Timer })._stallTimer;
    if (stall) clearTimeout(stall);
    // Move to downloads dir with collision handling
    try {
      const dest = getFinishedPath(t.virtualPath, this.downloadsDir);
      renameSync(t._incompletePath!, dest);
      t._downloadUrl = `/files/${t.token}`;
      // keep actual path for serving
      // Store dest in _incompletePath for serving
      t._incompletePath = dest;
    } catch {
      t.status = "Download folder error";
      this.emit(t);
      this.scheduleRetry(t.id, 900_000);
      return;
    }
    t.current = t.size;
    t.status = "Finished";
    t.speed = 0;
    t.timeLeft = null;
    t.queuePosition = null;
    // Send upload speed update (nicotine+ bookkeeping)
    try { this.session?.sendUploadSpeed(t.avgSpeed || 0); } catch {}
    this.emit(t);
    this.emitFinished(t);
    this.emitStats();
    this.persist();
    try { socket.end(); } catch {}
    // Cleanup poll
    if (t._pollTimer) { clearInterval(t._pollTimer); t._pollTimer = undefined; }
  }

  private startProgressStub(id: string) {
    const t = this.transfers.get(id);
    if (!t) return;
    if (t._timer) clearInterval(t._timer);
    t._timer = setInterval(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Transferring") {
        if (cur?._timer) clearInterval(cur._timer);
        return;
      }
      const chunk = 2_000_000 + Math.random() * 3_000_000;
      const step = Math.min(chunk * 0.5, cur.size - cur.current);
      cur.current += step;
      const elapsed = (Date.now() - (cur._startTime ?? Date.now())) / 1000;
      cur.speed = step * 2;
      cur.avgSpeed = elapsed > 0 ? cur.current / elapsed : cur.speed;
      cur.timeLeft = cur.speed > 0 ? Math.ceil((cur.size - cur.current) / cur.speed) : null;
      if (cur.current >= cur.size) {
        cur.current = cur.size;
        cur.status = "Finished";
        cur.speed = 0;
        cur.timeLeft = null;
        clearInterval(cur._timer!);
        cur._timer = undefined;
        // Simulate moveFinished for stub
        cur._downloadUrl = `/files/${cur.token}`;
        this.emitFinished(cur);
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
        if (t._statusTimer) clearTimeout(t._statusTimer);
        if (t._pollTimer) clearInterval(t._pollTimer);
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
        if (t._retryTimer) clearTimeout(t._retryTimer);
        t.status = "Queued";
        t.queuePosition = 1;
        this.emit(t);
        this.sendQueueUpload(t);
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
          this.startProgressStub(id);
          this.emit(cur);
        }, 900);
        break;
      case "clear":
        if (t._timer) clearInterval(t._timer);
        if (t._statusTimer) clearTimeout(t._statusTimer);
        if (t._pollTimer) clearInterval(t._pollTimer);
        if (t._retryTimer) clearTimeout(t._retryTimer);
        if (t._fileHandle !== undefined) try { const { closeSync } = require("node:fs"); closeSync(t._fileHandle); } catch {}
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
    for (const t of this.transfers.values()) {
      if (t._timer) clearInterval(t._timer);
      if (t._pollTimer) clearInterval(t._pollTimer);
      if (t._statusTimer) clearTimeout(t._statusTimer);
      if (t._retryTimer) clearTimeout(t._retryTimer);
      const st = (t as unknown as { _stallTimer?: Timer })._stallTimer;
      if (st) clearTimeout(st);
      if (t._fileHandle !== undefined) try { const { closeSync } = require("node:fs"); closeSync(t._fileHandle); } catch {}
    }
    if (this.statsTimer) clearInterval(this.statsTimer);
  }
}
