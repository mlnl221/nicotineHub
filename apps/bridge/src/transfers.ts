// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
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
import { existsSync, mkdirSync, renameSync, rmdirSync, statSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, dirname, resolve, sep, relative } from "node:path";
import type { Socket } from "bun";
import {
  buildFileTransferInit,
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
  isSlopLike?: boolean;
  token?: number;
  finishedAt?: number; // ms epoch when status became Finished — bounds /files/:token age (24h)
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
  const parts = virtualPath.split(/[\\/]/);
  return parts[parts.length - 1] || virtualPath;
}

// ponytail: single sink for peer-controlled names; per-user dirs if stricter mapping needed
function safeUsername(username: string): string {
  const s = username.replace(/[/\\]+/g, "_").replace(/[\x00-\x1f\x7f]/g, "").replace(/\.\./g, "_").trim().slice(0, 64);
  return s === "" || s === "." ? "_" : s;
}

function safeBasename(virtualPath: string): string {
  return safeSegment(fileNameOf(virtualPath), "file");
}

// Windows reserved device names (case-insensitive, extension ignored)
const RESERVED_BASENAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

function safeSegment(raw: string, fallback: string): string {
  let s = raw.replace(/[/\\]+/g, "_").replace(/[\x00-\x1f\x7f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[. ]+$/, "");
  if (s === "" || s === "." || s === "..") return fallback;
  const dot = s.indexOf(".");
  const stem = dot >= 0 ? s.slice(0, dot) : s;
  const out = RESERVED_BASENAMES.has(stem.toUpperCase()) ? `_${s}` : s;
  return out.slice(0, 100) || fallback;
}

// Split remote virtual path on \ (also tolerates /); drops [0] share alias.
function splitVirtual(virtualPath: string): { dirs: string[]; base: string } {
  const parts = virtualPath.split(/[\\/]/);
  const rest = parts.length > 1 ? parts.slice(1) : parts.slice();
  const base = safeSegment(rest.pop() ?? "", "file");
  const dirs: string[] = [];
  for (const p of rest) {
    if (p === "") continue;
    dirs.push(safeSegment(p, "dir"));
  }
  return { dirs, base };
}

function joinUnique(dir: string, base: string): string {
  let candidate = join(dir, base);
  let counter = 1;
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

// Shrink longest segments until measure fits budget (total path ~200 chars).
function shrinkSegments(segs: string[], overBy: () => number): void {
  let guard = 0;
  while (overBy() > 0 && guard++ < 64) {
    let idx = -1;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].length > 1 && (idx < 0 || segs[i].length > segs[idx].length)) idx = i;
    }
    if (idx < 0) return;
    segs[idx] = segs[idx].slice(0, Math.max(1, segs[idx].length - overBy()));
  }
}

function containedPath(dest: string, downloadsDir: string): string | null {
  const root = resolve(downloadsDir);
  const r = resolve(dest);
  return r === root || r.startsWith(root + sep) ? dest : null;
}

