/**
 * Minimal Soulseek (SLSK) protocol implementation for server login and search.
 *
 * Based on Nicotine+'s protocol documentation (doc/SLSKPROTOCOL.md) and the
 * reference implementation in pynicotine/slskmessages.py and slskproto.py.
 *
 * We implement what's needed to authenticate with the server and receive real
 * search results over inbound peer connections:
 *   - message framing            [uint32 len][uint32 code][payload]
 *   - Login (code 1)             send + parse response
 *   - SetWaitPort (code 2)
 *   - FileSearch (code 26)       send to the server
 *   - PeerInit (peer code 1)     handshake on inbound peer connections
 *   - FileSearchResponse (peer code 9, zlib)  parse results
 */

import { inflateSync } from "node:zlib";

/** Server message codes (subset). */
export const SERVER_MESSAGE_CODES = {
  login: 1,
  setWaitPort: 2,
  fileSearch: 26,
  getPeerAddress: 3,
  watchUser: 5,
  unwatchUser: 6,
  getUserStatus: 7,
  setStatus: 28,
  sharedFoldersFiles: 35,
  getUserStats: 36,
  addThingILike: 51,
  removeThingILike: 52,
  recommendations: 54,
  globalRecommendations: 56,
  userInterests: 57,
  similarUsers: 110,
  itemRecommendations: 111,
  itemSimilarUsers: 112,
  addThingIHate: 117,
  removeThingIHate: 118,
  givePrivileges: 123,
} as const;

/** Peer message codes (subset). */
export const PEER_MESSAGE_CODES = {
  peerInit: 1,
  userInfoRequest: 15,
  userInfoResponse: 16,
} as const;

/** File attribute types returned inside search results. */
export const FILE_ATTRIBUTE = {
  BITRATE: 0,
  LENGTH: 1,
  VBR: 2,
  SAMPLE_RATE: 4,
  BIT_DEPTH: 5,
} as const;

/** Login rejection reasons returned by the server. */
export const LOGIN_REJECT_REASONS = {
  INVALID_USERNAME: "INVALIDUSERNAME",
  EMPTY_PASSWORD: "EMPTYPASSWORD",
  INVALID_PASSWORD: "INVALIDPASS",
  INVALID_VERSION: "INVALIDVERSION",
  SERVER_FULL: "SVRFULL",
  SERVER_PRIVATE: "SVRPRIVATE",
} as const;

/**
 * Client major/minor version.
 *
 * The protocol reserves major version 177 for experimental downstream
 * clients. Each project picks its own minor version. We use 177/1.
 */
export const MAJOR_VERSION = 177;
export const MINOR_VERSION = 1;

/** Default official Soulseek server. */
export const DEFAULT_SERVER_HOST = "server.slsknet.org";
export const DEFAULT_SERVER_PORT = 2242;

/* ------------------------------------------------------------------ *
 * Packing primitives (little-endian, same as Nicotine+ SlskMessage)
 * ------------------------------------------------------------------ */

export function packUint32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

export function packString(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  return Buffer.concat([packUint32(body.length), body]);
}

export function packBool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

export function packUint8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

export function packInt32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf;
}

export function packBytes(value: Buffer): Buffer {
  return Buffer.concat([packUint32(value.length), value]);
}

/**
 * Cursor-based reader for parsing Soulseek messages. Mirrors pynicotine's
 * SlskMessage, advancing an internal offset as fields are consumed.
 */
export class SlskReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  uint32(): number {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  int32(): number {
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  uint8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  bool(): boolean {
    return this.uint8() !== 0;
  }

  string(): string {
    const len = this.uint32();
    const v = this.buf.subarray(this.offset, this.offset + len).toString("utf8");
    this.offset += len;
    return v;
  }

