/**
 * Persistent Soulseek session.
 *
 * Mirrors nicotine-plus: authenticate over the server TCP connection, advertise
 * a real listen port via SetWaitPort, keep the connection open, and accept
 * inbound peer connections to receive FileSearchResponse (peer code 9) results.
 *
 * Real peers deliver results by connecting back to our listen port. The very
 * first bytes on such a connection are a PeerInit (init code 1, uint8 framing);
 * after that, peer messages use the normal uint32 framing. If a direct
 * connection is impossible the server relays a ConnectToPeer (18) and we
 * connect out, answering with PierceFireWall (init code 0).
 */
import type { Socket, TCPSocketListener } from "bun";
import {
  buildAddThingIHate,
  buildAddThingILike,
  buildFileSearch,
  buildGetPeerAddress,
  buildGetUserStats,
  buildGivePrivileges,
  buildLogin,
  buildPeerInit,
  buildPierceFireWall,
  buildRemoveThingIHate,
  buildRemoveThingILike,
  buildSetStatus,
  buildSetWaitPort,
  buildSharedFoldersFiles,
  buildUnwatchUser,
  buildUserInfoRequest,
  buildUserInfoResponse,
  buildUserInterests,
  buildWatchUser,
  frameMessage,
  packString,
  parseConnectToPeer,
  parseFileSearchResponse,
  parseLoginResponse,
  parseItemRecommendations,
  parseItemSimilarUsers,
  parsePeerAddress,
  parsePeerInit,
  parsePierceFireWall,
  parseRecommendations,
  parseSimilarUsers,
  parseUserInterests,
  parseUserStats,
  parseUserInfoResponse,
  parseUserStatus,
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
  user: string;
  folder: string;
  filename: string;
  path: string;
  size: number;
  fileType: string;
  slotFree: boolean;
  speed: number;
  inQueue: number;
  /** bitrate kbps (0 if lossless/unknown) */
  quality: number;
  /** duration seconds (0 if unknown) */
  length: number;
  private: boolean;
  attributes: {
    bitrate?: number;
    length?: number;
    vbr?: number;
    sampleRate?: number;
    bitDepth?: number;
  };
}

export interface SearchResultPayload {
  searchId: string;
  token: number;
  rows: SearchRow[];
}

export interface SearchEndPayload {
  searchId: string;
  reason: "max_results" | "stopped" | "timeout" | "error";
}

export interface SearchHandlers {
  onResult: (p: SearchResultPayload) => void;
  onEnd: (p: SearchEndPayload) => void;
  timeoutMs?: number;
}

interface ActiveSearch extends SearchHandlers {
  searchId: string;
  timer?: ReturnType<typeof setTimeout>;
  users: Set<string>;
  count: number;
  maxResults: number;
}

interface PeerState {
  buf: Buffer;
  initDone: boolean;
  username?: string;
  outbound?: boolean;
}

export interface SessionOptions {
  username: string;
  password: string;
  host?: string;
  port?: number;
  listenPort: number;
  profile: UserInfoResponseMessage;
  onUserEvent?: (event: UserInfoEvent) => void;
  signal?: AbortSignal;
}

export interface UserInfoEvent {
  type:
    | "user-status"
    | "user-stats"
    | "user-interests"
    | "recommendations"
    | "global-recommendations"
    | "similar-users"
    | "item-recommendations"
    | "item-similar-users"
    | "peer-address"
    | "user-info-response"
    | "user-info-failed";
  username?: string;
  status?: UserStatusMessage;
  stats?: UserStatsMessage;
  interests?: UserInterestsMessage;
  recommendations?: Recommendation[];
  similarUsers?: SimilarUser[];
  peerAddress?: PeerAddress;
  info?: UserInfoResponseMessage;
}

