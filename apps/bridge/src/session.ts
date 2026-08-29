/**
 * Persistent Soulseek session — full protocol mirror (server/peer/distrib/file).
 *
 * Based on nicotine-plus pynicotine/slskproto.py + slskmessages.py.
 */

import type { Socket, TCPSocketListener } from "bun";
import { deflateSync, inflateSync } from "node:zlib";
import { ShareDB } from "./shares.ts";
import { logger } from "./logger.ts";
import { shouldBlockUser, shouldIgnoreUser, getCountryCode, setCountryForIp } from "./networkfilter.ts";
import {
  buildAddThingIHate,
  buildAddThingILike,
  buildBranchLevel,
  buildBranchRoot,
  buildCantConnectToPeer,
  buildChangePassword,
  buildCheckPrivileges,
  buildConnectToPeer,
  buildFileSearch,
  buildFolderContentsRequest,
  buildGetPeerAddress,
  buildGetUserStats,
  buildGivePrivileges,
  buildHaveNoParent,
  buildJoinGlobalRoom,
  buildJoinRoom,
  buildLeaveGlobalRoom,
  buildLeaveRoom,
  buildLogin,
  buildMessageAcked,
  buildMessageUser,
  buildPeerInit,
  buildPierceFireWall,
  buildPlaceInQueueRequest,
  buildPlaceInQueueResponse,
  buildQueueUpload,
  buildRemoveThingIHate,
  buildRemoveThingILike,
  buildRoomSearch,
  buildSayChatroom,
  buildSendUploadSpeed,
  buildSetRoomTicker,
  buildSetStatus,
  buildSetWaitPort,
  buildSharedFileListRequest,
  buildSharedFoldersFiles,
  buildTransferRequest,
  buildUnwatchUser,
  buildUserInfoRequest,
  buildUserInfoResponse,
  buildUserInterests,
  buildUserSearch,
  buildWatchUser,
  buildWishlistSearch,
  frameMessage,
  MAX_INCOMING,
  packString,
  packUint32,
  parseBranchLevel,
  parseBranchRoot,
  parseCantCreateRoom,
  parseCheckPrivileges,
  parseChildDepth,
  parseConnectToPeer,
  parseExcludedSearchPhrases,
  parseFileSearchResponse,
  parseFolderContentsResponse,
  parseGlobalRoomMessage,
  parseItemRecommendations,
  parseItemSimilarUsers,
  parseJoinRoom,
  parseLoginResponse,
  parseMessageUser,
  parseMessageUsers,
  parsePeerAddress,
  parsePeerInit,
  parsePierceFireWall,
  parsePlaceInQueueResponse,
  parsePossibleParents,
  parsePrivilegedUsers,
  parseQueueUpload,
  parseRecommendations,
  parseSharedFileListResponse,
  SlskReader,
  parseRoomList,
  parseRoomMember,
  parseRoomMembers,
  parseRoomTickers,
  parseRoomTickerEvent,
  parseSayChatroom,
  parseSimilarUsers,
  parseTransferRequest,
  parseTransferResponse,
  parseUserInterests,
  parseUserStats,
  parseUserInfoResponse,
  parseUserStatus,
  parseWatchUser,
  tryParseMessage,
  PEER_MESSAGE_CODES,
  SERVER_MESSAGE_CODES,
  type BrowseFolderEntry,
  type LoginResponse,
  type PeerAddress,
  type SearchFile,
  type Recommendation,
  type SimilarUser,
  type UserInterestsMessage,
  type UserStatsMessage,
  type UserStatusMessage,
  type UserInfoResponseMessage,
} from "./soulseek.ts";

export interface SearchRow {
  user: string; folder: string; filename: string; path: string; size: number; fileType: string;
  slotFree: boolean; speed: number; inQueue: number; quality: number; length: number; private: boolean;
  attributes: { bitrate?: number; length?: number; vbr?: number; sampleRate?: number; bitDepth?: number; };
}
export interface SearchResultPayload { searchId: string; token: number; rows: SearchRow[]; }
export interface SearchEndPayload { searchId: string; reason: "max_results" | "stopped" | "timeout" | "error"; }
export interface SearchHandlers { onResult: (p: SearchResultPayload) => void; onEnd: (p: SearchEndPayload) => void; timeoutMs?: number; }
interface ActiveSearch extends SearchHandlers { searchId: string; timer?: ReturnType<typeof setTimeout>; users: Set<string>; count: number; maxResults: number; }
interface PeerState { buf: Buffer; initDone: boolean; username?: string; outbound?: boolean; connType?: string; lastActive: number; isFileConn?: boolean; fileToken?: number; createdAt: number; }
export type ServerEvent = { type: "reconnect"; attempt: number; delay: number } | { type: "reconnect-failed"; error: string };
export interface BrowseEvent {
  type: "browse-shares" | "browse-folder" | "browse-error";
  username: string;
  folders?: import("./soulseek.ts").BrowseFolderEntry[];
  folder?: string;
  token?: number;
  files?: import("./soulseek.ts").BrowseFileEntry[];
  error?: string;
}
export interface SessionOptions {
  username: string; password: string; host?: string; port?: number; listenPort: number;
  profile: UserInfoResponseMessage; dataDir?: string; onUserEvent?: (event: UserInfoEvent) => void;
  onChatEvent?: (event: ChatEvent) => void; onRoomEvent?: (event: RoomEvent) => void;
  onTransferEvent?: (event: TransferEvent) => void; onBrowseEvent?: (event: BrowseEvent) => void;
  onServerEvent?: (event: ServerEvent) => void; signal?: AbortSignal;
  // F-stream wiring to TransferManager (Phase 4)
  onFileConnection?: (token: number, socket: Socket) => void;
  onFileChunk?: (token: number, chunk: Buffer) => void;
  getQueuePlace?: (file: string) => number;
}
export interface UserInfoEvent {
  type: "user-status" | "user-stats" | "user-interests" | "recommendations" | "global-recommendations"
    | "similar-users" | "item-recommendations" | "item-similar-users" | "peer-address"
    | "user-info-response" | "user-info-failed" | "privileged-users" | "check-privileges"
    | "excluded-search-phrases" | "wishlist-interval" | "watch-user" | "admin-message"
    | "privilege-time";
  username?: string; status?: UserStatusMessage; stats?: UserStatsMessage;
  interests?: UserInterestsMessage; recommendations?: Recommendation[]; similarUsers?: SimilarUser[];
  peerAddress?: PeerAddress; info?: UserInfoResponseMessage; privilegedUsers?: string[];
  checkPrivileges?: number; excludedPhrases?: string[]; wishlistInterval?: number;
  watchUser?: ReturnType<typeof parseWatchUser>; adminMessage?: string;
}
export interface ChatEvent {
  type: "say-chatroom" | "private-message" | "private-message-acked" | "global-room-message";
  room?: string; username?: string; message?: string; msgId?: number; timestamp?: number;
}
export interface RoomEvent {
  type: "join-room" | "leave-room" | "user-joined-room" | "user-left-room"
    | "room-list" | "room-members" | "room-tickers" | "ticker-added" | "ticker-removed"
    | "privileged-users" | "cant-create-room";
  room?: string; username?: string; data?: unknown;
}
export interface TransferEvent {
  type: "transfer-request" | "transfer-response" | "queue-upload" | "place-in-queue" | "upload-failed" | "upload-denied";
  username?: string; file?: string; token?: number; place?: number; reason?: string;
}

const MAX_DISPLAYED_RESULTS = 2500;
const DEFAULT_SEARCH_TIMEOUT_MS = 20_000;
const PEER_ADDRESS_TIMEOUT_MS = 20_000; // INDIRECT_REQUEST_TIMEOUT
const CONNECTION_MAX_IDLE_MS = 60_000;
const GHOST_IDLE_MS = 10_000;
const CONNECTION_INIT_TIMEOUT_MS = 2_000;
const USER_ADDRESS_TTL_MS = 30 * 60 * 1000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 300_000;
const CONNECT_PEER_TIMEOUT_MS = 45_000; // downloads.py Getting status 45 s (30 s indirect + 15 s grace)

export class SoulseekSession {
  readonly username: string;
  private serverSocket: Socket | undefined;
  private listener: TCPSocketListener | undefined;
  private serverBuffer = Buffer.alloc(0);
  private peerStates = new Map<Socket, PeerState>();
  private searches = new Map<number, ActiveSearch>();
  private searchIds = new Map<string, number>();
  private userInfoRequests = new Map<string, (info: UserInfoResponseMessage) => void>();
  private failedUserInfo = new Set<string>();
  private peerAddressRequests = new Map<string, { cbs: Array<(addr: PeerAddress) => void>; timer: ReturnType<typeof setTimeout>; createdAt: number }>();
  private userAddresses = new Map<string, { addr: PeerAddress; updated: number }>();
  private excludedPhrases = new Set<string>();
  private allowedSearchTokens = new Set<number>();
  private tokenCounter = Math.floor(Math.random() * 100000) + 1;
  // Phase 1 — indirect connectivity
  private pendingConnects = new Map<number, { resolve: (s: Socket) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; username: string; connType: string }>();
  private pendingFileTokens = new Set<number>();
  private loggedIn = false;
  private loginResolve: ((r: LoginResponse & { success: true }) => void) | undefined;
  private loginReject: ((e: Error) => void) | undefined;
  private idleTimer: ReturnType<typeof setInterval> | undefined;
  private wishlistTimer: ReturnType<typeof setInterval> | undefined;
  private serverPingTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private branchLevel = 0;
  private branchRoot: string | undefined;
  private parentCandidate: string | undefined;
  private maxChildren = 0;
  private shareDB: ShareDB;
  private wishlistInterval = 12 * 60; // seconds, server 12 min default (2 min privileged)
  private wishlistTerms: string[] = [];
  private wishlistIndex = 0;
  // ban/ignore/geo config — updated via server WS
  private banlist: string[] = [];
  private ignorelist: string[] = [];
  private ipblocklist: Record<string, string> = {};
  private ipignorelist: Record<string, string> = {};
  private geoblock = false;
  private geoblockcc: string[] = [];
  private usecustomban = false;
  private customban = "Banned, don't bother retrying";
  private usecustomgeoblock = false;
  private customgeoblock = "Sorry, your country is blocked";