  bytes(): Buffer {
    const len = this.uint32();
    const v = Buffer.from(this.buf.subarray(this.offset, this.offset + len));
    this.offset += len;
    return v;
  }
}

/** Parse a little-endian uint32 at a fixed offset (no cursor advance). */
export function readUint32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

export function packIp(value: string): Buffer {
  const parts = value.split(".").filter((p) => p !== "");
  if (parts.length !== 4) {
    throw new Error(`Invalid IP address: ${value}`);
  }
  const nums = parts.map((p) => parseInt(p, 10));
  if (!nums.every((n) => n >= 0 && n <= 255)) {
    throw new Error(`Invalid IP address: ${value}`);
  }
  return Buffer.from(nums);
}

/* ------------------------------------------------------------------ *
 * Message framing
 * ------------------------------------------------------------------ */

/**
 * Frame a message: [uint32 len][uint32 code][payload].
 * len == payload.length + 4 (the length of the code field).
 */
export function frameMessage(code: number, payload: Buffer): Buffer {
  const len = payload.length + 4;
  return Buffer.concat([packUint32(len), packUint32(code), payload]);
}

/**
 * Parse a single message from a buffer. Returns null if incomplete.
 * Buffers are consumed as they arrive, so we return offset only if the
 * full message body is present.
 */
export function tryParseMessage(buffer: Buffer): { code: number; payload: Buffer } | null {
  if (buffer.length < 4) return null;
  const len = buffer.readUInt32LE(0);
  const total = 4 + len;
  if (buffer.length < total) return null;
  const code = buffer.readUInt32LE(4);
  const payload = buffer.subarray(8, total);
  return { code, payload };
}

/* ------------------------------------------------------------------ *
 * Message builders
 * ------------------------------------------------------------------ */

export function buildLogin(username: string, password: string): Buffer {
  // MD5 hex digest of username + password (concatenated, no separator).
  const hash = Bun.CryptoHasher.hash("md5", `${username}${password}`, "hex");

  const payload = Buffer.concat([
    packString(username),
    packString(password),
    packUint32(MAJOR_VERSION),
    packString(hash),
    packUint32(MINOR_VERSION),
  ]);

  return frameMessage(SERVER_MESSAGE_CODES.login, payload);
}

export function buildSetWaitPort(port: number): Buffer {
  // Tells the server the TCP port we listen on for inbound peer connections
  // (used to receive search results). SetWaitPort is required immediately
  // after Login.
  return frameMessage(SERVER_MESSAGE_CODES.setWaitPort, packUint32(port));
}

export function buildFileSearch(token: number, query: string): Buffer {
  // Server code 26: FileSearch. The token is echoed back by peers in their
  // FileSearchResponse so we can correlate results to a request.
  return frameMessage(
    SERVER_MESSAGE_CODES.fileSearch,
    Buffer.concat([packUint32(token >>> 0), packString(query)]),
  );
}

/* ------------------------------------------------------------------ *
 * Peer init framing (uint8 code, distinct from the uint32 code used by
 * regular server/peer messages). PeerInit and PierceFireWall are sent as
 * [uint32 len][uint8 code][payload], where len == payload.length + 1.
 * ------------------------------------------------------------------ */

export function frameInitMessage(code: number, payload: Buffer): Buffer {
  const len = payload.length + 1;
  return Buffer.concat([packUint32(len), packUint8(code), payload]);
}

export function buildPeerInit(ownUser: string, connType = "P"): Buffer {
  // Peer init code 1. Sent/received on a fresh peer TCP connection to identify
  // the remote user and the connection type ("P" peer, "F" file, "D" distrib).
  // The token is always zero in the modern handshake. This is an init message,
  // so it uses the uint8 code framing.
  return frameInitMessage(
    1,
    Buffer.concat([packString(ownUser), packString(connType), packUint32(0)]),
  );
}

export function buildPierceFireWall(token: number): Buffer {
  // Peer init code 0. Sent when we initiate a peer connection in response to a
  // server ConnectToPeer (code 18) relay: we connect to the peer and send this
  // token to punch through. Init message framing (uint8 code).
  return frameInitMessage(0, packUint32(token >>> 0));
}

export interface PierceFireWall {
  token: number;
}

export function parsePierceFireWall(payload: Buffer): PierceFireWall {
  return { token: payload.readUInt32LE(0) };
}

/** Render a uint32 IP as a dotted quad. */
export function uint32ToIp(value: number): string {
  return `${(value >>> 0) & 0xff}.${(value >>> 8) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 24) & 0xff}`;
}

export interface ConnectToPeer {
  username: string;
  connType: string;
  ip: string;
  port: number;
  token: number;
  privileged: boolean;
}

/**
 * Parse a server ConnectToPeer (code 18) message we receive as the search
 * result recipient. Layout (receive):
 *   string username | string type | uint32 ip | uint32 port | uint32 token
 *   | bool privileged | uint32 obfuscationType | uint16 obfuscatedPort
 */
export function parseConnectToPeer(payload: Buffer): ConnectToPeer {
  let offset = 0;
  const readString = (): string => {
    const len = payload.readUInt32LE(offset);
    offset += 4;
    const v = payload.subarray(offset, offset + len).toString("utf8");
    offset += len;
    return v;
  };
  const username = readString();
  const connType = readString();
  const ip = uint32ToIp(payload.readUInt32LE(offset));
  offset += 4;
  const port = payload.readUInt32LE(offset);
  offset += 4;
  const token = payload.readUInt32LE(offset);
  offset += 4;
  const privileged = payload[offset] !== 0;
  offset += 1;
  // obfuscationType (uint32) + obfuscatedPort (uint16) — ignored.
  return { username, connType, ip, port, token, privileged };
}

export interface PeerInit {
  targetUser: string;
  connType: string;
}

export function parsePeerInit(payload: Buffer): PeerInit {
  let offset = 0;
  const readString = (): string => {
    const len = payload.readUInt32LE(offset);
    offset += 4;
    const v = payload.subarray(offset, offset + len).toString("utf8");
    offset += len;
    return v;
  };
  const targetUser = readString();
  const connType = readString();
  return { targetUser, connType };
}

/* ------------------------------------------------------------------ *
 * Response parsing
 * ------------------------------------------------------------------ */

export interface LoginSuccess {
  success: true;
  banner: string;
  ipAddress: string;
  checksum: string;
  isSupporter: boolean;
}

export interface LoginFailure {
  success: false;
  rejectionReason: string;
  rejectionDetail?: string;
}

export type LoginResponse = LoginSuccess | LoginFailure;

/** Parse a Login (code 1) server response. */
export function parseLoginResponse(payload: Buffer): LoginResponse {
  let offset = 0;

  const readBool = (): boolean => {
    const v = payload[offset] !== 0;
    offset += 1;
    return v;
  };

  const readUint32 = (): number => {
    const v = payload.readUInt32LE(offset);
    offset += 4;
    return v;
  };

  const readString = (): string => {
    const len = readUint32();
    const v = payload.subarray(offset, offset + len).toString("utf8");
    offset += len;
    return v;
  };

  const success = readBool();

  if (!success) {
    const rejectionReason = readString();
    const rejectionDetail = offset < payload.length ? readString() : undefined;
    return { success: false, rejectionReason, rejectionDetail };
  }

  const banner = readString();
  const ipBytes = payload.subarray(offset, offset + 4);
  offset += 4;
  const ipAddress = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
  const checksum = readString();
  const isSupporter = readBool();

  return { success: true, banner, ipAddress, checksum, isSupporter };
}

/* ------------------------------------------------------------------ *
 * Human-friendly rejection messages
 * ------------------------------------------------------------------ */

export function describeRejection(reason: string): string {
  switch (reason) {
    case LOGIN_REJECT_REASONS.INVALID_USERNAME:
      return "Unknown username.";
    case LOGIN_REJECT_REASONS.EMPTY_PASSWORD:
      return "The password cannot be empty.";
    case LOGIN_REJECT_REASONS.INVALID_PASSWORD:
      return "Incorrect password.";
    case LOGIN_REJECT_REASONS.INVALID_VERSION:
      return "Client version rejected by the server. The bridge may need updating.";
    case LOGIN_REJECT_REASONS.SERVER_FULL:
      return "The server is currently full. Please try again later.";
    case LOGIN_REJECT_REASONS.SERVER_PRIVATE:
      return "This server does not allow public registrations.";
    default:
      return `Login rejected by server (${reason}).`;
  }
}

/* ------------------------------------------------------------------ *
 * Search result parsing (peer FileSearchResponse, code 9)
 * ------------------------------------------------------------------ */

export interface SearchFileAttributes {
  bitrate?: number;
  length?: number;
  vbr?: number;
  sampleRate?: number;
  bitDepth?: number;
}

export interface SearchFile {
  name: string;
  size: number;
  attrs: SearchFileAttributes;
  private: boolean;
}

export interface FileSearchResult {
  token: number;
  username: string;
  freeUploadSlots: boolean;
  uploadSpeed: number;
  inQueue: number;
  results: SearchFile[];
}

/**
 * Parse a FileSearchResponse (peer code 9) payload. The entire payload is
 * zlib-compressed; after inflation the layout is:
 *   string username | uint32 token | uint32 nfiles
 *   repeated nfiles: uint8(1) | string name | uint64 size | uint32 extLen (ignored)
 *                    | uint32 numAttrs (uint32 type + uint32 value)*
 *   bool freeUploadSlots | uint32 uploadSpeed | uint32 inQueue
 * Mirrors nicotine-plus pynicotine/slskmessages.py FileSearchResponse.
 */
export function parseFileSearchResponse(payload: Buffer): FileSearchResult {
  const buf = inflateSync(payload);
  let offset = 0;

  const readString = (): string => {
    const len = buf.readUInt32LE(offset);
    offset += 4;
    const v = buf.subarray(offset, offset + len).toString("utf8");
    offset += len;
    return v;
  };
  const readUint32 = (): number => {
    const v = buf.readUInt32LE(offset);
    offset += 4;
    return v;
  };
  const readUint64 = (): number => {
    const lo = buf.readUInt32LE(offset);
    const hi = buf.readUInt32LE(offset + 4);
    offset += 8;
    return lo + hi * 2 ** 32;
  };
  const readBool = (): boolean => {
    const v = buf[offset] !== 0;
    offset += 1;
    return v;
  };
  const readUint8 = (): number => {
    const v = buf[offset];
    offset += 1;
    return v;
  };

  const username = readString();
  const token = readUint32();
  const nfiles = readUint32();

  const results: SearchFile[] = [];
  const readOne = (isPrivate: boolean) => {
    readUint8(); // result code, always 1
    const name = readString().replace("/", "\\");
    const size = readUint64();
    const extLen = readUint32();
    offset += extLen; // extension is obsolete; skip its bytes
    const numAttrs = readUint32();
    const attrs: SearchFileAttributes = {};
    for (let j = 0; j < numAttrs; j++) {
      const type = readUint32();
      const value = readUint32();
      if (type === FILE_ATTRIBUTE.BITRATE) attrs.bitrate = value;
      else if (type === FILE_ATTRIBUTE.LENGTH) attrs.length = value;
      else if (type === FILE_ATTRIBUTE.VBR) attrs.vbr = value;
      else if (type === FILE_ATTRIBUTE.SAMPLE_RATE) attrs.sampleRate = value;
      else if (type === FILE_ATTRIBUTE.BIT_DEPTH) attrs.bitDepth = value;
    }
    results.push({ name, size, attrs, private: isPrivate });
  };

  for (let i = 0; i < nfiles; i++) readOne(false);

  const freeUploadSlots = readBool();
  const uploadSpeed = readUint32();
  const inQueue = readUint32();

  // Optional private-share results: present only if bytes remain.
  if (offset < buf.length) {
    const npriv = readUint32();
    for (let i = 0; i < npriv; i++) readOne(true);
  }

  return { token, username, freeUploadSlots, uploadSpeed, inQueue, results };
}

/* ------------------------------------------------------------------ *
 * User info — server messages
 * ------------------------------------------------------------------ */

/** WatchUser (server code 5): subscribe to a user's status + initial stats. */
export function buildWatchUser(username: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.watchUser, packString(username));
}

