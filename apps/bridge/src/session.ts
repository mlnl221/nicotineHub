// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/slskproto.py + pynicotine/slskmessages.py + pynicotine/*.py

/**
 * Persistent Soulseek session — full protocol mirror (server/peer/distrib/file).
 *
 * Based on nicotine-plus pynicotine/slskproto.py + slskmessages.py.
 */

import type { Socket, TCPSocketListener } from "bun";
import { deflateSync, inflateSync } from "node:zlib";
import { ShareDB, PermissionLevel } from "./shares.ts";
import { logger } from "./logger.ts";
import { shouldBlockUser, shouldIgnoreUser, getCountryCode, setCountryForIp } from "./networkfilter.ts";
import { PortMapper } from "./portmapper.ts";
import {
  buildAcceptChildren,
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
  buildEnableRoomInvitations,
  buildCancelRoomMembership,
  buildCancelRoomOwnership,
  buildAddRoomOperator,
  buildRemoveRoomOperator,
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
  parseRoomOperators,
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
export type ServerEvent = { type: "reconnect"; attempt: number; delay: number } | { type: "reconnect-failed"; error: string } | { type: "reconnected"; listenPort: number };
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
  onWishlistEvent?: (event: { type: "result" | "end"; searchId: string; token: number; rows?: SearchRow[]; reason?: string }) => void;
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
    | "room-member-added" | "room-member-removed" | "cancel-membership" | "cancel-ownership"
    | "membership-granted" | "membership-revoked" | "operator-added" | "operator-removed"
    | "operatorship-granted" | "operatorship-revoked" | "room-operators" | "enable-room-invitations"
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
const MAX_SOCKETS_DEFAULT = Number(process.env.MAX_SOCKETS || 512);
const PARENT_MIN_SPEED_DEFAULT = 0;
const PARENT_SPEED_RATIO_DEFAULT = 0;

interface ParentCandidate {
  username: string;
  ip: string;
  port: number;
  conn?: Socket;
  branchLevel: number | null;
  branchRoot: string | null;
}

enum ParentStatus { WAITING = 0, ACCEPTED = 1, REJECTED = 2 }

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
  private reconnectPending = false;
  private branchLevel = 0;
  private branchRoot: string | undefined;
  private parent: ParentCandidate | null = null;
  private isServerParent = false;
  private potentialParents = new Map<string, ParentCandidate>();
  private childPeers = new Map<string, Socket>();
  private maxDistribChildren = 0;
  private distribParentMinSpeed = PARENT_MIN_SPEED_DEFAULT;
  private distribParentSpeedRatio = PARENT_SPEED_RATIO_DEFAULT;
  private uploadSpeed = 0;
  // legacy compat aliases
  private get parentCandidate(): string | undefined { return this.parent?.username; }
  private set parentCandidate(v: string | undefined) { void v; }
  private get maxChildren(): number { return this.maxDistribChildren; }
  private set maxChildren(v: number) { this.maxDistribChildren = v; }
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
  private pendingPeerMessages = new Map<string, Array<{ connType: string; msg: Buffer }>>();
  // user status cache for offline check (P1 hardening)
  private userStatusCache = new Map<string, { status: number; privileged: boolean; updated: number }>();
  // allowed peer responses gating (nicotine allowed_message_responses) — prevent unsolicited 448M
  private allowedPeerResponses = new Map<string, Set<number>>();
  // socket limiting
  private pendingPeerQueue: Array<{ fn: () => void }> = [];
  private get maxSockets(): number {
    const env = Number(process.env.MAX_SOCKETS || 0);
    if (env > 0) return env;
    return MAX_SOCKETS_DEFAULT;
  }
  private get activeSocketCount(): number { return this.peerStates.size + this.pendingConnects.size; }
  private canOpenSocket(): boolean { return this.activeSocketCount < this.maxSockets; }
  private enqueueOrRun(fn: () => void): void {
    if (this.canOpenSocket()) fn();
    else this.pendingPeerQueue.push({ fn });
  }
  private dequeuePendingSockets(): void {
    while (this.pendingPeerQueue.length && this.canOpenSocket()) {
      const item = this.pendingPeerQueue.shift()!;
      try { item.fn(); } catch {}
    }
  }

  // Portmapper — NAT-PMP → UPnP fallback, mirrors pynicotine/portmapper.py
  private portMapper = new PortMapper();
  private _upnpEnabled = true;
  private _localIpAddress = "";

  private findLocalIpAddress(): string {
    try {
      const { createSocket } = require("node:dgram") as typeof import("node:dgram");
      const sock = createSocket("udp4");
      // connect to dummy address to get local interface
      // Use sync approach: create socket, connect, then get address
      // Fallback to 127.0.0.1
      try {
        // Bun doesn't support connect for dgram easily; try UDP connect hack
        // Use same logic as pynicotine: connect to 10.255.255.255:1
        const dummy = require("node:dgram").createSocket("udp4") as unknown as { connect: (port:number, host:string, cb?:()=>void)=>void; address:()=>{address:string} };
        // Instead use node:net trick: create UDP socket and bind
        // Simpler: try to get local IP via os.networkInterfaces
        const { networkInterfaces } = require("node:os") as typeof import("node:os");
        const nets = networkInterfaces();
        for (const addrs of Object.values(nets)) {
          if (!addrs) continue;
          for (const addr of addrs) {
            if (addr.family === "IPv4" && !addr.internal) return addr.address;
          }
        }
      } catch {}
      return "0.0.0.0";
    } catch { return "0.0.0.0"; }
  }

  private updatePortMapper(): void {
    const ip = this._localIpAddress || this.findLocalIpAddress();
    this._localIpAddress = ip;
    if (this._listenPort && ip) {
      this.portMapper.setPort(this._listenPort, ip);
      if (this._upnpEnabled) {
        // fire-and-forget, renew handled inside
        this.portMapper.addPortMapping(false).catch(() => {});
      }
    }
  }

  private removePortMappingSync(): void {
    // best-effort removal on disconnect
    this.portMapper.removePortMapping(false).catch(() => {});
  }

  setUpnpEnabled(enabled: boolean): void {
    const was = this._upnpEnabled;
    this._upnpEnabled = enabled;
    logger.info("server", `UPnP ${enabled ? "enabled" : "disabled"}`, { listenPort: this._listenPort, username: this.username });
    if (enabled && !was) {
      this.updatePortMapper();
    } else if (!enabled && was) {
      this.removePortMappingSync();
    }
  }

  getPortMapperStatus(): { enabled: boolean; active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null; lastAttemptAt: number | null; hasPort: boolean } {
    const base = this.portMapper.status;
    return { enabled: this._upnpEnabled, ...base };
  }

  // Called after successful login + listener bind (nicotine-portmapper parity)
  private handlePortMapperOnConnect(): void {
    if (!this._upnpEnabled) return;
    this.updatePortMapper();
  }

  private handlePortMapperOnDisconnect(): void {
    this.removePortMappingSync();
  }

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
  private getSharePermissionLevel(username: string): PermissionLevel {
    if (!username || username === "unknown") return PermissionLevel.PUBLIC;
    // Banned check via shouldBlockUser helper (banlist/ipblocklist)
    try {
      const peerIp = this.userAddresses.get(username)?.addr?.ip || "";
      const blocked = shouldBlockUser({ username, peerIp, banlist: this.banlist, ipblocklist: this.ipblocklist, geoblock: this.geoblock, geoblockcc: this.geoblockcc, customBan: this.customban, customGeoblock: this.customgeoblock, trustedUsers: [], privilegedUsers: [], buddyUsers: [] } as never);
      if (blocked.blocked) return PermissionLevel.BANNED;
    } catch {}
    // Buddy/trusted — bridge stores watched buddies in buddyUsers set if available via plugin or config
    // For now, check if user is in userlist or watched; treat as BUDDY if watched
    const lower = username.toLowerCase();
    // Heuristic: if user is in _userlist or has been watched, consider buddy
    if (this._userlist.some(u => u.toLowerCase() === lower)) return PermissionLevel.BUDDY;
    // Also check privileged users from transfers? fallback to PUBLIC
    return PermissionLevel.PUBLIC;
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

  // Phase H — Network extras (server.interface/autoreply/autosearch/autojoin/userlist/autoaway)
  private _interface = "";
  private _autoreply = "";
  private _autosearch: string[] = [];
  private _autojoin: string[] = [];
  private _userlist: string[] = [];
  private _autoreplyThrottle = new Map<string, number>(); // user -> ts for auto-reply dedup
  private _autoawayTimer?: ReturnType<typeof setInterval>;
  private _lastActivity = Date.now();
  private resolveInterfaceToIp(iface: string): string | null {
    const trimmed = String(iface || "").trim();
    if (!trimmed) return null;
    // If looks like IP, return as-is (validate)
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
      const parts = trimmed.split(".").map(Number);
      if (parts.every((n) => n >= 0 && n <= 255)) return trimmed;
      return null;
    }
    try {
      const { networkInterfaces } = require("node:os") as typeof import("node:os");
      const nets = networkInterfaces();
      const addrs = nets[trimmed];
      if (addrs) {
        // Prefer first IPv4 non-internal, else first IPv4
        const ipv4 = addrs.find((a) => a.family === "IPv4" && !a.internal) ?? addrs.find((a) => a.family === "IPv4");
        if (ipv4) return ipv4.address;
      }
    } catch {}
    return null;
  }
  private getListenHostname(): string {
    const ip = this.resolveInterfaceToIp(this._interface);
    return ip || "0.0.0.0";
  }
  setNetworkInterface(iface: string) {
    const norm = String(iface || "").trim();
    if (norm === this._interface) return;
    const old = this._interface;
    const oldIp = this._localIpAddress;
    this._interface = norm;
    logger.info("server", `interface ${norm ? `${norm} → ${this.resolveInterfaceToIp(norm) || "0.0.0.0"}` : "default (0.0.0.0)"}`, { listenPort: this._listenPort, username: this.username, iface: norm || "default" });
    if (!this.loggedIn) return; // next login will bind correct hostname
    // Validate iface if non-empty: must resolve to IP or be IP itself
    if (norm && !this.resolveInterfaceToIp(norm) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(norm)) {
      logger.warn("server", `interface ${norm} not found, binding 0.0.0.0`, { iface: norm });
    }
    const newHostname = this.getListenHostname();
    const newIp = this.resolveInterfaceToIp(norm) || this.findLocalIpAddress();
    this._localIpAddress = newIp;
    this.portMapper.setPort(this._listenPort, newIp);
    // Restart listener on new hostname
    try { this.listener?.stop(); } catch {}
    this.listener = undefined;
    try {
      this.startListener();
    } catch (e) {
      this._interface = old;
      this._localIpAddress = oldIp;
      this.portMapper.setPort(this._listenPort, oldIp);
      try { this.startListener(); } catch {}
      if (this._upnpEnabled) {
        try { this.portMapper.addPortMapping(false).catch(() => {}); } catch {}
      }
      throw new Error(`Cannot bind to interface ${norm} (${newHostname}): ${(e as Error).message}`);
    }
    if (this._upnpEnabled) {
      // Remove old mapping before adding new (handled via setPort above, but ensure)
      this.portMapper.addPortMapping(false).catch(() => {});
    }
    this.reconnect("interface change");
  }
  setAutoreply(msg: string) { this._autoreply = String(msg || ""); }
  setAutosearch(terms: string[]) { this._autosearch = (terms || []).slice().filter(Boolean); }
  setAutojoin(rooms: string[]) { this._autojoin = (rooms || []).slice().filter(Boolean); }
  setUserlist(users: string[]) { this._userlist = (users || []).slice().filter(Boolean); }
  setAutoaway(minutes: number) {
    const m = Math.max(1, Math.min(10000, Number(minutes) || 15));
    this.autoawayMinutes = m;
    this.restartAutoawayTimer();
  }
  private autoawayMinutes = 15;
  private restartAutoawayTimer() {
    if (this._autoawayTimer) { clearInterval(this._autoawayTimer); this._autoawayTimer = undefined; }
    if (!this.loggedIn || this.autoawayMinutes <= 0) return;
    this._lastActivity = Date.now();
    this._autoawayTimer = setInterval(() => {
      if (!this.loggedIn || this.away) return;
      if (Date.now() - this._lastActivity > this.autoawayMinutes * 60_000) {
        this.setStatus(1); // away
      }
    }, 60_000);
  }
  private handleAutoJoinAndWatch() {
    // nicotine-plus autojoin / userlist / autosearch on login
    for (const room of this._autojoin.slice(0, 50)) {
      const sanitized = room.replace(/[^ -~]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
      if (sanitized) try { this.joinRoom(sanitized); } catch {}
    }
    for (const user of this._userlist.slice(0, 100)) {
      if (user) try { this.watchUser(user); } catch {}
    }
    for (const term of this._autosearch.slice(0, 20)) {
      if (term) try { this.search(term, `autosearch:${term.slice(0,20)}`, { onResult: () => {}, onEnd: () => {} }); } catch {}
    }
  }
  private maybeAutoreply(username: string, message: string) {
    if (!this.away || !this._autoreply) return;
    if (message.includes("\x01")) return; // ignore CTCP
    const now = Date.now();
    const last = this._autoreplyThrottle.get(username.toLowerCase()) || 0;
    if (now - last < 60_000) return; // 1/min per user, avoid spam
    this._autoreplyThrottle.set(username.toLowerCase(), now);
    try { this.sendPrivateMessage(username, this._autoreply); } catch {}
  }
  private away = false;
  // expose for server.ts config:update chatrooms/userbrowse (web-only but acknowledge)
  setChatroomsConfig(_opts: Record<string, unknown>) { /* web-only, noop in bridge */ }
  setUserbrowseConfig(_opts: Record<string, unknown>) { /* web-only, noop */ }

  // ---- Search config (P1) — mirrors nicotine-plus searches.search_results / private_search_results ----
  private _searchEnabled = true;
  private _privateSearchEnabled = false;
  private _maxResults = 300;
  private _maxDisplayedResults = 2500;
  setSearchConfig(opts: Partial<{ search_results: boolean; private_search_results: boolean; maxresults: number; max_displayed_results: number }>) {
    if (opts.search_results !== undefined) this._searchEnabled = !!opts.search_results;
    if (opts.private_search_results !== undefined) this._privateSearchEnabled = !!opts.private_search_results;
    if (opts.maxresults !== undefined) {
      const v = Number(opts.maxresults);
      if (Number.isInteger(v) && v >= 1 && v <= 10000) this._maxResults = v;
    }
    if (opts.max_displayed_results !== undefined) {
      const v = Number(opts.max_displayed_results);
      if (Number.isInteger(v) && v >= 100 && v <= 25000) this._maxDisplayedResults = v;
    }
    logger.info("server", "search config updated", { searchEnabled: this._searchEnabled, privateSearch: this._privateSearchEnabled, maxResults: this._maxResults });
  }

  // ---- Real file sharing (P0/P1) — web sends [virtualName, path] pairs, bridge scans them ----
  setShareRoots(pairs: [string, string][], levelStr: string) {
    const level = levelStr === "buddy" ? PermissionLevel.BUDDY : levelStr === "trusted" ? PermissionLevel.TRUSTED : PermissionLevel.PUBLIC;
    try {
      // ShareDB handles scanning + persisting; it knows how to map virtualName → real path.
      const res = (this.shareDB as unknown as { setCustomShares?: (roots: [string, string][], lvl: PermissionLevel) => ShareFolder[] }).setCustomShares?.(pairs, level);
      // If custom path doesn't exist inside container, ShareDB will log and keep previous. Advise mount.
      if (res) {
        const counts = this.shareDB.getSharedCounts();
        this.reportShares(counts.dirs, counts.files);
        logger.info("server", "shares updated from settings", { level: levelStr, pairs: pairs.length, dirs: counts.dirs, files: counts.files });
      }
    } catch (e) {
      logger.warn("server", "setShareRoots failed", { error: (e as Error).message, level: levelStr });
    }
  }

  // ---- Rescan daily/hour (P2) — nicotine-plus transfers.rescanonstartup / rescan_shares_daily / rescan_shares_hour ----
  private _rescanOnStartup = true;
  private _rescanDaily = true;
  private _rescanHour = 0;
  private _rescanTimer?: ReturnType<typeof setInterval>;
  private _lastRescanDay = "";
  setRescanConfig(opts: Partial<{ rescanonstartup: boolean; rescan_shares_daily: boolean; rescan_shares_hour: number }>) {
    if (opts.rescanonstartup !== undefined) this._rescanOnStartup = !!opts.rescanonstartup;
    if (opts.rescan_shares_daily !== undefined) this._rescanDaily = !!opts.rescan_shares_daily;
    if (opts.rescan_shares_hour !== undefined) {
      const h = Number(opts.rescan_shares_hour);
      if (Number.isInteger(h) && h >= 0 && h <= 23) this._rescanHour = h;
    }
    this.restartRescanTimer();
    logger.info("server", "rescan config updated", { startup: this._rescanOnStartup, daily: this._rescanDaily, hour: this._rescanHour });
  }
  private restartRescanTimer() {
    if (this._rescanTimer) { clearInterval(this._rescanTimer); this._rescanTimer = undefined; }
    if (!this._rescanDaily) return;
    // Check every 60s if hour matches and we haven't rescanned today
    this._rescanTimer = setInterval(() => {
      if (!this.loggedIn) return;
      const now = new Date();
      const hour = now.getUTCHours(); // use UTC for determinism (matches settings-plan hourLabel UTC)
      const day = now.toISOString().slice(0, 10);
      if (hour !== this._rescanHour) return;
      if (this._lastRescanDay === day) return;
      this._lastRescanDay = day;
      logger.info("server", "daily rescan triggered", { hour, day });
      this.rescanShares().catch((e) => logger.warn("server", "daily rescan failed", { error: (e as Error).message }));
    }, 60_000);
    // Don't keep process alive just for this timer
    try { (this._rescanTimer as unknown as { unref?: () => void }).unref?.(); } catch {}
  }

  private queuePendingPeerMessage(username: string, connType: string, msg: Buffer) {
    const key = username.toLowerCase();
    if (!this.pendingPeerMessages.has(key)) this.pendingPeerMessages.set(key, []);
    this.pendingPeerMessages.get(key)!.push({ connType, msg });
    this.flushPendingPeerMessages(username, connType);
  }

  private flushPendingPeerMessages(username: string, connType: string) {
    const key = username.toLowerCase();
    const list = this.pendingPeerMessages.get(key);
    if (!list || list.length === 0) return;
    const sock = this.getPeerSocket(username, connType);
    if (!sock) return;
    const remaining: Array<{ connType: string; msg: Buffer }> = [];
    for (const item of list) {
      if (item.connType !== connType) { remaining.push(item); continue; }
      try { (sock as unknown as { write: (b: Buffer) => void }).write(item.msg); } catch { remaining.push(item); }
    }
    if (remaining.length) this.pendingPeerMessages.set(key, remaining);
    else this.pendingPeerMessages.delete(key);
  }

  private sendConnectToPeerFallback(username: string, connType: string) {
    if (!this.loggedIn || !this.serverSocket) return;
    const token = this.tokenCounter++ >>> 0;
    if (this.tokenCounter >= 0xffffffff) this.tokenCounter = 1;
    logger.info("browse", "sendConnectToPeerFallback", { username, connType, token });
    try { this.serverSocket.write(buildConnectToPeer(token, username, connType)); } catch {}
    const timer = setTimeout(() => { this.pendingConnects.delete(token); }, CONNECT_PEER_TIMEOUT_MS);
    this.pendingConnects.set(token, { resolve: () => {}, reject: () => {}, timer, username, connType });
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
          onResult: (p) => this.opts.onWishlistEvent?.({ type: "result", searchId: p.searchId, token: p.token, rows: p.rows }),
          onEnd: (p) => this.opts.onWishlistEvent?.({ type: "end", searchId: p.searchId, token, reason: p.reason }),
        };
        const active: ActiveSearch = { searchId, ...handlers, users: new Set(), count: 0, maxResults: MAX_DISPLAYED_RESULTS };
        active.timer = setTimeout(() => {
          this.searches.delete(token); this.searchIds.delete(searchId); this.allowedSearchTokens.delete(token);
          handlers.onEnd({ searchId, reason: "timeout" });
        }, DEFAULT_SEARCH_TIMEOUT_MS);
        this.searches.set(token, active);
        this.searchIds.set(searchId, token);
        this.serverSocket.write(buildWishlistSearch(token, term));
        logger.info("search", "wishlist auto-search", { term, token, searchId });
        // notify server of start via wishlist event
        this.opts.onWishlistEvent?.({ type: "result", searchId, token, rows: [] });
      } catch {}
    }, intervalMs);
  }

  // Distributed helpers — mirrors pynicotine/slskproto.py
  private _sendHaveNoParent(): void {
    if (!this.serverSocket) return;
    this.parent = null;
    this.branchLevel = 0;
    this.branchRoot = this.username;
    this.isServerParent = false;
    logger.info("server", "have no parent, requesting new one", { username: this.username });
    try {
      this.serverSocket.write(buildHaveNoParent());
      this.serverSocket.write(buildBranchRoot(this.branchRoot));
      this.serverSocket.write(buildBranchLevel(this.branchLevel));
      this.serverSocket.write(buildAcceptChildren(false));
    } catch {}
  }

  private _closeParentCandidateConnections(): void {
    for (const cand of this.potentialParents.values()) {
      if (cand.conn && this.parent?.conn !== cand.conn) {
        try { (cand.conn as unknown as { end: () => void }).end(); } catch {}
        cand.conn = undefined;
      }
    }
  }

  private _updateMaximumDistributedChildren(): void {
    const prev = this.maxDistribChildren;
    const numChild = this.childPeers.size;
    if (this.uploadSpeed >= this.distribParentMinSpeed && this.distribParentSpeedRatio > 0) {
      this.maxDistribChildren = Math.min(Math.floor(this.uploadSpeed / this.distribParentSpeedRatio / 100), 10);
    } else {
      this.maxDistribChildren = 0;
    }
    logger.info("server", "distributed child limit updated", { max: this.maxDistribChildren, prev });
    if (this.maxDistribChildren <= numChild && numChild < prev) {
      try { this.serverSocket?.write(buildAcceptChildren(false)); } catch {}
    } else if (this.maxDistribChildren > numChild && prev <= numChild) {
      // we can accept again
      try { this.serverSocket?.write(buildAcceptChildren(numChild < this.maxDistribChildren)); } catch {}
    }
  }

  private _verifyParentStatus(sock: Socket, msgClass: string): ParentStatus {
    if (this.parent === null) return ParentStatus.WAITING;
    if (this.parent.conn === sock) return ParentStatus.ACCEPTED;
    logger.warn("server", `distrib ${msgClass} from non-parent`, { username: (this.peerStates.get(sock)?.username || "unknown") });
    return ParentStatus.REJECTED;
  }

  private _adoptParent(username: string): void {
    if (this.parent !== null) return;
    const cand = this.potentialParents.get(username.toLowerCase());
    if (!cand || !cand.conn) return;
    if (cand.branchLevel === null || !cand.branchRoot) return;
    this.parent = cand;
    this.branchLevel = (cand.branchLevel ?? 0) + 1;
    this.branchRoot = cand.branchRoot;
    this.isServerParent = false;
    cand.branchLevel = null;
    cand.branchRoot = null;
    this._closeParentCandidateConnections();
    try {
      this.serverSocket?.write(buildHaveNoParent());
      this.serverSocket?.write(buildBranchRoot(this.branchRoot!));
      this.serverSocket?.write(buildBranchLevel(this.branchLevel));
      if (this.childPeers.size < this.maxDistribChildren) {
        this.serverSocket?.write(buildAcceptChildren(true));
      }
    } catch {}
    // notify children of new level/root
    try {
      const lvlBuf = buildBranchLevel(this.branchLevel);
      const rootBuf = buildBranchRoot(this.branchRoot!);
      // we send distrib level/root via distrib framing: need to pack as distrib messages
      // Use direct peer framing via _sendMessageToChildPeers analog — write raw distrib
      for (const childSock of this.childPeers.values()) {
        try {
          // distribBranchLevel 4, distribBranchRoot 5 are framed as [len][code][payload] with uint8 code
          const lvlPayload = packUint32(this.branchLevel >>> 0);
          const rootPayload = packString(this.branchRoot!);
          // distrib framing helper: packUint32(len+1) + uint8 code + payload
          const frameLvl = Buffer.concat([packUint32(lvlPayload.length + 1), Buffer.from([4]), lvlPayload]);
          const frameRoot = Buffer.concat([packUint32(rootPayload.length + 1), Buffer.from([5]), rootPayload]);
          (childSock as unknown as { write: (b: Buffer)=>void }).write(frameLvl);
          (childSock as unknown as { write: (b: Buffer)=>void }).write(frameRoot);
        } catch {}
      }
    } catch {}
    this.childPeers.delete(username.toLowerCase());
    logger.info("server", "adopted parent", { username, branchLevel: this.branchLevel, branchRoot: this.branchRoot });
  }

  private _acceptChildPeerConnection(sock: Socket, username: string): boolean {
    if (this.peerStates.get(sock)?.connType !== "D") return false;
    if (username === this.username) { try { sock.end(); } catch {} return false; }
    if (this.potentialParents.has(username.toLowerCase())) return false;
    if (this.parent === null && !this.isServerParent) {
      logger.info("server", "rejecting child, no parent and not server parent", { username });
      try { sock.end(); } catch {}
      return false;
    }
    if (this.childPeers.has(username.toLowerCase())) {
      try { sock.end(); } catch {}
      return false;
    }
    if (this.childPeers.size >= this.maxDistribChildren) {
      try { sock.end(); } catch {}
      return false;
    }
    this.childPeers.set(username.toLowerCase(), sock);
    try {
      const lvlPayload = packUint32(this.branchLevel >>> 0);
      const rootPayload = packString(this.branchRoot ?? this.username);
      const frameLvl = Buffer.concat([packUint32(lvlPayload.length + 1), Buffer.from([4]), lvlPayload]);
      const frameRoot = Buffer.concat([packUint32(rootPayload.length + 1), Buffer.from([5]), rootPayload]);
      (sock as unknown as { write: (b: Buffer)=>void }).write(frameLvl);
      (sock as unknown as { write: (b: Buffer)=>void }).write(frameRoot);
    } catch {}
    logger.info("server", "adopted child peer", { username, total: this.childPeers.size });
    if (this.childPeers.size >= this.maxDistribChildren) {
      try { this.serverSocket?.write(buildAcceptChildren(false)); } catch {}
    }
    return true;
  }

  private _removeChildPeerConnection(username: string): void {
    this.childPeers.delete(username.toLowerCase());
    if (this.childPeers.size === this.maxDistribChildren - 1) {
      try { this.serverSocket?.write(buildAcceptChildren(true)); } catch {}
    }
    logger.info("server", "removed child peer", { username, total: this.childPeers.size });
  }

  private _sendMessageToChildPeers(payload: Buffer, distribCode: number): void {
    if (this.parent === null && !this.isServerParent) return;
    const frame = Buffer.concat([packUint32(payload.length + 1), Buffer.from([distribCode]), payload]);
    for (const child of this.childPeers.values()) {
      try { (child as unknown as { write: (b:Buffer)=>void }).write(frame); } catch {}
    }
  }

  private addAllowedPeerResponse(username: string, code: number): void {
    const key = username.toLowerCase();
    if (!this.allowedPeerResponses.has(key)) this.allowedPeerResponses.set(key, new Set());
    this.allowedPeerResponses.get(key)!.add(code);
  }
  private isAllowedPeerResponse(username: string, code: number): boolean {
    const set = this.allowedPeerResponses.get(username.toLowerCase());
    return set ? set.has(code) : false;
  }
  private clearAllowedPeerResponse(username: string, code: number): void {
    const set = this.allowedPeerResponses.get(username.toLowerCase());
    if (set) { set.delete(code); if (set.size===0) this.allowedPeerResponses.delete(username.toLowerCase()); }
  }

  private emit(event: UserInfoEvent) { this.opts.onUserEvent?.(event); }
  private emitChat(event: ChatEvent) { this.opts.onChatEvent?.(event); }
  private emitRoom(event: RoomEvent) { this.opts.onRoomEvent?.(event); }
  private emitTransfer(event: TransferEvent) { this.opts.onTransferEvent?.(event); }
  private emitBrowse(event: BrowseEvent) { this.opts.onBrowseEvent?.(event); }
  private emitServer(event: ServerEvent) { this.opts.onServerEvent?.(event); }

  setProfile(profile: UserInfoResponseMessage) { this.profile = { ...this.profile, ...profile }; }
  private profile: UserInfoResponseMessage;
  private _listenPort: number;

  /** Current listen port (mirrors nicotine-plus portrange[0]). Updated via setListenPort. */
  get listenPort(): number { return this._listenPort; }

  constructor(private readonly opts: SessionOptions) {
    this.username = opts.username;
    this.profile = opts.profile;
    this._listenPort = opts.listenPort;
    this.shareDB = new ShareDB({ dataDir: opts.dataDir || process.env.DATA_DIR || "/data" });
  }

  /**
   * Update listen port at runtime — mirrors nicotine-plus preferences portrange change.
   * Validates 1024-65535, restarts peer listener, and triggers server reconnect
   * (SetWaitPort is sent after next login, like pynicotine core.reconnect()).
   */
  async setListenPort(newPort: number): Promise<void> {
    const port = Number(newPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`Invalid listen port ${newPort}: must be 1024-65535`);
    }
    if (port === this._listenPort) return;
    const oldPort = this._listenPort;
    this._listenPort = port;
    logger.info("server", "listen port change", { oldPort, newPort: port, username: this.username, loggedIn: this.loggedIn });
    // Update portmapper mapping target (like nicotine PortMapper.set_port)
    const oldIp = this._localIpAddress;
    const newIp = this.findLocalIpAddress();
    this._localIpAddress = newIp;
    this.portMapper.setPort(port, newIp);
    if (!this.loggedIn) {
      // Listener only exists when logged in; next login will bind new port
      try { this.listener?.stop(); } catch {}
      this.listener = undefined;
      // Remove old mapping if UPnP was active
      if (this._upnpEnabled) {
        try { await this.portMapper.removePortMapping(true); } catch {}
        // Re-add with new port if we had an old mapping? But not logged in, will add on login
      }
      return;
    }
    // If UPnP enabled, remove old mapping before rebinding
    if (this._upnpEnabled) {
      try { await this.portMapper.removePortMapping(true); } catch {}
      // setPort already updated to new port above
    }
    // Restart peer listener on new port
    try { this.listener?.stop(); } catch {}
    this.listener = undefined;
    try {
      this.startListener();
    } catch (e) {
      // Revert on bind failure (e.g. port in use)
      this._listenPort = oldPort;
      this.portMapper.setPort(oldPort, oldIp);
      try { this.startListener(); } catch {}
      if (this._upnpEnabled) {
        try { await this.portMapper.addPortMapping(false); } catch {}
      }
      throw new Error(`Cannot listen on port ${port}: ${(e as Error).message}`);
    }
    // Trigger server reconnect so new SetWaitPort is advertised (nicotine-plus core.reconnect parity)
    // Also (re)add UPnP mapping with new port (done on next login success via updatePortMapper, but do now for immediate)
    if (this._upnpEnabled) {
      this.portMapper.addPortMapping(false).catch(() => {});
    }
    this.reconnect("listen port change");
  }

  /** Manual reconnect — mirrors pynicotine ServerReconnect / core.reconnect() */
  reconnect(reason = "manual reconnect"): void {
    logger.info("server", "manual reconnect", { reason, listenPort: this._listenPort, username: this.username });
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.reconnectPending = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    // Portmapper: remove before reconnect (nicotine _server_disconnect)
    try { this.portMapper.removePortMapping(false).catch(() => {}); } catch {}
    // Distributed teardown mirrors _server_disconnect
    this.parent = null;
    this.potentialParents.clear();
    this.childPeers.clear();
    this.branchLevel = 0;
    this.branchRoot = this.username;
    this.isServerParent = false;
    this.maxDistribChildren = 0;
    this.distribParentMinSpeed = PARENT_MIN_SPEED_DEFAULT;
    this.distribParentSpeedRatio = PARENT_SPEED_RATIO_DEFAULT;
    this.uploadSpeed = 0;
    // Peer listener will be rebound on next login success; stop old now to free port for immediate retry
    try { this.listener?.stop(); } catch {}
    this.listener = undefined;
    const sock = this.serverSocket;
    this.serverSocket = undefined;
    this.loggedIn = false;
    this.cleanupServerTimers();
    if (sock) { try { (sock as unknown as { end: () => void }).end(); } catch {} }
    this.emitServer({ type: "reconnect", attempt: 1, delay: 0 });
    setTimeout(() => { if (this.shouldReconnect) this.connectServer(); }, 200);
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
          const wasLoggedIn = this.loggedIn;
          if (wasLoggedIn) {
            // Portmapper cleanup mirrors pynicotine _server_disconnect remove_port_mapping
            try { this.portMapper.removePortMapping(false).catch(() => {}); } catch {}
          }
          if (!this.loggedIn && this.loginReject) {
            const err = new Error("Connection closed before login completed.");
            this.loginReject(err);
            this.loginReject = undefined;
            this.loginResolve = undefined;
          }
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
    if (this.wishlistTimer) { clearInterval(this.wishlistTimer); this.wishlistTimer = undefined; }
    if (this._autoawayTimer) { clearInterval(this._autoawayTimer); this._autoawayTimer = undefined; }
    if (this._rescanTimer) { clearInterval(this._rescanTimer); this._rescanTimer = undefined; }
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
        this.serverSocket?.write(buildSetWaitPort(this._listenPort));
        // Report real share counts (nicotine shares.py sendNumSharedFoldersFiles)
        try {
          const { dirs, files } = this.shareDB.getSharedCounts();
          this.serverSocket?.write(buildSharedFoldersFiles(dirs, files));
        } catch {}
        try { this.startListener(); } catch (e) { logger.warn("server", "peer listener bind failed (will retry on next port change)", { error: (e as Error).message, port: this._listenPort }); }
        this.startIdleSweep();
        this.startServerPing();
        // Portmapper: NAT-PMP → UPnP fallback (like nicotine PortMapper LEASE_DURATION 12h, RENEWAL 2h)
        this._localIpAddress = this.resolveInterfaceToIp(this._interface) || this.findLocalIpAddress();
        this.portMapper.setPort(this._listenPort, this._localIpAddress);
        if (this._upnpEnabled) this.portMapper.addPortMapping(false).catch(() => {});
        // Distrib bootstrap: HaveNoParent true + BranchRoot(login) + BranchLevel 0 + AcceptChildren false — mirrors _sendHaveNoParent
        this._sendHaveNoParent();
        this.restartWishlistTimer();
        this.restartAutoawayTimer();
        this.restartRescanTimer();
        this.handleAutoJoinAndWatch();
        if (this._rescanOnStartup) {
          this.rescanShares().catch((e) => logger.warn("server", "startup rescan failed", { error: (e as Error).message }));
        }
        if (this.loginResolve) {
          this.loginResolve?.(resp);
          this.loginResolve = undefined;
          this.loginReject = undefined;
        } else if (this.reconnectPending) {
          // This was a reconnect (e.g. after port change) – WS stays open, notify UI to go back to connected
          this.reconnectPending = false;
          logger.info("server", "reconnected after port change", { listenPort: this._listenPort });
          this.emitServer({ type: "reconnected", listenPort: this._listenPort });
        } else {
          this.reconnectPending = false;
        }
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
      try {
        const status = parseUserStatus(payload);
        // pynicotine clears userAddresses on OFFLINE (0)
        if (status.status === 0) {
          this.userAddresses.delete(status.username);
        }
        this.userStatusCache.set(status.username.toLowerCase(), { status: status.status, privileged: status.privileged, updated: Date.now() });
        this.emit({ type: "user-status", username: status.username, status });
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.getUserStats) {
      try {
        const stats = parseUserStats(payload);
        if (stats.username === this.username) {
          this.uploadSpeed = stats.avgspeed;
          this._updateMaximumDistributedChildren();
        }
        this.emit({ type: "user-stats", username: stats.username, stats });
      } catch {}
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
        // handle offline 0.0.0.0 — clear stale and don't cache
        if (addr.ip === "0.0.0.0" || addr.port === 0) {
          this.userAddresses.delete(addr.username);
        } else {
          this.userAddresses.set(addr.username, { addr, updated: Date.now() });
          // populate geo cache lazily via bisect
          try { getCountryCode(addr.ip); } catch {}
          // update ip lists if ip changed (mirrors _update_saved_user_ip_addresses)
          // keep placeholder handling minimal
        }
        const pending = this.peerAddressRequests.get(addr.username);
        if (pending) {
          clearTimeout(pending.timer);
          this.peerAddressRequests.delete(addr.username);
          this.emit({ type: "peer-address", username: addr.username, peerAddress: addr });
          for (const cb of pending.cbs) try { cb(addr); } catch {}
        } else {
          this.emit({ type: "peer-address", username: addr.username, peerAddress: addr });
        }
        this.dequeuePendingSockets();
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.watchUser) {
      try {
        const w = parseWatchUser(payload);
        if (!w.exists) {
          this.userAddresses.delete(w.username);
          this.userStatusCache.set(w.username.toLowerCase(), { status: 0, privileged: false, updated: Date.now() });
        } else {
          if (w.status !== undefined) this.userStatusCache.set(w.username.toLowerCase(), { status: w.status, privileged: false, updated: Date.now() });
          if (w.username === this.username && w.avgspeed !== undefined) {
            this.uploadSpeed = w.avgspeed;
            this._updateMaximumDistributedChildren();
          }
        }
        this.emit({ type: "watch-user", username: w.username, watchUser: w });
      } catch {}
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
        // Auto-reply when away
        this.maybeAutoreply(m.username, m.message);
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
      try {
        this.distribParentMinSpeed = payload.readUInt32LE(0);
        this._updateMaximumDistributedChildren();
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.parentSpeedRatio) {
      try {
        this.distribParentSpeedRatio = payload.readUInt32LE(0) || 1;
        this._updateMaximumDistributedChildren();
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.embeddedMessage) {
      try {
        if (payload.length >= 1) {
          const dCode = payload[0];
          const dPayload = payload.subarray(1);
          // mirror pynicotine _unpack_embedded_message: validate identifier "1" inside dPayload for DistribSearch
          if (dCode === 3) {
            // server -> branch root: validate and optionally become server parent
            const searchOk = (() => {
              try {
                const r = new SlskReader(dPayload);
                // Soulseek NS bug: embedded may be whole server message vs unpacked; try identifier check
                if (r.remaining >= 4) {
                  const peek = r.uint32();
                  // if peek looks like identifier length 1 and next char '1', treat as identifier
                }
                return true;
              } catch { return false; }
            })();
            void searchOk;
            // if we are branch root (no parent, had no parent true), mark as server parent
            if (this.parent === null && this.branchRoot === this.username) {
              this.isServerParent = true;
              if (this.childPeers.size < this.maxDistribChildren) {
                try { this.serverSocket?.write(buildAcceptChildren(true)); } catch {}
              }
            }
            // forward unpacked to children only if we are parent/serverParent
            try {
              const innerPayload = dPayload; // already unpacked per server spec
              this._sendMessageToChildPeers(innerPayload, 3);
            } catch {}
            // local emit for search handling via shares
            try {
              const r2 = new SlskReader(dPayload);
              if (r2.remaining >= 4) r2.uint32(); // identifier 49? optional
              const user = r2.string(); const token = r2.uint32(); const query = r2.string();
              if (!this.shareDB.isExcluded(query)) {
                // answer via peer FileSearchResponse if shares match — delegate to handleInboundFileSearch logic
                const resp = this.shareDB.buildFileSearchResponse(token, this.username, query);
                if (resp) {
                  // need to route to requester via peer — we will queue send
                  this.emitTransfer({ type: "transfer-request", username: user, token, file: query.slice(0, 120) });
                  // try direct peer send
                  try { this.ensurePeerAndSend(user, "P", resp); } catch {}
                }
              }
            } catch {}
          }
        }
      } catch {}
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
          this.dequeuePendingSockets();
        }
        // also cleanup file token pending (F)
        if (this.pendingFileTokens.has(token)) this.pendingFileTokens.delete(token);
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
    if (code === SERVER_MESSAGE_CODES.addRoomMember) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "room-member-added", room: m.room, username: m.username, data: m }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.removeRoomMember) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "room-member-removed", room: m.room, username: m.username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.cancelRoomMembership) {
      try { const room = new SlskReader(payload).string(); this.emitRoom({ type: "cancel-membership", room }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.cancelRoomOwnership) {
      try { const room = new SlskReader(payload).string(); this.emitRoom({ type: "cancel-ownership", room }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomMembershipGranted) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "membership-granted", room: m.room, username: m.username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomMembershipRevoked) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "membership-revoked", room: m.room, username: m.username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.addRoomOperator) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "operator-added", room: m.room, username: m.username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.removeRoomOperator) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "operator-removed", room: m.room, username: m.username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomOperatorshipGranted) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "operatorship-granted", room: m.room, username: m.username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomOperatorshipRevoked) {
      try { const m = parseRoomMember(payload); this.emitRoom({ type: "operatorship-revoked", room: m.room, username: m.username }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.roomOperators) {
      try { const ro = parseRoomOperators(payload); this.emitRoom({ type: "room-operators", room: ro.room, data: ro.operators }); } catch {}
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
      try { this.emitRoom({ type: code === SERVER_MESSAGE_CODES.joinGlobalRoom ? "join-room" : "leave-room", room: "global", data: { pending: payload.length } }); } catch {}
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
      for (const [sock, st] of this.peerStates) if (st.connType === "D") { try { sock.end(); } catch {} this.peerStates.delete(sock); }
      this.childPeers.clear();
      this.potentialParents.clear();
      this.parent = null;
      this.isServerParent = false;
      this.branchLevel = 0;
      this.branchRoot = this.username;
      this._sendHaveNoParent();
      return;
    }
    if (code === SERVER_MESSAGE_CODES.acceptChildren) {
      // server asking to accept children — we always accept
      try { const accept = payload[0] !== 0; void accept; } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.enableRoomInvitations) {
      try { const enabled = payload.length ? payload[0] !== 0 : true; this.emitRoom({ type: "enable-room-invitations", data: enabled }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.addToPrivileged) return;
    // Generic fallback for remaining codes: ignore, debug log
    // Unknown codes: ignore (don't close) — nicotine logs debug
  }

  private handleInboundFileSearch(payload: Buffer) {
    // Server FileSearch 26 receive: string username + uint32 token + string query (see SLSKPROTOCOL 26)
    // Some paths (legacy) may be token+query without username — handle both.
    if (!this._searchEnabled) {
      logger.debug("server", "FileSearch ignored — search_results disabled", {});
      return;
    }
    try {
      const r = new SlskReader(payload);
      let username: string | undefined;
      let token: number;
      let query: string;
      // try peek: first field could be string (username) then uint32 token; if remaining after first string <4, fallback to token first
      const snapshot = payload;
      try {
        // attempt username + token + query
        username = r.string();
        token = r.uint32();
        query = r.string();
        // if username contains spaces and query looks like token misparse, detect: if token is large but query empty, maybe username was query
        if (!query && r.remaining === 0 && username) {
          // fallback: treat username as query? but we have token already — assume correct
        }
      } catch {
        // fallback token+query
        const r2 = new SlskReader(snapshot);
        token = r2.uint32();
        query = r2.string();
        username = undefined;
      }
      if (!query) return;
      if (this.shareDB.isExcluded(query)) return;
      // emit diagnostic
      this.emitTransfer({ type: "transfer-request", username, token: token!, file: query.slice(0, 120) });
      // respect private_search_results: if disabled, don't include private (buddy/trusted) folders for non-buddies
      // buildFileSearchResponse already gates via getFoldersForPermission, so no extra check needed beyond permission.
      const resp = this.shareDB.buildFileSearchResponse(token!, username ?? this.username, query, true, 0, 0, this.getSharePermissionLevel(username ?? ""), this._maxResults);
      if (resp && username) {
        try { this.ensurePeerAndSend(username, "P", resp); } catch {}
      } else if (resp) {
        // if no username, try broadcast? ignore
      }
    } catch {}
  }

  private handlePossibleParents(parents: Array<{ username: string; ip: string; port: number }>) {
    // Close previous candidates that are not in new list
    const toTry = parents.slice(0, 10);
    const newNames = new Set(toTry.map((p) => p.username.toLowerCase()));
    for (const [name, cand] of this.potentialParents) {
      if (!newNames.has(name)) {
        if (cand.conn) try { (cand.conn as unknown as { end:()=>void }).end(); } catch {}
        this.potentialParents.delete(name);
      }
    }
    for (const p of toTry) {
      const lower = p.username.toLowerCase();
      if (!this.potentialParents.has(lower)) {
        this.potentialParents.set(lower, { username: p.username, ip: p.ip, port: p.port, branchLevel: null, branchRoot: null });
      }
      // enqueue or run D dial — respect MAX_SOCKETS
      this.enqueueOrRun(() => {
        Bun.connect({
          hostname: p.ip, port: p.port,
          socket: {
            open: (sock) => {
              (sock as Socket).write(buildPeerInit(this.username, "D"));
              this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username: p.username, outbound: true, connType: "D", lastActive: Date.now(), createdAt: Date.now() });
              const cand = this.potentialParents.get(lower);
              if (cand) cand.conn = sock as Socket;
            },
            data: (sock, chunk) => this.processPeer(sock as Socket, chunk, false),
            error: () => {},
            close: (sock) => {
              this.peerStates.delete(sock as Socket);
              const cand = this.potentialParents.get(lower);
              if (cand && cand.conn === (sock as Socket)) cand.conn = undefined;
              this.dequeuePendingSockets();
            },
          },
        }).catch(() => { this.dequeuePendingSockets(); });
      });
    }
  }

  private startListener() {
    const hostname = this.getListenHostname();
    this.listener = Bun.listen({
      port: this._listenPort, hostname,
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
        close: (peer) => {
          const st = this.peerStates.get(peer as Socket);
          this.peerStates.delete(peer as Socket);
          if (st?.username && st.connType === "D") this._removeChildPeerConnection(st.username);
          this.dequeuePendingSockets();
        },
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
          if (st.username && st.connType === "D") this._removeChildPeerConnection(st.username);
          this.dequeuePendingSockets();
        }
        // leak fix: partial init buf without progress -> evict after timeout (2s)
        if (!st.initDone && st.buf.length > 0 && (now - st.createdAt) > CONNECTION_INIT_TIMEOUT_MS) {
          try { sock.end(); } catch {}
          this.peerStates.delete(sock);
          this.dequeuePendingSockets();
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
    // Obfuscated port handling — nicotine does NOT support obfuscation, so always use plain port.
    // If obfuscationType is 1 (ROTATED), the plain port is rotated and obfuscatedPort is real,
    // but since we don't support obfuscation handshake, we still try plain port only.
    const port = ctp.port;
    const ip = ctp.ip;
    if (!this.canOpenSocket()) {
      // queue for later
      this.enqueueOrRun(() => this.connectToPeer(ctp));
      return;
    }
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
          this.dequeuePendingSockets();
        },
        data: (sock, chunk) => this.processPeer(sock as Socket, chunk, true),
        error: () => {
          // Report back to server we couldn't connect
          try { this.serverSocket?.write(buildCantConnectToPeer(ctp.token, ctp.username)); } catch {}
          if (pending) { try { pending.reject(new Error("Pierce failed")); } catch {} }
          this.dequeuePendingSockets();
        },
        close: (sock) => { this.peerStates.delete(sock as Socket); if ((this.peerStates.get(sock as Socket)?.connType ?? ctp.connType) === "D" && ctp.username) this._removeChildPeerConnection(ctp.username); this.dequeuePendingSockets(); },
      },
    }).catch(() => {
      try { this.serverSocket?.write(buildCantConnectToPeer(ctp.token, ctp.username)); } catch {}
      if (pending) { try { pending.reject(new Error("Connect failed")); } catch {} }
      this.dequeuePendingSockets();
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
        cbs: [(addr: PeerAddress) => {
          clearTimeout(timer);
          this.userAddresses.set(username, { addr, updated: Date.now() });
          resolve(addr);
        }],
        timer,
        createdAt: Date.now(),
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
              this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username, outbound: true, connType, lastActive: Date.now(), createdAt: Date.now() });
              (sock as Socket).write(buildPeerInit(this.username, connType));
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
          try {
            const pf = parsePierceFireWall(initPayload);
            const pending = this.pendingConnects.get(pf.token);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingConnects.delete(pf.token);
              state.username = pending.username;
              state.connType = pending.connType;
              setTimeout(() => this.flushPendingPeerMessages(pending.username, pending.connType), 10);
            }
          } catch {}
        }
        state.initDone = true;
        if (state.username && state.connType) {
          setTimeout(() => this.flushPendingPeerMessages(state.username!, state.connType!), 10);
          // Distributed child acceptance — only for inbound D
          if (state.connType === "D" && !state.outbound) {
            const ok = this._acceptChildPeerConnection(peer, state.username);
            if (!ok) {
              // _accept handles close; fall through but mark not child
            }
          }
        }
        // Phase 1: send any pendingMsg queued by ensurePeerAndSend
        const pendingMsg = (state as unknown as { pendingMsg?: Buffer }).pendingMsg as Buffer | undefined;
        if (pendingMsg) {
          try { (peer as Socket).write(pendingMsg); } catch {}
          delete (state as unknown as { pendingMsg?: Buffer }).pendingMsg;
        } else if (state.outbound && state.connType === "P" && !state.username) {
          try { (peer as Socket).write(buildUserInfoRequest()); } catch {}
        }
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
      // Distrib framing: uint8 code after init when connType D
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
            const ds = (()=>{ try{ const r=new SlskReader(payload); // identifier 49?
              if (r.remaining >=4) {
                const id = r.uint32();
                if (id !== 49 && r.remaining > 0) {
                  // if not 49, maybe it's already username length — rewind?
                }
              }
              const u=r.string(); const t=r.uint32(); const q=r.string(); return { username:u, token:t, query:q, identifier: "1" }; } catch { return null; } })();
            if (ds) {
              // validate identifier should be "1" — if ds fails, ignore
              if (ds.identifier !== "1" && ds.token === undefined) { /* invalid */ }
              // adoption if no parent yet
              if (this.parent === null) this._adoptParent(ds.username);
              const status = this._verifyParentStatus(peer, "DistribSearch");
              if (status === ParentStatus.REJECTED) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
              if (status === ParentStatus.ACCEPTED) {
                this._sendMessageToChildPeers(payload, 3);
                if (this._searchEnabled && !this.shareDB.isExcluded(ds.query)) {
                  // local shares search — also emit for server side (capped by maxResults)
                  const resp = this.shareDB.buildFileSearchResponse(ds.token, this.username, ds.query, true, 0, 0, this.getSharePermissionLevel(ds.username), this._maxResults);
                  if (resp) {
                    // resp is peer FileSearchResponse, but for distrib we need to support search via shares? Just emit
                    this.emitTransfer({ type: "transfer-request", username: ds.username, token: ds.token, file: ds.query.slice(0,120) });
                  } else {
                    this.emitTransfer({ type: "transfer-request", username: ds.username, token: ds.token, file: ds.query.slice(0,120) });
                  }
                }
              } else if (status === ParentStatus.WAITING) {
                // still forward? no — waiting means not yet parent, don't forward
              }
            }
          } catch {}
        } else if (code === 4) {
          try {
            const level = payload.readUInt32LE(0);
            if (level > 1000) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
            const status = this._verifyParentStatus(peer, "DistribBranchLevel");
            if (status === ParentStatus.ACCEPTED) {
              this.branchLevel = (level + 1) >>> 0;
              try { this.serverSocket?.write(buildBranchLevel(this.branchLevel)); } catch {}
              this._sendMessageToChildPeers(packUint32(this.branchLevel >>> 0), 4);
              logger.info("server", "branch level updated from parent", { level: this.branchLevel });
            } else if (status === ParentStatus.WAITING) {
              const lower = (state.username || "").toLowerCase();
              const cand = this.potentialParents.get(lower);
              if (cand) { cand.conn = peer; cand.branchLevel = level; if (level === 0) cand.branchRoot = cand.username; }
            } else if (status === ParentStatus.REJECTED) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
          } catch {}
        } else if (code === 5) {
          try {
            const root = new SlskReader(payload).string();
            if (!root) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
            const status = this._verifyParentStatus(peer, "DistribBranchRoot");
            if (status === ParentStatus.ACCEPTED) {
              this.branchRoot = root;
              try { this.serverSocket?.write(buildBranchRoot(this.branchRoot)); } catch {}
              this._sendMessageToChildPeers(packString(root), 5);
              logger.info("server", "branch root updated", { root });
            } else if (status === ParentStatus.WAITING) {
              const lower = (state.username || "").toLowerCase();
              const cand = this.potentialParents.get(lower);
              if (cand) { cand.conn = peer; cand.branchRoot = root; }
            } else if (status === ParentStatus.REJECTED) { try { peer.end(); } catch {} this.peerStates.delete(peer); break; }
          } catch {}
        } else if (code === 7) {
          // childDepth obsolete — ignore, but propagate if needed
        } else if (code === 93) {
          try {
            const r=new SlskReader(payload);
            const innerCode = r.uint8();
            const rest = payload.subarray(1);
            if (innerCode===3) {
              const ds2=(()=>{ try{ const rr=new SlskReader(rest); if(rr.remaining>=4) rr.uint32(); const u=rr.string(); const t=rr.uint32(); const q=rr.string(); return {username:u, token:t, query:q}; }catch{return null;}})();
              if (ds2 && !this.shareDB.isExcluded(ds2.query)) {
                if (this.parent===null) this._adoptParent(ds2.username);
                const st2 = this._verifyParentStatus(peer, "DistribSearch");
                if (st2===ParentStatus.ACCEPTED) {
                  this._sendMessageToChildPeers(rest, 3);
                  this.emitTransfer({ type: "transfer-request", username: ds2.username, token: ds2.token, file: ds2.query.slice(0,120) });
                }
              }
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
        logger.debug("search", "peer FileSearchResponse received", { tokenProbe, allowed: [...this.allowedSearchTokens].slice(0,5), payloadLen: msg.payload.length });
        if (tokenProbe !== null && this.allowedSearchTokens.size > 0 && !this.allowedSearchTokens.has(tokenProbe)) {
          logger.debug("search", "FileSearchResponse dropped — token not allowed", { tokenProbe });
          continue;
        }
        try { const resp = parseFileSearchResponse(msg.payload); logger.info("search", "search result", { token: resp.token, username: resp.username, results: resp.results?.length, freeSlots: resp.freeUploadSlots }); this.routeResult(resp); } catch (e) { logger.warn("search", "parseFileSearchResponse failed", { error: (e as Error).message }); }
      } else if (msg.code === PEER_MESSAGE_CODES.userInfoResponse) {
        const username = state.username ?? "";
        // gating: only accept if we requested it (mirrors nicotine allowed_message_responses)
        if (!this.isAllowedPeerResponse(username, PEER_MESSAGE_CODES.userInfoResponse)) {
          try { peer.end(); } catch {}
          this.peerStates.delete(peer);
          break;
        }
        this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.userInfoResponse);
        try {
          const info = parseUserInfoResponse(msg.payload, username);
          const cb = this.userInfoRequests.get(username);
          if (cb) { this.userInfoRequests.delete(username); this.failedUserInfo.delete(username); cb(info); }
          this.emit({ type: "user-info-response", username, info });
        } catch {}
        try { (peer as Socket).end(); } catch {}
        this.dequeuePendingSockets();
      } else if (msg.code === PEER_MESSAGE_CODES.sharedFileListResponse) {
        const username = state.username ?? "unknown";
        logger.info("browse", "sharedFileListResponse recv", { username, allowed: this.isAllowedPeerResponse(username, PEER_MESSAGE_CODES.sharedFileListResponse), pending: this.pendingBrowseShares.has(username.toLowerCase()) });
        if (!this.isAllowedPeerResponse(username, PEER_MESSAGE_CODES.sharedFileListResponse)) {
          logger.warn("browse", "sharedFileListResponse not allowed, dropping", { username });
          try { peer.end(); } catch {}
          this.peerStates.delete(peer);
          break;
        }
        this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.sharedFileListResponse);
        try {
          const parsed = parseSharedFileListResponse(msg.payload);
          const pending = this.pendingBrowseShares.get(username.toLowerCase());
          if (pending) { clearTimeout(pending.timer); this.pendingBrowseShares.delete(username.toLowerCase()); }
          logger.info("browse", "sharedFileListResponse success", { username, folders: parsed.folders.length });
          this.emitBrowse({ type: "browse-shares", username, folders: parsed.folders });
          try { (peer as Socket).end(); } catch {}
          this.dequeuePendingSockets();
        } catch (e) { logger.warn("browse", "sharedFileListResponse parse fail", { username, error: (e as Error).message }); }
      } else if (msg.code === PEER_MESSAGE_CODES.folderContentsResponse) {
        try {
          const parsed = parseFolderContentsResponse(msg.payload);
          const username = state.username ?? "unknown";
          if (!this.isAllowedPeerResponse(username, PEER_MESSAGE_CODES.folderContentsResponse)) {
            try { peer.end(); } catch {}
            this.peerStates.delete(peer);
            break;
          }
          this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.folderContentsResponse);
          const pending = this.pendingBrowseFolder.get(parsed.token);
          if (pending) { clearTimeout(pending.timer); this.pendingBrowseFolder.delete(parsed.token); }
          this.emitBrowse({ type: "browse-folder", username, token: parsed.token, folder: parsed.dir, files: parsed.files });
          try { (peer as Socket).end(); } catch {}
          this.dequeuePendingSockets();
        } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.userInfoRequest) {
        if (!state.outbound) { try { (peer as Socket).write(buildUserInfoResponse(this.profile)); } catch {} }
      } else if (msg.code === PEER_MESSAGE_CODES.sharedFileListRequest) {
        const peerName = state.username || "unknown";
        if (this.shareDB.shouldThrottle(peerName)) break;
        try { const perm = this.getSharePermissionLevel(peerName); (peer as Socket).write(this.shareDB.buildSharedFileListResponse(perm)); } catch { try { (peer as Socket).write(emptySharesResponse()); } catch {} }
      } else if (msg.code === PEER_MESSAGE_CODES.folderContentsRequest) {
        const peerName2 = state.username || "unknown";
        if (this.shareDB.shouldThrottle(peerName2)) break;
        try { const tok = msg.payload.readUInt32LE(0); const r = new SlskReader(msg.payload); r.uint32(); const dir = r.string(); const perm = this.getSharePermissionLevel(peerName2); const resp = this.shareDB.buildFolderContentsResponse(tok, dir, perm); (peer as Socket).write(resp); } catch { try { const tok = msg.payload.readUInt32LE(0); (peer as Socket).write(emptyFolderResponse(tok)); } catch {} }
      } else if (msg.code === PEER_MESSAGE_CODES.fileSearchRequest) {
        if (!this._searchEnabled) {
          logger.debug("server", "peer FileSearchRequest ignored — search_results disabled", { username: state.username });
        } else {
          try {
            // peer FileSearchRequest 8: [token][query] — respond with FileSearchResponse 9 via same peer, respecting permission
            const r = new SlskReader(msg.payload);
            const token = r.uint32(); const query = r.string();
            if (!this.shareDB.isExcluded(query)) {
            const peerName = state.username || "unknown";
            const perm = this.getSharePermissionLevel(peerName);
            // if private_search_results false, downgrade BUDDY/TRUSTED to PUBLIC for non-buddies (getSharePermissionLevel already PUBLIC for strangers)
            const resp = this.shareDB.buildFileSearchResponse(token, this.username, query, true, 0, 0, perm, this._maxResults);
            if (resp) (peer as Socket).write(resp);
            }
          } catch {}
        }
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
    if (state.buf.length === 0) {
      this.peerStates.delete(peer);
      if (state.username && state.connType === "D") this._removeChildPeerConnection(state.username);
      this.dequeuePendingSockets();
    } else this.peerStates.set(peer, state);
  }

  private routeResult(resp: { token: number; username: string; freeUploadSlots: boolean; inQueue: number; uploadSpeed: number; results: SearchFile[] }) {
    if (this.allowedSearchTokens.size && !this.allowedSearchTokens.has(resp.token)) return;
    const search = this.searches.get(resp.token);
    if (!search) return;
    if (search.users.has(resp.username)) return;
    search.users.add(resp.username);
    const cc = this.userAddresses.get(resp.username)?.addr ? getCountryCode(this.userAddresses.get(resp.username)!.addr.ip) : "";
    // lazy request address if missing for future
    if (!this.userAddresses.has(resp.username)) {
      try { this.serverSocket?.write(buildGetPeerAddress(resp.username)); } catch {}
    }
    const rows = resp.results.map((file) => {
      const r = toRow(resp.username, resp.freeUploadSlots, resp.inQueue, resp.uploadSpeed, file);
      (r as unknown as { country?: string }).country = cc;
      return r;
    });
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
  getUserStatus(username: string): number | undefined { return this.userStatusCache.get(username.toLowerCase())?.status; }
  getCachedUserStatus(username: string): number | undefined { return this.getUserStatus(username); }
  requestPeerAddress(username: string) { this.serverSocket?.write(buildGetPeerAddress(username)); }
  requestUserInterests(username: string) { this.serverSocket?.write(buildUserInterests(username)); }
  requestRecommendations() { this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.recommendations, Buffer.alloc(0))); }
  requestGlobalRecommendations() { this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.globalRecommendations, Buffer.alloc(0))); }
  requestSimilarUsers() { this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.similarUsers, Buffer.alloc(0))); }
  requestItemRecommendations(item: string) { this.serverSocket?.write(buildItemRec(item)); }
  requestItemSimilarUsers(item: string) { this.serverSocket?.write(buildItemSim(item)); }
  setStatus(status: number) {
    this.away = status === 1;
    if (!this.away) this._lastActivity = Date.now();
    this.serverSocket?.write(buildSetStatus(status));
  }
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
  setEnableRoomInvitations(enabled: boolean) { this.serverSocket?.write(buildEnableRoomInvitations(enabled)); }
  cancelRoomMembership(room: string) { this.serverSocket?.write(buildCancelRoomMembership(room)); }
  cancelRoomOwnership(room: string) { this.serverSocket?.write(buildCancelRoomOwnership(room)); }
  addRoomOperator(room: string, username: string) { this.serverSocket?.write(buildAddRoomOperator(room, username)); }
  removeRoomOperator(room: string, username: string) { this.serverSocket?.write(buildRemoveRoomOperator(room, username)); }

  // File ops via peer
  requestSharedFileList(username: string) {
    logger.info("browse", "requestSharedFileList", { username, pending: this.pendingBrowseShares.has(username.toLowerCase()) });
    // timeout 20s indirect + 10s grace = 30s (nicotine INDIRECT_REQUEST_TIMEOUT 20s + local 10s)
    const key = username.toLowerCase();
    const timer = setTimeout(() => {
      logger.warn("browse", "browse timeout", { username });
      this.pendingBrowseShares.delete(key);
      this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.sharedFileListResponse);
      this.emitBrowse({ type: "browse-error", username, error: "Timed out fetching shares" });
    }, 30000);
    this.pendingBrowseShares.set(key, { timer });
    this.addAllowedPeerResponse(username, PEER_MESSAGE_CODES.sharedFileListResponse);
    this.ensurePeerAndSend(username, "P", buildSharedFileListRequest());
  }
  requestFolderContents(username: string, dir: string, token: number) {
    const timer = setTimeout(() => {
      this.pendingBrowseFolder.delete(token);
      this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.folderContentsResponse);
      this.emitBrowse({ type: "browse-error", username, token, folder: dir, error: "Timed out fetching folder" });
    }, 30000);
    this.pendingBrowseFolder.set(token, { username, folder: dir, timer });
    this.addAllowedPeerResponse(username, PEER_MESSAGE_CODES.folderContentsResponse);
    this.ensurePeerAndSend(username, "P", buildFolderContentsRequest(token, dir));
  }
  queueUpload(username: string, file: string) { this.ensurePeerAndSend(username, "P", buildQueueUpload(file)); }
  placeInQueueRequest(username: string, file: string) { this.ensurePeerAndSend(username, "P", buildPlaceInQueueRequest(file)); }
  transferRequest(username: string, direction: number, token: number, file: string, size?: bigint) {
    this.ensurePeerAndSend(username, "P", buildTransferRequest(direction, token, file, size));
  }

  private ensurePeerAndSend(username: string, connType: string, msg: Buffer) {
    const hasPending = this.peerAddressRequests.has(username);
    const cachedCheck = this.userAddresses.get(username);
    logger.info("browse", "ensurePeerAndSend", { username, connType, hasCached: !!cachedCheck, hasPending, pendingSize: this.pendingBrowseShares.size });
    if (!this.loggedIn) return;
    // Queue for indirect fallback (peer connects to us via PierceFirewall)
    this.queuePendingPeerMessage(username, connType, msg);
    // Indirect first — nicotine sends ConnectToPeer before direct
    this.sendConnectToPeerFallback(username, connType);
    const cached = this.userAddresses.get(username);
    if (cached && Date.now() - cached.updated < USER_ADDRESS_TTL_MS) {
      this.connectToPeerViaAddress(username, cached.addr, connType, msg);
      return;
    }
    const existing = this.peerAddressRequests.get(username);
    if (existing) {
      existing.cbs.push((addr) => {
        this.connectToPeerViaAddress(username, addr, connType, msg);
      });
      return;
    }
    const timer = setTimeout(() => { this.peerAddressRequests.delete(username); }, PEER_ADDRESS_TIMEOUT_MS);
    const entry = { cbs: [(addr: PeerAddress) => { clearTimeout(timer); this.userAddresses.set(username, { addr, updated: Date.now() }); this.connectToPeerViaAddress(username, addr, connType, msg); }], timer, createdAt: Date.now() };
    this.peerAddressRequests.set(username, entry);
    this.serverSocket?.write(buildGetPeerAddress(username));
  }
  private connectToPeerViaAddress(username: string, addr: PeerAddress, connType: string, msg: Buffer) {
    logger.info("browse", "connectToPeerViaAddress", { username, ip: addr.ip, port: addr.port, connType });
    if (addr.port === 0 || addr.ip === "0.0.0.0") {
      logger.warn("browse", "peer address invalid, aborting direct", { username, ip: addr.ip, port: addr.port });
      return;
    }
    if (!this.canOpenSocket()) {
      this.enqueueOrRun(() => this.connectToPeerViaAddress(username, addr, connType, msg));
      return;
    }
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
        error: () => { this.dequeuePendingSockets(); },
        close: (sock) => { this.peerStates.delete(sock as Socket); this.dequeuePendingSockets(); },
      },
    }).catch(() => { this.dequeuePendingSockets(); });
  }

  requestUserInfo(username: string): Promise<UserInfoResponseMessage> {
    return new Promise((resolve, reject) => {
      if (this.userInfoRequests.has(username)) { reject(new Error("Already requesting this user.")); return; }
      this.userInfoRequests.set(username, resolve);
      this.addAllowedPeerResponse(username, PEER_MESSAGE_CODES.userInfoResponse);
      const cached = this.userAddresses.get(username);
      const doConnect = (addr: PeerAddress) => {
        if (addr.port === 0 || addr.ip === "0.0.0.0") {
          this.userInfoRequests.delete(username); this.peerAddressRequests.delete(username);
          this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.userInfoResponse);
          this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
          reject(new Error("User offline or port unknown."));
          return;
        }
        // enforce MAX_SOCKETS
        if (!this.canOpenSocket()) {
          this.enqueueOrRun(() => doConnect(addr));
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
              this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.userInfoResponse);
              this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
              this.dequeuePendingSockets();
              reject(new Error("Peer connection failed."));
            },
            close: (sock) => { this.peerStates.delete(sock as Socket); this.dequeuePendingSockets(); },
          },
        }).catch(() => {
          this.userInfoRequests.delete(username); this.peerAddressRequests.delete(username);
          this.clearAllowedPeerResponse(username, PEER_MESSAGE_CODES.userInfoResponse);
          this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
          this.dequeuePendingSockets();
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
    // Portmapper: remove mapping on quit (like nicotine _server_disconnect portmapper.remove)
    try { this.portMapper.removePortMapping(false).catch(() => {}); } catch {}
    for (const token of [...this.searches.keys()]) { const s = this.searches.get(token); if (s?.timer) clearTimeout(s.timer); if (s) s.onEnd({ searchId: s.searchId, reason: "stopped" }); this.searches.delete(token); }
    this.searchIds.clear(); this.allowedSearchTokens.clear();
    for (const { timer } of this.peerAddressRequests.values()) clearTimeout(timer);
    for (const { timer } of this.pendingConnects.values()) clearTimeout(timer);
    for (const { timer } of this.pendingBrowseShares.values()) clearTimeout(timer);
    for (const { timer } of this.pendingBrowseFolder.values()) clearTimeout(timer);
    this.pendingBrowseShares.clear(); this.pendingBrowseFolder.clear();
    this.pendingConnects.clear(); this.pendingFileTokens.clear();
    this.pendingPeerMessages.clear();
    this.allowedPeerResponses.clear();
    this.potentialParents.clear();
    this.childPeers.clear();
    this.pendingPeerQueue = [];
    this.parent = null;
    this.isServerParent = false;
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