const MAX_DISPLAYED_RESULTS = 2500;
const DEFAULT_SEARCH_TIMEOUT_MS = 20_000;

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
  private peerAddressRequests = new Map<string, (addr: PeerAddress) => void>();
  private tokenCounter = 1;
  private loggedIn = false;
  private loginResolve: ((r: LoginResponse & { success: true }) => void) | undefined;
  private loginReject: ((e: Error) => void) | undefined;

  private emit(event: UserInfoEvent) {
    this.opts.onUserEvent?.(event);
  }

  /** Update the profile we serve when peers browse us. */
  setProfile(profile: UserInfoResponseMessage) {
    this.profile = { ...this.profile, ...profile };
  }

  private profile: UserInfoResponseMessage;

  constructor(private readonly opts: SessionOptions) {
    this.username = opts.username;
    this.profile = opts.profile;
  }

  /** Connect, log in, and start the peer listener. Resolves on success. */
  login(): Promise<LoginResponse & { success: true }> {
    const promise = new Promise<LoginResponse & { success: true }>((resolve, reject) => {
      this.loginResolve = resolve;
      this.loginReject = reject;
    });

    this.opts.signal?.addEventListener(
      "abort",
      () => {
        this.loginReject?.(new Error("Login request was cancelled."));
        this.close();
      },
      { once: true },
    );

    Bun.connect({
      hostname: this.opts.host || "server.slsknet.org",
      port: this.opts.port || 2242,
      socket: {
        open: (sock) => {
          this.serverSocket = sock as Socket;
          sock.write(buildLogin(this.opts.username, this.opts.password));
          sock.write(buildSetWaitPort(this.opts.listenPort));
        },
        data: (_sock, chunk) => this.handleServerData(chunk),
        error: (_sock, err) => this.loginReject?.(new Error(`Connection error: ${err.message}`)),
        close: () => {
          if (!this.loggedIn) {
            this.loginReject?.(new Error("Connection closed before login completed."));
          }
          this.close();
        },
      },
    }).catch((err) => this.loginReject?.(new Error(`Unable to connect: ${err.message}`)));

    return promise;
  }

  private handleServerData(chunk: ArrayBuffer | Uint8Array) {
    const bytes = chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    this.serverBuffer = Buffer.concat([this.serverBuffer, Buffer.from(bytes)]);

    while (true) {
      const msg = tryParseMessage(this.serverBuffer);
      if (!msg) break;
      this.serverBuffer = this.serverBuffer.subarray(8 + msg.payload.length);

      if (msg.code === SERVER_MESSAGE_CODES.login) {
        const resp = parseLoginResponse(msg.payload);
        if (resp.success) {
          this.loggedIn = true;
          this.startListener();
          this.loginResolve?.(resp);
        } else {
          this.loginReject?.(new Error(`Login rejected: ${resp.rejectionReason}`));
        }
      } else if (msg.code === 41) {
        // Relogged: another client logged in with this username.
        this.loginReject?.(new Error("You have been logged in elsewhere."));
        this.close();
      } else if (msg.code === 18) {
        // ConnectToPeer relay — a peer couldn't reach us directly.
        try {
          this.connectToPeer(parseConnectToPeer(msg.payload));
        } catch {
          /* ignore malformed */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.getUserStatus) {
        try {
          const status = parseUserStatus(msg.payload);
          this.emit({ type: "user-status", username: status.username, status });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.getUserStats) {
        try {
          const stats = parseUserStats(msg.payload);
          this.emit({ type: "user-stats", username: stats.username, stats });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.userInterests) {
        try {
          const interests = parseUserInterests(msg.payload);
          this.emit({ type: "user-interests", username: interests.username, interests });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.recommendations) {
        try {
          this.emit({
            type: "recommendations",
            recommendations: parseRecommendations(msg.payload).recommendations,
          });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.globalRecommendations) {
        try {
          this.emit({ type: "global-recommendations", recommendations: parseRecommendations(msg.payload).recommendations });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.similarUsers) {
        try {
          this.emit({ type: "similar-users", similarUsers: parseSimilarUsers(msg.payload) });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.itemRecommendations) {
        try {
          this.emit({
            type: "item-recommendations",
            recommendations: parseItemRecommendations(msg.payload).recommendations,
          });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.itemSimilarUsers) {
        try {
          this.emit({
            type: "item-similar-users",
            similarUsers: parseItemSimilarUsers(msg.payload).users,
          });
        } catch {
          /* ignore */
        }
      } else if (msg.code === SERVER_MESSAGE_CODES.getPeerAddress) {
        try {
          const addr = parsePeerAddress(msg.payload);
          const cb = this.peerAddressRequests.get(addr.username);
          if (cb) {
            this.peerAddressRequests.delete(addr.username);
            this.emit({ type: "peer-address", username: addr.username, peerAddress: addr });
            cb(addr);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  private startListener() {
    this.listener = Bun.listen({
      port: this.opts.listenPort,
      hostname: "0.0.0.0",
      socket: {
        open: () => {},
        data: (peer, chunk) => this.processPeer(peer as Socket, chunk, false),
        error: () => {},
        close: (peer) => {
          this.peerStates.delete(peer as Socket);
        },
      },
    });
  }

  /** Connect out to a peer (ConnectToPeer relay) and answer with PierceFireWall. */
  private connectToPeer(ctp: ReturnType<typeof parseConnectToPeer>) {
    if (ctp.connType !== "P" && ctp.connType !== "F" && ctp.connType !== "D") return;
    Bun.connect({
      hostname: ctp.ip,
      port: ctp.port,
      socket: {
        open: (sock) => {
          (sock as Socket).write(buildPierceFireWall(ctp.token));
        },
        data: (sock, chunk) => this.processPeer(sock as Socket, chunk, true),
        error: () => {},
        close: (sock) => {
          this.peerStates.delete(sock as Socket);
        },
      },
    }).catch(() => {});
  }

  /**
   * Parse one peer connection's stream. `initDone` starts false for inbound
   * connections (peer sends PeerInit first) and true for outbound connections
   * (we already sent PierceFireWall; peer replies with peer messages).
   */
  private processPeer(peer: Socket, chunk: ArrayBuffer | Uint8Array, initDone: boolean) {
    const bytes = chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    const state = this.peerStates.get(peer) ?? { buf: Buffer.alloc(0), initDone };
    state.buf = Buffer.concat([state.buf, Buffer.from(bytes)]);

    while (true) {
      if (!state.initDone) {
        if (state.buf.length < 5) break; // need length(4) + init code(1)
        const len = state.buf.readUInt32LE(0);
        const total = 5 + len;
        if (state.buf.length < total) break;
        const code = state.buf[4];
        const initPayload = state.buf.subarray(5, total);
        if (code === 1) {
          // PeerInit — carries the peer's username (we are the connected-to peer).
          try {
            state.username = parsePeerInit(initPayload).targetUser;
          } catch {
            /* ignore */
          }
        } else if (code === 0) {
          parsePierceFireWall(initPayload); // PierceFireWall (token) — rare inbound
        }
        state.initDone = true;
        if (state.outbound) {
          // We initiated this connection: ask the peer for its user info.
          (peer as Socket).write(buildUserInfoRequest());
        }
        state.buf = state.buf.subarray(total);
        continue;
      }

      const msg = tryParseMessage(state.buf);
      if (!msg) break;
      state.buf = state.buf.subarray(8 + msg.payload.length);

      if (msg.code === 9) {
        // FileSearchResponse (zlib compressed).
        try {
          const resp = parseFileSearchResponse(msg.payload);
          this.routeResult(resp);
        } catch {
          // Malformed response; ignore.
        }
      } else if (msg.code === PEER_MESSAGE_CODES.userInfoResponse) {
        // UserInfoResponse from a peer we asked.
        const username = state.username ?? "";
        try {
          const info = parseUserInfoResponse(msg.payload, username);
          const cb = this.userInfoRequests.get(username);
          if (cb) {
            this.userInfoRequests.delete(username);
            this.failedUserInfo.delete(username);
            cb(info);
          }
          this.emit({ type: "user-info-response", username, info });
        } catch {
          /* ignore */
        }
        (peer as Socket).end();
        } else if (msg.code === PEER_MESSAGE_CODES.userInfoRequest) {
          // A peer is browsing us — reply with our own profile.
          if (!state.outbound) {
            (peer as Socket).write(buildUserInfoResponse(this.profile));
          }
        }
    }

    if (state.buf.length === 0) this.peerStates.delete(peer);
    else this.peerStates.set(peer, state);
  }

  private routeResult(resp: {
    token: number;
    username: string;
    freeUploadSlots: boolean;
    inQueue: number;
    uploadSpeed: number;
    results: SearchFile[];
  }) {
    const search = this.searches.get(resp.token);
    if (!search) return;

    // Each user contributes at most one response set per search.
    if (search.users.has(resp.username)) return;
    search.users.add(resp.username);

    const rows = resp.results.map((file) =>
      toRow(resp.username, resp.freeUploadSlots, resp.inQueue, resp.uploadSpeed, file),
    );

    const remaining = search.maxResults - search.count;
    if (remaining <= 0) return;

    const batch = rows.slice(0, remaining);
    search.count += batch.length;
    search.onResult({ searchId: search.searchId, token: resp.token, rows: batch });

    if (search.count >= search.maxResults) {
      if (search.timer) clearTimeout(search.timer);
      this.searches.delete(resp.token);
      this.searchIds.delete(search.searchId);
      search.onEnd({ searchId: search.searchId, reason: "max_results" });
    }
  }

  /** Send a FileSearch and stream results to the supplied handlers. Returns the token. */
  search(query: string, searchId: string, handlers: SearchHandlers): number {
    if (!this.serverSocket) {
      handlers.onEnd({ searchId, reason: "error" });
      return 0;
    }

    const token = this.tokenCounter++;
    const search: ActiveSearch = {
      searchId,
      ...handlers,
      timeoutMs: handlers.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
      users: new Set(),
      count: 0,
      maxResults: MAX_DISPLAYED_RESULTS,
    };
    search.timer = setTimeout(() => {
      this.searches.delete(token);
      this.searchIds.delete(searchId);
      handlers.onEnd({ searchId, reason: "timeout" });
    }, search.timeoutMs);

    this.searches.set(token, search);
    this.searchIds.set(searchId, token);
    this.serverSocket.write(buildFileSearch(token, query));
    return token;
  }

  /** Stop a search early (e.g. user cancelled or navigated away). */
  cancelSearch(searchId: string) {
    const token = this.searchIds.get(searchId);
    if (token === undefined) return;
    const search = this.searches.get(token);
    if (search?.timer) clearTimeout(search.timer);
    this.searches.delete(token);
    this.searchIds.delete(searchId);
    search?.onEnd({ searchId, reason: "stopped" });
  }

  /** Begin/refresh watching a user's online status and stats. */
  watchUser(username: string) {
    this.serverSocket?.write(buildWatchUser(username));
    this.serverSocket?.write(buildGetUserStats(username));
  }

  /** Stop watching a user. */
  unwatchUser(username: string) {
    this.serverSocket?.write(buildUnwatchUser(username));
  }

  /** Request a user's likes/dislikes. */
  requestUserInterests(username: string) {
    this.serverSocket?.write(buildUserInterests(username));
  }

  /** Request personalized recommendations for the logged-in user. */
  requestRecommendations() {
    this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.recommendations, packString(this.username)));
  }

  /** Request global (everyone) recommendations. */
  requestGlobalRecommendations() {
    this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.globalRecommendations, packString(this.username)));
  }

  /** Request users similar to the logged-in user. */
  requestSimilarUsers() {
    this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.similarUsers, packString(this.username)));
  }

  /** Request recommendations for a specific item (artist/song). */
  requestItemRecommendations(item: string) {
    this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.itemRecommendations, packString(item)));
  }

  /** Request users interested in a specific item. */
  requestItemSimilarUsers(item: string) {
    this.serverSocket?.write(frameMessage(SERVER_MESSAGE_CODES.itemSimilarUsers, packString(item)));
  }

  /** Set our own online status (1=away, 2=online). */
  setStatus(status: number) {
    this.serverSocket?.write(buildSetStatus(status));
  }

  /** Report our shared folder/file counts to the server. */
  reportShares(folders: number, files: number) {
    this.serverSocket?.write(buildSharedFoldersFiles(folders, files));
  }

  /** Add a liked thing (interest). */
  addThingILike(thing: string) {
    this.serverSocket?.write(buildAddThingILike(thing));
  }

  /** Remove a liked thing. */
  removeThingILike(thing: string) {
    this.serverSocket?.write(buildRemoveThingILike(thing));
  }

  /** Add a hated thing. */
  addThingIHate(thing: string) {
    this.serverSocket?.write(buildAddThingIHate(thing));
  }

  /** Remove a hated thing. */
  removeThingIHate(thing: string) {
    this.serverSocket?.write(buildRemoveThingIHate(thing));
  }

  /** Grant upload privileges (days) to another user. */
  givePrivileges(username: string, days: number) {
    this.serverSocket?.write(buildGivePrivileges(username, days));
  }

  /**
   * Fetch another user's profile over a direct peer connection.
   * Resolves with UserInfoResponseMessage, or rejects if the peer is
   * unreachable / doesn't respond. Marks the request as failed so the
   * web layer can show a "user info failed" state.
   */
  requestUserInfo(
    username: string,
  ): Promise<UserInfoResponseMessage> {
    return new Promise((resolve, reject) => {
      if (this.userInfoRequests.has(username)) {
        reject(new Error("Already requesting this user."));
        return;
      }
      this.userInfoRequests.set(username, resolve);
      this.peerAddressRequests.set(username, (addr) => {
        Bun.connect({
          hostname: addr.ip,
          port: addr.port,
          socket: {
            open: (sock) => {
              this.peerStates.set(sock as Socket, {
                buf: Buffer.alloc(0),
                initDone: false,
                username,
                outbound: true,
              });
              (sock as Socket).write(buildPeerInit(this.username, "P"));
            },
            data: (sock, chunk) => this.processPeer(sock as Socket, chunk, false),
            error: () => {
              this.userInfoRequests.delete(username);
              this.peerAddressRequests.delete(username);
              this.failedUserInfo.add(username);
              this.emit({ type: "user-info-failed", username });
              reject(new Error("Peer connection failed."));
            },
            close: (sock) => {
              this.peerStates.delete(sock as Socket);
            },
          },
        }).catch(() => {
          this.userInfoRequests.delete(username);
          this.peerAddressRequests.delete(username);
          this.failedUserInfo.add(username);
          this.emit({ type: "user-info-failed", username });
          reject(new Error("Unable to reach peer."));
        });
      });
      this.serverSocket?.write(buildGetPeerAddress(username));
    });
  }

  /** Tear down the server connection and peer listener. */
  close() {
    for (const token of [...this.searches.keys()]) {
      const search = this.searches.get(token);
      if (search?.timer) clearTimeout(search.timer);
      if (search) search.onEnd({ searchId: search.searchId, reason: "stopped" });
      this.searches.delete(token);
    }
    this.searchIds.clear();
    this.userInfoRequests.clear();
    this.peerAddressRequests.clear();
    this.failedUserInfo.clear();
    for (const peer of this.peerStates.keys()) {
      peer.end();
    }
    this.peerStates.clear();
    this.serverSocket?.end();
    this.listener?.stop();
    this.serverSocket = undefined;
    this.listener = undefined;
  }
}

function toRow(
  username: string,
  freeUploadSlots: boolean,
  inQueue: number,
  uploadSpeed: number,
  file: SearchFile,
): SearchRow {
  const name = file.name;
  const idx = name.lastIndexOf("\\");
  const folder = idx >= 0 ? name.slice(0, idx) : "";
  const filename = idx >= 0 ? name.slice(idx + 1) : name;
  const dot = filename.lastIndexOf(".");
  const fileType = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return {
    user: username,
    folder,
    filename,
    path: name,
    size: file.size,
    fileType,
    slotFree: freeUploadSlots,
    speed: uploadSpeed,
    inQueue,
    quality: file.attrs.bitrate ?? 0,
    length: file.attrs.length ?? 0,
    private: file.private,
    attributes: file.attrs,
  };
}