/** UnwatchUser (server code 6): stop receiving updates for a user. */
export function buildUnwatchUser(username: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.unwatchUser, packString(username));
}

/** GetUserStats (server code 36): request a user's shared stats. */
export function buildGetUserStats(username: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.getUserStats, packString(username));
}

/** UserInterests (server code 57): request a user's likes/hates. */
export function buildUserInterests(username: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.userInterests, packString(username));
}

/** GetPeerAddress (server code 3): ask the server for a peer's IP/port. */
export function buildGetPeerAddress(username: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.getPeerAddress, packString(username));
}

/** SetStatus (server code 28): set our own status (2 = online, 1 = away). */
export function buildSetStatus(status: number): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.setStatus, packInt32(status));
}

/** SharedFoldersFiles (server code 35): report our share counts to the server. */
export function buildSharedFoldersFiles(dirs: number, files: number): Buffer {
  return frameMessage(
    SERVER_MESSAGE_CODES.sharedFoldersFiles,
    Buffer.concat([packUint32(dirs), packUint32(files)]),
  );
}

/** AddThingILike (server code 51) / RemoveThingILike (server code 52). */
export function buildAddThingILike(thing: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.addThingILike, packString(thing));
}
export function buildRemoveThingILike(thing: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.removeThingILike, packString(thing));
}

