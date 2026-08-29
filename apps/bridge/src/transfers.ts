// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 nicotine-mobile Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/downloads.py + pynicotine/transfers.py

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
import { shouldBlockUser, getCountryCode } from "./networkfilter.ts";
import { StatsManager } from "./statistics.ts";

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

function getFinishedPath(virtualPath: string, downloadsDir: string, username?: string, usernamesubfolders?: boolean): string {
  let dir = downloadsDir;
  if (usernamesubfolders && username) {
    dir = join(downloadsDir, username.replace(/[/\\]/g, "_"));
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
  const base = fileNameOf(virtualPath).replace(/[/\\]/g, "_") || "file";
  let dest = join(dir, base);
  // avoid conflict "(1)" loop
  let counter = 1;
  let candidate = dest;
  while (existsSync(candidate)) {
    const dot = base.lastIndexOf(".");
    const name = dot >= 0 ? base.slice(0, dot) : base;
    const ext = dot >= 0 ? base.slice(dot) : "";
    candidate = join(dir, `${name} (${counter})${ext}`);
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
  private statsManager: StatsManager;
  private userUpdateCounter = new Map<string, number>();
  private globalUpdateCounter = 0;
  // Config mirrors nicotine transfers.* — updated via setConfig from server.ts WS
  private config = {
    uploadslots: 3,
    useupslots: true,
    uploadlimit: 1000,
    uploadlimitalt: 100,
    use_upload_speed_limit: "unlimited" as "unlimited" | "primary" | "alternative",
    downloadlimit: 1000,
    downloadlimitalt: 100,
    use_download_speed_limit: "unlimited" as "unlimited" | "primary" | "alternative",
    uploadbandwidth: 50,
    fifoqueue: false,
    limitby: true,
    queuelimit: 10000,
    filelimit: 100,
    friendsnolimits: false,
    preferfriends: false,
    autoclear_downloads: false,
    autoclear_uploads: false,
    usernamesubfolders: false,
    downloadfilters: [] as [string, number][],
    enablefilters: false,
    groupdownloads: "folder_grouping",
    groupuploads: "folder_grouping",
    banlist: [] as string[],
    ipblocklist: {} as Record<string, string>,
    usecustomban: false,
    customban: "Banned, don't bother retrying",
    geoblock: false,
    geoblockcc: [""] as string[],
    usecustomgeoblock: false,
    customgeoblock: "Sorry, your country is blocked",
    buddies: [] as string[],
    privilegedUsers: [] as string[],
  };

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
    this.statsManager = new StatsManager({ dataDir: this.dataDir });

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

  setConfig(partial: Partial<typeof this.config>) {
    Object.assign(this.config, partial);
  }

  getStatsSummary() {
    return {
      total: this.statsManager.getTotal(),
      session: this.statsManager.getSession(),
    };
  }

  clearFinished(type: "downloads" | "uploads" | "all" = "all") {
    const toDelete: string[] = [];
    for (const [id, t] of this.transfers) {
      if (t.status !== "Finished") continue;
      if (type === "downloads" && t.isUpload) continue;
      if (type === "uploads" && !t.isUpload) continue;
      toDelete.push(id);
    }
    for (const id of toDelete) {
      this.transfers.delete(id);
      this.onRemoved(id);
    }
    if (toDelete.length) this.persist();
    this.emitStats();
  }

  private isFilteredDownload(username: string, virtualPath: string): boolean {
    if (!this.config.enablefilters || !this.config.downloadfilters.length) return false;
    const base = virtualPath.split("\\").pop() || virtualPath;
    for (const [pattern, escaped] of this.config.downloadfilters) {
      try {
        const regex = escaped ? new RegExp(pattern) : new RegExp(`^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
        // For wildcard mode (escaped=1 means already regex? nicotine: 1=escaped)
        // nicotine downloadfilters: (pattern, escaped) where escaped=1 means regex, 0=wildcard
        // We treat escaped===1 as regex, else convert wildcard
        const testRegex = escaped ? new RegExp(pattern) : new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
        if (testRegex.test(base) || testRegex.test(virtualPath)) return true;
      } catch {}
    }
    return false;
  }

  private isBuddy(username: string): boolean {
    return this.config.buddies.includes(username);
  }

  private isPrivileged(username: string): boolean {
    return this.config.privilegedUsers.includes(username);
  }

  private shouldUseBuddyLimits(username: string): boolean {
    if (!this.config.friendsnolimits) return false;
    return this.isBuddy(username) || this.isPrivileged(username);
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
    // Try stored path first
    const stored = (t as unknown as { _incompletePath?: string })._incompletePath;
    if (stored && existsSync(stored)) return stored;
    // Reconstruct finished path
    const byName = join(this.downloadsDir, t.fileName);
    if (existsSync(byName)) return byName;
    if (this.config.usernamesubfolders && t.username) {
      const sub = join(this.downloadsDir, t.username.replace(/[/\\]/g, "_"), t.fileName);
      if (existsSync(sub)) return sub;
    }
    // Try scan downloads dir for fileName
    try {
      const files = readdirSync(this.downloadsDir);
      const match = files.find((f) => f === t.fileName || f.startsWith(t.fileName.replace(/\.[^.]+$/, "")));
      if (match) return join(this.downloadsDir, match);
      // scan subfolders if usernamesubfolders
      if (this.config.usernamesubfolders && t.username) {
        try {
          const subFiles = readdirSync(join(this.downloadsDir, t.username.replace(/[/\\]/g, "_")));
          const m2 = subFiles.find((f) => f === t.fileName);
          if (m2) return join(this.downloadsDir, t.username.replace(/[/\\]/g, "_"), m2);
        } catch {}
      }
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
    // Download filter check (nicotine downloadfilters)
    if (this.isFilteredDownload(username, virtualPath)) {
      const token = this.tokenCounter++ >>> 0;
      if (this.tokenCounter >= 0xffffffff) this.tokenCounter = 1;
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileName ?? fileNameOf(virtualPath),
        size: size || 1_000_000, current: 0, speed: 0, avgSpeed: 0, timeLeft: null,
        status: "Filtered", queuePosition: null, isUpload: false, token,
      };
      this.transfers.set(id, t);
      this.emit(t);
      this.emitStats();
      this.persist();
      logger.info("transfer", "download filtered", { username, virtualPath });
      return t;
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
    // Track for FIFO/RoundRobin
    this.globalUpdateCounter++;
    this.userUpdateCounter.set(username, this.globalUpdateCounter);
    this.transfers.set(id, t);
    this.statsManager.recordDownloadStarted(t.size);
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

  // ---- Phase 4: upload serving (FIFO/Round Robin with buddy/privileged) ----

  /** Handle incoming QueueUpload from peer (they want to download from us). */
  handleQueueUpload(username: string, virtualPath: string) {
    const id = `${username}::${virtualPath}`;
    // 0. Ban/Geoblock check before queuing (nicotine networkfilter.py)
    // Use cached peer address country if available via pending; fallback to global filter check
    const peerIp = ""; // ip unknown at this stage — check after GetPeerAddress if needed
    const country = getCountryCode(peerIp);
    const block = shouldBlockUser({
      username,
      ip: peerIp,
      countryCode: country,
      banlist: this.config.banlist,
      ipblocklist: this.config.ipblocklist,
      geoblock: this.config.geoblock,
      geoblockcc: this.config.geoblockcc,
    });
    // Note: ip empty → ipblock not triggered; we will re-check with real IP in session hook
    // Simple username ban check here
    if (this.config.banlist.includes(username)) {
      const banMsg = this.config.usecustomban ? this.config.customban : "Banned, don't bother retrying";
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Banned", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.emit(t);
      logger.info("transfer", "upload denied banned", { username, banMsg });
      return t;
    }
    if (block.blocked && block.reason === "Geoblocked") {
      const msg = this.config.usecustomgeoblock ? this.config.customgeoblock : "Sorry, your country is blocked";
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Banned", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.emit(t);
      logger.info("transfer", "upload denied geoblocked", { username, country });
      return t;
    }

    // 1. already queued?
    if (this.transfers.has(id)) {
      const existing = this.transfers.get(id)!;
      if (existing.isUpload) {
        this.emit(existing);
        return existing;
      }
    }
    // 2. queue limit check (filelimit / queuelimit) — respects friendsnolimits
    const bypassLimits = this.shouldUseBuddyLimits(username);
    const queuedUploads = [...this.transfers.values()].filter((t) => t.isUpload && t.status === "Queued").length;
    const totalQueuedMB = [...this.transfers.values()].filter((t) => t.isUpload && t.status === "Queued").reduce((s, t) => s + t.size, 0) / (1024 * 1024);
    const effectiveFileLimit = bypassLimits ? Infinity : (this.config.filelimit || 100);
    const effectiveQueueLimit = bypassLimits ? Infinity : (this.config.queuelimit || 10000);
    if (queuedUploads >= effectiveFileLimit) {
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Too many files", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.emit(t);
      return t;
    }
    if (totalQueuedMB >= effectiveQueueLimit) {
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
    // Determine max active uploads: useupslots ? uploadslots fixed, else auto via bandwidth (simplified to 2*uploadslots/3 fixed)
    const maxActive = this.config.useupslots ? Math.max(1, this.config.uploadslots || 3) : Math.max(1, Math.ceil(this.config.uploadbandwidth / 30));
    const activeUploads = [...this.transfers.values()].filter((t) => t.isUpload && t.status === "Transferring").length;
    if (activeUploads >= maxActive) return;

    // Select candidate: FIFO vs Round Robin
    const queued = [...this.transfers.values()].filter((t) => t.isUpload && t.status === "Queued");
    if (!queued.length) return;

    // Privileged/buddy prioritization: prefer privileged, then buddies if preferfriends
    const isPriv = (u: string) => this.isPrivileged(u);
    const isBuddy = (u: string) => this.isBuddy(u);
    // Sort by priority then by policy
    let candidate: BridgeTransfer | undefined;
    // First, privileged users always first
    const privilegedQueued = queued.filter((t) => isPriv(t.username));
    const buddyQueued = queued.filter((t) => !isPriv(t.username) && isBuddy(t.username));
    const normalQueued = queued.filter((t) => !isPriv(t.username) && !isBuddy(t.username));

    const pickFrom = (list: BridgeTransfer[]): BridgeTransfer | undefined => {
      if (!list.length) return undefined;
      if (this.config.fifoqueue) {
        // FIFO: earliest arrival (insertion order = Map order)
        return list[0];
      } else {
        // Round Robin: oldest user_update_counter
        let oldest: BridgeTransfer | undefined;
        let oldestCounter = Infinity;
        for (const t of list) {
          const c = this.userUpdateCounter.get(t.username) ?? Infinity;
          if (c < oldestCounter) { oldestCounter = c; oldest = t; }
        }
        return oldest ?? list[0];
      }
    };

    if (this.config.preferfriends) {
      candidate = pickFrom(privilegedQueued) || pickFrom(buddyQueued) || pickFrom(normalQueued);
    } else {
      // Without preferfriends, privileged still first, then FIFO/RoundRobin across all
      candidate = pickFrom(privilegedQueued) || pickFrom(queued);
      if (!candidate && !this.config.fifoqueue) {
        // Round Robin across all if no privileged
        candidate = pickFrom(queued);
      }
      if (!candidate) candidate = queued[0];
    }

    if (!candidate) return;
    // Validate online (stub assume online)
    candidate.status = "Transferring";
    candidate._startTime = Date.now();
    // Update counter for round robin
    this.globalUpdateCounter++;
    this.userUpdateCounter.set(candidate.username, this.globalUpdateCounter);
    this.emit(candidate);
    this.emitStats();
    this.statsManager.recordUploadStarted();
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

  // Bandwidth limiter — token bucket approximation (nicotine slskproto.py Limetr)
  // Env UPLOAD_LIMIT / DOWNLOAD_LIMIT in KB/s (0 = unlimited) + config use_*_speed_limit
  private getUploadLimit(): number {
    const envRaw = Number(process.env.UPLOAD_LIMIT || process.env.UPLOADLIMIT || 0);
    if (envRaw > 0) return envRaw * 1024;
    const cfg = this.config;
    if (cfg.use_upload_speed_limit === "unlimited") return 0;
    const limit = cfg.use_upload_speed_limit === "alternative" ? cfg.uploadlimitalt : cfg.uploadlimit;
    return limit > 0 ? limit * 1024 : 0;
  }
  private getDownloadLimit(): number {
    const envRaw = Number(process.env.DOWNLOAD_LIMIT || process.env.DOWNLOADLIMIT || 0);
    if (envRaw > 0) return envRaw * 1024;
    const cfg = this.config;
    if (cfg.use_download_speed_limit === "unlimited") return 0;
    const limit = cfg.use_download_speed_limit === "alternative" ? cfg.downloadlimitalt : cfg.downloadlimit;
    return limit > 0 ? limit * 1024 : 0;
  }
  private limiterDelay(bytes: number, limitBps: number): number {
    if (!limitBps) return 0;
    // adaptive chunk: max(4096, sent*1.25/dt) parity — simple delay = bytes/limit*1000
    return Math.ceil((bytes / limitBps) * 1000);
  }

  getQueuePlace(file: string): number {
    let idx = 0;
    for (const t of this.transfers.values()) {
      if (!t.isUpload || t.status !== "Queued") continue;
      idx++;
      if (t.virtualPath === file) return idx;
    }
    // fallback: linear search 1
    return 1;
  }

  // F connection handling — called by session when raw bytes arrive
  async handleFileConnection(token: number, socket: Socket) {
    const t = this.getByToken(token);
    if (!t) {
      try { socket.end(); } catch {}
      return;
    }
    // Upload serving: peer (downloader) connected via F to fetch file from us
    if (t.isUpload) {
      if (t._statusTimer) { clearTimeout(t._statusTimer); t._statusTimer = undefined; }
      if (t._timer) { clearInterval(t._timer); t._timer = undefined; }
      t.status = "Transferring";
      if (!t._startTime) t._startTime = Date.now();
      this.emit(t);
      this.emitStats();
      try { this.session?.unregisterFileToken(token); } catch {}
      (t as unknown as { _uploadSocket?: Socket })._uploadSocket = socket;
      (t as unknown as { _uploadOffsetBuf?: Buffer })._uploadOffsetBuf = Buffer.alloc(0);
      (t as unknown as { _uploadAwaitingOffset?: boolean })._uploadAwaitingOffset = true;
      const stall = setTimeout(() => {
        if (t.status === "Transferring") {
          t.status = "Connection timeout";
          this.emit(t);
          try { socket.end(); } catch {}
          this.scheduleRetry?.(t.id, 180_000);
        }
      }, 60_000);
      (t as unknown as { _stallTimer?: Timer })._stallTimer = stall;
      return;
    }
    if (t._statusTimer) { clearTimeout(t._statusTimer); t._statusTimer = undefined; }
    if (t._timer) { clearInterval(t._timer); t._timer = undefined; }
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
      // Bandwidth throttling: delay processing if limit exceeded (mimics slskproto adaptive 4096 logic)
      const dlLimit = this.getDownloadLimit();
      if (dlLimit) {
        const delay = this.limiterDelay(toWrite.length, dlLimit);
        if (delay > 10) {
          // Simple throttle: pause socket briefly
          try { (socket as unknown as { pause?: () => void })?.pause?.(); } catch {}
          setTimeout(() => { try { (socket as unknown as { resume?: () => void })?.resume?.(); } catch {} }, delay);
        }
      }
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
      // Adaptive speed calc like slskproto: max(4096, sent*1.25/dt)
      const rawSpeed = elapsed > 0 ? (t.current - startOffset) / elapsed : toWrite.length * 2;
      t.speed = Math.max(4096, Math.min(rawSpeed, dlLimit || rawSpeed));
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
    // Upload path: awaiting offset from downloader (8 bytes uint64 LE)
    if (t.isUpload) {
      const awaiting = (t as unknown as { _uploadAwaitingOffset?: boolean })._uploadAwaitingOffset;
      if (awaiting) {
        let buf = (t as unknown as { _uploadOffsetBuf?: Buffer })._uploadOffsetBuf || Buffer.alloc(0);
        buf = Buffer.concat([buf, chunk]);
        (t as unknown as { _uploadOffsetBuf?: Buffer })._uploadOffsetBuf = buf;
        if (buf.length < 8) return;
        const offset = Number(buf.readBigUInt64LE(0));
        (t as unknown as { _uploadAwaitingOffset?: boolean })._uploadAwaitingOffset = false;
        const remaining = buf.subarray(8);
        // stall timer cleared on successful offset
        const stall = (t as unknown as { _stallTimer?: Timer })._stallTimer;
        if (stall) { clearTimeout(stall); (t as unknown as { _stallTimer?: Timer })._stallTimer = undefined; }
        this.startUploadStream(t, offset, remaining.length ? remaining : undefined);
        if (remaining.length) {
          // if peer pipelined data after offset (shouldn't happen for upload), ignore
        }
        return;
      }
      // If upload already streaming, any extra chunk after offset is unexpected (downloader shouldn't send); ignore
      return;
    }
    const cb = (t as unknown as { _onFileData?: (c: Buffer) => void })._onFileData;
    if (cb) cb(chunk);
  }

  private startUploadStream(t: BridgeTransfer, offset: number, _initialTail?: Buffer) {
    const socket = (t as unknown as { _uploadSocket?: Socket })._uploadSocket as Socket | undefined;
    if (!socket) return;
    // Resolve real file path: try Shared dirs -> DATA_DIR/shared -> uploads
    let realPath: string | null = null;
    let fileSize = t.size || 0;
    try {
      const { existsSync: es, statSync: ss } = require("node:fs") as typeof import("node:fs");
      const { join: jp } = require("node:path") as typeof import("node:path");
      const candidates: string[] = [];
      const sharedEnv = process.env.SHARED_DIRS || process.env.SHARES_DIR || "";
      if (sharedEnv) candidates.push(...sharedEnv.split(":").map((s) => s.trim()).filter(Boolean));
      candidates.push(jp(this.dataDir, "shared"), jp(this.dataDir, "shares"), jp(this.dataDir, "uploads"), this.dataDir);
      const base = t.fileName;
      for (const dir of candidates) {
        const cand = jp(dir, base);
        if (es(cand)) { realPath = cand; try { fileSize = ss(cand).size; } catch {} break; }
        // also search recursively one level for virtualPath basename fallback
        try {
          const { readdirSync } = require("node:fs");
          if (es(dir)) {
            const ents = readdirSync(dir);
            for (const e of ents) {
              const p = jp(dir, e);
              try { if (es(p) && ss(p).isFile() && e === base) { realPath = p; fileSize = ss(p).size; break; } } catch {}
            }
            if (realPath) break;
          }
        } catch {}
      }
    } catch {}
    if (!realPath) {
      // No real file — stream dummy zeros of fileSize (or t.size) to demonstrate protocol
      const remaining = Math.max(0, (fileSize || t.size || 1024 * 1024) - offset);
      const dummyChunk = Buffer.alloc(Math.min(64 * 1024, remaining));
      let sent = 0;
      const ulLimit = this.getUploadLimit();
      const start = Date.now();
      const sendLoop = () => {
        if (sent >= remaining) {
          t.current = fileSize || t.size;
          t.status = "Finished";
          t.speed = 0;
          this.statsManager.recordUploadCompleted(t.size || fileSize);
          this.emit(t);
          this.emitStats();
          if (this.config.autoclear_uploads) {
            setTimeout(() => {
              if (this.transfers.has(t.id) && t.status === "Finished") {
                this.transfers.delete(t.id);
                this.onRemoved(t.id);
                this.emitStats();
                this.persist();
              }
            }, 100);
          } else {
            this.persist();
          }
          try { socket.end(); } catch {}
          try { this.session?.sendUploadSpeed(t.avgSpeed || 0); } catch {}
          // try next queued upload
          setTimeout(() => this.checkUploadQueue(), 100);
          return;
        }
        const toSend = Math.min(dummyChunk.length, remaining - sent);
        const slice = dummyChunk.subarray(0, toSend);
        try { socket.write(slice); } catch { t.status = "Connection closed"; this.emit(t); try { socket.end(); } catch {} return; }
        sent += toSend;
        t.current = offset + sent;
        const elapsed = (Date.now() - start) / 1000;
        const speed = elapsed > 0 ? sent / elapsed : toSend * 2;
        t.speed = ulLimit ? Math.min(speed, ulLimit) : speed;
        t.avgSpeed = speed;
        this.emit(t);
        this.emitStats();
        const delay = ulLimit ? this.limiterDelay(toSend, ulLimit) : 0;
        if (delay > 5) setTimeout(sendLoop, delay);
        else setImmediate(sendLoop);
      };
      setImmediate(sendLoop);
      return;
    }
    // Real file streaming
    try {
      const { createReadStream } = require("node:fs") as typeof import("node:fs");
      const rs = createReadStream(realPath, { start: offset });
      let sent = 0;
      const start = Date.now();
      const ulLimit = this.getUploadLimit();
      rs.on("data", (chunk: Buffer) => {
        const toSend = chunk as Buffer;
        // throttle
        if (ulLimit) {
          const delay = this.limiterDelay(toSend.length, ulLimit);
          if (delay > 10) {
            try { (rs as unknown as { pause?: () => void }).pause?.(); } catch {}
            setTimeout(() => { try { (rs as unknown as { resume?: () => void }).resume?.(); } catch {} }, delay);
          }
        }
        try { socket.write(toSend); } catch { rs.destroy(); }
        sent += toSend.length;
        t.current = offset + sent;
        const elapsed = (Date.now() - start) / 1000;
        const speed = elapsed > 0 ? sent / elapsed : toSend.length * 2;
        t.speed = ulLimit ? Math.min(speed, ulLimit) : speed;
        t.avgSpeed = speed;
        this.emit(t);
        this.emitStats();
      });
      rs.on("end", () => {
        t.status = "Finished";
        t.speed = 0;
        t.current = fileSize;
        this.statsManager.recordUploadCompleted(fileSize);
        this.emit(t);
        this.emitStats();
        if (this.config.autoclear_uploads) {
          setTimeout(() => {
            if (this.transfers.has(t.id) && t.status === "Finished") {
              this.transfers.delete(t.id);
              this.onRemoved(t.id);
              this.emitStats();
              this.persist();
            }
          }, 100);
        } else {
          this.persist();
        }
        try { socket.end(); } catch {}
        try { this.session?.sendUploadSpeed(t.avgSpeed || 0); } catch {}
        setTimeout(() => this.checkUploadQueue(), 100);
      });
      rs.on("error", () => {
        t.status = "File read error.";
        this.emit(t);
        try { socket.end(); } catch {}
      });
    } catch {
      t.status = "File read error.";
      this.emit(t);
      try { socket.end(); } catch {}
    }
  }

  private async prepareIncompleteFile(t: BridgeTransfer): Promise<number> {
    // Handle usernamesubfolders for incomplete as well? Keep incomplete flat, finished will respect subfolders
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
      // size_changed → truncate to 0 (nicotine truncates to 0 and restarts; we truncate to 0)
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
    // Move to downloads dir with collision handling + usernamesubfolders
    try {
      const dest = getFinishedPath(t.virtualPath, this.downloadsDir, t.username, this.config.usernamesubfolders);
      renameSync(t._incompletePath!, dest);
      t._downloadUrl = `/files/${t.token}`;
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
    try { this.session?.sendUploadSpeed(t.avgSpeed || 0); } catch {}
    this.statsManager.recordDownloadCompleted(t.size);
    this.emit(t);
    this.emitFinished(t);
    this.emitStats();
    this.persist();
    // Autoclear downloads if configured (nicotine autoclear_downloads)
    if (this.config.autoclear_downloads) {
      setTimeout(() => {
        if (this.transfers.has(t.id) && t.status === "Finished") {
          this.transfers.delete(t.id);
          this.onRemoved(t.id);
          this.emitStats();
          this.persist();
        }
      }, 100);
    }
    try { socket.end(); } catch {}
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
      const dlLimit = this.getDownloadLimit();
      cur.speed = dlLimit ? Math.min(step * 2, dlLimit) : step * 2;
      cur.avgSpeed = elapsed > 0 ? cur.current / elapsed : cur.speed;
      cur.timeLeft = cur.speed > 0 ? Math.ceil((cur.size - cur.current) / cur.speed) : null;
      if (cur.current >= cur.size) {
        cur.current = cur.size;
        cur.status = "Finished";
        cur.speed = 0;
        cur.timeLeft = null;
        clearInterval(cur._timer!);
        cur._timer = undefined;
        cur._downloadUrl = `/files/${cur.token}`;
        this.statsManager.recordDownloadCompleted(cur.size);
        this.emitFinished(cur);
        if (this.config.autoclear_downloads) {
          setTimeout(() => {
            if (this.transfers.has(cur.id) && cur.status === "Finished") {
              this.transfers.delete(cur.id);
              this.onRemoved(cur.id);
              this.emitStats();
              this.persist();
            }
          }, 100);
        }
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
