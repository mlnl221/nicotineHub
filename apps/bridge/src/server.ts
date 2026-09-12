// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Inspired by nicotine-plus pynicotine/*; WebSocket bridge implementation is original but
// behavior mirrors nicotine-plus and is licensed GPL-3.0-or-later for compliance.

/**
 * WebSocket bridge server — nicotine-plus 1:1 parity, token auth, volume-backed transfers.
 *
 * WS JSON protocol — examples:
 *   client -> server: { type:"login", username, password, host?, port? }
 *   client -> server: { type:"search", searchId, query } | { type:"search:user", searchId, username, query }
 *   client -> server: { type:"chat:room", action:"join"|"leave"|"say", room, message? }
 *   client -> server: { type:"chat:private", action:"send", username, message }
 */

import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, chmodSync, renameSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { SoulseekSession, namespaceSearchId } from "./session.ts";
import { userInfoPicToBase64 } from "./soulseek.ts";
import { PermissionLevel } from "./shares.ts";
import { TransferManager } from "./transfers.ts";
import { diagClear, diagLog, diagTail, diagSubscribe, logger, type LogLevel } from "./logger.ts";
import { PluginManager } from "./plugins/manager.ts";
import { Plugin as CoreCommandsPlugin, manifest as coreCommandsManifest } from "./plugins/builtin/core_commands.ts";
import { Plugin as SpamfilterPlugin, manifest as spamManifest } from "./plugins/builtin/spamfilter.ts";
import { Plugin as LeechDetectorPlugin, manifest as leechManifest } from "./plugins/builtin/leech_detector.ts";
import { listDirectory, resolveSafePath, sanitizeFileNameForHeader, serveFileWithRanges } from "./files.ts";
import { portChecker } from "./portchecker.ts";
import {
  maybeRecreateContainerForPort,
  recreateSelfWithPort,
  recreateStatus,
  inspectSelfContainer,
  parseHostPorts,
  envListenPort,
  getSelfContainerId,
} from "./docker.ts";
import { logPrivateMessage, logRoomMessage, logRoomSystem, readChatLogTail } from "./chatLogger.ts";
import { clearVault, loadVault, resolveLoginIntent, saveVault, type StoredCreds } from "./shared-session.ts";

/* Schemas */

const LoginMessageSchema = z.object({
  type: z.literal("login"),
  username: z.string().min(1).max(64),
  password: z.string().min(1),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  // Explicit user-confirmed takeover from the login-conflict popup.
  force: z.boolean().optional(),
});

const SessionStatusSchema = z.object({
  type: z.literal("session:status"),
});

const SearchMessageSchema = z.object({
  type: z.literal("search"),
  searchId: z.string().min(1).max(64),
  query: z.string().min(1).max(255),
});
const SearchUserSchema = z.object({
  type: z.literal("search:user"),
  searchId: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  query: z.string().min(1).max(255),
});
const SearchRoomSchema = z.object({
  type: z.literal("search:room"),
  searchId: z.string().min(1).max(64),
  room: z.string().min(1).max(64),
  query: z.string().min(1).max(255),
});
const SearchWishlistSchema = z.object({
  type: z.literal("search:wishlist"),
  // Wishlist ids embed `wishlist:<ts>:<term>` so long terms can exceed 64 — WS-local key, no protocol limit.
  searchId: z.string().min(1).max(320),
  query: z.string().min(1).max(255),
});
const SearchBuddiesSchema = z.object({
  type: z.literal("search:buddies"),
  searchId: z.string().min(1).max(64),
  usernames: z.array(z.string().min(1).max(64)).min(1).max(100),
  query: z.string().min(1).max(255),
});
const StopMessageSchema = z.object({
  type: z.literal("search:stop"),
  searchId: z.string().min(1).max(64),
});
const SearchPageSchema = z.object({
  type: z.literal("search:page"),
  searchId: z.string().min(1).max(64),
  offset: z.number().int().min(0).max(2500),
  limit: z.number().int().min(1).max(100),
});
const BrowsePageSchema = z.object({
  type: z.literal("browse:page"),
  username: z.string().min(1).max(64),
  offset: z.number().int().min(0).max(100000),
  limit: z.number().int().min(1).max(1000),
});
// Internal web<->bridge paging only — the peer always sends one full zlib blob
// (SharedFileListRequest code 4, empty payload), so page size is wire-invisible.
const BROWSE_PAGE_SIZE = 1000;
const PingSchema = z.object({
  type: z.literal("ping"),
  ts: z.number().optional(),
});

const ProfileSchema = z.object({
  descr: z.string().max(10000),
  pic: z.string().max(5_000_000).optional(),
  totalupl: z.number().int().min(0).max(1e12),
  queuesize: z.number().int().min(0).max(1e9),
  slotsavail: z.boolean(),
  uploadallowed: z.number().int().min(0).max(3),
});

const UserInfoMessageSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("watch"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("unwatch"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("get"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("interests"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("peerAddress"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("givePrivileges"), username: z.string().min(1).max(64), days: z.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("setStatus"), status: z.number().int().min(0).max(2) }),
  z.object({ action: z.literal("setProfile"), profile: ProfileSchema }),
  z.object({ action: z.literal("checkPrivileges") }),
  z.object({ action: z.literal("changePassword"), password: z.string().min(1).max(128) }),
  z.object({ action: z.literal("reportShares"), dirs: z.number().int().min(0), files: z.number().int().min(0) }),
]);

const DownloadRequestSchema = z.object({
  type: z.literal("download:request"),
  username: z.string().min(1).max(64),
  virtualPath: z.string().min(1).max(1024),
  size: z.number().min(0).max(1e13),
  fileName: z.string().max(512).optional(),
});
const DownloadControlSchema = z.object({
  type: z.literal("download:control"),
  id: z.string().min(1).max(1024),
  action: z.enum(["cancel", "pause", "resume", "retry", "clear"]),
});
const UploadControlSchema = z.object({
  type: z.literal("upload:control"),
  id: z.string().min(1).max(1024),
  action: z.enum(["cancel", "clear", "deny"]),
});
// Nicotine-plus parity bulk clear (list entries only). statuses null = everything.
const TransferClearManySchema = z.object({
  type: z.literal("transfer:clear-many"),
  isUpload: z.boolean(),
  statuses: z.array(z.string().min(1).max(64)).max(32).nullish(),
});
const UserInfoRequestSchema = z.object({ type: z.literal("userinfo") }).and(UserInfoMessageSchema);

const ChatRoomSchema = z.object({
  type: z.literal("chat:room"),
  action: z.enum(["join", "leave", "say", "ticker", "setTicker", "addMember", "addOperator", "removeOperator", "cancelMembership", "cancelOwnership", "refreshList"]),
  room: z.string().min(1).max(64).optional(),
  message: z.string().max(5000).optional(),
  username: z.string().max(64).optional(),
});
const ChatPrivateSchema = z.object({
  type: z.literal("chat:private"),
  action: z.enum(["send", "ack"]),
  username: z.string().min(1).max(64),
  message: z.string().max(5000).optional(),
  msgId: z.number().int().optional(),
});
const ChatLogsSchema = z.object({
  type: z.literal("chat:logs"),
  scope: z.enum(["rooms", "private"]),
  key: z.string().min(1).max(64),
  lines: z.number().int().min(1).max(10000),
});
const BrowseSchema = z.object({
  type: z.literal("browse"),
  action: z.enum(["shares", "folder"]),
  username: z.string().min(1).max(64),
  folder: z.string().max(1024).optional(),
  token: z.number().int().optional(),
});

const PluginListRequestSchema = z.object({ type: z.literal("plugin:list") });
const PluginToggleSchema = z.object({ type: z.literal("plugin:toggle"), name: z.string().min(1).max(64) });
const PluginReloadSchema = z.object({ type: z.literal("plugin:reload"), name: z.string().min(1).max(64) });
const PluginUninstallSchema = z.object({ type: z.literal("plugin:uninstall"), name: z.string().min(1).max(64) });
const PluginSettingsSchema = z.object({ type: z.literal("plugin:settings"), name: z.string().min(1).max(64), settings: z.record(z.unknown()) });
const PluginResetSettingsSchema = z.object({ type: z.literal("plugin:resetSettings"), name: z.string().min(1).max(64) });
const PluginInstallSchema = z.object({ type: z.literal("plugin:install"), fileName: z.string().max(255).optional(), data: z.string().min(1).max(22_000_000) }); // base64 zip ~20MB zip cap
const PluginInstallUrlSchema = z.object({ type: z.literal("plugin:installUrl"), url: z.string().url().max(2048) });
const PluginInstallGithubTsSchema = z.object({ type: z.literal("plugin:installGithubTs"), url: z.string().url().max(2048) });

const ConfigUpdateSchema = z.object({
  type: z.literal("config:update"),
  section: z.string().min(1).max(64),
  key: z.string().min(1).max(64),
  value: z.unknown(),
});

const BanControlSchema = z.object({
  type: z.enum(["ban:add", "ban:remove", "ignore:add", "ignore:remove"]),
  username: z.string().min(1).max(64),
});

const WishlistEntrySchema = z.object({
  term: z.string().min(1).max(255),
  auto: z.boolean(),
});
const WishlistUpdateSchema = z.object({
  type: z.literal("wishlist:update"),
  terms: z.array(z.string().min(1).max(255)).max(100),
  entries: z.array(WishlistEntrySchema).max(100).optional(),
});

const StatsRequestSchema = z.object({
  type: z.literal("statistics:request"),
});
const StatsResetSchema = z.object({
  type: z.literal("statistics:reset"),
});

function defaultProfile(username: string) {
  return { username, descr: "", pic: null, totalupl: 0, queuesize: 0, slotsavail: true, uploadallowed: 1 };
}

let LISTEN_PORT = Number(process.env.LISTEN_PORT || 60754);
const PORT = Number(process.env.PORT || 8787);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";
let CONFIG_DIR = process.env.CONFIG_DIR || "/config";
let DATA_DIR = process.env.DATA_DIR || "/data";
const APP_VERSION = process.env.APP_VERSION || process.env.BUILD_TAG || process.env.TAG || "0.1.0";
const COMMIT_SHA = (process.env.COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
const BUILD_DATE = process.env.BUILD_DATE || process.env.NEXT_PUBLIC_BUILD_DATE || "";

// Ensure config+data volumes exist (dev/sandbox fallback when /config or /data not writable)
// WSL bun dev: not writable → fallback to ./config/./data or /tmp/nicotine-hub-*, then env-sync so ShareDB/others see same dir.
// MUST run before any CONFIG_DIR/DATA_DIR-dependent reads (listen_port, upnp, PluginManager)
function ensureDirWithFallback(initial: string, fallbacks: string[], envKey: string): string {
  try {
    mkdirSync(initial, { recursive: true });
    const tf = join(initial, ".writetest");
    writeFileSync(tf, "ok");
    rmSync(tf);
    return initial;
  } catch {}
  const { tmpdir } = require("node:os") as typeof import("node:os");
  for (const cand of fallbacks) {
    // Resolve to absolute — a silent relative ./config would depend on cwd
    // and diverge between dev, prod, and tests.
    const full = cand.startsWith("/tmp") ? join(tmpdir(), cand.slice(5)) : resolve(cand);
    try {
      mkdirSync(full, { recursive: true });
      const tf = join(full, ".writetest");
      writeFileSync(tf, "ok");
      rmSync(tf);
      console.warn(`[bridge] ${envKey} ${initial} not writable, falling back to ${full}`);
      return full;
    } catch {}
  }
  console.warn(`[bridge] ${envKey} ${initial} not writable and no fallback worked, using ${initial} anyway`);
  return initial;
}
CONFIG_DIR = ensureDirWithFallback(CONFIG_DIR, ["./config", "/tmp/nicotine-hub-config"], "CONFIG_DIR");
DATA_DIR = ensureDirWithFallback(DATA_DIR, ["./data", "/tmp/nicotine-hub"], "DATA_DIR");
// Ensure env reflects resolved dirs for ShareDB defaultDataDir() and diagnostics
try { if (process.env.CONFIG_DIR !== CONFIG_DIR) process.env.CONFIG_DIR = CONFIG_DIR; } catch {}
try { if (process.env.DATA_DIR !== DATA_DIR) process.env.DATA_DIR = DATA_DIR; } catch {}
// Ensure chat log dirs exist (nicotine-plus parity: CONFIG_DIR/logs/rooms + private)
try { mkdirSync(join(CONFIG_DIR, "logs", "rooms"), { recursive: true }); } catch {}
try { mkdirSync(join(CONFIG_DIR, "logs", "private"), { recursive: true }); } catch {}

// One-time migration: copy config files from old DATA_DIR to new CONFIG_DIR if CONFIG_DIR is separate and empty
try {
  if (CONFIG_DIR !== DATA_DIR) {
    const cfgFiles = ["listen_port", "host.env", "upnp_enabled", "worker.json", "shares.json", "browse.cache", "downloads.json", "transfers.json", "statistics.json", "plugins.json", "diagnostics.log", "settings.json", "wishlist.json"];
    for (const f of cfgFiles) {
      const src = join(DATA_DIR, f);
      const dst = join(CONFIG_DIR, f);
      if (!existsSync(dst) && existsSync(src)) {
        try { const data = readFileSync(src); writeFileSync(dst, data); if (f === "worker.json") try { chmodSync(dst, 0o600); } catch {} console.log(`[bridge] migrated ${f} DATA_DIR → CONFIG_DIR`); } catch {}
      }
    }
    // migrate plugins dir
    try {
      const srcDir = join(DATA_DIR, "plugins");
      const dstDir = join(CONFIG_DIR, "plugins");
      if (!existsSync(dstDir) && existsSync(srcDir)) {
        const { cpSync } = require("node:fs") as typeof import("node:fs");
        try { cpSync(srcDir, dstDir, { recursive: true }); console.log("[bridge] migrated plugins DATA_DIR → CONFIG_DIR"); } catch {}
      }
    } catch {}
  }
} catch {}

// Persisted listen port override (homelab: survives restart without compose change)
// File CONFIG_DIR/listen_port overrides env default but env wins if explicitly set.
try {
  if (!process.env.LISTEN_PORT) {
    const _persistedPath = join(CONFIG_DIR, "listen_port");
    if (existsSync(_persistedPath)) {
      const _raw = readFileSync(_persistedPath, "utf8").trim();
      const _n = Number(_raw);
      if (Number.isInteger(_n) && _n >= 1024 && _n <= 65535) LISTEN_PORT = _n;
    } else {
      // fallback to old DATA_DIR for migration compat
      const _old = join(DATA_DIR, "listen_port");
      if (existsSync(_old)) {
        const _raw = readFileSync(_old, "utf8").trim();
        const _n = Number(_raw);
        if (Number.isInteger(_n) && _n >= 1024 && _n <= 65535) LISTEN_PORT = _n;
      }
    }
  }
} catch {}

// Global UPnP toggle — mirrors nicotine config server.upnp (default true)
// Persisted to CONFIG_DIR/upnp_enabled so bridge remembers user's choice across restarts even without WS.
let GLOBAL_UPNP_ENABLED = true;
try {
  const _upnpPath = join(CONFIG_DIR, "upnp_enabled");
  if (existsSync(_upnpPath)) {
    const _raw = readFileSync(_upnpPath, "utf8").trim().toLowerCase();
    if (_raw === "0" || _raw === "false" || _raw === "off") GLOBAL_UPNP_ENABLED = false;
    else if (_raw === "1" || _raw === "true" || _raw === "on") GLOBAL_UPNP_ENABLED = true;
  } else {
    const _oldUpnp = join(DATA_DIR, "upnp_enabled");
    if (existsSync(_oldUpnp)) {
      const _raw = readFileSync(_oldUpnp, "utf8").trim().toLowerCase();
      if (_raw === "0" || _raw === "false" || _raw === "off") GLOBAL_UPNP_ENABLED = false;
      else if (_raw === "1" || _raw === "true" || _raw === "on") GLOBAL_UPNP_ENABLED = true;
    } else if (process.env.UPNP_ENABLED != null) {
      const v = String(process.env.UPNP_ENABLED).trim().toLowerCase();
      if (v === "0" || v === "false" || v === "off") GLOBAL_UPNP_ENABLED = false;
    }
  }
} catch {}

// Central durable settings store — every config:update (except worker secrets)
// merges here so ALL preferences (incl. ui/appearance) survive bridge restarts
// and resync to new browsers via config:get. Special files (listen_port,
// shares.json, worker.json, plugins.json) remain authoritative for their domains.
let PERSISTED_SETTINGS: Record<string, Record<string, unknown>> = {};
try {
  const _p = join(CONFIG_DIR, "settings.json");
  if (existsSync(_p)) {
    const _raw = JSON.parse(readFileSync(_p, "utf8")) as unknown;
    if (_raw && typeof _raw === "object" && !Array.isArray(_raw)) {
      PERSISTED_SETTINGS = _raw as Record<string, Record<string, unknown>>;
    }
  }
} catch {}
function persistSetting(section: string, key: string, value: unknown) {
  try {
    if (section === "worker") return; // secrets stay in worker.json (0600), never in settings.json
    const cur = PERSISTED_SETTINGS[section];
    PERSISTED_SETTINGS = {
      ...PERSISTED_SETTINGS,
      [section]: { ...(cur && typeof cur === "object" ? cur : {}), [key]: value },
    };
    const p = join(CONFIG_DIR, "settings.json");
    const tmp = `${p}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(PERSISTED_SETTINGS));
    renameSync(tmp, p); // atomic
  } catch (e) {
    logger.warn("server", "settings.json persist failed", { section, key, error: (e as Error).message });
  }
}

// Helper to collect current PortMapper status from active sessions (or global defaults)
function getGlobalPortMapperStatus(): { enabled: boolean; active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null; hasPort: boolean } {
  let best: { enabled: boolean; active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null; hasPort: boolean } | null = null;
  for (const s of activeSessions) {
    try {
      const st = (s as unknown as { getPortMapperStatus?: () => { active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null; hasPort: boolean }; _upnpEnabled?: boolean }).getPortMapperStatus?.();
      if (st) {
        best = { enabled: (s as unknown as { _upnpEnabled?: boolean })._upnpEnabled ?? GLOBAL_UPNP_ENABLED, active: st.active, port: st.port, ip: st.ip, error: st.error, lastSuccessAt: st.lastSuccessAt, hasPort: st.hasPort };
        if (st.active) break; // prefer active mapping
      }
    } catch {}
  }
  if (!best) {
    return { enabled: GLOBAL_UPNP_ENABLED, active: null, port: LISTEN_PORT, ip: null, error: null, lastSuccessAt: null, hasPort: true };
  }
  return best;
}

// Active Soulseek sessions across all WS connections (for global port sync)
const activeSessions = new Set<SoulseekSession>();

/* ── Shared singleton session ─────────────────────────────────────
 * The bridge owns ONE Soulseek login (one account at a time). Every WS
 * client attaches to it instead of opening its own Soulseek TCP
 * connection (a second same-user login would get kicked — login fight).
 * Event pushes fan out to all attached clients via broadcast().
 */
type AttachedClient = { send: (payload: string) => unknown };
const attachedClients = new Set<AttachedClient>();
let wsClientSeq = 0;

function broadcast(payload: string): void {
  for (const c of attachedClients) {
    try { c.send(payload); } catch {}
  }
}

function broadcastJson(msg: unknown): void {
  let s: string;
  try { s = jsonStringifySafe(msg); } catch { return; }
  broadcast(s);
}

// Peer-supplied file sizes can exceed MAX_SAFE_INTEGER (parsed as BigInt) —
// plain JSON.stringify would throw and drop the whole payload.
export function jsonStringifySafe(msg: unknown): string {
  return JSON.stringify(msg, (_k, v: unknown) =>
    typeof v === "bigint" ? (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : v);
}

function sessionStatusPayload(): { type: "session:status"; loggedIn: boolean; username?: string } {
  const loggedIn = !!sharedSession?.isLoggedIn;
  return loggedIn && sharedSessionUser
    ? { type: "session:status", loggedIn, username: sharedSessionUser }
    : { type: "session:status", loggedIn: false };
}

let sharedSession: SoulseekSession | null = null;
let sharedSessionUser: string | null = null;
let sharedLoginOutcome: { success: true; banner: string; ipAddress: string; checksum: string; isSupporter: boolean } | null = null;
let establishing = false;

/** Single TransferManager owned by the singleton session (fresh per login, like before). */
let sharedTransfers: TransferManager;

function createSharedTransfers(): TransferManager {
  const tm = new TransferManager({
    dataDir: DATA_DIR,
    onUpdate: (transfer) => broadcastJson({ type: "transfer:update", transfer }),
    onRemoved: (id) => broadcastJson({ type: "transfer:removed", id }),
    onStats: (stats) => broadcastJson({ type: "transfer:stats", ...stats }),
    onQueue: (id, place) => broadcastJson({ type: "transfer:queue", id, place }),
    onFinished: (id, fileName, size, downloadUrl) => broadcastJson({ type: "transfer:finished", id, fileName, size, downloadUrl }),
    getSession: () => sharedSession as unknown as ReturnType<TransferManager["getByToken"]> extends never ? never : unknown as never,
  });
  tm.setSessionGetter(() => sharedSession as unknown as never);
  const pt = PERSISTED_SETTINGS?.transfers ?? {};
  const keys = ["uploadslots", "useupslots", "uploadlimit", "uploadlimitalt", "use_upload_speed_limit", "downloadlimit", "downloadlimitalt", "use_download_speed_limit", "fifoqueue", "limitby", "queuelimit", "filelimit", "friendsnolimits", "preferfriends", "autoclear_downloads", "autoclear_uploads", "usernamesubfolders", "download_path_depth", "groupdownloads", "groupuploads", "incomplete_strategy", "download_destination_template", "download_subdirectory"];
  const init: Record<string, unknown> = {};
  for (const k of keys) if (pt[k] !== undefined) init[k] = pt[k];
  if (pt["incompleteStrategy"] !== undefined) init["incomplete_strategy"] = pt["incompleteStrategy"];
  if (pt["downloadDestinationTemplate"] !== undefined) init["download_destination_template"] = pt["downloadDestinationTemplate"];
  if (pt["downloadSubdirectory"] !== undefined) init["download_subdirectory"] = pt["downloadSubdirectory"];
  if (Object.keys(init).length) tm.setConfig(init);
  tm.setBanlistUpdatedCb((banlist, byUser) => {
    broadcastJson({ type: "banlist:updated", banlist, byUser, reason: "honeypot" });
  });
  return tm;
}

/** Event callbacks for the singleton session — all pushes fan out to every attached client.
 * boundTransfers pins F-chunk/transfer routing to the manager created at login:
 * after a re-login the old session's in-flight chunks still land on the OLD
 * (closed) manager instead of being rerouted into the new login's transfers. */
function sharedSessionCallbacks(boundTransfers: TransferManager) {
  return {
    onFileConnection: (token: number, socket: unknown) => {
      try { (boundTransfers as unknown as { handleFileConnection: (t: number, s: unknown) => void })?.handleFileConnection(token, socket as unknown as never); } catch {}
    },
    onFileChunk: (token: number, chunk: Buffer) => {
      try { (boundTransfers as unknown as { handleFileChunk: (t: number, c: Buffer) => void })?.handleFileChunk(token, chunk); } catch {}
    },
    onFileClosed: (token: number) => {
      try { (boundTransfers as unknown as { handleFileClosed: (t: number) => void })?.handleFileClosed(token); } catch {}
    },
    onUploadPierce: (username: string, socket: unknown) => {
      try { (boundTransfers as unknown as { handleUploadPierced: (u: string, s: unknown) => Promise<void> })?.handleUploadPierced(username, socket as unknown as never); } catch {}
    },
    getQueuePlace: (file: string) => {
      try { return (boundTransfers as unknown as { getQueuePlace: (f: string) => number })?.getQueuePlace(file) ?? 1; } catch { return 1; }
    },
    filterWishlistTerm: (t: string): string | null => {
      const out = pluginManager.outgoingWishlistSearchEvent(t);
      if (out === null) return null;
      return (out?.[0] as string) ?? t;
    },
    onUserEvent: (event: { type: string; username?: string; status?: unknown; stats?: unknown; peerAddress?: unknown; wishlistInterval?: number }) => {
      if (event.type === "user-status" && event.status) {
        const st = event.status as { username: string; status: number; privileged: boolean };
        pluginManager.userStatusNotification(st.username, st.status, st.privileged);
      } else if (event.type === "user-stats" && event.stats) {
        const st = event.stats as { username: string };
        pluginManager.userStatsNotification(st.username, event.stats as never);
      } else if (event.type === "peer-address" && event.peerAddress) {
        const pa = event.peerAddress as { ip?: string; port?: number };
        pluginManager.userResolveNotification(event.username ?? "", pa.ip ?? "", pa.port ?? 0);
        try { (sharedTransfers as unknown as { handlePeerAddressResolved?: (u: string, ip: string) => void })?.handlePeerAddressResolved?.(event.username ?? "", pa.ip ?? ""); } catch {}
      }
      logger.debug("server", "user event", { type: event.type, username: event.username });
      // Peer user-info carries pic as Buffer — JSON would relay a truthy
      // {type,data} object that crashes clients calling string methods on it.
      if (event.type === "user-info-response") {
        const ev = event as unknown as { info?: { pic?: unknown } };
        if (ev.info && typeof ev.info === "object") {
          try { ev.info.pic = userInfoPicToBase64(ev.info.pic); } catch {}
        }
      }
      broadcastJson({ type: "userinfo:event", event });
      if (event.type === "wishlist-interval" && typeof event.wishlistInterval === "number") {
        broadcastJson({ type: "wishlist:interval", wishlistInterval: event.wishlistInterval });
      }
    },
    onChatEvent: (event: { type: string; room?: string; username?: string; message?: string }) => {
      if (event.type === "private-message" && event.username && event.message) {
        const out = pluginManager.incomingPrivateChatEvent(event.username, event.message);
        if (out === null) return;
        const finalMsg = out?.[1] as string | undefined;
        if (finalMsg !== undefined) event.message = finalMsg;
        pluginManager.incomingPrivateChatNotification(event.username, event.message);
      } else if (event.type === "say-chatroom" && event.room && event.username && event.message) {
        const out = pluginManager.incomingPublicChatEvent(event.room, event.username, event.message);
        if (out === null) return;
        const finalMsg = out?.[2] as string | undefined;
        if (finalMsg !== undefined) event.message = finalMsg;
        pluginManager.incomingPublicChatNotification(event.room, event.username ?? "", event.message);
      }
      logger.debug("chat", "chat event", { type: event.type, room: event.room, username: event.username });
      try {
        if (event.type === "private-message" && event.username && event.message) {
          const isAction = event.message.startsWith("/me ") || event.message.startsWith("* ");
          const txt = isAction ? event.message.replace(/^\/(me)\s+|^\*\s+/, "") : event.message;
          logPrivateMessage(event.username, event.username, txt, { isAction });
        } else if (event.type === "say-chatroom" && event.room && event.username && event.message) {
          const isAction = event.message.startsWith("/me ") || event.message.startsWith("* ");
          const txt = isAction ? event.message.replace(/^\/(me)\s+|^\*\s+/, "") : event.message;
          logRoomMessage(event.room, event.username, txt, { isAction });
        } else if (event.type === "global-room-message" && event.room && event.username && event.message) {
          const isAction = event.message.startsWith("/me ") || event.message.startsWith("* ");
          const txt = isAction ? event.message.replace(/^\/(me)\s+|^\*\s+/, "") : event.message;
          logRoomMessage(event.room, event.username, txt, { isAction, isGlobal: true, globalRoom: event.room });
        }
      } catch {}
      broadcastJson({ type: "chat:event", event });
    },
    onRoomEvent: (event: { type: string; room?: string; username?: string; data?: unknown }) => {
      if (event.type === "join-room" && event.room) pluginManager.joinChatroomNotification(event.room);
      else if (event.type === "leave-room" && event.room) pluginManager.leaveChatroomNotification(event.room);
      else if (event.type === "user-joined-room" && event.room && event.username) pluginManager.userJoinChatroomNotification(event.room, event.username);
      else if (event.type === "user-left-room" && event.room && event.username) pluginManager.userLeaveChatroomNotification(event.room, event.username);
      else if (event.type === "room-list" && event.data) {
        // ignore
      }
      logger.debug("chat", "room event", { type: event.type, room: event.room });
      broadcastJson({ type: "room:event", event });
    },
    onBrowseEvent: (event: { type: string; username: string; folders?: unknown[]; folder?: string; token?: number; files?: unknown[]; lockedFolders?: unknown[]; error?: string }) => {
      logger.debug("server", "browse event", { type: event.type, username: event.username, folder: event.folder });
      try {
        if (event.type === "browse-shares") {
          const seen = new Set<string>();
          const out: unknown[] = [];
          for (const f of (event.folders || [])) {
            const name = (f as { name?: string }).name;
            if (typeof name !== "string" || seen.has(name)) continue;
            seen.add(name);
            out.push(f);
          }
          try { setBrowseCache(event.username.toLowerCase(), { folders: out as unknown[], ts: Date.now() }); } catch {}
          const page = out.slice(0, BROWSE_PAGE_SIZE);
          const hasMore = out.length > BROWSE_PAGE_SIZE;
          const lockedCount = Array.isArray(event.lockedFolders) ? event.lockedFolders.length : 0;
          // Stash the full result keyed per user so browse:page serves the
          // right user even with concurrent browses from multiple clients.
          try { setBrowseFull(event.username, out); } catch {}
          broadcastJson({ type: "browse:shares", username: event.username, folders: page as never, total: out.length, hasMore, offset: 0, lockedCount });
        }
        else if (event.type === "browse-folder") broadcastJson({ type: "browse:folder", username: event.username, folder: event.folder, token: event.token, files: event.files, folders: (event as { folders?: unknown }).folders });
        else if (event.type === "browse-error") {
          const isFolder = event.token !== undefined;
          broadcastJson({
            type: isFolder ? "browse:folder" : "browse:shares",
            username: event.username,
            error: event.error,
            ...(isFolder ? { token: event.token, folder: event.folder } : {}),
          });
        }
      } catch {}
    },
    onWishlistEvent: (event: { type: string; searchId: string; token?: number; rows?: unknown[]; reason?: string }) => {
      if (event.type === "result" && event.rows && event.rows.length) {
        broadcastJson({ type: "search:result", searchId: event.searchId, token: event.token, rows: event.rows });
      } else if (event.type === "end" && event.reason) {
        broadcastJson({ type: "search:end", searchId: event.searchId, reason: event.reason });
      } else if (event.type === "result" && (!event.rows || event.rows.length === 0)) {
        broadcastJson({ type: "search:start", searchId: event.searchId, token: event.token });
      }
    },
    onTransferEvent: (event: { type: string; username?: string; file?: string; token?: number; place?: number; reason?: string; direction?: number; size?: number | bigint; allowed?: boolean }) => {
      if (event.type === "queue-upload" && event.username && event.file) pluginManager.uploadQueuedNotification(event.username, event.file);
      else if (event.type === "transfer-response" && event.username && event.file) {
        pluginManager.uploadStartedNotification(event.username, event.file);
      }
      logger.debug("transfer", "transfer event", { type: event.type, username: event.username, file: event.file?.slice(0, 80), token: event.token });
      broadcastJson({ type: "peer:transfer", event });
      const tm = boundTransfers;
      if (!tm) return;
      try {
        if (event.type === "place-in-queue" && event.file && event.place !== undefined) {
          (tm as unknown as { handlePlaceInQueueResponse: (f: string, p: number, u?: string) => void }).handlePlaceInQueueResponse(event.file, event.place, event.username);
        } else if (event.type === "transfer-request" && event.file && event.token !== undefined) {
          (tm as unknown as { handleTransferRequest: (d: number, t: number, f: string, u?: string, s?: number | bigint) => void }).handleTransferRequest(event.direction ?? 1, event.token, event.file, event.username, event.size);
        } else if (event.type === "transfer-response" && event.token !== undefined && event.username) {
          if (event.allowed) {
            (tm as unknown as { handleUploadGranted: (u: string, t: number) => void }).handleUploadGranted(event.username, event.token);
          } else {
            (tm as unknown as { handleUploadRejected: (u: string, t: number, r: string) => void }).handleUploadRejected(event.username, event.token, event.reason || "Cancelled");
          }
        } else if (event.type === "queue-upload" && event.file && event.username) {
          (tm as unknown as { handleQueueUpload: (u: string, f: string) => void }).handleQueueUpload(event.username, event.file);
        } else if (event.type === "upload-denied" && event.file) {
          (tm as unknown as { handleUploadDenied: (f: string, r: string, u?: string) => void }).handleUploadDenied(event.file, event.reason || "Cancelled", event.username);
        } else if (event.type === "upload-failed" && event.file) {
          (tm as unknown as { handleUploadFailed: (f: string, u?: string) => void }).handleUploadFailed(event.file, event.username);
        }
      } catch {}
    },
    onServerEvent: (event: { type: string; listenPort?: number; attempt?: number; delay?: number; error?: string } & Record<string, unknown>) => {
      if (event.type === "reconnect") pluginManager.serverConnectNotification();
      else if (event.type === "reconnect-failed") pluginManager.serverDisconnectNotification(false);
      else if (event.type === "reconnected") pluginManager.serverConnectNotification();
      logger.info("server", "server reconnect", event as unknown as Record<string, unknown>);
      try {
        const { type: _t, ...rest } = event;
        if (event.type === "reconnected") {
          broadcastJson({ type: "server:reconnect", ok: true, listenPort: event.listenPort });
          try { broadcastJson({ type: "diagnostics:health", health: { ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: event.listenPort, configDir: CONFIG_DIR, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN, version: APP_VERSION, commitSha: COMMIT_SHA, buildDate: BUILD_DATE, upnp: getGlobalPortMapperStatus() } }); } catch {}
        } else {
          broadcastJson({ type: "server:reconnect", ...rest, attempt: event.attempt, delay: event.delay, error: event.error });
        }
      } catch {}
    },
  };
}

/** Close + forget the singleton session (global logout / pre-replace teardown). */
function teardownSharedSession(): void {
  if (sharedSession) {
    try { activeSessions.delete(sharedSession); } catch {}
    try { sharedSession.close(); } catch {}
  }
  sharedSession = null;
  sharedSessionUser = null;
  sharedLoginOutcome = null;
}

/**
 * Establish the singleton session. Broadcasts login:start/result to all
 * attached clients. Persists the encrypted vault only after a successful
 * login (bad passwords must never overwrite good vault creds).
 */
async function establishSharedSession(creds: StoredCreds): Promise<{ ok: boolean; error?: string }> {
  if (establishing) return { ok: false, error: "Login already in progress." };
  establishing = true;
  try {
    teardownSharedSession();
    // Fresh transfer state per login (matches the old per-WS TransferManager).
    try { sharedTransfers?.close(); } catch {}
    sharedTransfers = createSharedTransfers();
    const session = new SoulseekSession({
      username: creds.username,
      password: creds.password,
      host: creds.host,
      port: creds.port,
      listenPort: LISTEN_PORT,
      profile: defaultProfile(creds.username),
      dataDir: DATA_DIR,
      ...sharedSessionCallbacks(sharedTransfers),
    });
    try { (session as unknown as { setUpnpEnabled?: (b: boolean) => void }).setUpnpEnabled?.(GLOBAL_UPNP_ENABLED); } catch {}
    sharedSession = session;
    sharedSessionUser = creds.username;
    try { activeSessions.add(session); } catch {}
    try { pluginManager.setSessionGetter(() => sharedSession as unknown as ReturnType<PluginManager["setSessionGetter"]> extends never ? never : unknown as never); } catch {}
    try { (pluginManager as unknown as { setTransfersGetter?: (g: () => unknown) => void }).setTransfersGetter?.(() => sharedTransfers as unknown as never); } catch {}
    broadcastJson({ type: "login:start" });
    try {
      const outcome = await session.login() as unknown as { success: true; banner: string; ipAddress: string; checksum: string; isSupporter: boolean };
      logger.info("auth", "login success", { username: creds.username, ipAddress: outcome?.ipAddress });
      sharedLoginOutcome = { success: true, banner: outcome?.banner ?? "", ipAddress: outcome?.ipAddress ?? "", checksum: outcome?.checksum ?? "", isSupporter: outcome?.isSupporter ?? false };
      try { saveVault(CONFIG_DIR, creds); } catch (e) {
        logger.warn("auth", "vault persist failed", { error: (e as Error).message });
      }
      broadcastJson({ type: "login:result", ok: true, data: sharedLoginOutcome });
      // Push fresh transfer state to late attachers' UIs (empty right after login).
      try {
        for (const t of sharedTransfers.list()) broadcastJson({ type: "transfer:update", transfer: t });
      } catch {}
      return { ok: true };
    } catch (err) {
      logger.warn("auth", "login failed", { username: creds.username, error: (err as Error).message });
      try { activeSessions.delete(session); } catch {}
      teardownSharedSession();
      try { clearVault(CONFIG_DIR); } catch {}
      const error = (err as Error).message;
      broadcastJson({ type: "login:result", ok: false, error });
      broadcastJson(sessionStatusPayload());
      return { ok: false, error };
    }
  } finally {
    establishing = false;
  }
}

/** Best-effort auto-login from the encrypted vault (bridge restarts). */
async function restoreSharedSessionFromVault(): Promise<void> {
  try {
    const creds = loadVault(CONFIG_DIR);
    if (!creds?.username || !creds?.password) return;
    logger.info("auth", "restoring session from vault", { username: creds.username });
    await establishSharedSession(creds);
  } catch (e) {
    logger.warn("auth", "vault restore failed", { error: (e as Error).message });
  }
}

// Eager singleton TransferManager — initialized after pluginManager below
// (per-login refresh happens in establishSharedSession).

// Global plugin manager (shared across WS, but per-WS session getter is swapped)
// Must be after CONFIG_DIR fallback — otherwise WSL uses stale "/config" and EACCES on persist.
const pluginManager = new PluginManager({ configDir: CONFIG_DIR });
pluginManager.registerBuiltin("core_commands", coreCommandsManifest as unknown as Record<string, unknown>, () => new CoreCommandsPlugin());
pluginManager.registerBuiltin("spamfilter", spamManifest as unknown as Record<string, unknown>, () => new SpamfilterPlugin());
pluginManager.registerBuiltin("leech_detector", leechManifest as unknown as Record<string, unknown>, () => new LeechDetectorPlugin());
// start async (don't block serve)
pluginManager.start().catch((e) => logger.warn("bridge", "plugin manager start failed", { error: (e as Error).message }));
// expose for http handlers
(globalThis as unknown as Record<string, unknown>).__pluginManager = pluginManager;

// Singleton session wiring (must run after pluginManager exists).
sharedTransfers = createSharedTransfers();
try { pluginManager.setSessionGetter(() => sharedSession as unknown as ReturnType<PluginManager["setSessionGetter"]> extends never ? never : unknown as never); } catch {}

// ── 5-minute in-memory caches (per-process, ephemeral) ──
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const BROWSE_CACHE_TTL_MS = 5 * 60 * 1000;
const USERINFO_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;
const BROWSE_CACHE_MAX = 500;
const USERINFO_CACHE_MAX = 500;
const searchCache = new Map<string, { rows: unknown[]; total: number; ts: number }>();
const browseCache = new Map<string, { folders: unknown[]; ts: number }>();
const userInfoCache = new Map<string, { data: unknown; ts: number }>();
// Full browse results keyed per user — concurrent browses for different users
// no longer overwrite each other (replaces the old per-client fan-out stash).
const BROWSE_FULL_MAX = 50;
const browseFullStash = new Map<string, { folders: unknown[]; username: string; ts: number }>();
function setBrowseCache(key: string, val: { folders: unknown[]; ts: number }) {
  if (!browseCache.has(key) && browseCache.size >= BROWSE_CACHE_MAX) {
    const first = browseCache.keys().next().value as string | undefined;
    if (first) browseCache.delete(first);
  }
  browseCache.set(key, val);
}
function setUserInfoCache(key: string, val: { data: unknown; ts: number }) {
  if (!userInfoCache.has(key) && userInfoCache.size >= USERINFO_CACHE_MAX) {
    const first = userInfoCache.keys().next().value as string | undefined;
    if (first) userInfoCache.delete(first);
  }
  userInfoCache.set(key, val);
}
function setBrowseFull(username: string, folders: unknown[]) {
  const key = username.toLowerCase();
  if (!browseFullStash.has(key) && browseFullStash.size >= BROWSE_FULL_MAX) {
    const first = browseFullStash.keys().next().value as string | undefined;
    if (first) browseFullStash.delete(first);
  }
  browseFullStash.set(key, { folders, username, ts: Date.now() });
}
function getBrowseFull(username: string): { folders: unknown[]; username: string } | null {
  const key = username.toLowerCase();
  const e = browseFullStash.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > BROWSE_CACHE_TTL_MS) { browseFullStash.delete(key); return null; }
  return e;
}
function sweepExpiredCaches(): void {
  const now = Date.now();
  for (const [k, e] of searchCache) if (now - e.ts > SEARCH_CACHE_TTL_MS) searchCache.delete(k);
  for (const [k, e] of browseCache) if (now - e.ts > BROWSE_CACHE_TTL_MS) browseCache.delete(k);
  for (const [k, e] of userInfoCache) if (now - e.ts > USERINFO_CACHE_TTL_MS) userInfoCache.delete(k);
  for (const [k, e] of browseFullStash) if (now - e.ts > BROWSE_CACHE_TTL_MS) browseFullStash.delete(k);
}
const cacheSweepTimer = setInterval(sweepExpiredCaches, 60_000);
try { (cacheSweepTimer as unknown as { unref?: () => void }).unref?.(); } catch {}
// /files/:token links die after 24h (autoclear_* behavior unchanged).
const FILE_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
function fileTokenExpired(issuedAt: number | undefined, fallbackMtime: number | undefined): boolean {
  const at = issuedAt ?? fallbackMtime;
  if (at === undefined || !Number.isFinite(at)) return false; // untimestamped legacy → allow
  return Date.now() - at > FILE_TOKEN_MAX_AGE_MS;
}

function cacheKeySearch(query: string, mode = "global", target = ""): string {
  return `${mode}:${target.toLowerCase()}:${query.trim().toLowerCase()}`;
}
function getCachedSearch(key: string): { rows: unknown[]; total: number } | null {
  const e = searchCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > SEARCH_CACHE_TTL_MS) { searchCache.delete(key); return null; }
  return { rows: e.rows, total: e.total };
}
function setCachedSearch(key: string, rows: unknown[], total: number) {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const first = searchCache.keys().next().value as string | undefined;
    if (first) searchCache.delete(first);
  }
  searchCache.set(key, { rows: [...rows], total, ts: Date.now() });
}
// Exported for session.ts integration (optional)
export const bridgeCaches = { searchCache, browseCache, userInfoCache, getCachedSearch, setCachedSearch, setBrowseCache, setUserInfoCache, sweepExpiredCaches };
// ─────────────────────────────────────────────────────────

function errorMessage(error: string): string { return JSON.stringify({ type: "error", error }); }

function extractToken(req: Request): string | null {
  const url = new URL(req.url);
  const qp = url.searchParams.get("token");
  if (qp) return qp;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const proto = req.headers.get("sec-websocket-protocol");
  // Client may send token as subprotocol like "bearer, <token>"
  if (proto) {
    const parts = proto.split(",").map((s) => s.trim());
    for (const p of parts) if (p && p !== "bearer") return p;
  }
  return null;
}

function getCorsHeaders(req?: Request): Record<string, string> {
  const base: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "vary": "Origin",
  };
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length > 0 && req) {
    const origin = req.headers.get("origin");
    if (origin && allowed.includes(origin)) {
      base["access-control-allow-origin"] = origin;
      base["access-control-allow-credentials"] = "true";
    } else if (!origin) {
      base["access-control-allow-origin"] = allowed[0] || "*";
    }
  } else {
    base["access-control-allow-origin"] = "*";
  }
  return base;
}
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
// ponytail: deduped 9× auth blocks into one helper; re-split if per-route auth diverges
function requireAuth(req: Request, cors: Record<string, string>): Response | null {
  if (!BRIDGE_TOKEN) return null;
  const tok = extractToken(req);
  if (tok !== BRIDGE_TOKEN) return new Response("Unauthorized", { status: 401, headers: cors });
  return null;
}

export const server = Bun.serve<{ session?: SoulseekSession; transfers?: TransferManager; logUnsub?: () => void; pluginManager?: PluginManager }>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    // Homelab: warn if BRIDGE_TOKEN not set (LAN without auth)
    if (import.meta.main && !BRIDGE_TOKEN) {
      // logged once via diagLog below; keep fetch-side quiet
    }
    const cors = getCorsHeaders(req);
    const secHeaders = { ...cors, ...SECURITY_HEADERS };
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === "/health" && req.method === "GET") {
      // Detailed health JSON if ?json or Accept: application/json, else plain "ok" for compose healthcheck
      const wantJson = url.searchParams.has("json") || (req.headers.get("accept") || "").includes("application/json");
      if (wantJson) {
        // Keep detailed JSON behind token if BRIDGE_TOKEN set (info disclosure), but allow unauth plain check
        if (BRIDGE_TOKEN) {
          const tok = extractToken(req);
          if (tok !== BRIDGE_TOKEN) {
            // For homelab, don't hard-block health json — but gate dataDir/listenPort behind auth
            return new Response(JSON.stringify({
              ok: true,
              ts: new Date().toISOString(),
              uptime: process.uptime(),
              port: PORT,
              tokenAuth: true,
              version: APP_VERSION,
              commitSha: COMMIT_SHA,
            }), { status: 200, headers: { "content-type": "application/json", ...cors } });
          }
        }
        const upnpStatus = getGlobalPortMapperStatus();
        return new Response(JSON.stringify({
          ok: true,
          ts: new Date().toISOString(),
          uptime: process.uptime(),
          port: PORT,
          listenPort: LISTEN_PORT,
          configDir: CONFIG_DIR,
          dataDir: DATA_DIR,
          tokenAuth: !!BRIDGE_TOKEN,
          version: APP_VERSION,
          commitSha: COMMIT_SHA,
          buildDate: BUILD_DATE,
          upnp: upnpStatus,
        }), { status: 200, headers: { "content-type": "application/json", ...cors } });
      }
      return new Response("ok", { status: 200, headers: { "cache-control": "no-store", ...cors } });
    }
    // UPnP status endpoint (detailed, auth-gated like health json)
    if ((url.pathname === "/upnp/status" || url.pathname === "/api/upnp/status") && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const st = getGlobalPortMapperStatus();
      return new Response(JSON.stringify({ ...st, listenPort: LISTEN_PORT, ts: new Date().toISOString() }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
    }
    // Port checker — external host (mirrors pynicotine/portchecker.py, slsknet.org).
    // Gated like /upnp/status when BRIDGE_TOKEN is set (reveals listen-port reachability).
    if ((url.pathname === "/portchecker" || url.pathname === "/api/portchecker") && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const portParam = Number(url.searchParams.get("port") || LISTEN_PORT);
      const port = Number.isInteger(portParam) && portParam >= 1 && portParam <= 65535 ? portParam : LISTEN_PORT;
      try {
        const result = await portChecker.checkStatus(port);
        const upnp = getGlobalPortMapperStatus();
        return new Response(JSON.stringify({ ...result, upnp, listenPort: port, ts: new Date().toISOString() }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store", ...cors },
        });
      } catch (e) {
        return new Response(JSON.stringify({ port, open: null, error: (e as Error).message, ts: new Date().toISOString() }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store", ...cors },
        });
      }
    }
    if ((url.pathname === "/interfaces" || url.pathname === "/api/interfaces") && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      try {
        const { networkInterfaces } = await import("node:os");
        const raw = networkInterfaces();
        // IPv4 only (Soulseek peer listener is IPv4), human-friendly name stored; show internal with flag
        const result = Object.entries(raw).flatMap(([name, addrs]) =>
          (addrs ?? []).filter((a) => a.family === "IPv4").map((a) => ({
            name,
            address: a.address,
            netmask: a.netmask,
            family: a.family,
            internal: a.internal,
            mac: a.mac,
            cidr: (a as unknown as { cidr?: string }).cidr ?? null,
          }))
        );
        return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "content-type": "application/json", ...cors } });
      }
    }
    if (url.pathname === "/logs" && req.method === "GET") {
      // Simple auth check via token param/header (mirror /ws)
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const tail = Math.min(Math.max(Number(url.searchParams.get("tail") || "500"), 1), 2000);
      const level = (url.searchParams.get("level") as LogLevel) || "debug";
      const scope = url.searchParams.get("scope") || undefined;
      let entries = diagTail(2000, level as LogLevel);
      if (scope) entries = entries.filter((e) => e.scope === scope);
      entries = entries.slice(-tail);
      return new Response(JSON.stringify({ entries, total: entries.length }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
    }
    if (url.pathname === "/diagnostics" && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const tail = Math.min(Math.max(Number(url.searchParams.get("tail") || "500"), 1), 2000);
      const level = (url.searchParams.get("level") as LogLevel) || "debug";
      let entries = diagTail(2000, level as LogLevel);
      entries = entries.slice(-tail);
      const _upnpDiag = getGlobalPortMapperStatus();
      return new Response(JSON.stringify({
        health: { ok: true, ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: LISTEN_PORT, configDir: CONFIG_DIR, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN, version: APP_VERSION, commitSha: COMMIT_SHA, buildDate: BUILD_DATE, upnp: _upnpDiag },
        logs: entries,
      }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
    }

    if (url.pathname === "/plugins" && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const list = pluginManager.getInstalledPluginListWithStatus();
      // include meta for each + loaded settings/metasettings
      const enriched = list.map((p) => ({
        ...p,
        settings: pluginManager.getPluginSettings(p.name),
        metasettings: pluginManager.getPluginMetaSettings(p.name),
      }));
      return new Response(JSON.stringify({ plugins: enriched, globalEnable: true }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
    }
    if (url.pathname === "/plugins/install" && req.method === "POST") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      // expect multipart or raw zip; handle raw body as zip bytes (content-type octet-stream) or JSON {url}
      const ct = req.headers.get("content-type") || "";
      // size guard: reject huge bodies before buffering (homelab: 20MB limit)
      const clen = Number(req.headers.get("content-length") || "0");
      if (clen > 20_000_000) return new Response(JSON.stringify({ error: "payload too large (max 20MB)" }), { status: 413, headers: { "content-type": "application/json", ...cors } });
      if (ct.includes("application/json")) {
        try {
          const body = (await req.json()) as { url?: string; githubTsUrl?: string; data?: string; fileName?: string };
          if (body.githubTsUrl) {
            const name = await (pluginManager as unknown as { installFromGithubTs: (u: string) => Promise<string | null> }).installFromGithubTs(body.githubTsUrl);
            if (!name) return new Response(JSON.stringify({ error: "install failed — only .ts/.js with Plugin class allowed (Python .py blocked)" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
            return new Response(JSON.stringify({ ok: true, name }), { status: 200, headers: { "content-type": "application/json", ...cors } });
          }
          if (body.url) {
            const name = await pluginManager.installFromUrl(body.url);
            if (!name) return new Response(JSON.stringify({ error: "install failed — zip must contain .ts/.js and Python is blocked" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
            return new Response(JSON.stringify({ ok: true, name }), { status: 200, headers: { "content-type": "application/json", ...cors } });
          }
          if (body.data) {
            // 20MB base64 cap enforced via schema next, double-check here
            if (body.data.length > 22_000_000) return new Response(JSON.stringify({ error: "base64 too large" }), { status: 413, headers: { "content-type": "application/json", ...cors } });
            const buf = Buffer.from(body.data, "base64");
            if (buf.length > 20_000_000) return new Response(JSON.stringify({ error: "zip too large (max 20MB)" }), { status: 413, headers: { "content-type": "application/json", ...cors } });
            const safeFile = (body.fileName || "plugin.zip").replace(/[^a-zA-Z0-9._\-]/g, "_").slice(0, 64) || "plugin.zip";
            const tmp = join(CONFIG_DIR, `.upload_${Date.now()}_${safeFile}`);
            try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
            writeFileSync(tmp, buf);
            const name = await (pluginManager as unknown as { installPluginFromZip: (p: string) => Promise<string | null> }).installPluginFromZip(tmp);
            try { rmSync(tmp, { force: true }); } catch {}
            if (!name) return new Response(JSON.stringify({ error: "install failed" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
            return new Response(JSON.stringify({ ok: true, name }), { status: 200, headers: { "content-type": "application/json", ...cors } });
          }
        } catch (e) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { "content-type": "application/json", ...cors } }); }
      }
      // raw zip bytes
      try {
        const buf = Buffer.from(await req.arrayBuffer());
        if (buf.length === 0) return new Response("Missing zip body", { status: 400, headers: cors });
        if (buf.length > 20_000_000) return new Response(JSON.stringify({ error: "zip too large (max 20MB)" }), { status: 413, headers: { "content-type": "application/json", ...cors } });
        const tmp = join(CONFIG_DIR, `.upload_${Date.now()}.zip`);
        writeFileSync(tmp, buf);
        const name = await (pluginManager as unknown as { installPluginFromZip: (p: string) => Promise<string | null> }).installPluginFromZip(tmp);
        try { rmSync(tmp, { force: true }); } catch {}
        if (!name) return new Response(JSON.stringify({ error: "install failed" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
        return new Response(JSON.stringify({ ok: true, name }), { status: 200, headers: { "content-type": "application/json", ...cors } });
      } catch (e) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "content-type": "application/json", ...cors } }); }
    }

    // GET /api/files?path=/subdir — browsing host root (starts at /data but can go up to /). See files.ts BROWSE_ROOT.
    if (url.pathname === "/api/files" && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const rawPath = url.searchParams.get("path") ?? "/";
      // Reject overly long or null-byte paths early (defense in depth, files.ts also handles)
      if (rawPath.length > 1024 || rawPath.includes("\0")) {
        return new Response(JSON.stringify({ error: "invalid path" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
      }
      try {
        const result = await listDirectory(rawPath, "/");
        // Do not expose absolute disk path outside container in production; but exposing DATA_DIR-relative is fine.
        // Keep absolutePath for debugging only when token auth passes, otherwise strip to prevent info leak? For homelab we include sanitized version.
        return new Response(JSON.stringify({
          path: result.path,
          parent: result.parent,
          entries: result.entries,
          // absolutePath kept internal; expose only if BRIDGE_TOKEN auth passed or not gated — still just DATA_DIR prefix
          // To avoid leaking host mount specifics, we expose only relative path. Absolute is DATA_DIR-based anyway.
        }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
      } catch (e) {
        const msg = (e as Error).message || "error";
        const status = (e as unknown as { status?: number }).status;
        if (msg.includes("traversal") || msg.includes("escapes")) {
          return new Response(JSON.stringify({ error: "path traversal blocked" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
        }
        if (status === 404) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json", ...cors } });
        if (status === 400) return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "content-type": "application/json", ...cors } });
        logger.warn("bridge", "api/files error", { error: msg, path: rawPath.slice(0, 200) });
        return new Response(JSON.stringify({ error: "internal error" }), { status: 500, headers: { "content-type": "application/json", ...cors } });
      }
    }

    // GET /api/files/raw?path=/data/Music/song.flac — raw bytes for in-browser audio/image preview.
    // Homelab: any mounted path is servable (no allowlist). Traversal is blocked
    // by resolveSafePath; symlinks are resolved to real and served as real.
    if (url.pathname === "/api/files/raw" && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const rawPath = url.searchParams.get("path") ?? "";
      if (!rawPath || rawPath.length > 1024 || rawPath.includes("\0")) {
        return new Response(JSON.stringify({ error: "invalid path" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
      }
      try {
        const { statSync, realpathSync } = require("node:fs") as typeof import("node:fs");
        const { basename } = require("node:path") as typeof import("node:path");
        // FileExplorer paths are host-root-absolute ("/data/...", "/media/...") —
        // resolve like the listing endpoint, then serve the realpath target.
        const abs = await resolveSafePath(rawPath, "/");
        let st;
        try {
          st = statSync(abs);
        } catch {
          return new Response("Not found", { status: 404, headers: secHeaders });
        }
        if (!st.isFile()) return new Response("Not found", { status: 404, headers: secHeaders });
        let real = abs;
        try {
          real = realpathSync(abs);
        } catch {}
        if (st.size > 500 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: "file too large to stream" }), { status: 413, headers: { "content-type": "application/json", ...cors } });
        }
        if (url.searchParams.get("preview") === "1" && st.size > 25 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: "too large to preview" }), { status: 413, headers: { "content-type": "application/json", ...cors } });
        }
        return serveFileWithRanges(real, req, cors, sanitizeFileNameForHeader(basename(real)));
      } catch (e) {
        const msg = (e as Error).message || "error";
        if (msg.includes("traversal") || msg.includes("escapes")) {
          return new Response(JSON.stringify({ error: "path traversal blocked" }), { status: 400, headers: { "content-type": "application/json", ...cors } });
        }
        return new Response("Not found", { status: 404, headers: secHeaders });
      }
    }

    if (url.pathname === "/ws") {
      if (BRIDGE_TOKEN) {
        const tok = extractToken(req);
        if (tok !== BRIDGE_TOKEN) {
          return new Response("Unauthorized: invalid token", { status: 401 });
        }
      }
      const ok = server.upgrade(req, { data: {} });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Container self-recreate via Docker socket (opt-in: ALLOW_CONTAINER_RESTART=1
    // + /var/run/docker.sock mount). Lets a UI port change update the whole
    // bridge: container host-port mappings are immutable at runtime, so only a
    // recreate applies a new mapping (plain `docker restart` keeps the old one).
    if (url.pathname === "/container" && req.method === "GET") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      let mapping: number[] = [];
      let envPort: number | null = null;
      let name: string | null = null;
      try {
        const insp = await inspectSelfContainer();
        if (insp) {
          mapping = parseHostPorts(insp);
          envPort = envListenPort(insp);
          name = (insp.Name || "").replace(/^\//, "") || null;
        }
      } catch (e) {
        logger.warn("bridge", "container inspect failed", { error: (e as Error).message });
      }
      return new Response(JSON.stringify({
        ...recreateStatus(),
        selfId: (getSelfContainerId() || "").slice(0, 12) || null,
        name,
        mapping,
        envPort,
        wantPort: LISTEN_PORT,
        mappingMatches: mapping.includes(LISTEN_PORT),
        ts: new Date().toISOString(),
      }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
    }
    if (url.pathname === "/restart" && req.method === "POST") {
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      const st = recreateStatus();
      if (!st.enabled || !st.socket) {
        return new Response(JSON.stringify({
          error: "container restart not available",
          hint: "mount /var/run/docker.sock + set ALLOW_CONTAINER_RESTART=1 (see compose.yaml), then LISTEN_PORT=<port> applies on recreate",
          ...st,
        }), { status: 501, headers: { "content-type": "application/json", ...cors } });
      }
      if (st.inProgress) return new Response(JSON.stringify({ error: "recreate already in progress" }), { status: 409, headers: { "content-type": "application/json", ...cors } });
      if (!getSelfContainerId()) return new Response(JSON.stringify({ error: "not running in a container" }), { status: 501, headers: { "content-type": "application/json", ...cors } });
      let port = LISTEN_PORT;
      try {
        const body = (await req.json()) as { port?: number };
        if (body?.port !== undefined) port = Number(body.port);
      } catch { /* empty body → current LISTEN_PORT */ }
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return new Response(JSON.stringify({ error: `Invalid listen port ${port} (must be 1024-65535)` }), { status: 400, headers: { "content-type": "application/json", ...cors } });
      }
      // 202: swap happens async — this container (and its sockets) go away mid-swap
      void recreateSelfWithPort(port).then(
        (r) => diagLog("info", "bridge", "container recreate finished", { port, ...r }),
        (e) => diagLog("warn", "bridge", "container recreate failed", { port, error: (e as Error).message })
      );
      return new Response(JSON.stringify({ ok: true, restarting: true, port, ts: new Date().toISOString() }), { status: 202, headers: { "content-type": "application/json", ...cors } });
    }

    // GET /files/:token — serve finished downloads from DATA_DIR/downloads
    // Homelab: if BRIDGE_TOKEN set, require valid token (LAN auth); otherwise open but still strict lookup
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      const tokenStr = url.pathname.slice("/files/".length).split("/")[0];
      const token = Number(tokenStr);
      if (!Number.isFinite(token)) return new Response("Not found", { status: 404, headers: secHeaders });
      // Auth gate — mirrors /ws when token enabled; never leak files without valid token
      { const _auth = requireAuth(req, cors); if (_auth) return _auth; }
      // Exact first: live transfer dest via manager (nested user dirs, migrated
      // layouts). Flat downloads.json lookup below stays as fallback.
      try {
        const mgrPath = sharedTransfers?.getFilePathForToken(token);
        if (mgrPath) {
          const { existsSync: es, statSync: ss } = require("node:fs") as typeof import("node:fs");
          const { basename: bn, resolve: res } = require("node:path") as typeof import("node:path");
          const r = res(mgrPath);
          const root = sharedTransfers?.downloadsRoot?.() ?? res(join(DATA_DIR, "downloads"));
          if (es(r) && (r === root || r.startsWith(root + "/"))) {
            const t = sharedTransfers?.getByToken(token) as { finishedAt?: number } | undefined;
            let mt: number | undefined;
            try { mt = ss(r).mtimeMs; } catch {}
            if (fileTokenExpired(t?.finishedAt, mt)) return new Response("Not found", { status: 404, headers: secHeaders });
            return serveFileWithRanges(r, req, cors, sanitizeFileNameForHeader(bn(r)));
          }
        }
      } catch {}
      try {
        const { existsSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
        const { join, basename, resolve } = require("node:path") as typeof import("node:path");
        // Strict lookup: only Finished entries match token; no fallback to arbitrary first file
        const dlPath = join(CONFIG_DIR, "downloads.json");
        let fileName: string | undefined;
        let tokenIssuedAt: number | undefined;
        if (existsSync(dlPath)) {
          try {
            const arr = JSON.parse(readFileSync(dlPath, "utf8")) as Array<{ token?: number; fileName?: string; size?: number; status?: string; finishedAt?: number }>;
            const entry = arr.find((e) => e.token === token && e.status === "Finished");
            if (entry) { fileName = entry.fileName; tokenIssuedAt = entry.finishedAt; }
          } catch {}
        }
        if (!fileName) {
          const alt = join(CONFIG_DIR, "transfers.json");
          if (existsSync(alt)) {
            try {
              const arr = JSON.parse(readFileSync(alt, "utf8")) as Array<{ token?: number; fileName?: string; size?: number; status?: string; finishedAt?: number }>;
              const entry = arr.find((e) => e.token === token && e.status === "Finished");
              if (entry) { fileName = entry.fileName; tokenIssuedAt = entry.finishedAt; }
            } catch {}
          }
        }
        if (!fileName) return new Response("Not found", { status: 404, headers: secHeaders });
        // Sanitize: basename + whitelist, prevent traversal/CRLF
        const safeName = sanitizeFileNameForHeader(basename(fileName));
        const downloadsDir = resolve(join(DATA_DIR, "downloads"));
        const cand = resolve(join(downloadsDir, safeName));
        // containment check
        if (!cand.startsWith(downloadsDir + "/") && cand !== downloadsDir) return new Response("Not found", { status: 404, headers: secHeaders });
        // Also try exact safeName first, then original sanitized if different (for legacy entries with underscores)
        let filePath: string | undefined;
        if (existsSync(cand)) filePath = cand;
        else {
          // Fallback: try original fileName sanitized differently (legacy) but still contained
          const altSafe = sanitizeFileNameForHeader(fileName);
          const altCand = resolve(join(downloadsDir, altSafe));
          if (altCand.startsWith(downloadsDir + "/") && existsSync(altCand)) filePath = altCand;
        }
        // Legacy stubs: scan DATA_DIR recursively (e.g. DATA_DIR/DJSplash/file.m4a) so old Finished without downloads dest still serves actual file
        if (!filePath || !existsSync(filePath)) {
          try {
            const { readdirSync: rds, statSync: sts } = require("node:fs") as typeof import("node:fs");
            const scan = (dir: string, target: string, depth = 2): string | null => {
              try {
                const c = resolve(join(dir, target));
                if (c.startsWith(resolve(DATA_DIR) + "/") && existsSync(c)) return c;
                if (depth <= 0 || !existsSync(dir)) return null;
                for (const ent of rds(dir)) {
                  const p = resolve(join(dir, ent));
                  try { if (sts(p).isDirectory() && p.startsWith(resolve(DATA_DIR) + "/")) { const r = scan(p, target, depth - 1); if (r) return r; } } catch {}
                }
              } catch {}
              return null;
            };
            const hit = scan(DATA_DIR, safeName, 4) || scan(DATA_DIR, sanitizeFileNameForHeader(fileName), 4);
            if (hit && existsSync(hit)) filePath = hit;
          } catch {}
        }
        if (!filePath || !existsSync(filePath)) return new Response("Not found", { status: 404, headers: secHeaders });
        // Token expiry: finishedAt when present, else file mtime as issue-time proxy.
        try {
          const mt = statSync(filePath).mtimeMs;
          if (fileTokenExpired(tokenIssuedAt, mt)) return new Response("Not found", { status: 404, headers: secHeaders });
        } catch {}
        return serveFileWithRanges(filePath, req, cors, safeName);
      } catch {
        return new Response("Not found", { status: 404, headers: secHeaders });
      }
    }

    // Spectrum moved to the worker service (apps/worker). This stub tells
    // stale web bundles where to go instead of a bare 404.
    if ((url.pathname.startsWith("/spectrum/") || url.pathname.startsWith("/api/spectrum/")) && req.method === "GET") {
      return new Response(JSON.stringify({ error: "moved to worker: POST /spectrum/request on :8789" }), { status: 410, headers: { "content-type": "application/json", ...cors } });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    perMessageDeflate: true,
    open(ws) {
      ws.data = {};
      (ws.data as unknown as Record<string, unknown>).pluginManager = pluginManager;
      (ws.data as unknown as Record<string, unknown>).clientId = `c${++wsClientSeq}`;
      logger.info("bridge", "ws open", { ip: (ws as unknown as { remoteAddress?: string }).remoteAddress });
      // Attach to the singleton session — no per-client Soulseek login.
      try { attachedClients.add(ws as unknown as AttachedClient); } catch {}
      setTimeout(() => {
        try {
          for (const t of sharedTransfers.list()) { try { ws.send(JSON.stringify({ type: "transfer:update", transfer: t })); } catch {} }
        } catch {}
        // Tell the newcomer whether the server is already logged in (any LAN
        // client auto-attaches — no per-client cookie needed).
        try { ws.send(JSON.stringify(sessionStatusPayload())); } catch {}
      }, 50);
      // Subscribe this socket to live diagnostics logs (all logged-in users OK — ws is already the auth boundary)
      const unsub = diagSubscribe((entry) => {
        try { ws.send(JSON.stringify({ type: "diagnostics:log", entry })); } catch {}
      });
      (ws.data as unknown as { logUnsub?: () => void }).logUnsub = unsub;
      // Send initial tail (500)
      try {
        const tail = diagTail(500, "debug");
        ws.send(JSON.stringify({ type: "diagnostics:init", entries: tail }));
      } catch {}
      // Send initial diagnostics health
      try {
        ws.send(JSON.stringify({ type: "diagnostics:health", health: { ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: LISTEN_PORT, configDir: CONFIG_DIR, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN, version: APP_VERSION, commitSha: COMMIT_SHA, buildDate: BUILD_DATE, upnp: getGlobalPortMapperStatus() } }));
      } catch {}
    },
    async message(ws, raw) {
      // Homelab guard: reject huge WS frames before JSON.parse (1MB)
      const rawStr = String(raw);
      if (rawStr.length > 1_000_000) { try { ws.close(1009, "frame too large"); } catch {} return; }
      let parsed: unknown;
      try { parsed = JSON.parse(rawStr); } catch { ws.send(errorMessage("Invalid JSON payload.")); return; }
      const data = parsed as { type?: string };

      if (data.type === "login") {
        const result = LoginMessageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid login message.")); return; }
        const { username, password, host, port, force } = result.data;
        logger.info("auth", "login attempt", { username, host: host || "server.slsknet.org", port: port || 2242 });
        // Singleton: one Soulseek login per bridge. Same-user → attach, no new TCP.
        const intent = resolveLoginIntent({ loggedIn: !!sharedSession?.isLoggedIn, currentUser: sharedSessionUser, username, force });
        if (intent === "attach") {
          if (sharedLoginOutcome) ws.send(JSON.stringify({ type: "login:result", ok: true, data: sharedLoginOutcome }));
          else ws.send(JSON.stringify(sessionStatusPayload()));
          return;
        }
        if (intent === "conflict") {
          // Different user while the singleton is active — client shows the
          // takeover popup and re-sends with force:true only on explicit confirm.
          ws.send(JSON.stringify({ type: "login:conflict", currentUser: sharedSessionUser, attemptedUser: username }));
          return;
        }
        // "fresh" or user-confirmed "replace": (re)establish the singleton.
        // Outcomes fan out via broadcast (establishSharedSession covers the
        // attached requester too); the catch is only a safety net for throws
        // outside the managed flow. The establishing guard below is the one
        // path that never broadcasts, so it replies per-WS (no hung requester).
        if (establishing) {
          ws.send(JSON.stringify({ type: "login:result", ok: false, error: "Login already in progress." }));
          return;
        }
        establishSharedSession({ username, password, host, port }).catch((e: Error) => {
          try { ws.send(JSON.stringify({ type: "login:result", ok: false, error: e.message })); } catch {}
        });
        return;
      }

      if (data.type === "session:status") {
        const statusParsed = SessionStatusSchema.safeParse(parsed);
        if (!statusParsed.success) { ws.send(errorMessage("Invalid session message.")); return; }
        ws.send(JSON.stringify(sessionStatusPayload()));
        return;
      }

      if (data.type === "logout") {
        // Global logoff: drops the singleton Soulseek session for ALL clients,
        // clears the vault, and tells every attached client to return to login.
        teardownSharedSession();
        try { clearVault(CONFIG_DIR); } catch {}
        try { sharedTransfers?.close(); } catch {}
        sharedTransfers = createSharedTransfers();
        logger.info("auth", "logout — shared soulseek session closed");
        broadcastJson({ type: "session:ended", reason: "logout" });
        broadcastJson(sessionStatusPayload());
        return;
      }

      // Per-client search-id namespace: session keys are "<clientId>:<searchId>" so
      // two tabs reusing an id can't collide; payloads back to clients keep the
      // original id via the `...p, searchId` override at each call site.
      const wsClientId = (): string => String((ws.data as unknown as Record<string, unknown>).clientId ?? "");
      const nsSearchId = (searchId: string): string => namespaceSearchId(wsClientId(), searchId);
      // Helpers to enforce logged-in (singleton session shared by all clients)
      const requireLogin = (): SoulseekSession | null => {
        const s = sharedSession;
        if (!s || !s.isLoggedIn) { ws.send(errorMessage("Not logged in.")); return null; }
        return s;
      };

      if (data.type === "search") {
        const result = SearchMessageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, query } = result.data;
        const out = pluginManager.outgoingGlobalSearchEvent(query);
        if (out === null) {
          logger.debug("search", "search blocked by plugin", { searchId, query: query.slice(0,80) });
          return;
        }
        const finalQuery = (out?.[0] as string) ?? query;
        // Search cache disabled — always hit network for fresh results (see fix/port-search-browse)
        logger.info("search", "search request", { searchId, query: finalQuery.slice(0,80), origQuery: query.slice(0,80) });
        const token = session.search(finalQuery, nsSearchId(searchId), {
          onResult: (p) => {
            logger.info("search", "search result → all clients", { searchId, token: p.token, rows: p.rows?.length });
            broadcastJson({ type: "search:result", ...p, searchId });
          },
          onEnd: (p) => {
            logger.info("search", "search end", { searchId, reason: p.reason });
            broadcastJson({ type: "search:end", ...p, searchId });
          },
        });
        logger.info("search", "search dispatched", { searchId, token, query: finalQuery.slice(0,80) });
        if (token === 0) {
          logger.warn("search", "search failed to start (not logged in?)", { searchId, query: finalQuery.slice(0,80) });
          ws.send(JSON.stringify({ type: "search:end", searchId, reason: "error" }));
        } else broadcastJson({ type: "search:start", searchId, token });
        return;
      }
      if (data.type === "search:user") {
        const result = SearchUserSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:user message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, username, query } = result.data;
        const out = pluginManager.outgoingUserSearchEvent([username], query);
        if (out === null) return;
        const finalQuery = (out?.[1] as string) ?? query;
        const token = session.searchUser(username, finalQuery, nsSearchId(searchId), {
          onResult: (p) => broadcastJson({ type: "search:result", ...p, searchId }),
          onEnd: (p) => broadcastJson({ type: "search:end", ...p, searchId }),
        });
        broadcastJson({ type: "search:start", searchId, token });
        return;
      }
      if (data.type === "search:room") {
        const result = SearchRoomSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:room message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, room, query } = result.data;
        const out = pluginManager.outgoingRoomSearchEvent([room], query);
        if (out === null) return;
        const finalQuery = (out?.[1] as string) ?? query;
        const token = session.searchRoom(room, finalQuery, nsSearchId(searchId), {
          onResult: (p) => broadcastJson({ type: "search:result", ...p, searchId }),
          onEnd: (p) => broadcastJson({ type: "search:end", ...p, searchId }),
        });
        broadcastJson({ type: "search:start", searchId, token });
        return;
      }
      if (data.type === "search:wishlist") {
        const result = SearchWishlistSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:wishlist message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, query } = result.data;
        const out = pluginManager.outgoingWishlistSearchEvent(query);
        if (out === null) return;
        const finalQuery = (out?.[0] as string) ?? query;
        const token = session.wishlistSearch(finalQuery, nsSearchId(searchId), {
          onResult: (p) => broadcastJson({ type: "search:result", ...p, searchId }),
          onEnd: (p) => broadcastJson({ type: "search:end", ...p, searchId }),
        });
        broadcastJson({ type: "search:start", searchId, token });
        return;
      }
      if (data.type === "search:buddies") {
        const result = SearchBuddiesSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:buddies message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, usernames, query } = result.data;
        // filter to plugin buddy search event (same as nicotine-plus)
        const out = pluginManager.outgoingUserSearchEvent(usernames, query);
        if (out === null) return;
        const finalUsernames = (out?.[0] as string[]) ?? usernames;
        const finalQuery = (out?.[1] as string) ?? query;
        const token = (session as unknown as { searchBuddies: (u:string[], q:string, id:string, h: unknown)=>number }).searchBuddies(finalUsernames, finalQuery, nsSearchId(searchId), {
          onResult: (p: unknown) => broadcastJson({ type: "search:result", ...(p as object), searchId }),
          onEnd: (p: unknown) => broadcastJson({ type: "search:end", ...(p as object), searchId }),
        });
        broadcastJson({ type: "search:start", searchId, token });
        return;
      }
      if (data.type === "search:stop") {
        const result = StopMessageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid stop message.")); return; }
        sharedSession?.cancelSearch(nsSearchId(result.data.searchId));
        return;
      }
      if (data.type === "search:page") {
        const result = SearchPageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:page.")); return; }
        // client pagination is local — server just acks (no-op), search results already buffered client-side
        ws.send(JSON.stringify({ type: "search:page", searchId: result.data.searchId, offset: result.data.offset, limit: result.data.limit, rows: [], total: 0, hasMore: false }));
        return;
      }
      if (data.type === "browse:page") {
        const result = BrowsePageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid browse:page.")); return; }
        // Per-user stash first — exact owner, no cross-browse mixups.
        const stashed = getBrowseFull(result.data.username);
        if (stashed) {
          const slice = stashed.folders.slice(result.data.offset, result.data.offset + result.data.limit);
          ws.send(jsonStringifySafe({ type: "browse:shares", username: stashed.username, folders: slice as never, total: stashed.folders.length, hasMore: result.data.offset + result.data.limit < stashed.folders.length, offset: result.data.offset }));
          return;
        }
        const full = ((ws.data as unknown as Record<string, unknown>)._browseFull as unknown[] | undefined) || [];
        const owner = ((ws.data as unknown as Record<string, unknown>)._browseUser as string | undefined) || result.data.username;
        if (owner.toLowerCase() !== result.data.username.toLowerCase()) {
          // try cache
          const cached = browseCache.get(result.data.username.toLowerCase());
          if (cached && Date.now() - cached.ts < BROWSE_CACHE_TTL_MS) {
            const slice = cached.folders.slice(result.data.offset, result.data.offset + result.data.limit);
            ws.send(jsonStringifySafe({ type: "browse:shares", username: result.data.username, folders: slice as never, total: cached.folders.length, hasMore: result.data.offset + result.data.limit < cached.folders.length, offset: result.data.offset }));
            return;
          }
          ws.send(errorMessage("No cached browse for that user."));
          return;
        }
        const slice = full.slice(result.data.offset, result.data.offset + result.data.limit);
        ws.send(jsonStringifySafe({ type: "browse:shares", username: owner, folders: slice as never, total: full.length, hasMore: result.data.offset + result.data.limit < full.length, offset: result.data.offset }));
        return;
      }
      if (data.type === "ping") {
        const result = PingSchema.safeParse(parsed);
        if (!result.success) { ws.send(JSON.stringify({ type: "pong", ts: Date.now() })); return; }
        ws.send(JSON.stringify({ type: "pong", ts: result.data.ts ?? Date.now() }));
        return;
      }

      if (data.type === "download:request") {
        const result = DownloadRequestSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid download request.")); return; }
        const session = requireLogin(); if (!session) return;
        logger.info("transfer", "download request", { username: result.data.username, path: result.data.virtualPath.slice(0,80), size: result.data.size });
        session.queueUpload(result.data.username, result.data.virtualPath);
        sharedTransfers?.requestDownload(result.data.username, result.data.virtualPath, result.data.size, result.data.fileName);
        return;
      }
      if (data.type === "download:control") {
        const result = DownloadControlSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid download control.")); return; }
        logger.info("transfer", "download control", { id: result.data.id, action: result.data.action });
        sharedTransfers?.controlDownload(result.data.id, result.data.action);
        return;
      }
      if (data.type === "upload:control") {
        const result = UploadControlSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid upload control.")); return; }
        logger.info("transfer", "upload control", { id: result.data.id, action: result.data.action });
        if (result.data.action === "deny") {
          const t = sharedTransfers?.get(result.data.id);
          if (t && t.isUpload) {
            const ok = sharedTransfers?.denyUpload(t.username, t.virtualPath);
            if (!ok) ws.send(errorMessage("Upload deny failed: transfer is no longer queued."));
          }
        } else sharedTransfers?.controlUpload(result.data.id, result.data.action);
        return;
      }
      if (data.type === "transfer:clear-many") {
        const result = TransferClearManySchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid transfer clear.")); return; }
        if (result.data.statuses === undefined) { ws.send(errorMessage("statuses is required (array or null for everything).")); return; }
        const session = requireLogin(); if (!session) return;
        logger.info("transfer", "clear-many", { isUpload: result.data.isUpload, statuses: result.data.statuses ?? "all" });
        sharedTransfers?.clearByStatuses(result.data.isUpload, result.data.statuses ?? null);
        return;
      }

      if (data.type === "chat:room") {
        const result = ChatRoomSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid chat:room message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { action, room, message } = result.data;
        if (action === "refreshList") { session.requestRoomList(); return; }
        if (!room) { ws.send(errorMessage("room is required.")); return; }
        if (action === "join") {
          pluginManager.joinChatroomNotification(room);
          session.joinRoom(room);
        } else if (action === "leave") {
          pluginManager.leaveChatroomNotification(room);
          session.leaveRoom(room);
        } else if (action === "say" && message) {
          // slash command intercept
          if (message.startsWith("/")) {
            const firstSpace = message.indexOf(" ");
            const cmd = firstSpace >= 0 ? message.slice(1, firstSpace).toLowerCase() : message.slice(1).toLowerCase();
            const args = firstSpace >= 0 ? message.slice(firstSpace + 1) : "";
            const outputs: string[] = [];
            pluginManager.setOutputHandler((_, text) => outputs.push(text));
            const handled = await pluginManager.triggerChatroomCommand(room, cmd, args);
            pluginManager.setOutputHandler(null);
            if (handled || outputs.length > 0) {
              // send plugin output as local echo so user sees command result
              for (const t of outputs) {
                try { ws.send(JSON.stringify({ type: "chat:event", event: { type: "say-chatroom", room, username: "[plugin]", message: t, timestamp: Date.now() } })); } catch {}
                try { ws.send(JSON.stringify({ type: "plugin:output", plugin: "core_commands", text: t })); } catch {}
              }
              if (handled) return;
            }
            // fallback: if command not handled, still allow plugin to maybe handle via outgoing event? Then drop if zap
          }
          const out = pluginManager.outgoingPublicChatEvent(room, message);
          if (out === null) {
            ws.send(JSON.stringify({ type: "chat:event", event: { type: "say-chatroom", room, username: session.username, message, timestamp: Date.now() } } as unknown as Record<string, unknown>));
            return;
          }
          const finalMsg = (out?.[1] as string) ?? message;
          session.sayChatroom(room, finalMsg);
          pluginManager.outgoingPublicChatNotification(room, finalMsg);
          // log outgoing room message (nicotine logs outgoing too)
          try {
            const isAction = finalMsg.startsWith("/me ") || finalMsg.startsWith("* ");
            const txt = isAction ? finalMsg.replace(/^\/(me)\s+|^\*\s+/, "") : finalMsg;
            logRoomMessage(room, session.username, txt, { isAction });
          } catch {}
        }         else if (action === "setTicker" && message !== undefined) session.setRoomTicker(room, message);
        else if (action === "addMember" && result.data.username) session.addRoomMember(room, result.data.username);
        else if (action === "addOperator" && result.data.username) session.addRoomOperator(room, result.data.username);
        else if (action === "removeOperator" && result.data.username) session.removeRoomOperator(room, result.data.username);
        else if (action === "cancelMembership") session.cancelRoomMembership(room);
        else if (action === "cancelOwnership") session.cancelRoomOwnership(room);
        else if (action === "ticker") { /* server pushes tickers, no client send needed */ }
        return;
      }
      if (data.type === "chat:private") {
        const result = ChatPrivateSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid chat:private message.")); return; }
        const session = requireLogin(); if (!session) return;
        if (result.data.action === "send" && result.data.message) {
          const msg = result.data.message;
          if (msg.startsWith("/")) {
            const firstSpace = msg.indexOf(" ");
            const cmd = firstSpace >= 0 ? msg.slice(1, firstSpace).toLowerCase() : msg.slice(1).toLowerCase();
            const args = firstSpace >= 0 ? msg.slice(firstSpace + 1) : "";
            const outputs: string[] = [];
            pluginManager.setOutputHandler((_, text) => outputs.push(text));
            const handled = await pluginManager.triggerPrivateChatCommand(result.data.username, cmd, args);
            pluginManager.setOutputHandler(null);
            if (handled || outputs.length > 0) {
              for (const t of outputs) {
                try { ws.send(JSON.stringify({ type: "chat:event", event: { type: "private-message", username: result.data.username, message: t, timestamp: Date.now() } })); } catch {}
                try { ws.send(JSON.stringify({ type: "plugin:output", plugin: "core_commands", text: t })); } catch {}
              }
              if (handled) return;
            }
          }
          const out = pluginManager.outgoingPrivateChatEvent(result.data.username, msg);
          if (out === null) return;
          const finalMsg = (out?.[1] as string) ?? msg;
          // No typing indicator protocol on the wire — drop our own legacy
          // TYPING control messages so peers never see them (mixed-version defense).
          if (/^\x01TYPING\x01$/i.test(finalMsg)) return;
          session.sendPrivateMessage(result.data.username, finalMsg);
          pluginManager.outgoingPrivateChatNotification(result.data.username, finalMsg);
          // log outgoing private (tag is own username, peer is recipient)
          try {
            const isAction = finalMsg.startsWith("/me ") || finalMsg.startsWith("* ");
            const txt = isAction ? finalMsg.replace(/^\/(me)\s+|^\*\s+/, "") : finalMsg;
            logPrivateMessage(result.data.username, session.username, txt, { isAction });
          } catch {}
        }
        return;
      }
      if (data.type === "chat:logs") {
        const result = ChatLogsSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid chat:logs message.")); return; }
        const session = requireLogin(); if (!session) return;
        const rows = readChatLogTail(result.data.scope, result.data.key, result.data.lines);
        const self = session.username.toLowerCase();
        try {
          ws.send(JSON.stringify({
            type: "chat:logs",
            scope: result.data.scope,
            key: result.data.key,
            rows: rows.map((r) => ({ ...r, isSelf: r.username.toLowerCase() === self })),
          }));
        } catch {}
        return;
      }
      if (data.type === "chat:global") {
        const session = requireLogin(); if (!session) return;
        const msg = parsed as { action?: string };
        if (msg.action === "join") session.joinGlobalRoom();
        else if (msg.action === "leave") session.leaveGlobalRoom();
        return;
      }
       if (data.type === "browse") {
        const result = BrowseSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid browse message.")); return; }
        const reqUser = typeof (parsed as { username?: unknown }).username === "string" ? (parsed as { username: string }).username : result.data.username;
        const session = requireLogin();
        if (!session) {
          // Fail fast on the browse channel too — generic errors are ignored by
          // browse receivers, which would otherwise spin until the 32s timeout.
          try { ws.send(JSON.stringify({ type: "browse:shares", username: reqUser, folders: [] as never, total: 0, hasMore: false, offset: 0, error: "Not logged in." })); } catch {}
          return;
        }
        const rawFolders = (session.shareDBInstance.getFoldersForPermission(PermissionLevel.PUBLIC) as unknown[]);
        const seen = new Set<string>();
        const foldersForBrowse = [] as unknown[];
        for (const f of rawFolders) {
          const name = (f as { name?: string }).name;
          if (typeof name !== "string" || seen.has(name)) continue;
          seen.add(name);
          foldersForBrowse.push(f);
        }
        const isSelf = result.data.username.trim().toLowerCase() === session.username.trim().toLowerCase();
        if (result.data.action === "shares") {
          // Local browse — nicotine-plus userbrowse.py:browse_user serves own shares
          // locally (self→PUBLIC view + reveal flags); no peer round-trip to self.
          if (isSelf) {
            try {
              const all = foldersForBrowse as unknown[];
              const page = all.slice(0, BROWSE_PAGE_SIZE);
              const hasMore = all.length > BROWSE_PAGE_SIZE;
              logger.info("browse", "local self-shares", { username: result.data.username, dirs: all.length });
              try { setBrowseCache(result.data.username.toLowerCase(), { folders: all as unknown[], ts: Date.now() }); } catch {}
              try { setBrowseFull(result.data.username, all); } catch {}
              (ws.data as unknown as Record<string, unknown>)._browseFull = all;
              (ws.data as unknown as Record<string, unknown>)._browseUser = result.data.username;
              ws.send(jsonStringifySafe({ type: "browse:shares", username: result.data.username, folders: page as never, total: all.length, hasMore, offset: 0 }));
            } catch (e) {
              ws.send(JSON.stringify({ type: "browse:shares", username: result.data.username, folders: [] as never, total: 0, hasMore: false, offset: 0, error: (e as Error).message }));
            }
            return;
          }
          session.requestSharedFileList(result.data.username);
        } else if (result.data.action === "folder" && result.data.folder) {
          // Local folder contents — from ShareDB when browsing own shares
          if (isSelf) {
            const tok = result.data.token ?? Math.floor(Math.random() * 1e9);
            try {
              const allFolders = foldersForBrowse as unknown as { name: string; files: unknown[] }[];
              const want = result.data.folder;
              const match = allFolders.find((f) => f.name === want)
                ?? allFolders.find((f) => f.name.toLowerCase() === want.toLowerCase());
              const files = match ? (match.files as unknown[]) : [];
              logger.info("browse", "local self-folder", { username: result.data.username, folder: want.slice(0, 80), files: files.length, matched: match?.name.slice(0, 80) ?? null });
              ws.send(JSON.stringify({ type: "browse:folder", username: result.data.username, folder: result.data.folder, token: tok, files: files as never }));
            } catch (e) {
              ws.send(JSON.stringify({ type: "browse:folder", username: result.data.username, folder: result.data.folder!, token: tok, files: [] as never, error: (e as Error).message }));
            }
            return;
          }
          session.requestFolderContents(result.data.username, result.data.folder, result.data.token ?? Math.floor(Math.random() * 1e9));
        }
        return;
      }

      if (data.type === "peer:connect") {
        const session = requireLogin(); if (!session) return;
        const { username, connType = "P" } = parsed as { username?: string; connType?: string };
        if (!username) { ws.send(errorMessage("username required")); return; }
        logger.info("peer", "peer connect requested", { username, connType });
        session.connectPeer(username, connType)
          .then(() => {
            logger.info("peer", "peer connect ok", { username, connType });
            ws.send(JSON.stringify({ type: "peer:connect", ok: true, username, connType }));
          })
          .catch((e: Error) => {
            logger.warn("peer", "peer connect failed", { username, connType, error: e.message });
            ws.send(JSON.stringify({ type: "peer:connect", ok: false, username, error: e.message }));
          });
        return;
      }

      if (data.type === "shares:rescan") {
        const session = requireLogin(); if (!session) return;
        let lastProgress = 0;
        const onProgress = (p: { dirs: number; files: number; current: string }) => {
          const now = Date.now();
          if (now - lastProgress < 200) return;
          lastProgress = now;
          try {
            const rs = (ws as unknown as { readyState?: number }).readyState;
            if (rs !== undefined && rs !== 1) return;
            ws.send(JSON.stringify({ type: "shares:scan:progress", ...p }));
          } catch {}
        };
        (session as unknown as { rescanShares: (onProgress?: (p: { dirs: number; files: number; current: string }) => void) => Promise<unknown> }).rescanShares(onProgress).then((folders: unknown) => {
          const sdb = (session as unknown as { shareDBInstance: { getSharedCounts: () => { dirs:number; files:number }; getUnavailableShares: () => [string,string][]; getSecretHits: (n?: number) => string[] } }).shareDBInstance;
          const counts = sdb.getSharedCounts();
          const unavailable = sdb.getUnavailableShares();
          const secretHits = sdb.getSecretHits(20);
          if (unavailable.length) logger.warn("bridge", "rescan: some shares unavailable on bridge FS", { unavailable, counts });
          if (secretHits.length) logger.warn("bridge", "rescan: secret-like files exposed", { secretHits });
          ws.send(JSON.stringify({ type: "shares:rescanned", folders, counts, unavailable, secretHits }));
        }).catch((e: Error) => ws.send(errorMessage(e.message)));
        return;
      }

      if (data.type === "shares:preview") {
        const session = requireLogin(); if (!session) return;
        const rawExcl = (parsed as unknown as { exclusions?: unknown }).exclusions;
        const exclusions = Array.isArray(rawExcl) ? (rawExcl as unknown[]).filter((s) => typeof s === "string").slice(0, 500) as string[] : undefined;
        (session as unknown as { previewShares: (e?: string[]) => Promise<{ counts: { dirs:number; files:number }; sample: string[]; excludedCount: number; secretHits: string[] }> }).previewShares(exclusions).then((res) => {
          ws.send(JSON.stringify({ type: "shares:preview:result", ...res }));
        }).catch((e: Error) => ws.send(errorMessage(e.message)));
        return;
      }

      if (data.type === "config:update") {
        const result = ConfigUpdateSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid config:update")); return; }
        const { section, key, value } = result.data;
        const session = sharedSession;
        const tm = sharedTransfers as unknown as { setConfig?: (c: Record<string, unknown>) => void } | undefined;
        // Bridge-relevant mappings
        try {
          if (section === "transfers") {
            // Real file sharing: web's virtualName|path lists need to become bridge ShareDB folders.
            // Bridge scans those host paths (any mounted path — no allowlist) and rebuilds the compressed shares.
            if (["shared", "buddyshared", "trustedshared"].includes(key) && Array.isArray(value)) {
              try {
                const pairs = value as [string, string][];
                const levelMap: Record<string, string> = { shared: "public", buddyshared: "buddy", trustedshared: "trusted" };
                const level = levelMap[key] || "public";
                (session as unknown as { setShareRoots?: (roots: [string, string][], lvl: string) => void })?.setShareRoots?.(pairs, level);
              } catch (e) {
                logger.warn("bridge", `setShareRoots failed for ${key}`, { error: (e as Error).message });
              }
              // also persist via TransferManager for diagnostics if needed
              tm?.setConfig?.({ [key]: value });
              // post-rescan report will be triggered by setShareRoots
            } else {
              const cfg: Record<string, unknown> = { [key]: value };
              tm?.setConfig?.(cfg);
            }
            // Also update session network filters if relevant
            if (["banlist", "ipblocklist", "geoblock", "geoblockcc", "usecustomban", "customban", "usecustomgeoblock", "customgeoblock"].includes(key)) {
              (session as unknown as { setNetworkFilters?: (o: unknown) => void })?.setNetworkFilters?.({ [key]: value });
            }
            if (key === "share_filters" && Array.isArray(value)) {
              (session as unknown as { setShareFilters?: (f: string[]) => void })?.setShareFilters?.(value as string[]);
            }
            if (key === "exclusions" && Array.isArray(value)) {
              const arr = (value as unknown[]).filter((s) => typeof s === "string") as string[];
              if (arr.length <= 500) {
                (session as unknown as { setExclusions?: (f: string[]) => void })?.setExclusions?.(arr);
              }
            }
            if (key === "downloadfilters" || key === "enablefilters") {
              tm?.setConfig?.({ [key]: value });
            }
            if (["uploadslots", "useupslots", "uploadlimit", "uploadlimitalt", "use_upload_speed_limit", "downloadlimit", "downloadlimitalt", "use_download_speed_limit", "fifoqueue", "limitby", "queuelimit", "filelimit", "friendsnolimits", "preferfriends", "autoclear_downloads", "autoclear_uploads", "usernamesubfolders", "download_path_depth", "groupdownloads", "groupuploads", "incomplete_strategy", "incompleteStrategy", "download_destination_template", "downloadDestinationTemplate", "download_subdirectory", "downloadSubdirectory"].includes(key)) {
              const norm: Record<string, unknown> = {};
              if (key === "incompleteStrategy") norm["incomplete_strategy"] = value;
              else if (key === "downloadDestinationTemplate") norm["download_destination_template"] = value;
              else if (key === "downloadSubdirectory") norm["download_subdirectory"] = value;
              else norm[key] = value;
              tm?.setConfig?.(norm);
            }
            if (["rescanonstartup", "rescan_shares_daily", "rescan_shares_hour"].includes(key)) {
              (session as unknown as { setRescanConfig?: (o: Record<string, unknown>) => void })?.setRescanConfig?.({ [key]: value });
              tm?.setConfig?.({ [key]: value });
            }
            if (["reveal_buddy_shares", "reveal_trusted_shares"].includes(key)) {
              try {
                const sdb = (session as unknown as { shareDBInstance: { getRevealFlags: ()=>{revealBuddyShares:boolean;revealTrustedShares:boolean}; setRevealFlags: (b:boolean,t:boolean)=>void } }).shareDBInstance;
                const cur = sdb.getRevealFlags();
                if (key === "reveal_buddy_shares") sdb.setRevealFlags(Boolean(value), cur.revealTrustedShares);
                else sdb.setRevealFlags(cur.revealBuddyShares, Boolean(value));
              } catch {}
            }
          } else if (section === "server" && ["banlist", "ignorelist", "ipblocklist", "ipignorelist", "private_chatrooms"].includes(key)) {
            if (key === "private_chatrooms") (session as unknown as { setEnableRoomInvitations?: (b: boolean) => void })?.setEnableRoomInvitations?.(!!value);
            (session as unknown as { setNetworkFilters?: (o: unknown) => void })?.setNetworkFilters?.({ [key]: value });
            if (key === "banlist" || key === "ipblocklist") tm?.setConfig?.({ [key]: value });
          } else if (section === "server" && (key === "portrange" || key === "listen_port" || key === "listenPort")) {
            // Mirrors nicotine-plus preferences.py portrange -> core.reconnect parity
            let newPort: number | null = null;
            if (Array.isArray(value) && value.length >= 1) newPort = Number((value as unknown[])[0]);
            else if (typeof value === "number") newPort = value;
            else if (typeof value === "string") newPort = Number(value);
            if (newPort !== null && Number.isInteger(newPort) && newPort >= 1024 && newPort <= 65535) {
              const oldPort = LISTEN_PORT;
              if (newPort !== oldPort) {
                const prevPort = LISTEN_PORT;
                LISTEN_PORT = newPort;
                try { writeFileSync(join(CONFIG_DIR, "listen_port"), String(newPort)); } catch {}
                // Also write host.env for Docker .env sync (bind-mount ./config:/config or named volume inspect)
                try { writeFileSync(join(CONFIG_DIR, "host.env"), `LISTEN_PORT=${newPort}\n`); } catch {}
                const sess = session as unknown as { setListenPort?: (p: number) => Promise<void>; reconnect?: (r: string) => void } | undefined;
                if (sess?.setListenPort) {
                  // Fire-and-forget, report via WS — trigger fresh Soulseek reconnect (WS stays open)
                  (sess.setListenPort(newPort) as Promise<void>).then(() => {
                    logger.info("server", "listen port updated via config", { oldPort: prevPort, newPort });
                    persistSetting(section, "portrange", [newPort, newPort]);
                    try { ws.send(JSON.stringify({ type: "config:updated", section, key, value: newPort })); } catch {}
                    // Notify all WS clients of new health (so UI Save shows success without poll)
                    try { ws.send(JSON.stringify({ type: "diagnostics:health", health: { ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: newPort, configDir: CONFIG_DIR, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN, version: APP_VERSION, commitSha: COMMIT_SHA, buildDate: BUILD_DATE, upnp: getGlobalPortMapperStatus() } })); } catch {}
                    // Also update other active sessions' listenPort silently (they'll reconnect lazily)
                    for (const s of activeSessions) {
                      if (s !== sess) {
                        try { (s as unknown as { _listenPort: number })._listenPort = newPort; (s as unknown as { portMapper: { setPort: (p:number,ip:string)=>void } }).portMapper?.setPort(newPort, (s as unknown as { _localIpAddress: string })._localIpAddress || "0.0.0.0"); } catch {}
                      }
                    }
                    // Opt-in: recreate the container so the Docker host mapping
                    // follows the new port (mappings are immutable at runtime).
                    // No-op unless socket mounted + ALLOW_CONTAINER_RESTART=1.
                    void maybeRecreateContainerForPort(newPort, prevPort).then((outcome) => {
                      if (outcome === "started") {
                        try { ws.send(JSON.stringify({ type: "server:restarting", listenPort: newPort })); } catch {}
                      } else if (outcome !== "disabled" && outcome !== "not-in-container" && !outcome.startsWith("already")) {
                        logger.warn("server", "container recreate skipped/failed", { newPort, outcome });
                      }
                    });
                  }).catch((e: Error) => {
                    // Revert global on bind failure
                    LISTEN_PORT = prevPort;
                    persistSetting(section, "portrange", [prevPort, prevPort]);
                    try { writeFileSync(join(CONFIG_DIR, "listen_port"), String(prevPort)); } catch {}
                    try { writeFileSync(join(CONFIG_DIR, "host.env"), `LISTEN_PORT=${prevPort}\n`); } catch {}
                    logger.warn("server", "listen port change failed, reverted", { newPort, error: e.message });
                    ws.send(JSON.stringify({ type: "error", error: `Cannot listen on port ${newPort}: ${e.message}` }));
                    // Also send config:updated with old value so UI can revert pending
                    try { ws.send(JSON.stringify({ type: "config:updated", section, key, value: prevPort })); } catch {}
                    try { ws.send(JSON.stringify({ type: "diagnostics:health", health: { ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: prevPort, configDir: CONFIG_DIR, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN, version: APP_VERSION, commitSha: COMMIT_SHA, buildDate: BUILD_DATE, upnp: getGlobalPortMapperStatus() } })); } catch {}
                  });
                  return; // avoid double config:updated below
                } else {
                  // No active session yet — next login will use new port (persisted)
                  logger.info("server", "listen port updated (no active session)", { oldPort: prevPort, newPort });
                  void maybeRecreateContainerForPort(newPort, prevPort);
                }
              }
            } else {
              ws.send(JSON.stringify({ type: "error", error: `Invalid listen port ${JSON.stringify(value)} (must be 1024-65535)` }));
              return;
            }
          } else if (section === "server" && key === "upnp") {
            const enabled = Boolean(value);
            GLOBAL_UPNP_ENABLED = enabled;
            try { writeFileSync(join(CONFIG_DIR, "upnp_enabled"), enabled ? "1" : "0"); } catch {}
            // Apply to current session and all active sessions
            (session as unknown as { setUpnpEnabled?: (b: boolean) => void })?.setUpnpEnabled?.(enabled);
            for (const s of activeSessions) {
              if (s !== session) try { (s as unknown as { setUpnpEnabled?: (b:boolean)=>void }).setUpnpEnabled?.(enabled); } catch {}
            }
            logger.info("server", `UPnP ${enabled ? "enabled" : "disabled"} via config`, { upnp: enabled });
            // push fresh health with upnp status so UI reflects immediately
            try { ws.send(JSON.stringify({ type: "diagnostics:health", health: { ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: LISTEN_PORT, configDir: CONFIG_DIR, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN, version: APP_VERSION, commitSha: COMMIT_SHA, buildDate: BUILD_DATE, upnp: getGlobalPortMapperStatus() } })); } catch {}
          } else if (section === "server" && ["interface", "autoreply", "autosearch", "autojoin", "userlist", "autoaway"].includes(key)) {
            if (key === "interface") {
              const newIface = String(value || "").trim();
              const sess = session as unknown as { setNetworkInterface?: (v: string) => void } | undefined;
              try {
                sess?.setNetworkInterface?.(newIface);
                logger.info("server", `interface set to ${newIface || "default (0.0.0.0)"}`, { iface: newIface || "default", username: (session as unknown as { username?: string })?.username });
                persistSetting(section, key, newIface);
                // Send config updated + health so UI can reflect immediate bind change (WS stays open, Soulseek reconnects if loggedIn)
                try { ws.send(JSON.stringify({ type: "config:updated", section, key, value: newIface })); } catch {}
                try { ws.send(JSON.stringify({ type: "diagnostics:health", health: { ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: LISTEN_PORT, configDir: CONFIG_DIR, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN, version: APP_VERSION, commitSha: COMMIT_SHA, buildDate: BUILD_DATE, upnp: getGlobalPortMapperStatus() } })); } catch {}
              } catch (e) {
                logger.warn("server", "interface change failed", { iface: newIface, error: (e as Error).message });
                ws.send(JSON.stringify({ type: "error", error: `Cannot bind to interface ${newIface || "default"}: ${(e as Error).message}` }));
                return;
              }
              return; // already sent config:updated, avoid duplicate below
            } else if (key === "autoreply") (session as unknown as { setAutoreply?: (v:string)=>void })?.setAutoreply?.(String(value || ""));
            else if (key === "autosearch") (session as unknown as { setAutosearch?: (v:string[])=>void })?.setAutosearch?.(Array.isArray(value) ? value as string[] : []);
            else if (key === "autojoin") (session as unknown as { setAutojoin?: (v:string[])=>void })?.setAutojoin?.(Array.isArray(value) ? value as string[] : []);
            else if (key === "userlist") (session as unknown as { setUserlist?: (v:string[])=>void })?.setUserlist?.(Array.isArray(value) ? value as string[] : []);
            // Buddy wiring — transfers (honeypot exempt, queue priority) mirrors session userlist.
            if (key === "userlist" && Array.isArray(value)) tm?.setConfig?.({ buddies: (value as unknown[]).filter((s) => typeof s === "string") as string[] });
            else if (key === "autoaway") (session as unknown as { setAutoaway?: (v:number)=>void })?.setAutoaway?.(Number(value) || 15);
            logger.debug("bridge", "network extra updated", { key, len: Array.isArray(value) ? (value as unknown[]).length : String(value).slice(0,40) });
          } else if (section === "chatrooms" || section === "userbrowse") {
            (session as unknown as { setChatroomsConfig?: (o:Record<string,unknown>)=>void; setUserbrowseConfig?: (o:Record<string,unknown>)=>void })?.setChatroomsConfig?.({ [key]: value });
            (session as unknown as { setUserbrowseConfig?: (o:Record<string,unknown>)=>void })?.setUserbrowseConfig?.({ [key]: value });
          } else if (section === "logging" && ["readroomlines", "readprivatelines", "rooms_timestamp", "private_timestamp"].includes(key)) {
            // logging caps are web-only, but acknowledge
            void value;
          } else if (section === "searches" && ["maxresults", "max_displayed_results", "search_results", "private_search_results"].includes(key)) {
            (session as unknown as { setSearchConfig?: (o: Record<string, unknown>) => void })?.setSearchConfig?.({ [key]: value });
          } else if (section === "plugins" && key === "enable") {
            (pluginManager as unknown as { setGlobalEnable?: (b: boolean) => void }).setGlobalEnable?.(Boolean(value));
            logger.info("bridge", `plugins ${Boolean(value) ? "enabled" : "disabled"} via config`, { enable: Boolean(value) });
          } else if (section === "worker" && ["discogs_token", "tidal_token", "tidal_country", "qobuz_app_id", "qobuz_user_auth_token", "media_scan_url", "media_scan_token"].includes(key)) {
            // Worker metadata tokens — write-only API. Merged into DATA_DIR/worker.json
            // (0600), read by the worker (env wins). Values never logged or returned.
            const maxLen = key === "media_scan_url" ? 2048 : 512;
            if (typeof value !== "string" || value.length > maxLen) {
              ws.send(errorMessage(`Worker value must be a string ≤${maxLen} chars (empty clears it).`));
              return;
            }
            if (key === "media_scan_url" && value) {
              const v = value.trim();
              if (!v.toLowerCase().startsWith("http://") && !v.toLowerCase().startsWith("https://")) {
                ws.send(errorMessage("MEDIA_SCAN_URL must start with http:// or https://"));
                return;
              }
              try {
                const u = new URL(v);
                if (u.username || u.password) { ws.send(errorMessage("MEDIA_SCAN_URL must not contain credentials")); return; }
              } catch { ws.send(errorMessage("MEDIA_SCAN_URL invalid URL")); return; }
            }
            try {
              const p = join(CONFIG_DIR, "worker.json");
              let cur: Record<string, string> = {};
              try {
                const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
                if (raw && typeof raw === "object") cur = raw as Record<string, string>;
              } catch {}
              if (value) cur[key] = value;
              else delete cur[key];
              writeFileSync(p, JSON.stringify(cur, null, 2), { mode: 0o600 });
              try { chmodSync(p, 0o600); } catch {}
              logger.info("server", "worker token updated", { key, set: Boolean(value) });
            } catch (e) {
              ws.send(errorMessage(`Cannot write worker.json: ${(e as Error).message}`));
              return;
            }
          } else if (section === "server" && (key === "server" || key === "auto_connect_startup")) {
            // Stored for login defaults; web handles auto_connect_startup gate, bridge just acks.
            logger.debug("bridge", "server config stored", { key, value: typeof value === "object" ? JSON.stringify(value).slice(0,120) : String(value).slice(0,80) });
          }
          logger.debug("bridge", "config update", { section, key });
          persistSetting(section, key, value);
          ws.send(JSON.stringify({ type: "config:updated", section, key }));
        } catch (e) {
          ws.send(errorMessage((e as Error).message));
        }
        return;
      }

      if (data.type === "config:get") {
        // Durable settings snapshot for new browsers / post-restart reconcile (no secrets — worker never persisted here)
        ws.send(JSON.stringify({ type: "config:state", settings: PERSISTED_SETTINGS }));
        return;
      }

      if (data.type === "ban:add" || data.type === "ban:remove" || data.type === "ignore:add" || data.type === "ignore:remove") {
        const result = BanControlSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid ban/ignore message.")); return; }
        const session = requireLogin(); if (!session) return;
        const name = result.data.username.trim();
        if (!name) { ws.send(errorMessage("Username required.")); return; }
        const tm = sharedTransfers as unknown as { setConfig?: (c: Record<string, unknown>) => void } | undefined;
        const sess = session as unknown as {
          banUser: (u: string) => string[]; unbanUser: (u: string) => string[];
          ignoreUser: (u: string) => string[]; unignoreUser: (u: string) => string[];
          getBanlist: () => string[]; getIgnorelist: () => string[];
        };
        try {
          if (result.data.type === "ban:add") {
            const banlist = sess.banUser(name);
            tm?.setConfig?.({ banlist });
            persistSetting("server", "banlist", banlist);
            broadcastJson({ type: "banlist:updated", banlist, byUser: name, reason: "manual" });
          } else if (result.data.type === "ban:remove") {
            const banlist = sess.unbanUser(name);
            tm?.setConfig?.({ banlist });
            persistSetting("server", "banlist", banlist);
            broadcastJson({ type: "banlist:updated", banlist, byUser: name, reason: "manual" });
          } else if (result.data.type === "ignore:add") {
            const ignorelist = sess.ignoreUser(name);
            persistSetting("server", "ignorelist", ignorelist);
            broadcastJson({ type: "ignorelist:updated", ignorelist, byUser: name, reason: "manual" });
          } else {
            const ignorelist = sess.unignoreUser(name);
            persistSetting("server", "ignorelist", ignorelist);
            broadcastJson({ type: "ignorelist:updated", ignorelist, byUser: name, reason: "manual" });
          }
        } catch (e) {
          ws.send(errorMessage((e as Error).message));
        }
        return;
      }

      if (data.type === "wishlist:update") {
        const result = WishlistUpdateSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid wishlist:update")); return; }
        const session = requireLogin(); if (!session) return;
        const entries = result.data.entries?.length ? result.data.entries : undefined;
        const terms = entries ? entries.map((e) => e.term) : result.data.terms;
        (session as unknown as { setWishlistTerms?: (t: string[], e?: Array<{ term: string; auto: boolean }>) => void }).setWishlistTerms?.(terms, entries);
        logger.info("search", "wishlist terms updated", { count: terms.length });
        ws.send(JSON.stringify({ type: "wishlist:updated", count: terms.length }));
        return;
      }

      if (data.type === "statistics:request") {
        const tm = sharedTransfers as unknown as { getStatsSummary?: () => unknown } | undefined;
        const summary = tm?.getStatsSummary?.() ?? { total: null, session: null };
        // Library size comes from the login session's ShareDB (best-effort — absent pre-login).
        try {
          const session = sharedSession as unknown as { shareDBInstance?: { getSharedCounts?: () => { dirs: number; files: number }; getUnavailableShares?: () => unknown[] } } | undefined;
          const sdb = session?.shareDBInstance;
          if (sdb?.getSharedCounts) {
            (summary as Record<string, unknown>).shares = {
              ...sdb.getSharedCounts(),
              unavailable: sdb.getUnavailableShares?.()?.length ?? 0,
            };
          }
        } catch {}
        ws.send(JSON.stringify({ type: "statistics:response", ...summary as Record<string, unknown> }));
        return;
      }
      if (data.type === "statistics:reset") {
        const result = StatsResetSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid statistics:reset")); return; }
        const tm = sharedTransfers as unknown as { resetStats?: () => void; getStatsSummary?: () => unknown } | undefined;
        try { tm?.resetStats?.(); } catch {}
        const summary = tm?.getStatsSummary?.() ?? { total: null, session: null };
        ws.send(JSON.stringify({ type: "statistics:response", ...summary as Record<string, unknown> }));
        ws.send(JSON.stringify({ type: "statistics:reset:ok" }));
        return;
      }

      // Spectrum moved to the worker service (apps/worker POST /spectrum/request).
      if (data.type === "spectrum:request" || data.type === "spectrum:status") {
        const id = (parsed as { id?: string }).id ?? "";
        ws.send(JSON.stringify({ type: "spectrum:error", id, error: "Spectrum moved to worker :8789 — update the web app." }));
        return;
      }

      if (data.type === "diagnostics:clear") {
        logger.info("system", "diagnostics clear requested");
        diagClear();
        ws.send(JSON.stringify({ type: "diagnostics:cleared" }));
        return;
      }
      if (data.type === "diagnostics:subscribe") {
        const { level } = parsed as { level?: LogLevel };
        logger.info("system", "diagnostics subscribe", { level: level || "debug" });
        try {
          const tail = diagTail(500, (level as LogLevel) || "debug");
          ws.send(JSON.stringify({ type: "diagnostics:init", entries: tail }));
        } catch {}
        return;
      }
      if (data.type === "diagnostics:browser-log") {
        const { level, scope, msg, meta } = parsed as { level?: string; scope?: string; msg?: string; meta?: Record<string, unknown> };
        if (msg) diagLog((level as LogLevel) || "info", (scope as never) || "system", `[browser] ${msg}`, meta);
        return;
      }

      if (data.type === "userinfo") {
        const result = UserInfoRequestSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid userinfo message.")); return; }
        const session = requireLogin(); if (!session) return;
        const msg = result.data;
        logger.debug("server", "userinfo request", { action: msg.action });
        switch (msg.action) {
          case "watch": session.watchUser(msg.username); break;
          case "unwatch": session.unwatchUser(msg.username); break;
          case "get": {
            // Local shortcut for own profile — Soulseek never needs a peer round-trip to self
            // (nicotine userinfo.py serves locally). Avoids sendConnectToPeerFallback to self.
            if (msg.username.trim().toLowerCase() === session.username.trim().toLowerCase()) {
              try {
                const p = (session as unknown as { profile: { username: string; descr: string; pic: Buffer | null; totalupl: number; queuesize: number; slotsavail: boolean; uploadallowed: number } }).profile;
                let queuesize = p.queuesize;
                let slotsavail = p.slotsavail;
                try {
                  const getter = (session as unknown as { opts?: { getTransferStats?: () => { queuedUploads: number; activeUploads: number } } }).opts?.getTransferStats;
                  if (getter) { const st = getter(); queuesize = st.queuedUploads; slotsavail = st.activeUploads < 3; }
                } catch {}
                const payload = { type: "user-info-response" as const, username: p.username, descr: p.descr, pic: p.pic ? p.pic.toString("base64") : null, totalupl: p.totalupl, queuesize, slotsavail, uploadallowed: p.uploadallowed };
                setUserInfoCache(msg.username.toLowerCase(), { data: payload, ts: Date.now() });
                ws.send(JSON.stringify(payload));
              } catch (e) {
                ws.send(JSON.stringify({ type: "user-info-failed", username: msg.username }));
              }
              break;
            }
            const cached = userInfoCache.get(msg.username.toLowerCase());
            if (cached && Date.now() - cached.ts < USERINFO_CACHE_TTL_MS) {
              ws.send(JSON.stringify(cached.data));
              break;
            }
            session.requestUserInfo(msg.username)
              .then((info) => {
                const payload = { type: "user-info-response" as const, username: info.username, descr: info.descr, pic: info.pic ? info.pic.toString("base64") : null, totalupl: info.totalupl, queuesize: info.queuesize, slotsavail: info.slotsavail, uploadallowed: info.uploadallowed };
                setUserInfoCache(msg.username.toLowerCase(), { data: payload, ts: Date.now() });
                ws.send(JSON.stringify(payload));
              })
              .catch(() => ws.send(JSON.stringify({ type: "user-info-failed", username: msg.username })));
            break;
          }
          case "interests": session.requestUserInterests(msg.username); break;
          case "givePrivileges": session.givePrivileges(msg.username, msg.days); break;
          case "setStatus": session.setStatus(msg.status); break;
          case "checkPrivileges": session.checkPrivileges(); break;
          case "changePassword": session.changePassword(msg.password); break;
          case "reportShares": session.reportShares(msg.dirs, msg.files); break;
          case "peerAddress": {
            const sessAny = session as unknown as { requestPeerAddress: (u:string)=>void };
            if (sessAny.requestPeerAddress) sessAny.requestPeerAddress(msg.username);
            break;
          }
          case "setProfile":
            session.setProfile({ username: session.username, descr: msg.profile.descr, pic: msg.profile.pic ? Buffer.from(msg.profile.pic, "base64") : null, totalupl: msg.profile.totalupl, queuesize: msg.profile.queuesize, slotsavail: msg.profile.slotsavail, uploadallowed: msg.profile.uploadallowed });
            persistSetting("userinfo", "descr", msg.profile.descr);
            // ponytail: skip huge embedded pictures in settings.json (re-pushed by web on connect), cap 256KB
            if (typeof msg.profile.pic === "string" && msg.profile.pic.length <= 256_000) persistSetting("userinfo", "pic", msg.profile.pic);
            break;
        }
        return;
      }

      // ---- plugin WS API ----
      if (data.type === "plugin:list") {
        const list = pluginManager.getInstalledPluginListWithStatus();
        const enriched = list.map((p) => ({
          ...p,
          settings: pluginManager.getPluginSettings(p.name),
          metasettings: pluginManager.getPluginMetaSettings(p.name),
        }));
        ws.send(JSON.stringify({ type: "plugin:list", plugins: enriched }));
        return;
      }
      if (data.type === "plugin:toggle") {
        const res = PluginToggleSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        await pluginManager.togglePlugin(res.data.name);
        const list = pluginManager.getInstalledPluginListWithStatus().map((p) => ({ ...p, settings: pluginManager.getPluginSettings(p.name), metasettings: pluginManager.getPluginMetaSettings(p.name) }));
        ws.send(JSON.stringify({ type: "plugin:list", plugins: list }));
        ws.send(JSON.stringify({ type: "plugin:toggled", name: res.data.name, enabled: pluginManager.isPluginLoaded(res.data.name) }));
        return;
      }
      if (data.type === "plugin:reload") {
        const res = PluginReloadSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        await pluginManager.reloadPlugin(res.data.name);
        ws.send(JSON.stringify({ type: "plugin:reloaded", name: res.data.name }));
        return;
      }
      if (data.type === "plugin:uninstall") {
        const res = PluginUninstallSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        const ok = pluginManager.uninstallPlugin(res.data.name);
        ws.send(JSON.stringify({ type: "plugin:uninstalled", name: res.data.name, ok }));
        const list = pluginManager.getInstalledPluginListWithStatus().map((p) => ({ ...p, settings: pluginManager.getPluginSettings(p.name), metasettings: pluginManager.getPluginMetaSettings(p.name) }));
        ws.send(JSON.stringify({ type: "plugin:list", plugins: list }));
        return;
      }
      if (data.type === "plugin:settings") {
        const res = PluginSettingsSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        pluginManager.setPluginSettings(res.data.name, res.data.settings as Record<string, unknown>);
        ws.send(JSON.stringify({ type: "plugin:settings", name: res.data.name, ok: true }));
        return;
      }
      if (data.type === "plugin:resetSettings") {
        const res = PluginResetSettingsSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        pluginManager.resetPluginSettings(res.data.name);
        ws.send(JSON.stringify({ type: "plugin:resetSettings", name: res.data.name, ok: true }));
        return;
      }
      if (data.type === "plugin:install") {
        const res = PluginInstallSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        try {
          const buf = Buffer.from(res.data.data, "base64");
          if (buf.length > 20_000_000) { ws.send(errorMessage("zip too large (max 20MB)")); return; }
          const safeName = (res.data.fileName || "plugin.zip").replace(/[^a-zA-Z0-9._\-]/g, "_").slice(0, 64) || "plugin.zip";
          const tmp = join(CONFIG_DIR, `.ws_upload_${Date.now()}_${safeName}`);
          try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
          writeFileSync(tmp, buf);
          const name = await (pluginManager as unknown as { installPluginFromZip: (p: string) => Promise<string | null> }).installPluginFromZip(tmp);
          try { rmSync(tmp, { force: true }); } catch {}
          if (!name) { ws.send(errorMessage("Install failed")); return; }
          ws.send(JSON.stringify({ type: "plugin:installed", name, ok: true }));
          const list = pluginManager.getInstalledPluginListWithStatus().map((p) => ({ ...p, settings: pluginManager.getPluginSettings(p.name), metasettings: pluginManager.getPluginMetaSettings(p.name) }));
          ws.send(JSON.stringify({ type: "plugin:list", plugins: list }));
        } catch (e) { ws.send(errorMessage((e as Error).message)); }
        return;
      }
      if (data.type === "plugin:installUrl") {
        const res = PluginInstallUrlSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        const name = await pluginManager.installFromUrl(res.data.url);
        if (!name) { ws.send(errorMessage("Install from URL failed — zip must contain .ts/.js and Python .py is blocked")); return; }
        ws.send(JSON.stringify({ type: "plugin:installed", name, ok: true }));
        const list = pluginManager.getInstalledPluginListWithStatus().map((p) => ({ ...p, settings: pluginManager.getPluginSettings(p.name), metasettings: pluginManager.getPluginMetaSettings(p.name) }));
        ws.send(JSON.stringify({ type: "plugin:list", plugins: list }));
        return;
      }
      if (data.type === "plugin:installGithubTs") {
        const res = PluginInstallGithubTsSchema.safeParse(parsed);
        if (!res.success) { ws.send(errorMessage(res.error.issues[0].message)); return; }
        const name = await (pluginManager as unknown as { installFromGithubTs: (u: string) => Promise<string | null> }).installFromGithubTs(res.data.url);
        if (!name) { ws.send(errorMessage("Install from GitHub failed — only .ts/.js with 'export class Plugin extends BasePlugin' allowed (Python .py blocked, need .ts/.js)")); return; }
        ws.send(JSON.stringify({ type: "plugin:installed", name, ok: true }));
        const list = pluginManager.getInstalledPluginListWithStatus().map((p) => ({ ...p, settings: pluginManager.getPluginSettings(p.name), metasettings: pluginManager.getPluginMetaSettings(p.name) }));
        ws.send(JSON.stringify({ type: "plugin:list", plugins: list }));
        return;
      }

      logger.debug("bridge", "unknown message type", { type: data.type });
      ws.send(errorMessage("Unknown message type."));
    },
    close(ws, code, reason) {
      try { (ws.data as unknown as { logUnsub?: () => void }).logUnsub?.(); } catch {}
      try { sharedSession?.cancelClientSearches(String((ws.data as unknown as Record<string, unknown>).clientId ?? "")); } catch {}
      try { attachedClients.delete(ws as unknown as AttachedClient); } catch {}
      // Detach only — the singleton Soulseek session stays up for other clients.
      const searchCount = (sharedSession as unknown as { searches?: Map<unknown, unknown> } | null)?.searches?.size ?? 0;
      logger.info("bridge", "ws close (detach)", { code, reason: reason ? String(reason).slice(0,200) : "", user: sharedSessionUser ?? "", searches: searchCount });
      ws.data = {};
    },
  },
});

if (import.meta.main) {
  if (!BRIDGE_TOKEN) {
    diagLog("warn", "bridge", `bridge running open (no BRIDGE_TOKEN) — LAN-only, set BRIDGE_TOKEN for auth (e.g. BRIDGE_TOKEN=$(openssl rand -hex 32))`, { port: PORT, listenPort: LISTEN_PORT });
    console.warn(`[homelab] BRIDGE_TOKEN not set — bridge open on LAN. For auth: BRIDGE_TOKEN=$(openssl rand -hex 32) docker compose up`);
  }
  diagLog("info", "bridge", `bridge listening on ws://localhost:${PORT}/ws ${BRIDGE_TOKEN ? "(token auth enabled)" : "(open)"} CONFIG_DIR=${CONFIG_DIR} DATA_DIR=${DATA_DIR} ${process.env.ALLOWED_ORIGINS ? `ALLOWED_ORIGINS=${process.env.ALLOWED_ORIGINS}` : ""}`, { port: PORT, listenPort: LISTEN_PORT });
  console.log(`Nicotine Hub bridge listening on ws://localhost:${PORT}/ws ${BRIDGE_TOKEN ? "(token auth enabled)" : "(open)"} CONFIG_DIR=${CONFIG_DIR} DATA_DIR=${DATA_DIR}`);
  // Singleton session survives restarts via the encrypted vault — no per-client cookie needed.
  void restoreSharedSessionFromVault();
}