/** AddThingIHate (server code 117) / RemoveThingIHate (server code 118). */
export function buildAddThingIHate(thing: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.addThingIHate, packString(thing));
}
export function buildRemoveThingIHate(thing: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.removeThingIHate, packString(thing));
}

/** GivePrivileges (server code 123): gift N days of privileges to a user. */
export function buildGivePrivileges(username: string, days: number): Buffer {
  return frameMessage(
    SERVER_MESSAGE_CODES.givePrivileges,
    Buffer.concat([packString(username), packUint32(days)]),
  );
}

/* ------------------------------------------------------------------ *
 * User info — server message parsers
 * ------------------------------------------------------------------ */

export interface UserStatusMessage {
  username: string;
  status: number; // 0 offline, 1 away, 2 online
  privileged: boolean;
}

/** GetUserStatus (server code 7). */
export function parseUserStatus(payload: Buffer): UserStatusMessage {
  const r = new SlskReader(payload);
  const username = r.string();
  const status = r.uint32();
  const privileged = r.bool();
  return { username, status, privileged };
}

export interface UserStatsMessage {
  username: string;
  avgspeed: number;
  uploadnum: number; // number of uploaded files
  files: number;
  dirs: number;
}

/** GetUserStats (server code 36). */
export function parseUserStats(payload: Buffer): UserStatsMessage {
  const r = new SlskReader(payload);
  const username = r.string();
  const avgspeed = r.uint32();
  const uploadnum = r.uint32();
  r.uint32(); // unknown
  const files = r.uint32();
  const dirs = r.uint32();
  return { username, avgspeed, uploadnum, files, dirs };
}