  // pending browse tracking
  private pendingBrowseShares = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
  private pendingBrowseFolder = new Map<number, { username: string; folder: string; timer: ReturnType<typeof setTimeout> }>();

  get isLoggedIn(): boolean { return this.loggedIn; }

  // Expose ShareDB for rescan via server.ts WS
  get shareDBInstance(): ShareDB { return this.shareDB; }
  async rescanShares(): Promise<import("./shares.ts").ShareFolder[]> {
    const res = await this.shareDB.rescanAsync();
    try {
      const { dirs, files } = this.shareDB.getSharedCounts();
      this.reportShares(dirs, files);
    } catch {}
    return res;
  }

  setNetworkFilters(opts: Partial<{
    banlist: string[]; ignorelist: string[]; ipblocklist: Record<string, string>; ipignorelist: Record<string, string>;
    geoblock: boolean; geoblockcc: string[]; usecustomban: boolean; customban: string;
    usecustomgeoblock: boolean; customgeoblock: string;
  }>) {
    if (opts.banlist !== undefined) this.banlist = opts.banlist;
    if (opts.ignorelist !== undefined) this.ignorelist = opts.ignorelist;
    if (opts.ipblocklist !== undefined) this.ipblocklist = opts.ipblocklist;
    if (opts.ipignorelist !== undefined) this.ipignorelist = opts.ipignorelist;
    if (opts.geoblock !== undefined) this.geoblock = opts.geoblock;
    if (opts.geoblockcc !== undefined) this.geoblockcc = opts.geoblockcc;
    if (opts.usecustomban !== undefined) this.usecustomban = opts.usecustomban;
    if (opts.customban !== undefined) this.customban = opts.customban;
    if (opts.usecustomgeoblock !== undefined) this.usecustomgeoblock = opts.usecustomgeoblock;
    if (opts.customgeoblock !== undefined) this.customgeoblock = opts.customgeoblock;
  }

  setShareFilters(filters: string[]) {
    this.shareDB.setShareFilters(filters);
  }

  setWishlistTerms(terms: string[]) {
    this.wishlistTerms = terms.slice();
    this.wishlistIndex = 0;
    this.restartWishlistTimer();
  }

  private restartWishlistTimer() {
    if (this.wishlistTimer) { clearInterval(this.wishlistTimer); this.wishlistTimer = undefined; }
    if (!this.wishlistTerms.length || !this.loggedIn) return;
    const intervalMs = Math.max(30_000, this.wishlistInterval * 1000);
    this.wishlistTimer = setInterval(() => {
      if (!this.loggedIn || !this.serverSocket || !this.wishlistTerms.length) return;
      const term = this.wishlistTerms[this.wishlistIndex % this.wishlistTerms.length];
      this.wishlistIndex++;
      try {
        const token = this.tokenCounter++;
        if (this.tokenCounter >= 0xffffffff) this.tokenCounter = 1;
        this.allowedSearchTokens.add(token);
        const searchId = `wishlist:${term}:${Date.now()}`;
        const handlers: SearchHandlers = {
          onResult: (p) => this.emit({ type: "privilege-time" } as unknown as UserInfoEvent), // placeholder; real routing handled via routeResult
          onEnd: () => {},
        };
        // Use internal search plumbing but emit via existing event
        this.serverSocket.write(buildWishlistSearch(token, term));
        logger.info("search", "wishlist auto-search", { term, token });
      } catch {}
    }, intervalMs);
  }

  private emit(event: UserInfoEvent) { this.opts.onUserEvent?.(event); }
  private emitChat(event: ChatEvent) { this.opts.onChatEvent?.(event); }
  private emitRoom(event: RoomEvent) { this.opts.onRoomEvent?.(event); }
  private emitTransfer(event: TransferEvent) { this.opts.onTransferEvent?.(event); }
  private emitBrowse(event: BrowseEvent) { this.opts.onBrowseEvent?.(event); }
  private emitServer(event: ServerEvent) { this.opts.onServerEvent?.(event); }

  setProfile(profile: UserInfoResponseMessage) { this.profile = { ...this.profile, ...profile }; }
  private profile: UserInfoResponseMessage;

  constructor(private readonly opts: SessionOptions) {
    this.username = opts.username;
    this.profile = opts.profile;
    this.shareDB = new ShareDB({ dataDir: opts.dataDir || process.env.DATA_DIR || "/data" });
  }

  login(): Promise<LoginResponse & { success: true }> {
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    const promise = new Promise<LoginResponse & { success: true }>((resolve, reject) => {
      this.loginResolve = resolve;
      this.loginReject = reject;
    });
    this.opts.signal?.addEventListener("abort", () => { this.loginReject?.(new Error("Login request was cancelled.")); this.shouldReconnect = false; this.close(); }, { once: true });
    this.connectServer();
    return promise;
  }

  private connectServer() {
    logger.info("server", `connecting to ${this.opts.host || "server.slsknet.org"}:${this.opts.port || 2242}`, { username: this.username });
    Bun.connect({
      hostname: this.opts.host || "server.slsknet.org",
      port: this.opts.port || 2242,
      socket: {
        open: (sock) => {
          logger.info("server", "tcp open, sending login", { username: this.username });
          // Bun TCP keepalive: pynicotine sets SO_KEEPALIVE idle 10s interval 2s count 10
          // Bun only exposes setKeepAlive(bool); tuning not available — fallback ServerPing 32 60s
          try { (sock as unknown as { setKeepAlive?: (b: boolean) => void }).setKeepAlive?.(true); } catch {}
          try { (sock as unknown as { setNoDelay?: (b: boolean) => void }).setNoDelay?.(true); } catch {}
          this.serverSocket = sock as Socket;
          // Send Login only; SetWaitPort after success (nicotine parity)
          sock.write(buildLogin(this.opts.username, this.opts.password));
        },
        data: (_sock, chunk) => this.handleServerData(chunk),
        error: (_sock, err) => {
          logger.warn("server", "tcp error", { error: err.message, username: this.username });
          if (!this.loggedIn) this.loginReject?.(new Error(`Connection error: ${err.message}`));
          this.scheduleReconnect(`Connection error: ${err.message}`);
        },
        close: () => {
          logger.warn("server", "tcp close", { loggedIn: this.loggedIn, username: this.username });
          if (!this.loggedIn && this.loginReject) {
            const err = new Error("Connection closed before login completed.");
            this.loginReject(err);
            this.loginReject = undefined;
            this.loginResolve = undefined;
          }
          const wasLoggedIn = this.loggedIn;
          // keep loggedIn false; schedule reconnect if we were logged in or still trying
          if (wasLoggedIn) this.loggedIn = false;
          this.cleanupServerTimers();
          if (this.shouldReconnect) this.scheduleReconnect("Server closed");
          else this.close();
        },
      },
    }).catch((err) => {
      logger.error("server", "connect failed", { error: err.message, username: this.username });
      if (!this.loggedIn) this.loginReject?.(new Error(`Unable to connect: ${err.message}`));
      this.scheduleReconnect(`Unable to connect: ${err.message}`);
    });
  }

