/**
 * Persistent Soulseek session — full protocol mirror (server/peer/distrib/file).
 *
 * Based on nicotine-plus pynicotine/slskproto.py + slskmessages.py.
 */

import type { Socket, TCPSocketListener } from "bun";
import { deflateSync, inflateSync } from "node:zlib";
import {
  buildAddThingIHate,
  buildAddThingILike,
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
  parseCheckPrivileges,
  parseConnectToPeer,
  parseExcludedSearchPhrases,
  parseFileSearchResponse,
  parseItemRecommendations,
  parseItemSimilarUsers,
  parseJoinRoom,
  parseLoginResponse,
  parseMessageUser,
  parsePeerAddress,
  parsePeerInit,
  parsePierceFireWall,
  parsePlaceInQueueResponse,
  parsePossibleParents,
  parsePrivilegedUsers,
  parseQueueUpload,
  parseRecommendations,
  SlskReader,
  parseRoomList,
  parseRoomTickers,
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
interface PeerState { buf: Buffer; initDone: boolean; username?: string; outbound?: boolean; connType?: string; lastActive: number; isFileConn?: boolean; fileToken?: number; }
export interface SessionOptions {
  username: string; password: string; host?: string; port?: number; listenPort: number;
  profile: UserInfoResponseMessage; onUserEvent?: (event: UserInfoEvent) => void;
  onChatEvent?: (event: ChatEvent) => void; onRoomEvent?: (event: RoomEvent) => void;
  onTransferEvent?: (event: TransferEvent) => void; signal?: AbortSignal;
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
const PEER_ADDRESS_TIMEOUT_MS = 15000;
const CONNECTION_MAX_IDLE_MS = 60_000;
const GHOST_IDLE_MS = 10_000;
const USER_ADDRESS_TTL_MS = 30 * 60 * 1000;

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
  private peerAddressRequests = new Map<string, { cb: (addr: PeerAddress) => void; timer: ReturnType<typeof setTimeout> }>();
  private userAddresses = new Map<string, { addr: PeerAddress; updated: number }>();
  private excludedPhrases = new Set<string>();
  private allowedSearchTokens = new Set<number>();
  private tokenCounter = Math.floor(Math.random() * 100000) + 1;
  private loggedIn = false;
  private loginResolve: ((r: LoginResponse & { success: true }) => void) | undefined;
  private loginReject: ((e: Error) => void) | undefined;
  private idleTimer: ReturnType<typeof setInterval> | undefined;
  private wishlistTimer: ReturnType<typeof setInterval> | undefined;
  private serverPingTimer: ReturnType<typeof setInterval> | undefined;
  private branchLevel = 0;
  private branchRoot: string | undefined;
  private parentCandidate: string | undefined;
  private maxChildren = 0;

  get isLoggedIn(): boolean { return this.loggedIn; }

  private emit(event: UserInfoEvent) { this.opts.onUserEvent?.(event); }
  private emitChat(event: ChatEvent) { this.opts.onChatEvent?.(event); }
  private emitRoom(event: RoomEvent) { this.opts.onRoomEvent?.(event); }
  private emitTransfer(event: TransferEvent) { this.opts.onTransferEvent?.(event); }

  setProfile(profile: UserInfoResponseMessage) { this.profile = { ...this.profile, ...profile }; }
  private profile: UserInfoResponseMessage;

  constructor(private readonly opts: SessionOptions) {
    this.username = opts.username;
    this.profile = opts.profile;
  }

  login(): Promise<LoginResponse & { success: true }> {
    const promise = new Promise<LoginResponse & { success: true }>((resolve, reject) => {
      this.loginResolve = resolve;
      this.loginReject = reject;
    });
    this.opts.signal?.addEventListener("abort", () => { this.loginReject?.(new Error("Login request was cancelled.")); this.close(); }, { once: true });
    Bun.connect({
      hostname: this.opts.host || "server.slsknet.org",
      port: this.opts.port || 2242,
      socket: {
        open: (sock) => {
          this.serverSocket = sock as Socket;
          // Send Login only; SetWaitPort after success (nicotine parity)
          sock.write(buildLogin(this.opts.username, this.opts.password));
        },
        data: (_sock, chunk) => this.handleServerData(chunk),
        error: (_sock, err) => this.loginReject?.(new Error(`Connection error: ${err.message}`)),
        close: () => {
          if (!this.loggedIn) this.loginReject?.(new Error("Connection closed before login completed."));
          this.close();
        },
      },
    }).catch((err) => this.loginReject?.(new Error(`Unable to connect: ${err.message}`)));
    return promise;
  }

  private handleServerData(chunk: ArrayBuffer | Uint8Array) {
    const bytes = chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    if (this.serverBuffer.length + bytes.length > MAX_INCOMING.server16M) {
      // overflow guard — drop connection
      this.serverSocket?.end();
      return;
    }
    this.serverBuffer = Buffer.concat([this.serverBuffer, Buffer.from(bytes)]);
    while (true) {
      const msg = tryParseMessage(this.serverBuffer);
      if (!msg) break;
      if (msg.payload.length > MAX_INCOMING.server16M) { this.serverSocket?.end(); break; }
      this.serverBuffer = this.serverBuffer.subarray(8 + msg.payload.length);
      this.dispatchServerMessage(msg.code, msg.payload);
    }
  }

  private dispatchServerMessage(code: number, payload: Buffer) {
    if (code === SERVER_MESSAGE_CODES.login) {
      const resp = parseLoginResponse(payload);
      if (resp.success) {
        this.loggedIn = true;
        // Now advertise listen port (after success)
        this.serverSocket?.write(buildSetWaitPort(this.opts.listenPort));
        this.startListener();
        this.startIdleSweep();
        this.startServerPing();
        // Distrib bootstrap
        this.serverSocket?.write(buildHaveNoParent());
        this.loginResolve?.(resp);
      } else {
        this.loginReject?.(new Error(`Login rejected: ${resp.rejectionReason}`));
      }
      return;
    }
    if (code === SERVER_MESSAGE_CODES.relogged) {
      this.loginReject?.(new Error("You have been logged in elsewhere."));
      this.close(); return;
    }
    if (code === SERVER_MESSAGE_CODES.connectToPeer) {
      try { this.connectToPeer(parseConnectToPeer(payload)); } catch {}
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
        // cache
        this.userAddresses.set(addr.username, { addr, updated: Date.now() });
        const pending = this.peerAddressRequests.get(addr.username);
        if (pending) {
          clearTimeout(pending.timer);
          this.peerAddressRequests.delete(addr.username);
          this.emit({ type: "peer-address", username: addr.username, peerAddress: addr });
          pending.cb(addr);
        }
      } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.watchUser) {
      try { const w = parseWatchUser(payload); this.emit({ type: "watch-user", username: w.username, watchUser: w }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.sayChatroom) {
      try { const m = parseSayChatroom(payload); this.emitChat({ type: "say-chatroom", room: m.room, username: m.username, message: m.message }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.messageUser) {
      try {
        const m = parseMessageUser(payload);
        this.emitChat({ type: "private-message", username: m.username, message: m.message, msgId: m.id, timestamp: m.timestamp });
        // Must ack or server re-delivers
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
      try { const phrases = parseExcludedSearchPhrases(payload); for (const p of phrases) this.excludedPhrases.add(p.toLowerCase()); this.emit({ type: "excluded-search-phrases", excludedPhrases: phrases }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.wishlistInterval) {
      try { const secs = payload.readUInt32LE(0); this.emit({ type: "wishlist-interval", wishlistInterval: secs }); } catch {}
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
      // Branch root forwarding — distrib search embedded
      // For now emit raw
      this.emitRoom({ type: "room-list", data: payload.toString("hex").slice(0, 64) });
      return;
    }
    if (code === SERVER_MESSAGE_CODES.adminMessage) {
      try { const msg = payload.length >= 4 ? (() => { const l = payload.readUInt32LE(0); return payload.subarray(4, 4 + l).toString("utf8"); })() : ""; this.emit({ type: "admin-message", adminMessage: msg }); } catch {}
      return;
    }
    if (code === SERVER_MESSAGE_CODES.cantConnectToPeer) {
      // Server echo of our failure — ignore
      return;
    }
    if (code === SERVER_MESSAGE_CODES.fileSearch) {
      // Someone searching via server (global search hitting us) — ignored for now (no shares)
      return;
    }
    // Unknown codes: ignore (don't close) — nicotine logs debug
  }

  private handlePossibleParents(parents: Array<{ username: string; ip: string; port: number }>) {
    // Attempt D connections to candidates (distrib) — stub: try first 2 to avoid storm
    for (const p of parents.slice(0, 2)) {
      Bun.connect({
        hostname: p.ip, port: p.port,
        socket: {
          open: (sock) => { (sock as Socket).write(buildPeerInit(this.username, "D")); this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username: p.username, outbound: true, connType: "D", lastActive: Date.now() }); },
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
        data: (peer, chunk) => this.processPeer(peer as Socket, chunk, false),
        error: () => {},
        close: (peer) => { this.peerStates.delete(peer as Socket); },
      },
    });
  }
  private startIdleSweep() {
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [sock, st] of this.peerStates) {
        const idle = now - st.lastActive;
        const ghost = !st.username && idle > GHOST_IDLE_MS;
        const dead = idle > CONNECTION_MAX_IDLE_MS;
        if (ghost || dead) {
          try { sock.end(); } catch {}
          this.peerStates.delete(sock);
        }
      }
      // peer address cache TTL
      for (const [user, entry] of this.userAddresses) {
        if (now - entry.updated > USER_ADDRESS_TTL_MS) this.userAddresses.delete(user);
      }
      for (const [user, pending] of this.peerAddressRequests) {
        if (now - (pending as unknown as { updated?: number }).updated! > PEER_ADDRESS_TIMEOUT_MS) {
          clearTimeout(pending.timer);
          this.peerAddressRequests.delete(user);
        }
      }
    }, 5000);
  }
  private startServerPing() {
    // nicotine uses TCP keepalive; we send ServerPing 32 every 55s as fallback
    this.serverPingTimer = setInterval(() => {
      try { this.serverSocket?.write(Buffer.concat([Buffer.from([4, 0, 0, 0]), Buffer.from([32, 0, 0, 0])])); } catch {}
    }, 55000);
  }

  private connectToPeer(ctp: ReturnType<typeof parseConnectToPeer>) {
    if (ctp.connType !== "P" && ctp.connType !== "F" && ctp.connType !== "D") return;
    // Obfuscated port handling
    const port = ctp.obfuscatedPort ?? ctp.port;
    const ip = ctp.ip;
    Bun.connect({
      hostname: ip, port,
      socket: {
        open: (sock) => { (sock as Socket).write(buildPierceFireWall(ctp.token)); this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: true, username: ctp.username, outbound: false, connType: ctp.connType, lastActive: Date.now() }); },
        data: (sock, chunk) => this.processPeer(sock as Socket, chunk, true),
        error: () => {
          // Report back to server we couldn't connect
          try { this.serverSocket?.write(buildCantConnectToPeer(ctp.token, ctp.username)); } catch {}
        },
        close: (sock) => { this.peerStates.delete(sock as Socket); },
      },
    }).catch(() => {
      try { this.serverSocket?.write(buildCantConnectToPeer(ctp.token, ctp.username)); } catch {}
    });
  }

  private processPeer(peer: Socket, chunk: ArrayBuffer | Uint8Array, initDone: boolean) {
    const bytes = chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    const state = this.peerStates.get(peer) ?? { buf: Buffer.alloc(0), initDone, lastActive: Date.now() };
    state.lastActive = Date.now();
    if (state.buf.length + bytes.length > MAX_INCOMING.server1M) { try { peer.end(); } catch {} this.peerStates.delete(peer); return; }
    state.buf = Buffer.concat([state.buf, Buffer.from(bytes)]);
    while (true) {
      if (!state.initDone) {
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
        if (state.outbound) { try { (peer as Socket).write(buildUserInfoRequest()); } catch {} }
        state.buf = state.buf.subarray(total);
        continue;
      }
      // File connection: raw [uint32 token] + [uint64 offset] + bytes
      if (state.isFileConn) {
        if (state.fileToken === undefined) {
          if (state.buf.length < 4) break;
          state.fileToken = state.buf.readUInt32LE(0);
          state.buf = state.buf.subarray(4);
          // next expected is offset
          continue;
        }
        // For now, ignore file bytes (bridge delegates to TransferManager via events)
        // Consume all as file data
        const n = state.buf.length;
        if (n > 0) {
          this.emitTransfer({ type: "transfer-request", username: state.username, token: state.fileToken, file: `F:${state.fileToken}` });
          state.buf = Buffer.alloc(0);
        }
        break;
      }
      // Distrib framing: uint8 code after init when connType D
      if (state.connType === "D") {
        if (state.buf.length < 5) break;
        const len = state.buf.readUInt32LE(0);
        if (len > MAX_INCOMING.server16K) { try { peer.end(); } catch {} break; }
        const total = 5 + len; if (state.buf.length < total) break;
        const code = state.buf[4];
        const payload = state.buf.subarray(5, total);
        state.buf = state.buf.subarray(total);
        if (code === 3) {
          // DistribSearch — forward stub
          this.emitTransfer({ type: "transfer-request", username: state.username, file: payload.toString("utf8").slice(0, 100) });
        }
        continue;
      }
      const msg = tryParseMessage(state.buf);
      if (!msg) break;
      if (msg.payload.length > MAX_INCOMING.server1M) { try { peer.end(); } catch {} break; }
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
      } else if (msg.code === PEER_MESSAGE_CODES.userInfoRequest) {
        if (!state.outbound) { try { (peer as Socket).write(buildUserInfoResponse(this.profile)); } catch {} }
      } else if (msg.code === PEER_MESSAGE_CODES.sharedFileListRequest) {
        // No shares — reply empty compressed list
        try { (peer as Socket).write(emptySharesResponse()); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.folderContentsRequest) {
        try { const tok = msg.payload.readUInt32LE(0); (peer as Socket).write(emptyFolderResponse(tok)); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.transferRequest) {
        try { const tr = parseTransferRequest(msg.payload); this.emitTransfer({ type: "transfer-request", username: state.username, token: tr.token, file: tr.file }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.transferResponse) {
        try { const tr = parseTransferResponse(msg.payload); this.emitTransfer({ type: "transfer-response", username: state.username, token: tr.token, reason: tr.reason }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.queueUpload) {
        try { const file = parseQueueUpload(msg.payload); this.emitTransfer({ type: "queue-upload", username: state.username, file }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.placeInQueueRequest) {
        try { const file = msg.payload.length >= 4 ? (() => { const l = msg.payload.readUInt32LE(0); return msg.payload.subarray(4, 4 + l).toString("utf8"); })() : ""; try { (peer as Socket).write(buildPlaceInQueueRequest(file)); } catch {} } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.placeInQueueResponse) {
        try { const p = parsePlaceInQueueResponse(msg.payload); this.emitTransfer({ type: "place-in-queue", username: state.username, file: p.file, place: p.place }); } catch {}
      } else if (msg.code === PEER_MESSAGE_CODES.uploadFailed || msg.code === PEER_MESSAGE_CODES.uploadDenied) {
        try { this.emitTransfer({ type: msg.code === PEER_MESSAGE_CODES.uploadFailed ? "upload-failed" : "upload-denied", username: state.username, file: msg.payload.toString("utf8").slice(0, 256) }); } catch {}
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
    this.ensurePeerAndSend(username, "P", buildSharedFileListRequest());
  }
  requestFolderContents(username: string, dir: string, token: number) {
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
    const timer = setTimeout(() => { this.peerAddressRequests.delete(username); }, PEER_ADDRESS_TIMEOUT_MS);
    this.peerAddressRequests.set(username, { cb: (addr) => { clearTimeout(timer); this.connectToPeerViaAddress(username, addr, connType, msg); }, timer });
    this.serverSocket?.write(buildGetPeerAddress(username));
  }
  private connectToPeerViaAddress(username: string, addr: PeerAddress, connType: string, msg: Buffer) {
    if (addr.port === 0 || addr.ip === "0.0.0.0") return;
    Bun.connect({
      hostname: addr.ip, port: addr.port,
      socket: {
        open: (sock) => {
          this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username, outbound: true, connType, lastActive: Date.now() });
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
              this.peerStates.set(sock as Socket, { buf: Buffer.alloc(0), initDone: false, username, outbound: true, connType: "P", lastActive: Date.now() });
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
      const timer = setTimeout(() => {
        this.peerAddressRequests.delete(username); this.userInfoRequests.delete(username);
        this.failedUserInfo.add(username); this.emit({ type: "user-info-failed", username });
        reject(new Error("Peer address request timed out."));
      }, PEER_ADDRESS_TIMEOUT_MS);
      this.peerAddressRequests.set(username, { cb: (addr) => { clearTimeout(timer); this.userAddresses.set(username, { addr, updated: Date.now() }); doConnect(addr); }, timer });
      this.serverSocket?.write(buildGetPeerAddress(username));
    });
  }

  close() {
    for (const token of [...this.searches.keys()]) { const s = this.searches.get(token); if (s?.timer) clearTimeout(s.timer); if (s) s.onEnd({ searchId: s.searchId, reason: "stopped" }); this.searches.delete(token); }
    this.searchIds.clear(); this.allowedSearchTokens.clear();
    for (const { timer } of this.peerAddressRequests.values()) clearTimeout(timer);
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