export interface UserInterestsMessage {
  username: string;
  likes: string[];
  hates: string[];
}

/** UserInterests (server code 57). */
export function parseUserInterests(payload: Buffer): UserInterestsMessage {
  const r = new SlskReader(payload);
  const username = r.string();
  const likes: string[] = [];
  const hates: string[] = [];
  const nLikes = r.uint32();
  for (let i = 0; i < nLikes; i++) likes.push(r.string());
  const nHates = r.uint32();
  for (let i = 0; i < nHates; i++) hates.push(r.string());
  return { username, likes, hates };
}

export interface Recommendation {
  thing: string;
  rating: number;
}

/** Recommendations (server code 54) and GlobalRecommendations (server code 56). */
export function parseRecommendations(payload: Buffer): {
  recommendations: Recommendation[];
  unrecommendations: Recommendation[];
} {
  const r = new SlskReader(payload);
  const recommendations: Recommendation[] = [];
  const unrecommendations: Recommendation[] = [];
  const nRecs = r.uint32();
  for (let i = 0; i < nRecs; i++) {
    const thing = r.string();
    const rating = r.int32();
    recommendations.push({ thing, rating });
  }
  const nUnrecs = r.uint32();
  for (let i = 0; i < nUnrecs; i++) {
    const thing = r.string();
    const rating = r.int32();
    unrecommendations.push({ thing, rating });
  }
  return { recommendations, unrecommendations };
}

export interface SimilarUser {
  username: string;
  rating: number;
}