  private scheduleReconnect(reason: string) {
    if (!this.shouldReconnect || this.opts.signal?.aborted) return;
    if (this.reconnectTimer) return;
    const base = RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.min(RECONNECT_MAX_MS, Math.max(RECONNECT_BASE_MS, base + jitter));
    this.reconnectAttempts += 1;
    logger.warn("server", "schedule reconnect", { attempt: this.reconnectAttempts, delay: Math.round(delay), reason });
    this.emitServer({ type: "reconnect", attempt: this.reconnectAttempts, delay: Math.round(delay) });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.shouldReconnect || this.opts.signal?.aborted) return;
      this.connectServer();
    }, delay);
    if (this.reconnectAttempts > 15) {
      logger.error("server", "reconnect failed", { reason, attempts: this.reconnectAttempts });
      this.emitServer({ type: "reconnect-failed", error: reason });
    }
  }

  private cleanupServerTimers() {
    if (this.serverPingTimer) { clearInterval(this.serverPingTimer); this.serverPingTimer = undefined; }
  }

  private handleServerData(chunk: ArrayBuffer | Uint8Array) {
    const bytes = chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    // Per spec: server generic 1M, but we allow 16M for search/shares; close on overflow
    if (this.serverBuffer.length + bytes.length > MAX_INCOMING.server16M) {
      try { this.serverSocket?.end(); } catch {}
      this.scheduleReconnect("Server overflow");
      return;
    }
    this.serverBuffer = Buffer.concat([this.serverBuffer, Buffer.from(bytes)]);
    while (true) {
      const msg = tryParseMessage(this.serverBuffer, MAX_INCOMING.server16M);
      if (!msg) {
        // check if next len exceeds cap -> overflow
        if (this.serverBuffer.length >= 4) {
          const len = this.serverBuffer.readUInt32LE(0);
          if (len > MAX_INCOMING.server16M) { try { this.serverSocket?.end(); } catch {} this.scheduleReconnect("Server msg too large"); break; }
        }
        break;
      }
      // Additional per-code overflow guard (shares etc could be larger but server caps at 16M)
      if (msg.payload.length > MAX_INCOMING.server16M) { try { this.serverSocket?.end(); } catch {} break; }
      this.serverBuffer = this.serverBuffer.subarray(8 + msg.payload.length);
      this.dispatchServerMessage(msg.code, msg.payload);
    }
  }

  private dispatchServerMessage(code: number, payload: Buffer) {
    logger.debug("server", "server message", { code, len: payload.length });
    if (code === SERVER_MESSAGE_CODES.login) {
      const resp = parseLoginResponse(payload);
      if (resp.success) {
        logger.info("server", "login success", { banner: resp.banner?.slice(0,60), ip: resp.ipAddress });
        this.loggedIn = true;
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
        // Now advertise listen port (after success)
        this.serverSocket?.write(buildSetWaitPort(this.opts.listenPort));
        // Report real share counts (nicotine shares.py sendNumSharedFoldersFiles)
        try {
          const { dirs, files } = this.shareDB.getSharedCounts();
          this.serverSocket?.write(buildSharedFoldersFiles(dirs, files));
        } catch {}
        this.startListener();
        this.startIdleSweep();
        this.startServerPing();
        // Distrib bootstrap: HaveNoParent + BranchLevel/Root (Phase 5)
        this.serverSocket?.write(buildHaveNoParent());
        try { this.serverSocket?.write(buildBranchLevel(this.branchLevel)); } catch {}
        if (this.branchRoot) try { this.serverSocket?.write(buildBranchRoot(this.branchRoot)); } catch {}
        this.restartWishlistTimer();
        this.loginResolve?.(resp);
        this.loginResolve = undefined;
        this.loginReject = undefined;
      } else {
        logger.warn("server", "login rejected", { reason: resp.rejectionReason, detail: resp.rejectionDetail?.slice(0,120) });
        this.shouldReconnect = false;
        this.loginReject?.(new Error(`Login rejected: ${resp.rejectionReason}`));
        this.loginReject = undefined;
        this.loginResolve = undefined;
      }
      return;
    }
    if (code === SERVER_MESSAGE_CODES.relogged) {
      logger.warn("server", "relogged elsewhere");
      this.loginReject?.(new Error("You have been logged in elsewhere."));
      this.close(); return;
    }
    if (code === SERVER_MESSAGE_CODES.connectToPeer) {
      try {
        const ctp = parseConnectToPeer(payload);
        // If this is a response to our outbound ConnectToPeer (pendingConnects), resolve it.
        const pending = this.pendingConnects.get(ctp.token);
        if (pending && pending.username === ctp.username && pending.connType === ctp.connType) {
          // Inbound ConnectToPeer from server means peer wants to connect to us — for P, we Pierce.
          // For pending outbound, we treat this as server relay and attempt direct Pierce.
          this.connectToPeer(ctp);
          // Also emit diagnostic
          this.emitTransfer({ type: "transfer-request", username: ctp.username, token: ctp.token, file: `peer:connect:${ctp.connType}:${ctp.username}` });
          return;
        }
        // Delegate F to TransferManager via event (Phase 2 will handle), else handle P normally
        if (ctp.connType === "F" && this.pendingFileTokens.has(ctp.token)) {
          this.emitTransfer({ type: "transfer-request", username: ctp.username, token: ctp.token, file: `F:${ctp.token}` });
          // Also attempt to pierce as fallback
          this.connectToPeer(ctp);
        } else {
          this.connectToPeer(ctp);
        }
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.getUserStatus) {
      try { const status = parseUserStatus(payload); this.emit({ type: "user-status", username: status.username, status }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.getUserStats) {
      try { const stats = parseUserStats(payload); this.emit({ type: "user-stats", username: stats.username, stats }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.userInterests) {
      try { const interests = parseUserInterests(payload); this.emit({ type: "user-interests", username: interests.username, interests }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.recommendations) {
      try { this.emit({ type: "recommendations", recommendations: parseRecommendations(payload).recommendations }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.globalRecommendations) {
      try { this.emit({ type: "global-recommendations", recommendations: parseRecommendations(payload).recommendations }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.similarUsers) {
      try { this.emit({ type: "similar-users", similarUsers: parseSimilarUsers(payload) }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.itemRecommendations) {
      try { this.emit({ type: "item-recommendations", recommendations: parseItemRecommendations(payload).recommendations }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.itemSimilarUsers) {
      try { this.emit({ type: "item-similar-users", similarUsers: parseItemSimilarUsers(payload).users }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.getPeerAddress) {
      try {
        const addr = parsePeerAddress(payload);
        // cache 30m TTL and populate geo cache if we have country mapping externally
        this.userAddresses.set(addr.username, { addr, updated: Date.now() });
        // If bridge has geoblock enabled, try to lookup country via simple /24 heuristic placeholder
        // Real geo uses ip_country_data.csv; we keep cache externally populated via setCountryForIp
        const pending = this.peerAddressRequests.get(addr.username);
        if (pending) {
          clearTimeout(pending.timer);
          this.peerAddressRequests.delete(addr.username);
          this.emit({ type: "peer-address", username: addr.username, peerAddress: addr });
          for (const cb of pending.cbs) try { cb(addr); } catch {}
        } else {
          this.emit({ type: "peer-address", username: addr.username, peerAddress: addr });
        }
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.watchUser) {
      try { const w = parseWatchUser(payload); this.emit({ type: "watch-user", username: w.username, watchUser: w }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.sayChatroom) {
      try {
        const m = parseSayChatroom(payload);
        const peerAddr = this.userAddresses.get(m.username)?.addr;
        const ip = peerAddr?.ip || "";
        if (shouldIgnoreUser({ username: m.username, ip, ignorelist: this.ignorelist, ipignorelist: this.ipignorelist })) return;
        this.emitChat({ type: "say-chatroom", room: m.room, username: m.username, message: m.message });
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.messageUser) {
      try {
        const m = parseMessageUser(payload);
        // Ignore filter — drop messages from ignored users/IPs
        const peerAddr = this.userAddresses.get(m.username)?.addr;
        const ip = peerAddr?.ip || "";
        const country = ip ? getCountryCode(ip) : "";
        if (shouldIgnoreUser({ username: m.username, ip, ignorelist: this.ignorelist, ipignorelist: this.ipignorelist })) {
          this.serverSocket?.write(buildMessageAcked(m.id));
          logger.debug("chat", "ignored private message", { username: m.username });
          return;
        }
        // Also respect geo/ban filtering for PM? Not needed but keep
        this.emitChat({ type: "private-message", username: m.username, message: m.message, msgId: m.id, timestamp: m.timestamp });
        this.serverSocket?.write(buildMessageAcked(m.id));
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.joinRoom) {
      try { const j = parseJoinRoom(payload); this.emitRoom({ type: "join-room", room: j.room, data: j }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.userJoinedRoom) {
      try {
        let off = 0; const rs = (): string => { const len = payload.readUInt32LE(off); off += 4; const s = payload.subarray(off, off + len).toString("utf8"); off += len; return s; };
        const room = rs(); const username = rs();
        this.emitRoom({ type: "user-joined-room", room, username });
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.userLeftRoom) {
      try { let off = 0; const rs = (): string => { const len = payload.readUInt32LE(off); off += 4; const s = payload.subarray(off, off + len).toString("utf8"); off += len; return s; };
        const room = rs(); const username = rs(); this.emitRoom({ type: "user-left-room", room, username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomList) {
      try { const rl = parseRoomList(payload); this.emitRoom({ type: "room-list", data: rl }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.privilegedUsers) {
      try { const users = parsePrivilegedUsers(payload); this.emit({ type: "privileged-users", privilegedUsers: users }); this.emitRoom({ type: "privileged-users", data: users }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.checkPrivileges) {
      try { const secs = parseCheckPrivileges(payload); this.emit({ type: "check-privileges", checkPrivileges: secs }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.excludedSearchPhrases) {
      try { const phrases = parseExcludedSearchPhrases(payload); for (const p of phrases) this.excludedPhrases.add(p.toLowerCase()); this.shareDB.setExcludedPhrases(phrases); this.emit({ type: "excluded-search-phrases", excludedPhrases: phrases }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.wishlistInterval) {
      try { const secs = payload.readUInt32LE(0); this.wishlistInterval = secs; this.restartWishlistTimer(); this.emit({ type: "wishlist-interval", wishlistInterval: secs }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomTickers) {
      try { const t = parseRoomTickers(payload); this.emitRoom({ type: "room-tickers", room: t.room, data: t.tickers }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomTickerAdded) {
      try {
        let off = 0; const rs = (): string => { const l = payload.readUInt32LE(off); off += 4; const s = payload.subarray(off, off + l).toString("utf8"); off += l; return s; };
        const room = rs(); const username = rs(); const msg = rs();
        this.emitRoom({ type: "ticker-added", room, username, data: msg });
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.possibleParents) {
      try { const parents = parsePossibleParents(payload); this.handlePossibleParents(parents); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.parentMinSpeed) {
      try { const v = payload.readUInt32LE(0); this.maxChildren = Math.floor(v / 100); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.parentSpeedRatio) {
      try {
        const ratio = payload.readUInt32LE(0) || 1;
        // recompute max children if already have speed — stub
        void ratio;
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.embeddedMessage) {
      // Phase 5: server EmbeddedMessage 93 contains distrib search — unpack
      try {
        // payload is [uint8 distribCode][distribPayload] possibly after server framing removed; first byte is distrib code
        if (payload.length >= 1) {
          const dCode = payload[0];
          const dPayload = payload.subarray(1);
          if (dCode === 3) {
            try {
              const r = new SlskReader(dPayload);
              if (r.remaining >= 4) r.uint32();
              const user = r.string(); const token = r.uint32(); const query = r.string();
              if (!this.shareDB.isExcluded(query)) this.emitTransfer({ type: "transfer-request", username: user, token, file: query.slice(0,120) });
              // forward to D children
              for (const [sock,st] of this.peerStates) if (st.connType==="D") try{ sock.write(Buffer.concat([packUint32(dPayload.length+1), Buffer.from([3]), dPayload])); }catch{}
            } catch {}
          }
        }
      } catch {}
      this.emitRoom({ type: "room-list", data: payload.toString("hex").slice(0, 64) });
      return;
    }
    if (code === SERVER_MESSAGE_CODES.adminMessage) {
      try { const msg = payload.length >= 4 ? (() => { const l = payload.readUInt32LE(0); return payload.subarray(4, 4 + l).toString("utf8"); })() : ""; this.emit({ type: "admin-message", adminMessage: msg }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.cantConnectToPeer) {
      try {
        const token = payload.readUInt32LE(0);
        const pending = this.pendingConnects.get(token);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingConnects.delete(token);
          pending.reject(new Error("CantConnectToPeer"));
        }
        // also try to parse optional username string for diagnostic
        if (payload.length > 4) {
          try { const r = new SlskReader(payload); r.uint32(); const user = r.string(); this.emitTransfer({ type: "transfer-response", username: user, token, reason: "CantConnectToPeer" }); } catch {}
        }
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.fileSearch) {
      // Someone searching via server (global search hitting us) — handled via shares in Phase 3
      try { this.handleInboundFileSearch(payload); } catch {}
      return;
    }
    // --- Phase 2 additional server codes ---
    if (code === SERVER_MESSAGE_CODES.messageUsers) {
      try { const users = parseMessageUsers(payload); for (const m of users) { this.emitChat({ type: "private-message", username: m.username, message: m.message, msgId: m.id, timestamp: m.timestamp }); this.serverSocket?.write(buildMessageAcked(m.id)); } } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomMembers) {
      try { const rm = parseRoomMembers(payload); this.emitRoom({ type: "room-members", room: rm.room, data: rm.members }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.addRoomMember || code === SERVER_MESSAGE_CODES.removeRoomMember) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: code === SERVER_MESSAGE_CODES.addRoomMember ? "room-members" : "room-members", room: m.room, username: m.username, data: m }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomTickerRemoved) {
      try { const t = parseRoomTickerEvent(payload); this.emitRoom({ type: "ticker-removed", room: t.room, username: t.username, data: t.msg }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.globalRoomMessage) {
      try { const m = parseGlobalRoomMessage(payload); this.emitChat({ type: "global-room-message", room: m.room, username: m.username, message: m.message }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.joinGlobalRoom || code === SERVER_MESSAGE_CODES.leaveGlobalRoom) {
      // server ack for global room join/leave
      try { this.emitRoom({ type: code === SERVER_MESSAGE_CODES.joinGlobalRoom ? "join-room" : "leave-room", room: "global", data: payload.length }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.cantCreateRoom) {
      try { const room = parseCantCreateRoom(payload); this.emitRoom({ type: "cant-create-room", room }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.userPrivileged || code === SERVER_MESSAGE_CODES.givePrivileges || code === SERVER_MESSAGE_CODES.notifyPrivileges || code === SERVER_MESSAGE_CODES.ackNotifyPrivileges) {
      try { const v = payload.length >= 4 ? payload.readUInt32LE(0) : 0; this.emit({ type: "check-privileges", checkPrivileges: v }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.branchLevel) {
      try { this.branchLevel = parseBranchLevel(payload); this.emitRoom({ type: "room-list", data: { branchLevel: this.branchLevel } }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.branchRoot) {
      try { this.branchRoot = parseBranchRoot(payload); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.childDepth) {
      try { const d = parseChildDepth(payload); this.emitRoom({ type: "room-list", data: { childDepth: d } }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.resetDistributed) {
      // reset distributed — close D conns and re-bootstrap
      for (const [sock, st] of this.peerStates) if (st.connType === "D") { try { sock.end(); } catch {} this.peerStates.delete(sock); }
      try { this.serverSocket?.write(buildHaveNoParent()); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.acceptChildren) {
      // server asking to accept children — we always accept
      try { const accept = payload[0] !== 0; void accept; } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.enableRoomInvitations || code === SERVER_MESSAGE_CODES.addToPrivileged) {
      // no-op ack
      return;
    }
    // Generic fallback for remaining 76 codes: emit raw for debugging but don't close
    this.emit({ type: "privilege-time" } as unknown as UserInfoEvent);
    // Unknown codes: ignore (don't close) — nicotine logs debug
  }

  private handleInboundFileSearch(payload: Buffer) {
    // Phase 3: user searching us via server FileSearch (26)
    // Delegated to ShareDB if present; stub emits event for now
    try {
      const r = new SlskReader(payload);
      const token = r.uint32(); const query = r.string();
      // If shares loaded, let shares handle; otherwise just emit transfer event for debugging
      this.emitTransfer({ type: "transfer-request", token, file: query.slice(0, 120) });
      // Try to dispatch via injected share handler if available
      (this as unknown as { shareHandler?: (tok:number,q:string)=>void }).shareHandler?.(token, query);
    } catch {}
  }

  private handlePossibleParents(parents: Array<{ username: string; ip: string; port: number }>) {
    // Phase 5: attempt up to 10 parallel D dials (spec)
    const toTry = parents.slice(0, 10);
    for (const p of toTry) {
      Bun.connect({
        hostname: p.ip, port: p.port,
        socket: {
          open: (sock) => { (sock as Socket).write(buildPeerInit(this.username, "D")); this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username: p.username, outbound: true, connType: "D", lastActive: Date.now(), createdAt: Date.now() }); },
          data: (sock, chunk) => this.processPeer(sock as Socket, chunk, false),
          error: () => {},
          close: (sock) => { this.peerStates.delete(sock as Socket); },
        },
      }).catch(() => {});
    }
  }

  private startListener() {
    this.listener = Bun.listen({
      port: this.opts.listenPort, hostname: "0.0.0.0",
      socket: {
        open: () => {},
        data: (peer, chunk) => {
          // Phase 4: demux P vs F — F starts with uint32 token, no PeerInit prefix
          const buf = Buffer.from(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
          const state = this.peerStates.get(peer as Socket);
          if (!state || !state.initDone) {
            if (buf.length >= 4) {
              const token = buf.readUInt32LE(0);
              if (this.pendingFileTokens.has(token)) {
                // F conn
                const st: PeerState = state ?? { buf: Buffer.alloc(0), initDone: true, isFileConn: true, fileToken: token, lastActive: Date.now(), createdAt: Date.now() };
                st.isFileConn = true; st.fileToken = token; st.initDone = true;
                this.pendingFileTokens.delete(token);
                // consume token and delegate to file handler
                this.peerStates.set(peer as Socket, st);
                this.processPeer(peer as Socket, buf.subarray(4), true);
                // if chunk had more after token, process remainder as file data (offset etc)
                return;
              }
              // Heuristic: if first 5 bytes don't form valid PeerInit/PierceFW frame, treat as F
              if (buf.length >= 5) {
                const len = buf.readUInt32LE(0);
                const code = buf[4];
                if (code !== 0 && code !== 1) {
                  // Likely F raw token + offset
                  const fileState: PeerState = { buf: Buffer.alloc(0), initDone: true, isFileConn: true, fileToken: token, lastActive: Date.now(), createdAt: Date.now() };
                  this.peerStates.set(peer as Socket, fileState);
                  // The rest after token is offset (8 bytes) + data
                  if (buf.length > 4) this.processPeer(peer as Socket, buf.subarray(4), true);
                  return;
                }
                if (len > 1024*1024) {
                  const fileState2: PeerState = { buf: Buffer.alloc(0), initDone: true, isFileConn: true, fileToken: token, lastActive: Date.now(), createdAt: Date.now() };
                  this.peerStates.set(peer as Socket, fileState2);
                  if (buf.length > 4) this.processPeer(peer as Socket, buf.subarray(4), true);
                  return;
                }
              }
            }
          }
          this.processPeer(peer as Socket, chunk, false);
        },
        error: () => {},
        close: (peer) => { this.peerStates.delete(peer as Socket); },
      },
    });
    // Bun.listen keepalive is implicit via OS; ServerPing is fallback
  }
  private startIdleSweep() {
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [sock, st] of this.peerStates) {
        const idle = now - st.lastActive;
        const initTimeout = !st.initDone && (now - st.createdAt) > CONNECTION_INIT_TIMEOUT_MS;
        const ghost = !st.username && idle > GHOST_IDLE_MS;
        const dead = idle > CONNECTION_MAX_IDLE_MS;
        if (initTimeout || ghost || dead) {
          try { sock.end(); } catch {}
          this.peerStates.delete(sock);
        }
        // leak fix: partial init buf without progress -> evict after timeout (2s)
        if (!st.initDone && st.buf.length > 0 && (now - st.createdAt) > CONNECTION_INIT_TIMEOUT_MS) {
          try { sock.end(); } catch {}
          this.peerStates.delete(sock);
        }
      }
      // peer address cache TTL
      for (const [user, entry] of this.userAddresses) {
        if (now - entry.updated > USER_ADDRESS_TTL_MS) this.userAddresses.delete(user);
      }
      for (const [user, pending] of this.peerAddressRequests) {
        // Pending GetPeerAddress timeout is INDIRECT_REQUEST_TIMEOUT (20s) — we store createdAt
        const created = (pending as unknown as { createdAt?: number }).createdAt ?? 0;
        if (created && now - created > PEER_ADDRESS_TIMEOUT_MS) {
          clearTimeout(pending.timer);
          this.peerAddressRequests.delete(user);
        }
      }
      // pendingConnects timeout is handled per-token (45 s), but sweep stale just in case
      for (const [token, pending] of this.pendingConnects) {
        // if timer already fired, pending would be deleted; no extra handling
        void token; void pending;
      }
    }, 5000);
  }
  private startServerPing() {
    // nicotine (slskproto.py) marks ServerPing 32 obsolete and uses TCP keepalive instead.
    // Bridge sends it as fallback every 60s; disable via ENABLE_SERVER_PING=0
    if (process.env.ENABLE_SERVER_PING === "0") return;
    this.serverPingTimer = setInterval(() => {
      try { this.serverSocket?.write(Buffer.concat([Buffer.from([4, 0, 0, 0]), Buffer.from([32, 0, 0, 0])])); } catch {}
    }, 60000);
  }

  private connectToPeer(ctp: ReturnType<typeof parseConnectToPeer>) {
    if (ctp.connType !== "P" && ctp.connType !== "F" && ctp.connType !== "D") return;
    // If this token matches a pending outbound connectPeer, resolve it
    const pending = this.pendingConnects.get(ctp.token);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingConnects.delete(ctp.token);
      // Outbound pierce will be handled by the pending resolver; still emit for diagnostics
      this.emitTransfer({ type: "transfer-response", username: ctp.username, token: ctp.token, reason: `ConnectToPeer ${ctp.connType}` });
    }
    // Obfuscated port handling
    const port = ctp.obfuscatedPort ?? ctp.port;
    const ip = ctp.ip;
    Bun.connect({
      hostname: ip, port,
      socket: {
        open: (sock) => {
          (sock as Socket).write(buildPierceFireWall(ctp.token));
          this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: true, username: ctp.username, outbound: false, connType: ctp.connType, lastActive: Date.now(), createdAt: Date.now() });
          // Resolve pending if any
          if (pending) {
            try { pending.resolve(sock as Socket); } catch {}
          }
        },
        data: (sock, chunk) => this.processPeer(sock as Socket, chunk, true),
        error: () => {
          // Report back to server we couldn't connect
          try { this.serverSocket?.write(buildCantConnectToPeer(ctp.token, ctp.username)); } catch {}
          if (pending) { try { pending.reject(new Error("Pierce failed")); } catch {} }
        },
        close: (sock) => { this.peerStates.delete(sock as Socket); },
      },
    }).catch(() => {
      try { this.serverSocket?.write(buildCantConnectToPeer(ctp.token, ctp.username)); } catch {}
      if (pending) { try { pending.reject(new Error("Connect failed")); } catch {} }
    });
  }

  /** Phase 1: connect to peer with 45 s race (direct vs server-relayed). */
  async connectPeer(username: string, connType: string): Promise<Socket> {
    const cached = this.userAddresses.get(username);
    if (cached && Date.now() - cached.updated < USER_ADDRESS_TTL_MS) {
      // Try direct first, but also trigger server relay
      return this.connectPeerWithRelay(username, connType, cached.addr);
    }
    // Need to fetch address
    const addr = await this.fetchPeerAddress(username);
    return this.connectPeerWithRelay(username, connType, addr);
  }

  private fetchPeerAddress(username: string): Promise<PeerAddress> {
    const cached = this.userAddresses.get(username);
    if (cached && Date.now() - cached.updated < USER_ADDRESS_TTL_MS) return Promise.resolve(cached.addr);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.peerAddressRequests.delete(username);
        reject(new Error("GetPeerAddress timeout"));
      }, PEER_ADDRESS_TIMEOUT_MS);
      this.peerAddressRequests.set(username, {
        cb: (addr) => {
          clearTimeout(timer);
          this.userAddresses.set(username, { addr, updated: Date.now() });
          resolve(addr);
        },
        timer,
      });
      this.serverSocket?.write(buildGetPeerAddress(username));
    });
  }

  private async connectPeerWithRelay(username: string, connType: string, addr: PeerAddress): Promise<Socket> {
    const token = this.tokenCounter++ >>> 0;
    if (this.tokenCounter >= 0xffffffff) this.tokenCounter = 1;

    // Send server relay
    try { this.serverSocket?.write(buildConnectToPeer(token, username, connType)); } catch {}

    // Attempt direct
    const directPromise = (async (): Promise<Socket> => {
      if (addr.port === 0 || addr.ip === "0.0.0.0") throw new Error("Peer offline");
      return new Promise<Socket>((resolve, reject) => {
        Bun.connect({
          hostname: addr.ip, port: addr.port,
          socket: {
            open: (sock) => {
              this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username, outbound: true, connType, lastActive: Date.now() });
              (sock as Socket).write(buildPeerInit(this.username, connType));
              // Wait for remote PeerInit/Pierce to complete — consider connected after open + init
              // For P, we consider success after we send PeerInit and get data
              setTimeout(() => resolve(sock as Socket), 200);
            },
            data: (sock, chunk) => this.processPeer(sock as Socket, chunk, false),
            error: () => reject(new Error("Direct connect failed")),
            close: () => {},
          },
        }).catch(reject);
      });
    })();

    // Race with pending server relay (PierceFirewall)
    const relayPromise = new Promise<Socket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingConnects.delete(token);
        reject(new Error("ConnectToPeer timeout 45s"));
      }, CONNECT_PEER_TIMEOUT_MS);
      this.pendingConnects.set(token, { resolve, reject, timer, username, connType });
    });

    // Race direct vs relay, but prefer whichever succeeds first
    return Promise.race([directPromise, relayPromise]).finally(() => {
      const p = this.pendingConnects.get(token);
      if (p) { clearTimeout(p.timer); this.pendingConnects.delete(token); }
    });
  }

  /** Register an F token so incoming raw F connections are demuxed correctly. */
  registerFileToken(token: number) { this.pendingFileTokens.add(token >>> 0); }
  unregisterFileToken(token: number) { this.pendingFileTokens.delete(token >>> 0); }
  getPeerSocket(username: string, connType: string): Socket | undefined {
    for (const [sock, st] of this.peerStates) {
      if (st.username === username && st.connType === connType && st.initDone) return sock;
    }
    return undefined;
  }

  private processPeer(peer: Socket, chunk: ArrayBuffer | Uint8Array, initDone: boolean) {
    const bytes = chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    const state = this.peerStates.get(peer) ?? { buf: Buffer.alloc(0), initDone, lastActive: Date.now(), createdAt: Date.now() };
    if (!state.createdAt) state.createdAt = Date.now();
    state.lastActive = Date.now();
    // Enforce per-conn max before appending
    const maxForState = state.connType === "D" ? MAX_INCOMING.server16K : (state.isFileConn ? MAX_INCOMING.server16M : MAX_INCOMING.server1M);
    if (state.buf.length + bytes.length > maxForState) { try { peer.end(); } catch {} this.peerStates.delete(peer); return; }
    state.buf = Buffer.concat([state.buf, Buffer.from(bytes)]);
    while (true) {
      if (!state.initDone) {
        // Phase 1 F demux: raw [uint32 token] without PeerInit — detect via pendingFileTokens heuristic
        if (state.buf.length >= 4) {
          const peekToken = state.buf.readUInt32LE(0);
          if (this.pendingFileTokens.has(peekToken)) {
            state.isFileConn = true;
            state.fileToken = peekToken;
            state.initDone = true;
            state.connType = "F";
            state.buf = state.buf.subarray(4);
            // Fall through to file handling
            continue;
          }
          // Probe init framing: try to validate [len][code] — if not 0/1, treat as raw F if len looks like token
          if (state.buf.length >= 5) {
            const lenProbe = state.buf.readUInt32LE(0);
            const codeProbe = state.buf[4];
            if (codeProbe !== 0 && codeProbe !== 1 && lenProbe < 0x1000000) {
              // Heuristic may be raw token; check if token+remaining could be offset (8 bytes)
              // Defer to F handling if token in pending set already handled; otherwise continue init path
            }
          }
        }
        if (state.buf.length < 5) break;
        const len = state.buf.readUInt32LE(0);
        if (len > 1024 * 1024) { try { peer.end(); } catch {} break; }
        const total = 5 + len;
        if (state.buf.length < total) break;
        const code = state.buf[4];
        const initPayload = state.buf.subarray(5, total);
        if (code === 1) {
          try {
            const pi = parsePeerInit(initPayload);
            // validation: username size + printable
            if (pi.targetUser.length === 0 || pi.targetUser.length > 256 || pi.targetUser === "server") {
              try { peer.end(); } catch {}
              break;
            }
            state.username = pi.targetUser;
            state.connType = pi.connType;
            // File conn detection: type F has no further peer messages — token follows as raw
            if (pi.connType === "F") state.isFileConn = true;
          } catch {}
        } else if (code === 0) {
          try { parsePierceFireWall(initPayload); } catch {}
        }
        state.initDone = true;
        // Phase 1: send any pendingMsg queued by ensurePeerAndSend
        const pendingMsg = (state as unknown as { pendingMsg?: Buffer }).pendingMsg as Buffer | undefined;
        if (pendingMsg) {
          try { (peer as Socket).write(pendingMsg); } catch {}
          delete (state as unknown as { pendingMsg?: Buffer }).pendingMsg;
        } else if (state.outbound) { try { (peer as Socket).write(buildUserInfoRequest()); } catch {} }
        state.buf = state.buf.subarray(total);
        continue;
      }
      // File connection: raw [uint32 token] + [uint64 offset] + bytes (nicotine downloads.py FileTransferInit+FileOffset)
      if (state.isFileConn) {
        if (state.fileToken === undefined) {
          if (state.buf.length < 4) break;
          state.fileToken = state.buf.readUInt32LE(0);
          state.buf = state.buf.subarray(4);
          // Wire to TransferManager if handler registered (Phase 4)
          try { this.opts.onFileConnection?.(state.fileToken, peer); } catch {}
          continue;
        }
        // Forward raw bytes to TransferManager via callback; also emit diagnostic
        if (state.buf.length > 0) {
          const chunk = Buffer.from(state.buf);
          try { this.opts.onFileChunk?.(state.fileToken, chunk); } catch {}
          this.emitTransfer({ type: "transfer-request", username: state.username, token: state.fileToken, file: `F:${state.fileToken}` });
          state.buf = Buffer.alloc(0);
        }
        break;
      }
      // Distrib framing: uint8 code after init when connType D (Phase 5)
      if (state.connType === "D") {
        if (state.buf.length < 5) break;
        const len = state.buf.readUInt32LE(0);
        if (len > MAX_INCOMING.server16K) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
        const total = 5 + len; if (state.buf.length < total) break;
        const code = state.buf[4];
        const payload = state.buf.subarray(5, total);
        state.buf = state.buf.subarray(total);
        if (code === 0) {
          // DistribPing — ignore
        } else if (code === 3) {
          try {
            const ds = (()=>{ try{ const r=new SlskReader(payload); if(r.remaining>=4) r.uint32(); const u=r.string(); const t=r.uint32(); const q=r.string(); return { username:u, token:t, query:q }; } catch { return null; } })();
            if (ds) {
              // forward to children + local search via shares
              for (const [sock,st] of this.peerStates) if (st.connType==="D" && sock!==peer) try{ sock.write(Buffer.concat([packUint32(payload.length+1), Buffer.from([3]), payload])); }catch{}
              // local handler: if query matches excluded, ignore; else could emit
              if (!this.shareDB.isExcluded(ds.query)) this.emitTransfer({ type: "transfer-request", username: ds.username, token: ds.token, file: ds.query.slice(0,120) });
            } else {
              this.emitTransfer({ type: "transfer-request", username: state.username, file: payload.toString("utf8").slice(0, 100) });
            }
          } catch {}
        } else if (code === 4) {
          try { this.branchLevel = payload.readUInt32LE(0); } catch {}
        } else if (code === 5) {
          try { this.branchRoot = new SlskReader(payload).string(); } catch {}
        } else if (code === 7) {
          // childDepth ignored
        } else if (code === 93) {
          // EmbeddedMessage 93 inside distrib — unpack server message 93
          try {
            const r=new SlskReader(payload);
            const innerCode = r.uint8(); // should be 3? Actually distrib embedded carries FileSearch etc
            // rest is inner payload: try handle as distribSearch again
            const rest = payload.subarray(1);
            if (innerCode===3) {
              // treat as distribSearch
              const ds2=(()=>{ try{ const rr=new SlskReader(rest); if(rr.remaining>=4) rr.uint32(); const u=rr.string(); const t=rr.uint32(); const q=rr.string(); return {username:u, token:t, query:q}; }catch{return null;}})();
              if(ds2 && !this.shareDB.isExcluded(ds2.query)) this.emitTransfer({ type: "transfer-request", username: ds2.username, token: ds2.token, file: ds2.query.slice(0,120) });
            }
          } catch {}
        }
        continue;
      }
      // Determine max per expected message type (peek len)
      if (state.buf.length >= 4) {
        const peekLen = state.buf.readUInt32LE(0);
        // Quick overflow check against max generic; detailed per-code check after parse
        if (peekLen > MAX_INCOMING.server448M) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
      }
      // Use appropriate max for tryParse (shares need 448M)
      const msg = tryParseMessage(state.buf, MAX_INCOMING.server448M);
      if (!msg) {
        if (state.buf.length >= 4) {
          const len = state.buf.readUInt32LE(0);
          if (len > MAX_INCOMING.server448M) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
        }
        break;
      }
      // Per-code enforcement: close on overflow for non-shares
      const maxForCode = (msg.code === PEER_MESSAGE_CODES.sharedFileListResponse || msg.code === PEER_MESSAGE_CODES.folderContentsResponse) ? MAX_INCOMING.server448M
        : (msg.code === PEER_MESSAGE_CODES.fileSearchResponse ? MAX_INCOMING.server16M : MAX_INCOMING.server1M);
      if (msg.payload.length > maxForCode) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
      state.buf = state.buf.subarray(8 + msg.payload.length);
      if (msg.code === 9) {
        // Gate on allowed token to prevent zlib bomb from unsolicited peers
        const tokenProbe = (() => { try { const b = inflateProbeToken(msg.payload); return b; } catch { return null; } })();
        if (tokenProbe !== null && this.allowedSearchTokens.size > 0 && !this.allowedSearchTokens.has(tokenProbe)) {
          continue;
        }
        try { const resp = parseFileSearchResponse(msg.payload); this.routeResult(resp); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.userInfoResponse) {
        const username = state.username ?? "";
        try {
          const info = parseUserInfoResponse(msg.payload, username);
          const cb = this.userInfoRequests.get(username);
          if (cb) { this.userInfoRequests.delete(username); this.failedUserInfo.delete(username); cb(info); }
          this.emit({ type: "user-info-response", username, info });
        } catch {}
        try { (peer as Socket).end(); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.sharedFileListResponse) {
        try {
          const username = state.username ?? "unknown";
          const parsed = parseSharedFileListResponse(msg.payload);
          const pending = this.pendingBrowseShares.get(username);
          if (pending) { clearTimeout(pending.timer); this.pendingBrowseShares.delete(username); }
          this.emitBrowse({ type: "browse-shares", username, folders: parsed.folders });
          try { (peer as Socket).end(); } catch {}
        } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.folderContentsResponse) {
        try {
          const parsed = parseFolderContentsResponse(msg.payload);
          const username = state.username ?? "unknown";
          const pending = this.pendingBrowseFolder.get(parsed.token);
          if (pending) { clearTimeout(pending.timer); this.pendingBrowseFolder.delete(parsed.token); }
          this.emitBrowse({ type: "browse-folder", username, token: parsed.token, folder: parsed.dir, files: parsed.files });
          try { (peer as Socket).end(); } catch {}
        } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.userInfoRequest) {
        if (!state.outbound) { try { (peer as Socket).write(buildUserInfoResponse(this.profile)); } catch {} }
      } else if (msg.code === PEER_MESSAGE_CODES.sharedFileListRequest) {
        const peerName = state.username || "unknown";
        if (this.shareDB.shouldThrottle(peerName)) break;
        try { (peer as Socket).write(this.shareDB.buildSharedFileListResponse()); } catch { try { (peer as Socket).write(emptySharesResponse()); } catch {} }
      } else if (msg.code === PEER_MESSAGE_CODES.folderContentsRequest) {
        const peerName2 = state.username || "unknown";
        if (this.shareDB.shouldThrottle(peerName2)) break;
        try { const tok = msg.payload.readUInt32LE(0); const r = new SlskReader(msg.payload); r.uint32(); const dir = r.string(); const resp = this.shareDB.buildFolderContentsResponse(tok, dir); (peer as Socket).write(resp); } catch { try { const tok = msg.payload.readUInt32LE(0); (peer as Socket).write(emptyFolderResponse(tok)); } catch {} }
      } else if (msg.code === PEER_MESSAGE_CODES.fileSearchRequest) {
        try {
          // peer FileSearchRequest 8: [token][query] — respond with FileSearchResponse 9 via same peer
          const r = new SlskReader(msg.payload);
          const token = r.uint32(); const query = r.string();
          if (!this.shareDB.isExcluded(query)) {
            const resp = this.shareDB.buildFileSearchResponse(token, this.username, query);
            if (resp) (peer as Socket).write(resp);
          }
        } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.transferRequest) {
        try { const tr = parseTransferRequest(msg.payload); this.emitTransfer({ type: "transfer-request", username: state.username, token: tr.token, file: tr.file }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.transferResponse) {
        try { const tr = parseTransferResponse(msg.payload); this.emitTransfer({ type: "transfer-response", username: state.username, token: tr.token, reason: tr.reason }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.queueUpload) {
        try { const q = parseQueueUpload(msg.payload); const file = typeof q === "string" ? q : (q as { file: string }).file; this.emitTransfer({ type: "queue-upload", username: state.username, file }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.placeInQueueRequest) {
        try {
          const file = msg.payload.length >= 4 ? (() => { const l = msg.payload.readUInt32LE(0); return msg.payload.subarray(4, 4 + l).toString("utf8"); })() : "";
          let place = 1;
          try {
            const getter = (this.opts as unknown as { getQueuePlace?: (f: string) => number }).getQueuePlace;
            if (getter) place = getter(file) ?? 1;
          } catch {}
          try { (peer as Socket).write(buildPlaceInQueueResponse(file, place)); } catch { try { (peer as Socket).write(buildPlaceInQueueRequest(file)); } catch {} }
        } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.placeInQueueResponse) {
        try { const p = parsePlaceInQueueResponse(msg.payload); this.emitTransfer({ type: "place-in-queue", username: state.username, file: p.file, place: p.place }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.uploadFailed || msg.code === PEER_MESSAGE_CODES.uploadDenied) {
        try { this.emitTransfer({ type: msg.code === PEER_MESSAGE_CODES.uploadFailed ? "upload-failed" : "upload-denied", username: state.username, file: msg.payload.toString("utf8").slice(0, 256) }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.placeholdUpload || msg.code === PEER_MESSAGE_CODES.uploadQueueNotification) {
        // Obsolete/deprecated 42/52 — no-op to silence unknown-peer warnings (nicotine keeps but never handles)
      }
    }
    if (state.buf.length === 0) this.peerStates.delete(peer);
    else this.peerStates.set(peer, state);
  }

  private routeResult(resp: { token: number; username: string; freeUploadSlots: boolean; inQueue: number; uploadSpeed: number; results: SearchFile[] }) {
    if (this.allowedSearchTokens.size && !this.allowedSearchTokens.has(resp.token)) return;
    const search = this.searches.get(resp.token);
    if (!search) return;
    if (search.users.has(resp.username)) return;
    search.users.add(resp.username);
    const rows = resp.results.map((file) => toRow(resp.username, resp.freeUploadSlots, resp.inQueue, resp.uploadSpeed, file));
    const remaining = search.maxResults - search.count;
    if (remaining <= 0) return;
    const batch = rows.slice(0, remaining);
    search.count += batch.length;
    search.onResult({ searchId: search.searchId, token: resp.token, rows: batch });
    if (search.count >= search.maxResults) {
      if (search.timer) clearTimeout(search.timer);
      this.searches.delete(resp.token); this.searchIds.delete(search.searchId);
      this.allowedSearchTokens.delete(resp.token);
      search.onEnd({ searchId: search.searchId, reason: "max_results" });
    }
  }

  search(query: string, searchId: string, handlers: SearchHandlers): number {
    if (!this.serverSocket || !this.loggedIn) { handlers.onEnd({ searchId, reason: "error" }); return 0; }
    // Excluded phrases filter (case-insensitive)
    const qLower = query.toLowerCase();
    for (const phrase of this.excludedPhrases) { if (qLower.includes(phrase)) { handlers.onEnd({ searchId, reason: "error" }); return 0; } }
    const token = this.tokenCounter++;
    if (this.tokenCounter >= 0xffffffff) this.tokenCounter = 1;
    this.allowedSearchTokens.add(token);
    const search: ActiveSearch = { searchId, ...handlers, timeoutMs: handlers.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS, users: new Set(), count: 0, maxResults: MAX_DISPLAYED_RESULTS };
    search.timer = setTimeout(() => { this.searches.delete(token); this.searchIds.delete(searchId); this.allowedSearchTokens.delete(token); handlers.onEnd({ searchId, reason: "timeout" }); }, search.timeoutMs);
    this.searches.set(token, search); this.searchIds.set(searchId, token);
    this.serverSocket.write(buildFileSearch(token, query));
    return token;
  }
  cancelSearch(searchId: string) {
    const token = this.searchIds.get(searchId);
    if (token === undefined) return;
    const search = this.searches.get(token);
    if (search?.timer) clearTimeout(search.timer);
    this.searches.delete(token); this.searchIds.delete(searchId); this.allowedSearchTokens.delete(token);
    search?.onEnd({ searchId, reason: "stopped" });
  }
  searchUser(username: string, query: string, searchId: string, handlers: SearchHandlers): number {
    if (!this.loggedIn || !this.serverSocket) { handlers.onEnd({ searchId, reason: "error" }); return 0; }
    const token = this.tokenCounter++;
    this.allowedSearchTokens.add(token);
    const search: ActiveSearch = { searchId, ...handlers, timeoutMs: handlers.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS, users: new Set(), count: 0, maxResults: MAX_DISPLAYED_RESULTS };
    search.timer = setTimeout(() => { this.searches.delete(token); this.searchIds.delete(searchId); this.allowedSearchTokens.delete(token); handlers.onEnd({ searchId, reason: "timeout" }); }, search.timeoutMs);
    this.searches.set(token, search); this.searchIds.set(searchId, token);
    this.serverSocket.write(buildUserSearch(username, token, query));
    return token;
  }
  searchRoom(room: string, query: string, searchId: string, handlers: SearchHandlers): number {
    if (!this.loggedIn || !this.serverSocket) { handlers.onEnd({ searchId, reason: "error" }); return 0; }
    const token = this.tokenCounter++;
    this.allowedSearchTokens.add(token);
    const search: ActiveSearch = { searchId, ...handlers, timeoutMs: handlers.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS, users: new Set(), count: 0, maxResults: MAX_DISPLAYED_RESULTS };
    search.timer = setTimeout(() => { this.searches.delete(token); this.searchIds.delete(searchId); this.allowedSearchTokens.delete(token); handlers.onEnd({ searchId, reason: "timeout" }); }, search.timeoutMs);
    this.searches.set(token, search); this.searchIds.set(searchId, token);
    this.serverSocket.write(buildRoomSearch(room, token, query));
    return token;
  }
  wishlistSearch(query: string, searchId: string, handlers: SearchHandlers): number {
    if (!this.loggedIn || !this.serverSocket) { handlers.onEnd({ searchId, reason: "error" }); return 0; }
    const token = this.tokenCounter++;
    this.allowedSearchTokens.add(token);
    const search: ActiveSearch = { searchId, ...handlers, timeoutMs: handlers.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS, users: new Set(), count: 0, maxResults: MAX_DISPLAYED_RESULTS };
    search.timer = setTimeout(() => { this.searches.delete(token); this.searchIds.delete(searchId); this.allowedSearchTokens.delete(token); handlers.onEnd({ searchId, reason: "timeout" }); }, search.timeoutMs);
    this.searches.set(token, search); this.searchIds.set(searchId, token);
    this.serverSocket.write(buildWishlistSearch(token, query));
    return token;
  }
  watchUser(username: string) { this.serverSocket?.write(buildWatchUser(username)); this.serverSocket?.write(buildGetUserStats(username)); }
  unwatchUser(username: string) { this.serverSocket?.write(buildUnwatchUser(username)); }
  requestPeerAddress(username: string) { this.serverSocket?.write(buildGetPeerAddress(username)); }
  requestUserInterests(username: string) { this.serverSocket?.write(buildUserInterests(username)); }
  requestRecommendations() { this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.recommendations, Buffer.alloc(0))); }
  requestGlobalRecommendations() { this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.globalRecommendations, Buffer.alloc(0))); }
  requestSimilarUsers() { this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.similarUsers, Buffer.alloc(0))); }
  requestItemRecommendations(item: string) { this.serverSocket?.write(buildItemRec(item)); }
  requestItemSimilarUsers(item: string) { this.serverSocket?.write(buildItemSim(item)); }
  setStatus(status: number) { this.serverSocket?.write(buildSetStatus(status)); }
  reportShares(folders: number, files: number) { this.serverSocket?.write(buildSharedFoldersFiles(folders, files)); }
  addThingILike(thing: string) { this.serverSocket?.write(buildAddThingILike(thing)); }
  removeThingILike(thing: string) { this.serverSocket?.write(buildRemoveThingILike(thing)); }
  addThingIHate(thing: string) { this.serverSocket?.write(buildAddThingIHate(thing)); }
  removeThingIHate(thing: string) { this.serverSocket?.write(buildRemoveThingIHate(thing)); }
  givePrivileges(username: string, days: number) { this.serverSocket?.write(buildGivePrivileges(username, days)); }
  sendUploadSpeed(speed: number) { this.serverSocket?.write(buildSendUploadSpeed(speed)); }
  changePassword(password: string) { this.serverSocket?.write(buildChangePassword(password)); }
  checkPrivileges() { this.serverSocket?.write(buildCheckPrivileges()); }
  joinRoom(room: string, priv = false) { this.serverSocket?.write(buildJoinRoom(room, priv)); }
  leaveRoom(room: string) { this.serverSocket?.write(buildLeaveRoom(room)); }
  sayChatroom(room: string, message: string) { this.serverSocket?.write(buildSayChatroom(room, message)); }
  sendPrivateMessage(username: string, message: string) { this.serverSocket?.write(buildMessageUser(username, message)); }
  joinGlobalRoom() { this.serverSocket?.write(buildJoinGlobalRoom()); }
  leaveGlobalRoom() { this.serverSocket?.write(buildLeaveGlobalRoom()); }
  setRoomTicker(room: string, msg: string) { this.serverSocket?.write(buildSetRoomTicker(room, msg)); }

  // File ops via peer
  requestSharedFileList(username: string) {
    // timeout 30s
    const timer = setTimeout(() => {
      this.pendingBrowseShares.delete(username);
      this.emitBrowse({ type: "browse-error", username, error: "Timed out fetching shares" });
    }, 30000);
    this.pendingBrowseShares.set(username, { timer });
    this.ensurePeerAndSend(username, "P", buildSharedFileListRequest());
  }
  requestFolderContents(username: string, dir: string, token: number) {
    const timer = setTimeout(() => {
      this.pendingBrowseFolder.delete(token);
      this.emitBrowse({ type: "browse-error", username, token, folder: dir, error: "Timed out fetching folder" });
    }, 30000);
    this.pendingBrowseFolder.set(token, { username, folder: dir, timer });
    this.ensurePeerAndSend(username, "P", buildFolderContentsRequest(token, dir));
  }
  queueUpload(username: string, file: string) { this.ensurePeerAndSend(username, "P", buildQueueUpload(file)); }
  placeInQueueRequest(username: string, file: string) { this.ensurePeerAndSend(username, "P", buildPlaceInQueueRequest(file)); }
  transferRequest(username: string, direction: number, token: number, file: string, size?: bigint) {
    this.ensurePeerAndSend(username, "P", buildTransferRequest(direction, token, file, size));
  }

  private ensurePeerAndSend(username: string, connType: string, msg: Buffer) {
    if (!this.loggedIn) return;
    const cached = this.userAddresses.get(username);
    if (cached && Date.now() - cached.updated < USER_ADDRESS_TTL_MS) {
      this.connectToPeerViaAddress(username, cached.addr, connType, msg);
      return;
    }
    const existing = this.peerAddressRequests.get(username);
    if (existing) {
      existing.cbs.push((addr) => this.connectToPeerViaAddress(username, addr, connType, msg));
      return;
    }
    const timer = setTimeout(() => { this.peerAddressRequests.delete(username); }, PEER_ADDRESS_TIMEOUT_MS);
    const entry = { cbs: [(addr: PeerAddress) => { clearTimeout(timer); this.connectToPeerViaAddress(username, addr, connType, msg); }], timer, createdAt: Date.now() };
    this.peerAddressRequests.set(username, entry);
    this.serverSocket?.write(buildGetPeerAddress(username));
  }
  private connectToPeerViaAddress(username: string, addr: PeerAddress, connType: string, msg: Buffer) {
    if (addr.port === 0 || addr.ip === "0.0.0.0") return;
    Bun.connect({
      hostname: addr.ip, port: addr.port,
      socket: {
        open: (sock) => {
          this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username, outbound: true, connType, lastActive: Date.now(), createdAt: Date.now() });
          (sock as Socket).write(buildPeerInit(this.username, connType));
          // queue msg via state — will be sent after initDone in processPeer
          const st = this.peerStates.get(sock as Socket);
          if (st) (st as unknown as { pendingMsg?: Buffer }).pendingMsg = msg;
        },
        data: (sock, chunk) => this.processPeer(sock as Socket, chunk, false),
        error: () => {},
        close: (sock) => { this.peerStates.delete(sock as Socket); },
      },
    }).catch(() => {});
  }

  requestUserInfo(username: string): Promise<UserInfoResponseMessage> {
    return new Promise((resolve, reject) => {
      if (this.userInfoRequests.has(username)) { reject(new Error("Already requesting this user.")); return; }
      this.userInfoRequests.set(username, resolve);
      const cached = this.userAddresses.get(username);
      const doConnect = (addr: PeerAddress) => {
        if (addr.port === 0 || addr.ip === "0.0.0.0") {
          this.userInfoRequests.delete(username); this.peerAddressRequests.delete(username);
          this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
          reject(new Error("User offline or port unknown."));
          return;
        }
        Bun.connect({
          hostname: addr.ip, port: addr.port,
          socket: {
            open: (sock) => {
              this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username, outbound: true, connType: "P", lastActive: Date.now(), createdAt: Date.now() });
              (sock as Socket).write(buildPeerInit(this.username, "P"));
            },
            data: (sock, chunk) => this.processPeer(sock as Socket, chunk, false),
            error: () => {
              this.userInfoRequests.delete(username); this.peerAddressRequests.delete(username);
              this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
              reject(new Error("Peer connection failed."));
            },
            close: (sock) => { this.peerStates.delete(sock as Socket); },
          },
        }).catch(() => {
          this.userInfoRequests.delete(username); this.peerAddressRequests.delete(username);
          this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
          reject(new Error("Unable to reach peer."));
        });
      };
      if (cached && Date.now() - cached.updated < USER_ADDRESS_TTL_MS) { doConnect(cached.addr); return; }
      const existing = this.peerAddressRequests.get(username);
      if (existing) {
        existing.cbs.push((addr) => { this.userAddresses.set(username, { addr, updated: Date.now() }); doConnect(addr); });
        return;
      }
      const timer = setTimeout(() => {
        this.peerAddressRequests.delete(username); this.userInfoRequests.delete(username);
        this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
        reject(new Error("Peer address request timed out."));
      }, PEER_ADDRESS_TIMEOUT_MS);
      this.peerAddressRequests.set(username, { cbs: [(addr) => { clearTimeout(timer); this.userAddresses.set(username, { addr, updated: Date.now() }); doConnect(addr); }], timer, createdAt: Date.now() });
      this.serverSocket?.write(buildGetPeerAddress(username));
    });
  }

  close() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    for (const token of [...this.searches.keys()]) { const s = this.searches.get(token); if (s?.timer) clearTimeout(s.timer); if (s) s.onEnd({ searchId: s.searchId, reason: "stopped" }); this.searches.delete(token); }
    this.searchIds.clear(); this.allowedSearchTokens.clear();
    for (const { timer } of this.peerAddressRequests.values()) clearTimeout(timer);
    for (const { timer } of this.pendingConnects.values()) clearTimeout(timer);
    for (const { timer } of this.pendingBrowseShares.values()) clearTimeout(timer);
    for (const { timer } of this.pendingBrowseFolder.values()) clearTimeout(timer);
    this.pendingBrowseShares.clear(); this.pendingBrowseFolder.clear();
    this.pendingConnects.clear(); this.pendingFileTokens.clear();
    this.userInfoRequests.clear(); this.peerAddressRequests.clear(); this.failedUserInfo.clear();
    this.excludedPhrases.clear();
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.wishlistTimer) clearInterval(this.wishlistTimer);
    if (this.serverPingTimer) clearInterval(this.serverPingTimer);
    for (const peer of this.peerStates.keys()) { try { peer.end(); } catch {} }
    this.peerStates.clear();
    try { this.serverSocket?.end(); } catch {}
    try { this.listener?.stop(); } catch {}
    this.serverSocket = undefined; this.listener = undefined; this.loggedIn = false;
    this.reconnectAttempts = 0;
  }
}

function toRow(username: string, freeUploadSlots: boolean, inQueue: number, uploadSpeed: number, file: SearchFile): SearchRow {
  const name = file.name; const idx = name.lastIndexOf("\\"); const folder = idx >= 0 ? name.slice(0, idx) : ""; const filename = idx >= 0 ? name.slice(idx + 1) : name;
  const dot = filename.lastIndexOf("."); const fileType = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return { user: username, folder, filename, path: name, size: file.size, fileType, slotFree: freeUploadSlots, speed: uploadSpeed, inQueue, quality: file.attrs.bitrate ?? 0, length: file.attrs.length ?? 0, private: file.private, attributes: file.attrs };
}
function buildItemRec(item: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.itemRecommendations, packString(item));
}
function buildItemSim(item: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.itemSimilarUsers, packString(item));
}
function inflateProbeToken(payload: Buffer): number | null {
  try {
    const buf: Buffer = inflateSync(payload);
    if (buf.length < 8) return null;
    const unameLen = buf.readUInt32LE(0);
    if (4 + unameLen + 4 > buf.length) return null;
    return buf.readUInt32LE(4 + unameLen);
  } catch { return null; }
}
function emptySharesResponse(): Buffer {
  const inner = Buffer.concat([packUint32(0), packUint32(0)]);
  const compressed = deflateSync(inner);
  return frameMessage(PEER_MESSAGE_CODES.sharedFileListResponse, compressed);
}
function emptyFolderResponse(token: number): Buffer {
  const inner = Buffer.concat([packUint32(token >>> 0), packString(""), packUint32(0)]);
  const compressed = deflateSync(inner);
  return frameMessage(PEER_MESSAGE_CODES.folderContentsResponse, compressed);
}