// ponytail: one sink for stall-timer teardown; callers previously each inlined the cast
function clearStallTimer(t: BridgeTransfer): void {
  const st = (t as unknown as { _stallTimer?: Timer })._stallTimer;
  if (st) { clearTimeout(st); (t as unknown as { _stallTimer?: Timer })._stallTimer = undefined; }
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

function getFinishedPath(virtualPath: string, downloadsDir: string, username?: string, _usernamesubfolders?: boolean, depth?: string): string {
  // Layout: <downloads>/<user>/<subdirs...>/<base>. Alias dropped, username always
  // included; _usernamesubfolders kept as no-op for config compat.
  // depth trims remote dirs: "full" (default) keeps all, "N" keeps last N.
  const user = username ? safeUsername(username) : "";
  const { dirs, base } = splitVirtual(virtualPath);
  const remote = (() => {
    if (!depth || depth === "full") return dirs;
    const n = Number(depth);
    if (!Number.isFinite(n) || n < 0) return dirs;
    return n === 0 ? [] : dirs.slice(-n);
  })();
  const flatBase = (): string => {
    const dir = user ? join(downloadsDir, user) : downloadsDir;
    try { mkdirSync(dir, { recursive: true }); } catch {}
    return joinUnique(dir, base);
  };
  if (!user || remote.length === 0) return flatBase();
  const segs = remote.slice();
  shrinkSegments(segs, () => join(downloadsDir, user, ...segs, base).length - 200);
  let outBase = base;
  if (join(downloadsDir, user, ...segs, outBase).length > 200) {
    // ponytail: middle segments already at floor; trim base stem, keep extension
    const dot = outBase.lastIndexOf(".");
    const stem = dot > 0 ? outBase.slice(0, dot) : outBase;
    const ext = dot > 0 ? outBase.slice(dot) : "";
    outBase = stem.slice(0, Math.max(1, 200 - join(downloadsDir, user, ...segs, ext).length)) + ext;
  }
  const dir = join(downloadsDir, user, ...segs);
  if (!containedPath(join(dir, outBase), downloadsDir)) return flatBase();
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return joinUnique(dir, outBase);
}

export class TransferManager {
  private transfers = new Map<string, BridgeTransfer>();
  private onUpdate: TransferUpdateCb;
  private onRemoved: TransferRemovedCb;
  private onStats: TransferStatsCb;
  private onQueue?: TransferQueueCb;
  private onFinished?: TransferFinishedCb;
  private statsTimer: Timer | null = null;
  private pollTimer: Timer | null = null;
  private dataDir: string;
  private configDir: string;
  private incompleteDir: string;
  private downloadsDir: string;
  private sessionGetter?: () => { queueUpload: (u: string, f: string) => void; sendUploadDenied?: (u: string, f: string, reason?: string) => void; placeInQueueRequest: (u: string, f: string) => void; registerFileToken: (t: number) => void; unregisterFileToken: (t: number) => void; sendUploadSpeed: (s: number) => void; sendTransferResponse?: (u: string, t: number, allowed: boolean, sizeOrReason?: number | bigint | string) => void; dialFileUpload?: (u: string, t: number) => Promise<Socket>; markFileUploadSocket?: (s: Socket, t: number, u: string) => void; connectPeer: (u: string, t: string) => Promise<Socket>; getShareDB?: () => { hasVirtualPath?: (p: string) => boolean; getFolders?: () => unknown[] } } | undefined;
  private onBanlistUpdated?: (banlist: string[], byUser: string) => void;
  private tokenCounter = Math.floor(Math.random() * 900000) + 10000;
  private tokenIndex = new Map<number, string>();
  private statsManager: StatsManager;
  private userUpdateCounter = new Map<string, number>();
  private globalUpdateCounter = 0;
  private retryAttempts = new Map<string, number>();
  private activeEnqueueCount = 0;
  private enqueueQueue: Array<() => void> = [];
  private readonly MAX_CONCURRENT_ENQUEUE = 5;
  private perUserActive = new Set<string>();
  private perUserQueues = new Map<string, Array<() => void>>();
  // Config mirrors nicotine transfers.* + slskd incompleteStrategy/destination templating — updated via setConfig
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
    usernamesubfolders: true, // always-true layout <downloads>/<user>/...; kept for config compat, forced in setConfig
    download_path_depth: "full" as "full" | "0" | "1" | "2" | "3", // remote dirs kept under <downloads>/<user>; "full" preserves whole tree
    incomplete_strategy: "resume" as "resume" | "overwrite",
    download_destination_template: null as string | null, // slskd DeriveDestination tokens e.g. "${SOURCE_DIRECTORY}/${SOURCE_USERNAME}"
    download_subdirectory: null as string | null, // legacy alias
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
    honeypot_enabled: false as boolean,
    honeypot_names: ["!banned.txt"] as string[],
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
    getSession?: () => any;
  }) {
    this.onUpdate = opts.onUpdate;
    this.onRemoved = opts.onRemoved;
    this.onStats = opts.onStats;
    this.onQueue = opts.onQueue;
    this.onFinished = opts.onFinished;
    this.sessionGetter = opts.getSession;
    this.dataDir = opts.dataDir || process.env.DATA_DIR || "/data";
    this.configDir = process.env.CONFIG_DIR || opts.dataDir || process.env.DATA_DIR || "/config";
    this.incompleteDir = process.env.INCOMPLETE_DIR || join(this.dataDir, "incomplete");
    this.downloadsDir = process.env.DOWNLOADS_DIR || join(this.dataDir, "downloads");
    this.statsManager = new StatsManager({ configDir: this.configDir });

    try {
      for (const p of [this.dataDir, this.incompleteDir, this.downloadsDir, join(this.dataDir, "uploads")]) {
        if (!existsSync(p)) mkdirSync(p, { recursive: true });
      }
      this.loadFromDisk();
      try { this.migrateFlatDownloads(); } catch {}
      try { this.migrateTrimmedDownloads(); } catch {}
    } catch {}

    // Keep demo uploads for UI unless real transfers exist — only when explicitly enabled to avoid masking empty state in docker prod
    // Use bracket access to avoid bun build inlining; SEED_DEMO_UPLOADS=1 enables for manual dev testing
    if (this.transfers.size === 0 && (process.env as Record<string, string | undefined>)["SEED_DEMO_UPLOADS"] === "1") this.seedDemoUploads();

    this.statsTimer = setInterval(() => this.emitStats(), 2000);
    // Poll PlaceInQueue every 300 s
    this.pollTimer = setInterval(() => this.pollQueuePositions(), 300_000);
  }

  setSessionGetter(getter: () => any) {
    this.sessionGetter = getter;
  }

  setBanlistUpdatedCb(cb: (banlist: string[], byUser: string) => void) {
    this.onBanlistUpdated = cb;
  }

  setConfig(partial: Partial<typeof this.config>) {
    Object.assign(this.config, partial);
    // no-op compat: folder layout always includes <downloads>/<user>/...
    this.config.usernamesubfolders = true;
    // Normalize depth: unknown values fall back to full tree (never silent user-only).
    if (!["full", "0", "1", "2", "3"].includes(this.config.download_path_depth)) {
      this.config.download_path_depth = "full";
    }
    try { const ul = this.getUploadLimit(); if (ul) this.uploadBucket.configure(ul); const dl = this.getDownloadLimit(); if (dl) this.downloadBucket.configure(dl); } catch {}
  }

  private isSlopUsername(username: string): boolean {
    return /^[A-Z0-9]{8,12}$/.test(username);
  }

  private getSlopStats(username: string): { files: number; folders: Set<string> } {
    let files = 0;
    const folders = new Set<string>();
    for (const t of this.transfers.values()) {
      if (t.username !== username || !t.isUpload) continue;
      if (t.status !== "Queued") continue;
      files++;
      const idx = t.virtualPath.lastIndexOf("\\");
      const folder = idx >= 0 ? t.virtualPath.slice(0, idx) : t.virtualPath;
      folders.add(folder);
    }
    return { files, folders };
  }

  private updateSlopForUser(username: string) {
    if (!this.isSlopUsername(username)) {
      let changed = false;
      for (const t of this.transfers.values()) if (t.username === username && t.isSlopLike) { t.isSlopLike = false; changed = true; this.emit(t); }
      return;
    }
    const { files, folders } = this.getSlopStats(username);
    const isSlop = files > 0 && files <= 60 && folders.size === 10;
    for (const t of this.transfers.values()) if (t.username === username) {
      if (!!t.isSlopLike !== isSlop) { t.isSlopLike = isSlop; this.emit(t); }
    }
  }

  getStatsSummary() {
    return {
      total: this.statsManager.getTotal(),
      session: this.statsManager.getSession(),
      live: this.getLiveStats(),
    };
  }

  getLiveStats() {
    const vals = [...this.transfers.values()];
    const isActive = (t: (typeof vals)[number]) => t.status === "Transferring";
    const activeDownloads = vals.filter((t) => !t.isUpload && isActive(t)).length;
    const activeUploads = vals.filter((t) => t.isUpload && isActive(t)).length;
    const queuedDownloads = vals.filter((t) => !t.isUpload && t.status === "Queued").length;
    const queuedUploads = vals.filter((t) => t.isUpload && t.status === "Queued").length;
    const downloadSpeed = vals.filter((t) => !t.isUpload && isActive(t)).reduce((s, t) => s + t.speed, 0);
    const uploadSpeed = vals.filter((t) => t.isUpload && isActive(t)).reduce((s, t) => s + t.speed, 0);
    return { downloadSpeed, uploadSpeed, activeDownloads, activeUploads, queuedDownloads, queuedUploads };
  }

  resetStats() {
    this.statsManager.reset();
    this.emitStats();
    this.persist();
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
      this.forgetTokensFor(id);
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

  isBuddy(username: string): boolean {
    const lower = String(username || "").toLowerCase();
    if (!lower) return false;
    return this.config.buddies.some((b) => String(b || "").toLowerCase() === lower);
  }

  isPrivileged(username: string): boolean {
    const lower = String(username || "").toLowerCase();
    if (!lower) return false;
    return this.config.privilegedUsers.some((b) => String(b || "").toLowerCase() === lower);
  }

  getBuddies(): string[] { return [...this.config.buddies]; }
  getBanlist(): string[] { return [...this.config.banlist]; }

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
      const tmp = join(this.configDir, "downloads.json.tmp");
      const dest = join(this.configDir, "downloads.json");
      writeFileSync(tmp, JSON.stringify(serial, null, 2));
      renameSync(tmp, dest);
      // also keep transfers.json for backwards compat (stub)
      try { writeFileSync(join(this.configDir, "transfers.json"), JSON.stringify(serial, null, 2)); } catch {}
    } catch {}
  }

  private loadFromDisk() {
    try {
      const candidates = [join(this.configDir, "downloads.json"), join(this.configDir, "transfers.json"), join(this.dataDir, "downloads.json"), join(this.dataDir, "transfers.json")];
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
        if ((t.status as any) === "Transferring") (t as any).status = "Paused";
        t.current = t.current ?? 0;
        t.speed = 0;
        t.queuePosition = t.queuePosition ?? null;
        t.timeLeft = null;
        this.transfers.set(t.id, t as BridgeTransfer);
      }
    } catch {}
  }

  migrateTrimmedDownloads(): { moved: number; skipped: number } {
    // Move finished files deeper than download_path_depth into the trimmed
    // layout (username + last N remote dirs). Token/_downloadUrl stay valid:
    // only _incompletePath changes and /files/:token resolves via manager.
    let moved = 0;
    let skipped = 0;
    const depth = this.config.download_path_depth;
    if (!depth || depth === "full") return { moved, skipped };
    // Template owners manage their own layout; trim applies to the default tree only.
    if (this.config.download_destination_template || this.config.download_subdirectory) return { moved, skipped };
    const n = Number(depth);
    if (!Number.isFinite(n) || n < 0) return { moved, skipped };
    try {
      const root = resolve(this.downloadsDir);
      for (const t of this.transfers.values()) {
        try {
          if (t.isUpload || t.status !== "Finished") { skipped++; continue; }
          if (!t.virtualPath || typeof t.virtualPath !== "string") { skipped++; continue; }
          const stored = (t as unknown as { _incompletePath?: unknown })._incompletePath;
          if (!stored || typeof stored !== "string") continue;
          const sRes = resolve(stored);
          if (sRes !== root && !sRes.startsWith(root + sep)) continue;
          if (!existsSync(sRes)) continue;
          // Cheap check before deriveDestination (it mkdirs as a side effect)
          const { dirs, base } = splitVirtual(t.virtualPath);
          const keep = n === 0 ? [] : dirs.slice(-n);
          const ideal = join(this.downloadsDir, safeUsername(t.username), ...keep, base);
          if (resolve(ideal) === sRes) continue;
          if (existsSync(ideal)) { skipped++; continue; }
          const expected = this.deriveDestination(t.virtualPath, t.username);
          const eRes = resolve(expected);
          if (eRes === sRes) continue;
          if (eRes !== root && !eRes.startsWith(root + sep)) { skipped++; continue; }
          if (existsSync(eRes)) { skipped++; continue; }
          try { mkdirSync(dirname(eRes), { recursive: true }); } catch {}
          renameSync(sRes, eRes);
          (t as unknown as { _incompletePath?: string })._incompletePath = eRes;
          this.pruneEmptyDirs(sRes, root);
          moved++;
        } catch { skipped++; continue; }
      }
    } catch {}
    if (moved > 0) { try { this.persist(); } catch {} }
    try { logger.info("transfer", "migrated trimmed downloads", { moved, skipped }); } catch {}
    return { moved, skipped };
  }

  // Remove dirs left empty by a migration move, bottom-up. Stops at the
  // downloads root and never removes the per-user dir itself.
  private pruneEmptyDirs(movedFrom: string, root: string) {
    let dir = dirname(movedFrom);
    for (let i = 0; i < 32; i++) {
      const r = resolve(dir);
      if (r === root || !r.startsWith(root + sep)) return;
      if (dirname(r) === root) return;
      try { rmdirSync(r); } catch { return; }
      dir = dirname(dir);
    }
  }

  migrateFlatDownloads(): { moved: number; skipped: number } {
    let moved = 0;
    let skipped = 0;
    try {
      const root = resolve(this.downloadsDir);
      for (const t of this.transfers.values()) {
        try {
          if (t.isUpload) continue;
          if (!t.virtualPath || typeof t.virtualPath !== "string") { skipped++; continue; }
          const stored = (t as unknown as { _incompletePath?: unknown })._incompletePath;
          if (!stored || typeof stored !== "string") continue;
          const sRes = resolve(stored);
          if (sRes !== root && !sRes.startsWith(root + sep)) continue;
          const parent = dirname(sRes);
          let userDir = root;
          try { userDir = resolve(join(this.downloadsDir, safeUsername(t.username))); } catch {}
          if (parent !== root && parent !== userDir) continue;
          if (!existsSync(sRes)) continue;
          // cheap skips before deriveDestination (it mkdirs as a side effect)
          const { dirs, base } = splitVirtual(t.virtualPath);
          if (dirs.length === 0) { skipped++; continue; }
          const ideal = join(this.downloadsDir, safeUsername(t.username), ...dirs, base);
          const iRes = resolve(ideal);
          if (iRes === sRes) continue;
          if (relative(root, iRes).split(sep).filter(Boolean).length < 3 || iRes !== root && !iRes.startsWith(root + sep)) { skipped++; continue; }
          if (existsSync(ideal)) { skipped++; continue; }
          const expected = this.deriveDestination(t.virtualPath, t.username);
          const eRes = resolve(expected);
          if (eRes === sRes) continue;
          if (existsSync(eRes)) { skipped++; continue; }
          try { mkdirSync(dirname(eRes), { recursive: true }); } catch {}
          renameSync(sRes, eRes);
          (t as unknown as { _incompletePath?: string })._incompletePath = eRes;
          moved++;
        } catch { skipped++; continue; }
      }
    } catch {}
    if (moved > 0) { try { this.persist(); } catch {} }
    try { logger.info("transfer", "migrated flat downloads", { moved, skipped }); } catch {}
    return { moved, skipped };
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
    this.onUpdate(publicT as unknown as BridgeTransfer);
    this.persist();
  }

  private emitStats() {
    this.onStats(this.getLiveStats());
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
    // Repeat grants carry new tokens while an older F may still be in flight —
    // fall back to any token this transfer was granted (see handleTransferRequest).
    const id = this.tokenIndex.get(token >>> 0);
    if (id !== undefined) return this.transfers.get(id);
    return undefined;
  }

  private forgetTokensFor(id: string) {
    for (const [tok, mapped] of this.tokenIndex) if (mapped === id) this.tokenIndex.delete(tok);
  }

  // Downloads root for containment checks (honors DOWNLOADS_DIR override).
  downloadsRoot(): string {
    return resolve(this.downloadsDir);
  }

  // For GET /files/:token — tolerant fallback so spectrum works on legacy stubs + subfolders + WSL share dirs
  getFilePathForToken(token: number): string | null {    const t = this.getByToken(token);
    if (!t || t.status !== "Finished") return null;
    // Try stored path first (may be downloads dest or copied shared file)
    const stored = (t as unknown as { _incompletePath?: string })._incompletePath;
    if (stored && existsSync(stored)) return stored;
    // Also allow _downloadUrl missing for legacy entries — still try to locate file
    const bareName = t.fileName.replace(/[/\\]+/g, "_") || "file";
    const byName = join(this.downloadsDir, bareName);
    if (existsSync(byName)) return byName;
    if (this.config.usernamesubfolders && t.username) {
      const sub = join(this.downloadsDir, safeUsername(t.username), bareName);
      if (existsSync(sub)) return sub;
    }
    // Derive via template (same as finishDownload)
    try { const derived = this.deriveDestination(t.virtualPath, t.username); if (existsSync(derived)) return derived; } catch {}
    // Try scan downloads dir for fileName
    try {
      const files = readdirSync(this.downloadsDir);
      const match = files.find((f) => f === t.fileName || f.startsWith(t.fileName.replace(/\.[^.]+$/, "")));
      if (match) return join(this.downloadsDir, match);
      // scan subfolders if usernamesubfolders
      if (this.config.usernamesubfolders && t.username) {
        try {
          const subFiles = readdirSync(join(this.downloadsDir, safeUsername(t.username)));
          const m2 = subFiles.find((f) => f === t.fileName);
          if (m2) return join(this.downloadsDir, safeUsername(t.username), m2);
        } catch {}
      }
    } catch {}
    // Fallback: scan DATA_DIR recursively (WSL share copy e.g. DATA_DIR/DJSplash/file.m4a) — ponytail: handles legacy stubs where dest never written
    try {
      // sanitize: scan target must be a bare name, never a path (fileName arrives via WS)
      const target = t.fileName.replace(/[/\\]+/g, "_").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || "file";
      const dataRoot = resolve(this.dataDir);
      const scan = (dir: string, depth = 2): string | null => {
        try {
          const cand = resolve(join(dir, target));
          if ((cand === dataRoot || cand.startsWith(dataRoot + sep)) && existsSync(cand)) return cand;
          if (depth <= 0 || !existsSync(dir)) return null;
          for (const ent of readdirSync(dir)) {
            const p = resolve(join(dir, ent));
            try { if (!p.startsWith(dataRoot + sep)) continue; if (statSync(p).isDirectory()) { const r = scan(p, depth - 1); if (r) return r; } } catch {}
          }
        } catch {}
        return null;
      };
      const hit = scan(this.dataDir, 4);
      if (hit) return hit;
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

    // Honest timeout only: stay Queued until a real peer event (queue grant,
    // deny, place). No fake Getting/Transferring — those hid dial stalls.
    const reqTimer = setTimeout(() => {
      const cur = this.transfers.get(id);
      if (!cur || cur.status !== "Queued") return;
      cur.status = "Connection timeout";
      this.emit(cur);
      this.scheduleRetry(id, 180_000);
    }, 45_000);
    t._statusTimer = reqTimer;

    return t;
  }

  private async sendQueueUpload(t: BridgeTransfer) {
    const sess = this.session;
    if (!sess) { this.startPolling(t.id); return; }
    const user = t.username;
    const processQueues = () => {
      // try per-user queues first
      for (const [u, q] of this.perUserQueues) {
        if (q.length && !this.perUserActive.has(u) && this.activeEnqueueCount < this.MAX_CONCURRENT_ENQUEUE) {
          const fn = q.shift()!;
          if (q.length === 0) this.perUserQueues.delete(u);
          this.perUserActive.add(u);
          this.activeEnqueueCount++;
          void (async () => {
            try { await fn(); } finally {
              this.perUserActive.delete(u);
              this.activeEnqueueCount = Math.max(0, this.activeEnqueueCount - 1);
              processQueues();
              // also drain legacy global queue
              const nextGlobal = this.enqueueQueue.shift();
              if (nextGlobal) nextGlobal();
            }
          })();
          // only one at a time per loop
          return;
        }
      }
      // drain legacy global queue if no per-user pending
      if (this.enqueueQueue.length && this.activeEnqueueCount < this.MAX_CONCURRENT_ENQUEUE) {
        const fn = this.enqueueQueue.shift()!;
        this.activeEnqueueCount++;
        void (async () => {
          try { await fn(); } finally {
            this.activeEnqueueCount = Math.max(0, this.activeEnqueueCount - 1);
            processQueues();
          }
        })();
      }
    };
    const run = async () => {
      try { await sess.connectPeer(user, "P"); } catch {}
      try { sess.queueUpload(user, t.virtualPath); } catch {}
      this.startPolling(t.id);
    };
    if (this.perUserActive.has(user) || this.activeEnqueueCount >= this.MAX_CONCURRENT_ENQUEUE) {
      if (!this.perUserQueues.has(user)) this.perUserQueues.set(user, []);
      this.perUserQueues.get(user)!.push(run);
    } else {
      this.perUserActive.add(user);
      this.activeEnqueueCount++;
      try { await run(); } finally {
        this.perUserActive.delete(user);
        this.activeEnqueueCount = Math.max(0, this.activeEnqueueCount - 1);
        processQueues();
      }
    }
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
  handleQueueUpload(username: string, virtualPath: string, peerIp?: string) {
    const id = `${username}::${virtualPath}`;
    // HoneyPot bait — exact basename case-insensitive, default off, buddies exempt
    const baseName = fileNameOf(virtualPath);
    const honeyLower = baseName.toLowerCase();
    const honeyNames = (this.config.honeypot_names || []).map((s: string) => s.toLowerCase().trim()).filter(Boolean);
    const isHoney = this.config.honeypot_enabled && honeyNames.includes(honeyLower);
    if (isHoney) {
      const isBuddy = this.isBuddy(username) || this.isPrivileged(username);
      if (!isBuddy) {
        if (!this.config.banlist.includes(username)) {
          this.config.banlist = [...this.config.banlist, username];
        }
        try {
          const sess = this.sessionGetter?.() as unknown as { setNetworkFilters?: (o: unknown) => void };
          sess?.setNetworkFilters?.({ banlist: this.config.banlist });
        } catch {}
        try { this.onBanlistUpdated?.(this.config.banlist, username); } catch {}
        const t: BridgeTransfer = { id, username, virtualPath, fileName: baseName, size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Banned", queuePosition: null, isUpload: true };
        this.transfers.set(id, t);
        this.statsManager.recordUploadFailed();
        this.emit(t);
        this.emitStats();
        this.persist();
        try { logger.warn("honeypot", "banned via honeypot", { username, virtualPath, ip: peerIp || "" }); } catch {}
        return t;
      }
    }
    // 0. Ban/Geoblock check before queuing (nicotine networkfilter.py)
    const ip = peerIp || "";
    const country = ip ? getCountryCode(ip) : "";
    const block = shouldBlockUser({
      username,
      ip,
      countryCode: country,
      banlist: this.config.banlist,
      ipblocklist: this.config.ipblocklist,
      geoblock: this.config.geoblock,
      geoblockcc: this.config.geoblockcc,
    });
    if (block.blocked) {
      const isGeo = block.reason === "Geoblocked";
      const banMsg = isGeo ? (this.config.usecustomgeoblock ? this.config.customgeoblock : "Sorry, your country is blocked") : (this.config.usecustomban ? this.config.customban : "Banned, don't bother retrying");
      // If geoblock with empty IP, defer — allow queue and re-check later via handlePeerAddressResolved
      if (isGeo && !ip && this.config.geoblock) {
        // defer, fall through to queue but mark for later check
      } else {
        const t: BridgeTransfer = {
          id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Banned", queuePosition: null, isUpload: true,
        };
        this.transfers.set(id, t);
        this.statsManager.recordUploadFailed();
        this.emit(t);
        logger.info("transfer", isGeo ? "upload denied geoblocked" : "upload denied banned", { username, banMsg, ip, country });
        return t;
      }
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
      this.statsManager.recordUploadFailed();
      this.emit(t);
      return t;
    }
    if (totalQueuedMB >= effectiveQueueLimit) {
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Too many megabytes", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.statsManager.recordUploadFailed();
      this.emit(t);
      return t;
    }
    // 3. file_is_shared — check ShareDB direct (preferred), then shares.json, then FS recursive (deny by default)
    let shared = false;
    let shareCheckedViaJson = false;
    // Try ShareDB via session (best, knows full virtual paths including nested)
    try {
      const sess: any = this.session;
      const sdb = sess?.shareDBInstance ?? (this.sessionGetter?.() as any)?.shareDBInstance ?? (sess as any)?.shareDB ?? null;
      if (sdb) {
        // sdb may be ShareDB instance with getFolders etc.
        if (typeof sdb.hasVirtualPath === "function" && sdb.hasVirtualPath(virtualPath)) shared = true;
        else if (typeof sdb.getFolders === "function") {
          const folders = sdb.getFolders();
          for (const fo of folders) {
            if (fo.name === virtualPath || virtualPath.startsWith((fo.name || "") + "\\")) { shared = true; break; }
            if (fo.files?.some((f: { name: string }) => f.name === virtualPath)) { shared = true; break; }
          }
        }
        // also check virtual2real mapping if available
        if (!shared && typeof sdb.getVirtual2Real === "function" && sdb.getVirtual2Real(virtualPath)) shared = true;
      }
    } catch {}
    if (!shared) {
      try {
        const sharesPath = join(this.configDir, "shares.json");
        if (existsSync(sharesPath)) {
          shareCheckedViaJson = true;
          const raw = JSON.parse(readFileSync(sharesPath, "utf8")) as Record<string, unknown>;
          if (Array.isArray((raw as { folders?: unknown[] }).folders)) {
            const folders = (raw as { folders: Array<{ name?: string; files: Array<{ name?: string }> }> }).folders;
            shared = folders.some((fo) => fo.files?.some((f) => f.name === virtualPath) || virtualPath.startsWith((fo.name || "") + "\\"));
            if (!shared && Array.isArray((raw as { publicFolders?: unknown[] }).publicFolders)) {
              const pub = (raw as { publicFolders: Array<{ name?: string; files: Array<{ name?: string }> }> }).publicFolders;
              shared = pub.some((fo) => fo.files?.some((f) => f.name === virtualPath) || virtualPath.startsWith((fo.name || "") + "\\"));
            }
          } else if (Array.isArray(raw)) {
            shared = (raw as string[]).includes(virtualPath);
          } else {
            shared = Object.keys(raw).some((k) => virtualPath.startsWith(k) || virtualPath === k);
          }
        }
      } catch { shared = false; }
    }
    // If not found via JSON/ShareDB, check FS shared dirs recursive (covers nested shares)
    if (!shared) {
      try {
        const base = fileNameOf(virtualPath);
        const candidates: string[] = [];
        const sharedEnv = process.env.SHARED_DIRS || process.env.SHARES_DIR || "";
        if (sharedEnv) candidates.push(...sharedEnv.split(":").map((s) => s.trim()).filter(Boolean));
        candidates.push(join(this.dataDir, "shared"), join(this.dataDir, "shares"), join(this.dataDir, "uploads"), this.dataDir);
        const { readdirSync: rds } = require("node:fs") as typeof import("node:fs");
        const searchRecursive = (dir: string, target: string, depth = 2): boolean => {
          if (depth < 0) return false;
          try {
            const cand = join(dir, target);
            if (existsSync(cand)) return true;
            if (!existsSync(dir)) return false;
            const ents = rds(dir);
            for (const e of ents) {
              const p = join(dir, e);
              try {
                const st = require("node:fs").statSync(p);
                if (st.isDirectory() && searchRecursive(p, target, depth - 1)) return true;
              } catch {}
            }
          } catch {}
          return false;
        };
        for (const dir of candidates) {
          if (searchRecursive(dir, base, 2)) { shared = true; break; }
        }
        if (!shared && !shareCheckedViaJson) shared = false;
      } catch { shared = false; }
    }
    if (!shared) {
      const t: BridgeTransfer = {
        id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "File not shared.", queuePosition: null, isUpload: true,
      };
      this.transfers.set(id, t);
      this.statsManager.recordUploadFailed();
      this.emit(t);
      return t;
    }
    // 4. enqueue
    const t: BridgeTransfer = {
      id, username, virtualPath, fileName: fileNameOf(virtualPath), size: 0, current: 0, speed: 0, avgSpeed: 0, timeLeft: null, status: "Queued", queuePosition: queuedUploads + 1, isUpload: true,
    };
    this.transfers.set(id, t);
    this.emit(t);
    this.updateSlopForUser(username);
    this.emitStats();
    this.persist();
    // schedule upload queue check (FIFO) after 100ms
    setTimeout(() => this.checkUploadQueue(), 100);
    // if geoblock deferred (ip empty), try to resolve address shortly
    if (!ip && this.config.geoblock) {
      setTimeout(() => this.handlePeerAddressResolved(username, ""), 2000);
    }
    return t;
  }

  /** Called from session when peer address resolves to re-check geoblock */
  handlePeerAddressResolved(username: string, ip: string) {
    if (!this.config.geoblock) return;
    const cc = ip ? getCountryCode(ip) : "";
    for (const t of this.transfers.values()) {
      if (t.username !== username || !t.isUpload || t.status !== "Queued") continue;
      const block = shouldBlockUser({ username, ip: ip || "", countryCode: cc, banlist: this.config.banlist, ipblocklist: this.config.ipblocklist, geoblock: true, geoblockcc: this.config.geoblockcc });
      if (block.blocked) {
        t.status = "Banned";
        t.queuePosition = null;
        this.statsManager.recordUploadFailed();
        this.emit(t);
        this.emitStats();
        this.persist();
      }
    }
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
    // Validate online — check cached user status if available (0 = offline per SLSKPROTOCOL.md)
    try {
      const sess = this.session as unknown as { getUserStatus?: (u: string) => number | undefined; getCachedUserStatus?: (u: string) => number | undefined };
      const st = sess?.getUserStatus?.(candidate.username) ?? sess?.getCachedUserStatus?.(candidate.username);
      if (st === 0) {
        candidate.status = "User logged off";
        candidate.queuePosition = null;
        this.emit(candidate);
        this.emitStats();
        this.persist();
        logger.info("transfer", "upload deferred — user offline", { username: candidate.username });
        this.scheduleRetry(candidate.id, 30000);
        return;
      }
    } catch {}
    candidate.status = "Transferring";
    candidate._startTime = Date.now();
    // Update counter for round robin
    this.globalUpdateCounter++;
    this.userUpdateCounter.set(candidate.username, this.globalUpdateCounter);
    this.emit(candidate);
    this.updateSlopForUser(candidate.username);
    this.emitStats();
    this.statsManager.recordUploadStarted();
    const token = this.tokenCounter++ >>> 0;
    candidate.token = token;
    this.tokenIndex.set(token >>> 0, candidate.id);
    // Stat the real file first so the request advertises a true size.
    const resolved = this.resolveSharedFile(candidate.virtualPath, candidate.fileName);
    if (!resolved) {
      candidate.status = "File not shared.";
      this.emit(candidate);
      this.emitStats();
      this.persist();
      setTimeout(() => this.checkUploadQueue(), 100);
      return;
    }
    if (resolved.size > 0) candidate.size = resolved.size;
    try { (this.session as any)?.transferRequest?.(candidate.username, 1, token, candidate.virtualPath, BigInt(candidate.size || 0)); } catch {}
  }

  handlePlaceInQueueResponse(file: string, place: number, username?: string) {
    let hit: BridgeTransfer | undefined;
    if (username) hit = this.transfers.get(`${username}::${file}`);
    if (!hit) {
      for (const t of this.transfers.values()) {
        if (t.virtualPath === file && (!username || t.username === username)) {
          hit = t;
          break;
        }
      }
    }
    if (hit) {
      hit.queuePosition = place;
      this.emit(hit);
      this.emitQueue(hit.id, place);
    }
  }

  handleTransferRequest(direction: number, token: number, file: string, username?: string, size?: number | bigint) {
    // Legacy direction 0 = download from peer (slskd/Museek) — treat as QueueUpload
    if (direction === 0) {
      // find or create queued upload? For interop, treat as queue-upload request from peer that wants our file
      // but direction 0 here means peer wants to download from us via TransferRequest not QueueUpload — handle as upload
      // Reuse queue logic: if file matches a queued download awaiting upload? Instead treat as handleQueueUpload if we have shares
      // Simplest: if we are the uploader (peer wants file), handle as queue upload
      // Check if any transfer with this file is queued as upload? fallback to ignore but try to handle
      // We treat direction 0 with file as peer wanting to download -> queue upload
      try { this.handleQueueUpload(typeof username === "string" ? username : "unknown", file); } catch {}
      return;
    }
    if (direction !== 1) return;
    // Find queued transfer by owner + file (ids are username::path; never bind
    // one user's grant to another user's same path).
    const owner = typeof username === "string" ? username : undefined;
    let target: BridgeTransfer | undefined;
    if (owner) target = this.transfers.get(`${owner}::${file}`);
    if (!target && owner) {
      for (const t of this.transfers.values()) {
        if (t.isUpload || t.username !== owner) continue;
        if (t.virtualPath === file || file.endsWith(t.fileName)) { target = t; break; }
      }
    }
    if (!target) {
      // Legacy: grant without username — exact path only, no basename guessing.
      for (const t of this.transfers.values()) if (t.virtualPath === file && !t.isUpload) { target = t; break; }
    }
    if (!target) return;
    // Repeat grant while already streaming: keep the live F, just map + ack.
    if (target.status === "Transferring" && (target as unknown as { _hadRealF?: boolean })._hadRealF) {
      this.tokenIndex.set(token >>> 0, target.id);
      try { this.session?.registerFileToken(token); } catch {}
      const peer = owner || target.username;
      try { if (peer && this.session?.sendTransferResponse) this.session.sendTransferResponse(peer, token, true, target.size); } catch {}
      return;
    }
    // Activate
    target.token = token;
    // Keep every granted token mapped: repeat grants race in-flight F conns.
    this.tokenIndex.set(token >>> 0, target.id);
    // Uploader authoritative size wins (nicotine-plus downloads.py _transfer_request_downloads).
    // Guard: ignore non-finite/huge values instead of corrupting arithmetic.
    if (typeof size === "number" || typeof size === "bigint") {
      const n = typeof size === "bigint"
        ? (size >= 0 && size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(size) : NaN)
        : size;
      if (Number.isFinite(n) && (n as number) > 0 && (n as number) !== target.size) {
        // Partial bytes belong to different content — restart (nicotine size_changed).
        try {
          const { statSync: ss } = require("node:fs") as typeof import("node:fs");
          const partial = getIncompletePath(target.virtualPath, target.username, this.incompleteDir);
          if (ss(partial).size > 0) {
            const { unlinkSync: ul } = require("node:fs") as typeof import("node:fs");
            try { ul(partial); } catch {}
            logger.info("transfer", "size changed, partial discarded", { id: target.id });
          }
        } catch {}
        target.size = n as number;
        target.current = 0;
      }
    }
    target.status = "Getting status";
    if (target._statusTimer) clearTimeout(target._statusTimer);
    this.emit(target);
    // Register file token for F demux
    try { this.session?.registerFileToken(token); } catch {}
    // SLSKPROTOCOL: TransferResponse allowed carries u64 filesize — echo the
    // uploader's own size (bare replies made SoulseekQt abort with UploadFailed).
    try {
      const peer = username || target.username;
      if (peer && this.session?.sendTransferResponse) this.session.sendTransferResponse(peer, token, true, target.size);
    } catch {}
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

  // Permanent denials never succeed on retry (nicotine-plus denial categories).
  private static readonly terminalDenials = new Set(["Banned", "File not shared.", "Filtered"]);

  /** Downloader rejected our upload request. */
  handleUploadRejected(username: string, token: number, reason: string) {
    const t = this.getByToken(token);
    if (!t || !t.isUpload || t.username !== username) return;
    if (t.status === "Finished" || t.status === "Cancelled") return;
    t.status = (TransferManager.terminalDenials.has(reason) ? reason : "Cancelled") as TransferStatus;
    this.emit(t);
    this.emitStats();
    this.persist();
    setTimeout(() => this.checkUploadQueue(), 100);
  }

  /** Downloader allowed our upload: dial F and start serving (nicotine uploads.py). */
  async handleUploadGranted(username: string, token: number) {
    const t = this.getByToken(token);
    if (!t || !t.isUpload || t.status === "Finished" || t.status === "Cancelled") return;
    if ((t as unknown as { _uploadSocket?: unknown })._uploadSocket) return; // already serving
    const sess = this.sessionGetter?.() as unknown as {
      dialFileUpload?: (u: string, t: number) => Promise<Socket>;
    } | undefined;
    if (!sess?.dialFileUpload) return;
    try {
      const sock = await sess.dialFileUpload(username, token);
      await this.handleFileConnection(token, sock);
    } catch {
      t.status = "Connection timeout";
      this.emit(t);
      this.scheduleRetry(t.id, 180_000);
    }
  }

  /** Firewalled downloader pierced to us: serve oldest queued upload for them. */
  async handleUploadPierced(username: string, socket: Socket) {
    const t = [...this.transfers.values()].find((x) => x.isUpload && x.username === username && x.status === "Queued");
    if (!t) { try { socket.end(); } catch {} return; }
    if (t.token === undefined) { try { socket.end(); } catch {} return; }
    const sess = this.sessionGetter?.() as unknown as { markFileUploadSocket?: (s: Socket, t: number, u: string) => void } | undefined;
    try { sess?.markFileUploadSocket?.(socket, t.token, username); } catch {}
    try { (socket as unknown as { write: (b: Buffer) => void }).write(buildFileTransferInit(t.token)); } catch {}
    await this.handleFileConnection(t.token, socket);
  }

  /** F socket died mid-transfer: fail fast instead of waiting out the 60s stall. */
  handleFileClosed(token: number) {
    const t = this.getByToken(token);
    if (!t || t.status !== "Transferring") return;
    t.status = "Connection closed";
    this.emit(t);
    try { this.session?.unregisterFileToken(token); } catch {}
    this.scheduleRetry(t.id, 180_000);
  }

  handleUploadDenied(file: string, reason: string, username?: string) {
    let hit: BridgeTransfer | undefined;
    if (username) hit = this.transfers.get(`${username}::${file}`);
    if (!hit && username) {
      for (const t of this.transfers.values()) {
        if (t.isUpload || t.username !== username) continue;
        if (t.virtualPath === file || file.endsWith(t.fileName)) { hit = t; break; }
      }
    }
    if (!hit) for (const t of this.transfers.values()) if (t.virtualPath === file && !t.isUpload) { hit = t; break; }
    if (hit) {
      hit.status = reason as TransferStatus;
      this.emit(hit);
      if (!TransferManager.terminalDenials.has(reason)) this.scheduleRetry(hit.id, 180_000);
    }
  }

  handleUploadFailed(file: string, username?: string) {
    let hit: BridgeTransfer | undefined;
    if (username) hit = this.transfers.get(`${username}::${file}`);
    if (!hit && username) {
      for (const t of this.transfers.values()) {
        if (t.isUpload || t.username !== username) continue;
        if (t.virtualPath === file || file.endsWith(t.fileName)) { hit = t; break; }
      }
    }
    if (!hit) for (const t of this.transfers.values()) if (t.virtualPath === file && !t.isUpload) { hit = t; break; }
    if (hit) {
      hit.status = "Connection closed";
      this.statsManager.recordDownloadFailed();
      this.emit(hit);
      this.scheduleRetry(hit.id, 180_000);
    }
  }

  private scheduleRetry(id: string, delayMs: number) {
    const t = this.transfers.get(id);
    if (!t) return;
    if (t._retryTimer) clearTimeout(t._retryTimer);
    // Exponential backoff like slskd Retry.Do: base 5s max 60s attempts 3, else cap 180s
    const attempts = (this.retryAttempts.get(id) ?? 0) + 1;
    this.retryAttempts.set(id, attempts);
    if (attempts > 3 && t.status !== "Filtered") {
      // After 3 attempts, cap delay to max 60s but keep retrying for resilience; log
      logger.debug("transfer", "retry attempts exceeded 3, capping", { id, attempts });
    }
    const base = 5000;
    const max = 60000;
    const exp = Math.min(max, base * Math.pow(2, attempts - 1));
    const jitter = exp * 0.2 * (Math.random() * 2 - 1);
    const computed = Math.min(180000, Math.max(base, exp + jitter));
    const finalDelay = delayMs && delayMs !== 180000 ? delayMs : Math.round(computed);
    t._retryTimer = setTimeout(() => {
      const cur = this.transfers.get(id);
      if (!cur) return;
      // Don't retry if already Finished/Cancelled
      if (cur.status === "Finished" || cur.status === "Cancelled") return;
      cur.status = "Queued";
      cur.queuePosition = Math.max(1, [...this.transfers.values()].filter((x) => !x.isUpload && x.status === "Queued").length + 1);
      this.emit(cur);
      this.sendQueueUpload(cur);
    }, finalDelay);
  }
  private clearRetryAttempts(id: string) { this.retryAttempts.delete(id); }

  // Bandwidth limiter — token bucket approximation (nicotine slskproto.py Limetr + slskd TokenBucket)
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
  private getEffectiveUploadLimit(): number {
    const base = this.getUploadLimit();
    if (!base) return 0;
    const active = [...this.transfers.values()].filter(t => t.isUpload && t.status === "Transferring").length || 1;
    return Math.max(1024, Math.floor(base / active));
  }
  private getEffectiveDownloadLimit(): number {
    const base = this.getDownloadLimit();
    if (!base) return 0;
    const active = [...this.transfers.values()].filter(t => !t.isUpload && t.status === "Transferring").length || 1;
    return Math.max(1024, Math.floor(base / active));
  }
  private limiterDelay(bytes: number, limitBps: number): number {
    if (!limitBps) return 0;
    return Math.ceil((bytes / limitBps) * 1000);
  }
  // TokenBucket per Soulseek.NET Common/TokenBucket.cs:57 + TransferInternal.cs:278 EMA — two buckets (up/down) capacity limit/10 interval 100ms FIFO
  private makeTokenBucket() {
    return new (class {
      capacity = 0; tokens = 0; lastRefill = Date.now(); private queue: Array<() => void> = [];
      configure(limitBps: number) { this.capacity = Math.max(1024, Math.floor(limitBps / 10)); this.tokens = this.capacity; this.lastRefill = Date.now(); }
      refill(limitBps: number) {
        const now = Date.now(); const elapsed = now - this.lastRefill;
        if (elapsed >= 100) { const add = Math.floor(limitBps * (elapsed / 1000)); this.tokens = Math.min(this.capacity, this.tokens + add); this.lastRefill = now; if (this.tokens > 0) { const q = this.queue.shift(); if (q) q(); } }
      }
      tryConsume(bytes: number, limitBps: number): boolean {
        if (!limitBps) return true;
        this.refill(limitBps);
        if (this.tokens >= bytes) { this.tokens -= bytes; return true; }
        return false;
      }
      async GetAsync(requested: number, limitBps: number): Promise<number> {
        if (!limitBps) return requested;
        this.refill(limitBps);
        if (this.tokens >= requested) { this.tokens -= requested; return requested; }
        if (this.tokens > 0) { const avail = this.tokens; this.tokens = 0; return avail; }
        // wait for refill interval 100ms FIFO
        await new Promise<void>((res) => { this.queue.push(res); setTimeout(res, 100); });
        this.refill(limitBps);
        const granted = Math.min(this.tokens, requested);
        this.tokens -= granted;
        return granted;
      }
    })();
  }
  private uploadBucket = this.makeTokenBucket();
  private downloadBucket = this.makeTokenBucket();
  private updateEmaSpeed(t: BridgeTransfer, currentSpeed: number, now: number): void {
    const last = (t as unknown as { _lastSpeedUpdate?: number })._lastSpeedUpdate || 0;
    const elapsed = now - last;
    if (elapsed >= 1000) {
      if (!t.avgSpeed) t.avgSpeed = currentSpeed;
      else t.avgSpeed = t.avgSpeed * 0.8 + currentSpeed * 0.2; // Soulseek.NET TransferInternal.cs:278 EMA alpha 0.2
      (t as unknown as { _lastSpeedUpdate?: number })._lastSpeedUpdate = now;
    }
    t.speed = Math.max(1024, currentSpeed);
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
      logger.debug("transfer", "F connection unknown token, closing", { token });
      try { socket.end(); } catch {}
      return;
    }
    // Adopt the live F token (may be an older grant racing a newer request).
    t.token = token;
    this.tokenIndex.set(token >>> 0, t.id);
    // Second F dial for a transfer that already streams: close the spare so
    // two sockets never share _onFileData/left accounting. Timed-out or
    // retried transfers (status != Transferring) still accept a fresh F.
    if (!t.isUpload && t.status === "Transferring" && (t as unknown as { _hadRealF?: boolean })._hadRealF && (t as unknown as { _onFileData?: unknown })._onFileData) {
      logger.debug("transfer", "duplicate F ignored", { id: t.id, token });
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
    // Real F drove progress from here (no fake progress exists anymore).
    (t as unknown as { _hadRealF?: boolean })._hadRealF = true;
    (t as unknown as { _hadRealF?: boolean })._hadRealF = true;
    (t as unknown as { _fileSocket?: Socket })._fileSocket = socket;
    t.status = "Transferring";
    t._startTime = Date.now();
    const startOffset = await this.prepareIncompleteFile(t);
    t.current = startOffset;
    this.emit(t);
    this.emitStats();
    // Already whole: nothing to fetch (nicotine-plus downloads.py parity).
    if (t.size > 0 && startOffset >= t.size) {
      logger.debug("transfer", "already complete, finishing", { id: t.id });
      this.finishDownload(t, socket);
      return;
    }
    logger.debug("transfer", "F accepted, FileOffset sent", { id: t.id, token, startOffset });

    // Send FileOffset (uint64 LE)
    try {
      const n = socket.write(packUint64(startOffset));
      logger.debug("transfer", "FileOffset write result", { id: t.id, token, startOffset, wrote: typeof n === "number" ? n : String(n) });
    } catch (e) { logger.debug("transfer", "FileOffset write failed", { id: t.id, err: String(e).slice(0, 120) }); }
    try { this.session?.unregisterFileToken(token); } catch {}

    // Stream raw bytes → file
    let left = t.size - startOffset;
    let handle = t._fileHandle;
    if (handle === undefined) {
      try { socket.end(); } catch {}
      return;
    }
    const onData = async (chunk: Buffer) => {
      if (t.status === "Cancelled" || t.status === "Paused" || t.status === "Finished") return;
      if (left <= 0) return;
      const toWrite = chunk.subarray(0, Math.min(chunk.length, left));
      const dlLimit = this.getEffectiveDownloadLimit();
      if (dlLimit) {
        // TokenBucket async FIFO like Soulseek.NET Common/TokenBucket.cs:155
        const granted = await this.downloadBucket.GetAsync(toWrite.length, dlLimit);
        if (granted < toWrite.length) {
          // bucket granted partial — would need to slice; for now we wrote full, but next chunk will be throttled
          // still apply limiterDelay for partial backpressure
          const delay = this.limiterDelay(toWrite.length - granted, dlLimit);
          if (delay > 10) {
            try { (socket as unknown as { pause?: () => void })?.pause?.(); } catch {}
            await new Promise(r => setTimeout(r, Math.min(delay, 100)));
            try { (socket as unknown as { resume?: () => void })?.resume?.(); } catch {}
          }
        } else {
          // also apply simple delay for large chunks to avoid burst
          const delay = this.limiterDelay(toWrite.length, dlLimit);
          if (delay > 10) {
            try { (socket as unknown as { pause?: () => void })?.pause?.(); } catch {}
            await new Promise(r => setTimeout(r, Math.min(delay, 50)));
            try { (socket as unknown as { resume?: () => void })?.resume?.(); } catch {}
          }
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
      const rawSpeed = elapsed > 0 ? (t.current - startOffset) / elapsed : toWrite.length * 2;
      const curr = Math.max(1024, Math.min(rawSpeed, dlLimit || rawSpeed));
      this.updateEmaSpeed(t, curr, Date.now());
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
    // Drain bytes that arrived during async file preparation, in order.
    const early = (t as unknown as { _earlyChunks?: Buffer[] })._earlyChunks;
    if (early?.length) {
      (t as unknown as { _earlyChunks?: Buffer[] })._earlyChunks = [];
      for (const c of early) { try { await onData(c); } catch {} }
    }

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
    // Upload path: awaiting offset from downloader (8 bytes uint64 LE) — handle >2GiB -1 sentinel (0xFFFFFFFFFFFFFFFF)
    if (t.isUpload) {
      const awaiting = (t as unknown as { _uploadAwaitingOffset?: boolean })._uploadAwaitingOffset;
      if (awaiting) {
        let buf = (t as unknown as { _uploadOffsetBuf?: Buffer })._uploadOffsetBuf || Buffer.alloc(0);
        buf = Buffer.concat([buf, chunk]);
        (t as unknown as { _uploadOffsetBuf?: Buffer })._uploadOffsetBuf = buf;
        if (buf.length < 8) return;
        const rawOffset = buf.readBigUInt64LE(0);
        // clamp -1 sentinel (NS bug for >2GiB files where hi=0xffffffff) — treat as 0 resume
        let offset: number;
        if (rawOffset === 0xFFFFFFFFFFFFFFFFn || rawOffset === 0xFFFFFFFFn) offset = 0;
        else offset = rawOffset <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rawOffset) : Number(rawOffset & BigInt(Number.MAX_SAFE_INTEGER));
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
    if (cb) { cb(chunk); return; }
    // Handler installs after async file prep — stash early bytes (cap 1MB).
    const early = ((t as unknown as { _earlyChunks?: Buffer[] })._earlyChunks ??= []);
    const buffered = early.reduce((n, c) => n + c.length, 0);
    if (buffered + chunk.length <= 1024 * 1024) early.push(chunk);
    else logger.debug("transfer", "F early buffer full, dropping", { id: t.id, token });
  }

  /** Resolve a shared virtual path to a real readable file + size. */
  private resolveSharedFile(virtualPath: string, fileName: string): { path: string; size: number } | null {
    let realPath: string | null = null;
    let fileSize = 0;
    try {
      const { existsSync: es, statSync: ss } = require("node:fs") as typeof import("node:fs");
      const { join: jp } = require("node:path") as typeof import("node:path");
      const use = (p: string): boolean => {
        try { if (es(p) && ss(p).isFile()) { realPath = p; try { fileSize = ss(p).size; } catch {} return true; } } catch {}
        return false;
      };
      // 0. ShareDB virtual→real (covers /media and any mounted share)
      try {
        const sess: any = this.session;
        const sdb = sess?.shareDBInstance ?? (this.sessionGetter?.() as any)?.shareDBInstance ?? (sess as any)?.shareDB ?? null;
        if (sdb && typeof sdb.getVirtual2Real === "function") {
          const exact = sdb.getVirtual2Real(virtualPath) as string | undefined;
          if (!exact || !use(exact)) {
            // longest mapped folder prefix + remainder (e.g. "M\Orpheus" + "song.flac")
            const parts = virtualPath.split("\\");
            for (let i = parts.length - 1; i > 0 && !realPath; i--) {
              const folderReal = sdb.getVirtual2Real(parts.slice(0, i).join("\\")) as string | undefined;
              if (folderReal) use(jp(folderReal, ...parts.slice(i)));
            }
          }
        }
      } catch {}
      if (!realPath) {
      const candidates: string[] = [];
      const sharedEnv = process.env.SHARED_DIRS || process.env.SHARES_DIR || "";
      if (sharedEnv) candidates.push(...sharedEnv.split(":").map((s) => s.trim()).filter(Boolean));
      candidates.push(jp(this.dataDir, "shared"), jp(this.dataDir, "shares"), jp(this.dataDir, "uploads"), this.dataDir);
      const base = fileName;
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
      }
    } catch {}
    if (!realPath) return null;
    return { path: realPath, size: fileSize };
  }

  private startUploadStream(t: BridgeTransfer, offset: number, _initialTail?: Buffer) {
    const socket = (t as unknown as { _uploadSocket?: Socket })._uploadSocket as Socket | undefined;
    if (!socket) return;
    // Resolve real file path: ShareDB virtual2real first (any mounted path),
    // then Shared dirs -> DATA_DIR/shared -> uploads basename fallback.
    const resolved = this.resolveSharedFile(t.virtualPath, t.fileName);
    let realPath = resolved?.path ?? null;
    let fileSize = resolved?.size ?? t.size ?? 0;
    if (!realPath) {
      // No real file on disk — deny (do not stream dummy zeros). Previously was demo fallback.
      t.status = "File not shared.";
      this.emit(t);
      this.emitStats();
      this.persist();
      try { socket.end(); } catch {}
      const stall2 = (t as unknown as { _stallTimer?: Timer })._stallTimer;
      if (stall2) { clearTimeout(stall2); (t as unknown as { _stallTimer?: Timer })._stallTimer = undefined; }
      setTimeout(() => this.checkUploadQueue(), 100);
      logger.warn("transfer", "upload denied — file not shared (no real path)", { username: t.username, virtualPath: t.virtualPath });
      return;
    }
    // Real file streaming — TokenBucket + EMA like Soulseek.NET TransferInternal.cs:278
    try {
      const { createReadStream } = require("node:fs") as typeof import("node:fs");
      const rs = createReadStream(realPath, { start: offset });
      let sent = 0;
      const start = Date.now();
      (t as unknown as { _lastSpeedUpdate?: number })._lastSpeedUpdate = start;
      const ulLimit = this.getEffectiveUploadLimit();
      if (ulLimit) this.uploadBucket.configure(ulLimit);
      rs.on("data", async (chunk: Buffer) => {
        const toSend = chunk as Buffer;
        if (ulLimit) {
          const granted = await this.uploadBucket.GetAsync(toSend.length, ulLimit);
          if (granted < toSend.length) {
            try { (rs as unknown as { pause?: () => void }).pause?.(); } catch {}
            await new Promise(r => setTimeout(r, 50));
            try { (rs as unknown as { resume?: () => void }).resume?.(); } catch {}
          }
        }
        try { socket.write(toSend); } catch { rs.destroy(); }
        sent += toSend.length;
        t.current = offset + sent;
        const elapsed = (Date.now() - start) / 1000;
        const raw = elapsed > 0 ? sent / elapsed : toSend.length * 2;
        const curr = ulLimit ? Math.min(raw, ulLimit) : raw;
        this.updateEmaSpeed(t, curr, Date.now());
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
              this.forgetTokensFor(t.id);
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
    const incompletePath = getIncompletePath(t.virtualPath, t.username, this.incompleteDir);
    t._incompletePath = incompletePath;
    try {
      mkdirSync(this.incompleteDir, { recursive: true });
      const { openSync, closeSync, unlinkSync: ulink } = require("node:fs");
      // slskd incompleteStrategy: resume (default, slskd) vs overwrite (truncate)
      if (this.config.incomplete_strategy === "overwrite" && existsSync(incompletePath)) {
        try { ulink(incompletePath); } catch {}
      }
      // Open ab+ (resume) or w+ (overwrite already deleted)
      const fd = openSync(incompletePath, "a+");
      t._fileHandle = fd;
      const stat = statSync(incompletePath);
      let offset = stat.size;
      // size_changed → truncate to 0 (nicotine truncates to 0 and restarts)
      if (offset > t.size) {
        try { const { ftruncateSync } = require("node:fs"); ftruncateSync(fd, 0); offset = 0; } catch {}
      }
      // overwrite strategy always starts 0
      if (this.config.incomplete_strategy === "overwrite") { try { const { ftruncateSync } = require("node:fs"); ftruncateSync(fd, 0); offset = 0; } catch {} }
      return offset;
    } catch {
      t.status = "Local file error";
      this.emit(t);
      this.scheduleRetry(t.id, 900_000);
      return 0;
    }
  }
  private deriveDestination(virtualPath: string, username: string): string {
    const { dirs, base } = splitVirtual(virtualPath);
    const tmpl = this.config.download_destination_template || this.config.download_subdirectory || null;
    if (!tmpl) return getFinishedPath(virtualPath, this.downloadsDir, username, this.config.usernamesubfolders, this.config.download_path_depth);
    // Simple token replacement like slskd: ${SOURCE_USERNAME}, ${SOURCE_DIRECTORY}, ${SOURCE_PATH}, ${BATCH_ID}
    const sourceUsername = username.replace(/[/\\]/g, "_");
    const clean = (s: string) => s.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
    let expanded = tmpl
      .replace(/\$\{SOURCE_USERNAME\}/g, clean(sourceUsername))
      .replace(/\$\{SOURCE_DIRECTORY\}/g, clean(dirs[0] || ""))
      .replace(/\$\{SOURCE_PATH\}/g, clean(virtualPath))
      .replace(/\$\{BATCH_ID\}/g, "batch");
    // guard traversal
    expanded = expanded.replace(/\.\./g, "_").replace(/^[/\\]+/, "");
    // Append preserved subpath past what the template already ends with:
    // longest prefix of dirs matching the template suffix continues from there.
    const expSegs = expanded.split(/[\\/]/).filter((s) => s !== "");
    let k = 0;
    for (let n = Math.min(dirs.length, expSegs.length); n > 0; n--) {
      if (expSegs.slice(-n).every((s, i) => s === dirs[i])) { k = n; break; }
    }
    const tail = dirs.slice(k);
    shrinkSegments(tail, () => join(this.downloadsDir, expanded, ...tail, base).length - 200);
    const flatDir = join(this.downloadsDir, expanded);
    const flatBase = safeBasename(virtualPath);
    if (!containedPath(join(this.downloadsDir, expanded, ...tail, base), this.downloadsDir)) {
      try { mkdirSync(flatDir, { recursive: true }); } catch {}
      return joinUnique(flatDir, flatBase);
    }
    const dir = join(this.downloadsDir, expanded, ...tail);
    try { mkdirSync(dir, { recursive: true }); } catch {}
    return joinUnique(dir, base);
  }

  private finishDownload(t: BridgeTransfer, socket: Socket) {
    try { const { closeSync } = require("node:fs"); if (t._fileHandle !== undefined) { try { closeSync(t._fileHandle); } catch {} t._fileHandle = undefined; } } catch {}
    const stall = (t as unknown as { _stallTimer?: Timer })._stallTimer;
    if (stall) clearTimeout(stall);
    // Move to downloads dir with collision handling + templating (slskd DeriveDestination)
    try {
      const dest = this.deriveDestination(t.virtualPath, t.username);
      try { mkdirSync(dirname(dest), { recursive: true }); } catch {}
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
    t.finishedAt = Date.now();
    // Live token stays on t.token for /files/ lookup; drop historic grants so
    // a stale token can never reopen a finished transfer.
    this.forgetTokensFor(t.id);
    this.tokenIndex.set(t.token >>> 0, t.id);
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
          this.forgetTokensFor(t.id);
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

  /** End live F/upload sockets and detach chunk handlers. */
  private closeTransferSockets(t: BridgeTransfer) {
    try { (t as unknown as { _fileSocket?: Socket })._fileSocket?.end?.(); } catch {}
    try { (t as unknown as { _uploadSocket?: Socket })._uploadSocket?.end?.(); } catch {}
    (t as unknown as { _fileSocket?: Socket })._fileSocket = undefined;
    (t as unknown as { _uploadSocket?: Socket })._uploadSocket = undefined;
    (t as unknown as { _onFileData?: unknown })._onFileData = undefined;
    (t as unknown as { _earlyChunks?: Buffer[] })._earlyChunks = [];
  }

  controlDownload(id: string, action: "cancel" | "pause" | "resume" | "retry" | "clear") {
    const t = this.transfers.get(id);
    if (!t) return;
    if (t.isUpload) return;
    switch (action) {
      case "cancel":
        if (t.status !== "Finished" && t.status !== "Cancelled") this.statsManager.recordDownloadCancelled();
        t.status = "Cancelled";
        this.closeTransferSockets(t);
        if (t._timer) clearInterval(t._timer);
        if (t._statusTimer) clearTimeout(t._statusTimer);
        if (t._pollTimer) clearInterval(t._pollTimer);
        if (t._retryTimer) { clearTimeout(t._retryTimer); t._retryTimer = undefined; }
        clearStallTimer(t);
        t.speed = 0;
        this.emit(t);
        this.emitStats();
        break;
      case "pause":
        if (t.status === "Transferring" && t._timer) clearInterval(t._timer);
        t.status = "Paused";
        this.closeTransferSockets(t);
        if (t._retryTimer) { clearTimeout(t._retryTimer); t._retryTimer = undefined; }
        clearStallTimer(t);
        t.speed = 0;
        this.emit(t);
        this.emitStats();
        break;
      case "resume":
      case "retry":
        if (t._retryTimer) clearTimeout(t._retryTimer);
        t.status = "Queued";
        t.queuePosition = 1;
        t.current = 0;
        this.emit(t);
        this.sendQueueUpload(t);
        // Honest timeout only: no fake Getting/Transferring. Real peer
        // events (queue/grant/deny) drive status from here.
        setTimeout(() => {
          const cur = this.transfers.get(id);
          if (!cur || cur.status !== "Queued") return;
          cur.status = "Connection timeout";
          this.emit(cur);
          this.scheduleRetry(id, 180_000);
        }, 45_000);
        break;
      case "clear":
        if (t._timer) clearInterval(t._timer);
        if (t._statusTimer) clearTimeout(t._statusTimer);
        if (t._pollTimer) clearInterval(t._pollTimer);
        if (t._retryTimer) clearTimeout(t._retryTimer);
        if (t._fileHandle !== undefined) try { const { closeSync } = require("node:fs"); closeSync(t._fileHandle); } catch {}
        this.closeTransferSockets(t);
        this.forgetTokensFor(id);
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
      if (t.status !== "Finished" && t.status !== "Cancelled") this.statsManager.recordUploadCancelled();
      t.status = "Cancelled";
      this.emit(t);
      this.emitStats();
      this.persist();
    } else if (action === "clear") {
      this.forgetTokensFor(id);
      this.transfers.delete(id);
      this.onRemoved(id);
      this.emitStats();
      this.persist();
    }
  }

  /** Hard-deny a queued upload: drop entry, notify UI, send UploadDenied(50) to peer. */
  denyUpload(username: string, virtualPath: string, reason = "Denied"): boolean {
    const id = `${username}::${virtualPath}`;
    const t = this.transfers.get(id);
    if (!t || !t.isUpload || t.status !== "Queued") return false;
    if (t._timer) clearInterval(t._timer);
    if (t._statusTimer) clearTimeout(t._statusTimer);
    if (t._pollTimer) clearInterval(t._pollTimer);
    if (t._retryTimer) clearTimeout(t._retryTimer);
    if (t._fileHandle !== undefined) try { const { closeSync } = require("node:fs"); closeSync(t._fileHandle); } catch {}
    this.forgetTokensFor(id);
    this.transfers.delete(id);
    this.onRemoved(id);
    this.emitStats();
    this.persist();
    try { this.sessionGetter?.()?.sendUploadDenied?.(username, virtualPath, reason); } catch {}
    return true;
  }

  /** Clear upload retry backoff and re-run queue selection (e.g. after undeny). */
  retryUploads(username?: string, file?: string): void {
    // ProveIt grant-path: denyUpload deletes the Queued entry, so resurrect it here.
    if (username && file && !this.transfers.has(`${username}::${file}`)) {
      try { this.handleQueueUpload(username, file); } catch {}
    }
    for (const [id, t] of this.transfers) {
      if (!t.isUpload) continue;
      if (username && t.username !== username) continue;
      if (t._retryTimer) { clearTimeout(t._retryTimer); t._retryTimer = undefined; }
      this.retryAttempts.delete(id);
    }
    this.checkUploadQueue();
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
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}