/** SimilarUsers (server code 110). */
export function parseSimilarUsers(payload: Buffer): SimilarUser[] {
  const r = new SlskReader(payload);
  const count = r.uint32();
  const users: SimilarUser[] = [];
  for (let i = 0; i < count; i++) {
    const username = r.string();
    const rating = r.uint32();
    users.push({ username, rating });
  }
  return users;
}

/** ItemRecommendations (server code 111) / ItemSimilarUsers (server code 112). */
export function parseItemRecommendations(payload: Buffer): {
  thing: string;
  recommendations: Recommendation[];
} {
  const r = new SlskReader(payload);
  const thing = r.string();
  const recommendations: Recommendation[] = [];
  const n = r.uint32();
  for (let i = 0; i < n; i++) {
    const recThing = r.string();
    const rating = r.uint32();
    recommendations.push({ thing: recThing, rating });
  }
  return { thing, recommendations };
}

/** ItemSimilarUsers (server code 112). */
export function parseItemSimilarUsers(payload: Buffer): {
  thing: string;
  users: SimilarUser[];
} {
  const r = new SlskReader(payload);
  const thing = r.string();
  const users: SimilarUser[] = [];
  const n = r.uint32();
  for (let i = 0; i < n; i++) {
    const username = r.string();
    const rating = r.uint32();
    users.push({ username, rating });
  }
  return { thing, users };
}

/** GetPeerAddress response (server code 3). */
export interface PeerAddress {
  username: string;
  ip: string;
  port: number;
}

export function parsePeerAddress(payload: Buffer): PeerAddress {
  const r = new SlskReader(payload);
  const username = r.string();
  const ipInt = r.uint32();
  // Serialised little-endian: byte0.byte1.byte2.byte3.
  const ip = `${(ipInt >>> 0) & 0xff}.${(ipInt >>> 8) & 0xff}.${(ipInt >>> 16) & 0xff}.${(ipInt >>> 24) & 0xff}`;
  const port = r.uint32();
  return { username, ip, port };
}

/* ------------------------------------------------------------------ *
 * User info — peer messages
 * ------------------------------------------------------------------ */

/** UserInfoRequest (peer code 15). */
export function buildUserInfoRequest(): Buffer {
  return frameMessage(PEER_MESSAGE_CODES.userInfoRequest, Buffer.alloc(0));
}

export interface UserInfoResponseMessage {
  username: string;
  descr: string;
  pic: Buffer | null;
  totalupl: number;
  queuesize: number;
  slotsavail: boolean;
  uploadallowed: number;
}

/**
 * UserInfoResponse (peer code 16). Layout:
 *   string descr | bool has_pic | (bytes pic)? | uint32 totalupl
 *   uint32 queuesize | bool slotsavail | uint32 uploadallowed
 */
export function parseUserInfoResponse(payload: Buffer, username: string): UserInfoResponseMessage {
  const r = new SlskReader(payload);
  const descr = r.string();
  const hasPic = r.bool();
  const pic = hasPic ? r.bytes() : null;
  const totalupl = r.uint32();
  const queuesize = r.uint32();
  const slotsavail = r.bool();
  const uploadallowed = r.remaining >= 4 ? r.uint32() : 0;
  return { username, descr, pic, totalupl, queuesize, slotsavail, uploadallowed };
}

/** Build an outgoing UserInfoResponse (peer code 16) for our own profile. */
export function buildUserInfoResponse(opts: {
  descr: string;
  pic: Buffer | null;
  totalupl: number;
  queuesize: number;
  slotsavail: boolean;
  uploadallowed: number;
}): Buffer {
  const parts: Buffer[] = [];
  parts.push(packString(opts.descr));
  if (opts.pic) {
    parts.push(packBool(true));
    parts.push(packBytes(opts.pic));
  } else {
    parts.push(packBool(false));
  }
  parts.push(packUint32(opts.totalupl));
  parts.push(packUint32(opts.queuesize));
  parts.push(packBool(opts.slotsavail));
  parts.push(packUint32(opts.uploadallowed));
  return frameMessage(PEER_MESSAGE_CODES.userInfoResponse, Buffer.concat(parts));
}
