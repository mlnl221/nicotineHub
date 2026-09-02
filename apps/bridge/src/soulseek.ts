// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2003-2004 Hyriand <hyriand@thegraveyard.org>
// SPDX-FileCopyrightText: 2007-2009 daelstorm <daelstorm@gmail.com>
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/slskmessages.py + pynicotine/slskproto.py + doc/SLSKPROTOCOL.md

/**
 * Full Soulseek (SLSK) protocol implementation for the WebSocket bridge.
 *
 * Mirrors nicotine-plus pynicotine/slskmessages.py + slskproto.py:
 *  - All 102 server codes, 18 peer codes, 6 distrib codes, init + file codes
 *  - Framing [uint32 len][uint32 code][payload] (server/peer), [len][uint8 code][payload] (init/distrib)
 *  - Packing primitives little-endian, zlib caps, >2GiB quirk, obfuscation tail
 *  - Token gating for search/browse, size guards
 *
 * Reference: doc/SLSKPROTOCOL.md + apps/bridge/src/soulseek.ts framing docs.
 */

import { inflateSync } from "node:zlib";

/* ------------------------------------------------------------------ *
 * Message code tables — mirrors pynicotine/slskmessages.py
 * ------------------------------------------------------------------ */

export const SERVER_MESSAGE_CODES = {
  login: 1,
  setWaitPort: 2,
  getPeerAddress: 3,
  watchUser: 5,
  unwatchUser: 6,
  getUserStatus: 7,
  ignoreUser: 11,
  unignoreUser: 12,
  sayChatroom: 13,
  joinRoom: 14,
  leaveRoom: 15,
  userJoinedRoom: 16,
  userLeftRoom: 17,
  connectToPeer: 18,
  messageUser: 22,
  messageAcked: 23,
  fileSearchRoom: 25,
  fileSearch: 26,
  setStatus: 28,
  serverPing: 32,
  sendConnectToken: 33,
  sendDownloadSpeed: 34,
  sharedFoldersFiles: 35,
  getUserStats: 36,
  uploadSlotsFull: 40,
  relogged: 41,
  userSearch: 42,
  similarRecommendations: 50,
  addThingILike: 51,
  removeThingILike: 52,
  recommendations: 54,
  myRecommendations: 55,
  globalRecommendations: 56,
  userInterests: 57,
  adminCommand: 58,
  placeInLineRequest: 59,
  placeInLineResponse: 60,
  roomAdded: 62,
  roomRemoved: 63,
  roomList: 64,
  exactFileSearch: 65,
  adminMessage: 66,
  globalUserList: 67,
  tunneledMessage: 68,
  privilegedUsers: 69,
  haveNoParent: 71,
  parentIP: 73,
  parentMinSpeed: 83,
  parentSpeedRatio: 84,
  parentInactivityTimeout: 86,
  searchInactivityTimeout: 87,
  minParentsInCache: 88,
  distribPingInterval: 90,
  addToPrivileged: 91,
  checkPrivileges: 92,
  embeddedMessage: 93,
  acceptChildren: 100,
  possibleParents: 102,
  wishlistSearch: 103,
  wishlistInterval: 104,
  similarUsers: 110,
  itemRecommendations: 111,
  itemSimilarUsers: 112,
  roomTickers: 113,
  roomTickerAdded: 114,
  roomTickerRemoved: 115,
  setRoomTicker: 116,
  addThingIHate: 117,
  removeThingIHate: 118,
  roomSearch: 120,
  sendUploadSpeed: 121,
  userPrivileged: 122,
  givePrivileges: 123,
  notifyPrivileges: 124,
  ackNotifyPrivileges: 125,
  branchLevel: 126,
  branchRoot: 127,
  childDepth: 129,
  resetDistributed: 130,
  roomMembers: 133,
  addRoomMember: 134,
  removeRoomMember: 135,
  cancelRoomMembership: 136,
  cancelRoomOwnership: 137,
  roomSomething: 138,
  roomMembershipGranted: 139,
  roomMembershipRevoked: 140,
  enableRoomInvitations: 141,
  changePassword: 142,
  addRoomOperator: 143,
  removeRoomOperator: 144,
  roomOperatorshipGranted: 145,
  roomOperatorshipRevoked: 146,
  roomOperators: 148,
  messageUsers: 149,
  joinGlobalRoom: 150,
  leaveGlobalRoom: 151,
  globalRoomMessage: 152,
  relatedSearch: 153, // intentionally not implemented — low-value spell-correct, no handler (see docs/porting-status.md)
  excludedSearchPhrases: 160,
  cantConnectToPeer: 1001,
  cantCreateRoom: 1003,
} as const;

export const PEER_INIT_CODES = {
  pierceFireWall: 0,
  peerInit: 1,
} as const;

export const PEER_MESSAGE_CODES = {
  sharedFileListRequest: 4,
  sharedFileListResponse: 5,
  fileSearchRequest: 8,
  fileSearchResponse: 9,
  userInfoRequest: 15,
  userInfoResponse: 16,
  folderContentsRequest: 36,
  folderContentsResponse: 37,
  transferRequest: 40,
  transferResponse: 41,
  placeholdUpload: 42,
  queueUpload: 43,
  placeInQueueResponse: 44,
  uploadFailed: 46,
  uploadDenied: 50,
  placeInQueueRequest: 51,
  uploadQueueNotification: 52,
  unknownPeerMessage: 12547,
} as const;

export const DISTRIBUTED_MESSAGE_CODES = {
  distribPing: 0,
  distribSearch: 3,
  distribBranchLevel: 4,
  distribBranchRoot: 5,
  distribChildDepth: 7,
  distribEmbeddedMessage: 93,
} as const;

export const FILE_MESSAGE_CODES = {
  fileTransferInit: 0, // [uint32 token] on F conn, no code field — distinct framing
  fileOffset: 1, // [uint64 offset] — not a separate code, sent as raw uint64 after Init
} as const;

/** Server max incoming sizes (bytes) — slskproto.py limits. */
export const MAX_INCOMING = {
  server16K: 16384,
  server1M: 1048576,
  server16M: 16777216,
  server448M: 469762048,
} as const;

/** File attribute types. */
export const FILE_ATTRIBUTE = {
  BITRATE: 0,
  LENGTH: 1,
  VBR: 2,
  SAMPLE_RATE: 4,
  BIT_DEPTH: 5,
} as const;

/** Login rejection reasons. */
export const LOGIN_REJECT_REASONS = {
  INVALID_USERNAME: "INVALIDUSERNAME",
  EMPTY_PASSWORD: "EMPTYPASSWORD",
  INVALID_PASSWORD: "INVALIDPASS",
  INVALID_VERSION: "INVALIDVERSION",
  SERVER_FULL: "SVRFULL",
  SERVER_PRIVATE: "SVRPRIVATE",
} as const;

export const MAJOR_VERSION = 177;
export const MINOR_VERSION = 1;
// Nicotine+ stable reserved version (for reference / fallback). Experimental 177 is kept as default per AGENTS.md — use MAJOR_VERSION.
// See SLSKPROTOCOL.md Reserved 160 = Nicotine+, 177 = Experimental.
export const NICOTINE_MAJOR_VERSION = 160;
export const NICOTINE_MINOR_VERSION = 3;
export const EXPERIMENTAL_VERSION_FLAG = true;

export const DEFAULT_SERVER_HOST = "server.slsknet.org";
export const DEFAULT_SERVER_PORT = 2242;

/* Search sanitization — mirrors pynicotine/search.py REMOVED_SEARCH_CHARACTERS + TRANSLATE_PUNCTUATION */
export const REMOVED_SEARCH_CHARACTERS = [
  "!", '"', "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/", ":", ";",
  "<", "=", ">", "?", "@", "[", "\\", "]", "^", "_", "`", "{", "|", "}", "~", "–", "—",
  "‐", "’", "“", "”", "…",
];
const REMOVED_SET = new Set(REMOVED_SEARCH_CHARACTERS);
// ponytail: PUNCTUATION is REMOVED minus unicode dashes/quotes/ellipsis; single source
const PUNCTUATION_SET = new Set(REMOVED_SEARCH_CHARACTERS.filter((c) => !["–", "—", "‐", "’", "“", "”", "…"].includes(c)));
function translateWithSet(s: string, set: Set<string>): string {
  let out = "";
  for (const ch of s) out += set.has(ch) ? " " : ch;
  return out;
}
const translateRemoved = (s: string) => translateWithSet(s, REMOVED_SET);
const translatePunct = (s: string) => translateWithSet(s, PUNCTUATION_SET);
/** Tokenize respecting quoted phrases — like shlex with " quotes */
function tokenizeSearchTerm(term: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]+)"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(term)) !== null) {
    if (m[1] !== undefined) tokens.push(`"${m[1]}"`);
    else tokens.push(m[0]);
  }
  return tokens;
}
export function sanitizeSearchTerm(searchTerm: string): {
  sanitized: string;
  transmitted: string;
  includedWords: string[];
  excludedWords: string[];
} {
  const raw = String(searchTerm || "").trim();
  if (!raw) return { sanitized: "", transmitted: "", includedWords: [], excludedWords: [] };
  const words = tokenizeSearchTerm(raw);
  const included: string[] = [];
  const excluded: string[] = [];
  const transmittedWords: string[] = [];
  const sanitizedWords: string[] = [];
  const excludedChar = "-";
  const partialChar = "*";
  const quoteChar = '"';
  for (let idx = 0; idx < words.length; idx++) {
    const w = words[idx];
    if (!w) continue;
    const first = w[0];
    if (first === partialChar && w.length > 1) {
      const core = w.slice(1);
      const cleaned = translateRemoved(core).trim().replace(/\s+/g, " ");
      if (cleaned) {
        for (const sub of translatePunct(cleaned).trim().split(/\s+/).filter(Boolean)) included.push(sub.toLowerCase());
        transmittedWords.push(cleaned);
        sanitizedWords.push(cleaned);
      } else {
        included.push(core.toLowerCase());
        transmittedWords.push(core);
        sanitizedWords.push(core);
      }
      continue;
    }
    if (first === excludedChar && w.length > 1) {
      const core = w.slice(1);
      const cleaned = translateRemoved(core).trim().replace(/\s+/g, " ");
      const target = cleaned || core;
      for (const sub of translatePunct(target).trim().split(/\s+/).filter(Boolean)) excluded.push(sub.toLowerCase());
      sanitizedWords.push(w);
      continue;
    }
    if (first === quoteChar && w.length > 2 && w[w.length - 1] === quoteChar) {
      const inner = w.slice(1, -1);
      included.push(inner.toLowerCase());
      const cleaned = translateRemoved(inner).trim().replace(/\s+/g, " ");
      const t = cleaned || inner;
      transmittedWords.push(t);
      sanitizedWords.push(`"${inner}"`);
      continue;
    }
    const subwords = translateRemoved(w).trim().split(/\s+/).filter(Boolean);
    const joined = subwords.join(" ").trim();
    if (!joined) continue;
    sanitizedWords.push(joined);
    transmittedWords.push(joined);
    for (const sub of joined.split(/\s+/)) {
      for (const p of translatePunct(sub).trim().split(/\s+/).filter(Boolean)) included.push(p.toLowerCase());
    }
  }
  const sanitized = sanitizedWords.join(" ").trim();
  const transmitted = transmittedWords.join(" ").trim() || sanitized;
  return { sanitized: sanitized || raw, transmitted: transmitted || sanitized || raw, includedWords: included, excludedWords: excluded };
}

/* Packing primitives */

export function packUint32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}
export function packInt32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf;
}
export function packUint64(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  // Handle numbers > 2^32 correctly (use BigInt for all, but keep signed fix)
  if (typeof value === "bigint") {
    buf.writeBigUInt64LE(value, 0);
  } else {
    // For JS number, use BigInt to support > 2^32 without >>> 0 truncation
    buf.writeBigUInt64LE(BigInt(Math.floor(value)), 0);
  }
  return buf;
}
/** @deprecated alias for Phase 0 tests — same as packUint64 but number-only */
export function packUint64LE(value: number): Buffer {
  return packUint64(value);
}
/** @deprecated alias — reads LE uint64 as number (exact up to 2^53) */
export function unpackUint64LE(buf: Buffer, offset = 0): number {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readUInt32LE(offset + 4);
  return lo + hi * 2 ** 32;
}
export function packUint16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value & 0xffff, 0);
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
export function packBytes(value: Buffer): Buffer {
  return Buffer.concat([packUint32(value.length), value]);
}
export function packIp(value: string): Buffer {
  const parts = value.split(".").filter((p) => p !== "");
  if (parts.length !== 4) throw new Error(`Invalid IP: ${value}`);
  const nums = parts.map((p) => parseInt(p, 10));
  if (!nums.every((n) => n >= 0 && n <= 255)) throw new Error(`Invalid IP: ${value}`);
  // wire is LE (reversed inet_aton): 192.168.1.1 -> [1,1,168,192]
  return Buffer.from([nums[3]!, nums[2]!, nums[1]!, nums[0]!]);
}

/** Cursor reader — mirrors SlskMessage. */
export class SlskReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}
  get remaining(): number { return this.buf.length - this.offset; }
  uint32(): number { const v = this.buf.readUInt32LE(this.offset); this.offset += 4; return v; }
  int32(): number { const v = this.buf.readInt32LE(this.offset); this.offset += 4; return v; }
  uint16(): number { const v = this.buf.readUInt16LE(this.offset); this.offset += 2; return v; }
  uint8(): number { const v = this.buf.readUInt8(this.offset); this.offset += 1; return v; }
  bool(): boolean { return this.uint8() !== 0; }
  uint64(): bigint { const v = this.buf.readBigUInt64LE(this.offset); this.offset += 8; return v; }
  string(): string {
    const len = this.uint32();
    const raw = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      return raw.toString("latin1");
    }
  }
  bytes(): Buffer {
    const len = this.uint32();
    const v = Buffer.from(this.buf.subarray(this.offset, this.offset + len));
    this.offset += len; return v;
  }
  ip(): string {
    const start = this.offset; this.offset += 4;
    const b = this.buf.subarray(start, this.offset);
    // wire: little-endian reversed inet_aton
    return `${b[3]}.${b[2]}.${b[1]}.${b[0]}`;
  }
}

export function readUint32(buf: Buffer, offset: number): number { return buf.readUInt32LE(offset); }
export function uint32ToIp(value: number): string {
  // LE wire integer -> dotted (high byte is first octet)
  return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${(value >>> 0) & 0xff}`;
}

/* Framing */

export function frameMessage(code: number, payload: Buffer): Buffer {
  const len = payload.length + 4;
  return Buffer.concat([packUint32(len), packUint32(code), payload]);
}
export function tryParseMessage(buffer: Buffer, maxLen = MAX_INCOMING.server16M): { code: number; payload: Buffer } | null {
  if (buffer.length < 4) return null;
  const len = buffer.readUInt32LE(0);
  if (len > maxLen) return null; // guard — caller may treat as overflow close
  if (len < 4) return null; // must at least contain code
  const total = 4 + len;
  if (buffer.length < total) return null;
  const code = buffer.readUInt32LE(4);
  const payload = buffer.subarray(8, total);
  return { code, payload };
}

/** Per-connection max incoming — nicotine parity: 448M shares, 16M search, 1M generic, 16K distrib */
export function maxIncomingForPeer(code: number): number {
  // Peer shares are huge (448M)
  if (code === PEER_MESSAGE_CODES.sharedFileListResponse || code === PEER_MESSAGE_CODES.folderContentsResponse) return MAX_INCOMING.server448M;
  if (code === PEER_MESSAGE_CODES.fileSearchResponse) return MAX_INCOMING.server16M;
  return MAX_INCOMING.server1M;
}
export function frameInitMessage(code: number, payload: Buffer): Buffer {
  const len = payload.length + 1;
  return Buffer.concat([packUint32(len), packUint8(code), payload]);
}
export function frameDistribMessage(code: number, payload: Buffer): Buffer {
  return frameInitMessage(code, payload);
}

/* Builders — server */

export function buildLogin(username: string, password: string): Buffer {
  const hash = Bun.CryptoHasher.hash("md5", `${username}${password}`, "hex");
  const payload = Buffer.concat([
    packString(username), packString(password),
    packUint32(MAJOR_VERSION), packString(hash), packUint32(MINOR_VERSION),
  ]);
  return frameMessage(SERVER_MESSAGE_CODES.login, payload);
}
export function buildSetWaitPort(port: number): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.setWaitPort, packUint32(port));
}
export function buildFileSearch(token: number, query: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.fileSearch, Buffer.concat([packUint32(token >>> 0), packString(query)]));
}
export function buildUserSearch(username: string, token: number, query: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.userSearch, Buffer.concat([packString(username), packUint32(token >>> 0), packString(query)]));
}
export function buildRoomSearch(room: string, token: number, query: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.roomSearch, Buffer.concat([packString(room), packUint32(token >>> 0), packString(query)]));
}
export function buildWishlistSearch(token: number, query: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.wishlistSearch, Buffer.concat([packUint32(token >>> 0), packString(query)]));
}
export function buildWatchUser(username: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.watchUser, packString(username)); }
export function buildUnwatchUser(username: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.unwatchUser, packString(username)); }
export function buildGetUserStats(username: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.getUserStats, packString(username)); }
export function buildUserInterests(username: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.userInterests, packString(username)); }
export function buildGetPeerAddress(username: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.getPeerAddress, packString(username)); }
export function buildSetStatus(status: number): Buffer { return frameMessage(SERVER_MESSAGE_CODES.setStatus, packInt32(status)); }
export function buildSharedFoldersFiles(dirs: number, files: number): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.sharedFoldersFiles, Buffer.concat([packUint32(dirs), packUint32(files)]));
}
export function buildAddThingILike(thing: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.addThingILike, packString(thing)); }
export function buildRemoveThingILike(thing: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.removeThingILike, packString(thing)); }
export function buildAddThingIHate(thing: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.addThingIHate, packString(thing)); }
export function buildRemoveThingIHate(thing: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.removeThingIHate, packString(thing)); }
export function buildGivePrivileges(username: string, days: number): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.givePrivileges, Buffer.concat([packString(username), packUint32(days)]));
}
export function buildSendUploadSpeed(speed: number): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.sendUploadSpeed, packUint32(speed >>> 0));
}
export function buildCantConnectToPeer(token: number, username?: string): Buffer {
  if (username === undefined) return frameMessage(SERVER_MESSAGE_CODES.cantConnectToPeer, packUint32(token >>> 0));
  return frameMessage(SERVER_MESSAGE_CODES.cantConnectToPeer, Buffer.concat([packUint32(token >>> 0), packString(username)]));
}
/** Builder for PrivilegedUsers (69) — used by transfers Phase 0 */
export function buildPrivilegedUsers(users: string[]): Buffer {
  const parts = [packUint32(users.length)];
  for (const u of users) parts.push(packString(u));
  return frameMessage(SERVER_MESSAGE_CODES.privilegedUsers, Buffer.concat(parts));
}
export function buildMessageAcked(msgId: number): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.messageAcked, packUint32(msgId >>> 0));
}
export function buildMessageUser(username: string, message: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.messageUser, Buffer.concat([packString(username), packString(message)]));
}
export function buildSayChatroom(room: string, message: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.sayChatroom, Buffer.concat([packString(room), packString(message)]));
}
export function buildJoinRoom(room: string, priv = false): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.joinRoom, Buffer.concat([packString(room), packUint32(priv ? 1 : 0)]));
}
export function buildLeaveRoom(room: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.leaveRoom, packString(room)); }
export function buildChangePassword(password: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.changePassword, packString(password)); }
export function buildCheckPrivileges(): Buffer { return frameMessage(SERVER_MESSAGE_CODES.checkPrivileges, Buffer.alloc(0)); }
export function buildRoomTickers(room: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.roomTickers, packString(room)); }
export function buildSetRoomTicker(room: string, msg: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.setRoomTicker, Buffer.concat([packString(room), packString(msg)]));
}
export function buildEnableRoomInvitations(enabled: boolean): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.enableRoomInvitations, Buffer.from([enabled ? 1 : 0]));
}
export function buildCancelRoomMembership(room: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.cancelRoomMembership, packString(room)); }
export function buildCancelRoomOwnership(room: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.cancelRoomOwnership, packString(room)); }
export function buildAddRoomOperator(room: string, username: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.addRoomOperator, Buffer.concat([packString(room), packString(username)])); }
export function buildRemoveRoomOperator(room: string, username: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.removeRoomOperator, Buffer.concat([packString(room), packString(username)])); }
export function buildRecommendationsEmpty(): Buffer { return frameMessage(SERVER_MESSAGE_CODES.recommendations, Buffer.alloc(0)); }
export function buildGlobalRecommendationsEmpty(): Buffer { return frameMessage(SERVER_MESSAGE_CODES.globalRecommendations, Buffer.alloc(0)); }
export function buildSimilarUsersEmpty(): Buffer { return frameMessage(SERVER_MESSAGE_CODES.similarUsers, Buffer.alloc(0)); }
export function buildHaveNoParent(): Buffer { return frameMessage(SERVER_MESSAGE_CODES.haveNoParent, packBool(true)); }
export function buildBranchLevel(level: number): Buffer { return frameMessage(SERVER_MESSAGE_CODES.branchLevel, packUint32(level >>> 0)); }
export function buildBranchRoot(root: string): Buffer { return frameMessage(SERVER_MESSAGE_CODES.branchRoot, packString(root)); }
export function buildAcceptChildren(accept: boolean): Buffer { return frameMessage(SERVER_MESSAGE_CODES.acceptChildren, packBool(accept)); }
export function buildJoinGlobalRoom(): Buffer { return frameMessage(SERVER_MESSAGE_CODES.joinGlobalRoom, Buffer.alloc(0)); }
export function buildLeaveGlobalRoom(): Buffer { return frameMessage(SERVER_MESSAGE_CODES.leaveGlobalRoom, Buffer.alloc(0)); }

/* Builders — peer */

export function buildPeerInit(ownUser: string, connType = "P"): Buffer {
  return frameInitMessage(1, Buffer.concat([packString(ownUser), packString(connType), packUint32(0)]));
}
export function buildPierceFireWall(token: number): Buffer { return frameInitMessage(0, packUint32(token >>> 0)); }
export function buildConnectToPeer(token: number, username: string, connType: string): Buffer {
  return frameMessage(SERVER_MESSAGE_CODES.connectToPeer, Buffer.concat([packUint32(token >>> 0), packString(username), packString(connType)]));
}
export function buildSharedFileListRequest(): Buffer { return frameMessage(PEER_MESSAGE_CODES.sharedFileListRequest, Buffer.alloc(0)); }
export function buildFolderContentsRequest(token: number, dir: string): Buffer {
  return frameMessage(PEER_MESSAGE_CODES.folderContentsRequest, Buffer.concat([packUint32(token >>> 0), packString(dir)]));
}
export function buildTransferRequest(direction: number, token: number, file: string, size?: number | bigint): Buffer {
  const parts = [packUint32(direction >>> 0), packUint32(token >>> 0), packString(file)];
  if (direction === 1 && size !== undefined) parts.push(packUint64(size));
  return frameMessage(PEER_MESSAGE_CODES.transferRequest, Buffer.concat(parts));
}
export function buildTransferResponse(token: number, allowed: boolean, sizeOrReason?: number | bigint | string): Buffer {
  const parts: Buffer[] = [packUint32(token >>> 0), packBool(allowed)];
  if (allowed && typeof sizeOrReason !== "string") parts.push(packUint64((sizeOrReason as number | bigint) ?? 0));
  else if (!allowed && typeof sizeOrReason === "string") parts.push(packString(sizeOrReason));
  return frameMessage(PEER_MESSAGE_CODES.transferResponse, Buffer.concat(parts));
}
export function buildQueueUpload(file: string): Buffer { return frameMessage(PEER_MESSAGE_CODES.queueUpload, packString(file)); }
export function buildPlaceInQueueRequest(file: string): Buffer { return frameMessage(PEER_MESSAGE_CODES.placeInQueueRequest, packString(file)); }
export function buildPlaceInQueueResponse(file: string, place: number): Buffer {
  return frameMessage(PEER_MESSAGE_CODES.placeInQueueResponse, Buffer.concat([packString(file), packUint32(place >>> 0)]));
}
export function buildUploadFailed(file: string): Buffer { return frameMessage(PEER_MESSAGE_CODES.uploadFailed, packString(file)); }
export function buildUploadDenied(file: string, reason: string): Buffer {
  return frameMessage(PEER_MESSAGE_CODES.uploadDenied, Buffer.concat([packString(file), packString(reason)]));
}
export function buildFileTransferInit(token: number): Buffer { return packUint32(token >>> 0); }
export function buildFileOffset(offset: number | bigint): Buffer { return packUint64(offset); }

/* Parsers — helpers */

export interface PierceFireWall { token: number; }
export function parsePierceFireWall(payload: Buffer): PierceFireWall { return { token: payload.readUInt32LE(0) }; }
export function uint32ToIp(value: number): string {
  return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${(value >>> 0) & 0xff}`;
}

export interface ConnectToPeer {
  username: string; connType: string; ip: string; port: number; token: number; privileged: boolean;
  obfuscationType?: number; obfuscatedPort?: number;
}
export function parseConnectToPeer(payload: Buffer): ConnectToPeer {
  const r = new SlskReader(payload);
  const username = r.string();
  const connType = r.string();
  const ip = r.ip();
  const port = r.uint32();
  const token = r.uint32();
  const privileged = r.bool();
  let obfuscationType: number | undefined;
  let obfuscatedPort: number | undefined;
  // Trailing obfuscation: uint32 type + uint32 or uint16 port (nicotine handles both)
  if (r.remaining >= 8) { obfuscationType = r.uint32(); obfuscatedPort = r.uint32(); }
  else if (r.remaining >= 6) { obfuscationType = r.uint32(); obfuscatedPort = r.uint16(); }
  return { username, connType, ip, port, token, privileged, obfuscationType, obfuscatedPort };
}
export interface PeerInit { targetUser: string; connType: string; }
export function parsePeerInit(payload: Buffer): PeerInit {
  const r = new SlskReader(payload);
  const targetUser = r.string(); const connType = r.string(); return { targetUser, connType };
}

/* Login */

export interface LoginSuccess { success: true; banner: string; ipAddress: string; checksum: string; isSupporter: boolean; }
export interface LoginFailure { success: false; rejectionReason: string; rejectionDetail?: string; }
export type LoginResponse = LoginSuccess | LoginFailure;
export function parseLoginResponse(payload: Buffer): LoginResponse {
  let offset = 0;
  const readBool = (): boolean => { const v = payload[offset] !== 0; offset += 1; return v; };
  const readUint32 = (): number => { const v = payload.readUInt32LE(offset); offset += 4; return v; };
  const readString = (): string => {
    const len = readUint32();
    const raw = payload.subarray(offset, offset + len);
    offset += len;
    try { return new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { return raw.toString("latin1"); }
  };
  const success = readBool();
  if (!success) {
    const rejectionReason = readString();
    const rejectionDetail = offset < payload.length ? readString() : undefined;
    return { success: false, rejectionReason, rejectionDetail };
  }
  const banner = readString();
  const ipBytes = payload.subarray(offset, offset + 4); offset += 4;
  const ipAddress = `${ipBytes[3]}.${ipBytes[2]}.${ipBytes[1]}.${ipBytes[0]}`;
  const checksum = readString(); const isSupporter = readBool();
  return { success: true, banner, ipAddress, checksum, isSupporter };
}
export function describeRejection(reason: string): string {
  switch (reason) {
    case LOGIN_REJECT_REASONS.INVALID_USERNAME: return "Unknown username.";
    case LOGIN_REJECT_REASONS.EMPTY_PASSWORD: return "The password cannot be empty.";
    case LOGIN_REJECT_REASONS.INVALID_PASSWORD: return "Incorrect password.";
    case LOGIN_REJECT_REASONS.INVALID_VERSION: return "Client version rejected by the server. The bridge may need updating.";
    case LOGIN_REJECT_REASONS.SERVER_FULL: return "The server is currently full. Please try again later.";
    case LOGIN_REJECT_REASONS.SERVER_PRIVATE: return "This server does not allow public registrations.";
    default: return `Login rejected by server (${reason}).`;
  }
}

/* Search result parsing — with zlib cap, >2GiB bug, private guard */

export interface SearchFileAttributes { bitrate?: number; length?: number; vbr?: number; sampleRate?: number; bitDepth?: number; }
export interface SearchFile { name: string; size: number; attrs: SearchFileAttributes; private: boolean; }
export interface FileSearchResult { token: number; username: string; freeUploadSlots: boolean; uploadSpeed: number; inQueue: number; results: SearchFile[]; }

const MAX_SEARCH_DECOMPRESSED = 128 * 1024 * 1024; // 128 MiB guard
const MAX_SEARCH_COMPRESSED = 16 * 1024 * 1024;

export function inflateWithCap(payload: Buffer, max = MAX_SEARCH_DECOMPRESSED): Buffer {
  if (payload.length > MAX_SEARCH_COMPRESSED) throw new Error("Search response too large");
  let buf: Buffer;
  try {
    buf = inflateSync(payload) as Buffer;
  } catch {
    // second stage attempt — some peers double-compress (nicotine two-stage, slskmessages.py:466)
    try {
      const first = inflateSync(payload) as Buffer;
      buf = inflateSync(first) as Buffer;
    } catch (e) {
      throw e;
    }
  }
  if (buf.length > max) throw new Error("Decompressed search response exceeds limit");
  // nicotine two-stage: if decompressed still looks like zlib (starts with 0x78), try second inflate
  if (buf.length >= 2 && buf[0] === 0x78 && (buf[1] === 0x01 || buf[1] === 0x9c || buf[1] === 0xda)) {
    try {
      const second = inflateSync(buf) as Buffer;
      if (second.length > max) throw new Error("Decompressed search response exceeds limit");
      return Buffer.from(second);
    } catch {
      // not double-compressed, return first stage
    }
  }
  return Buffer.from(buf);
}

export function parseCantConnectToPeer(payload: Buffer): { token: number; username: string } {
  const r = new SlskReader(payload);
  return { token: r.uint32(), username: r.string() };
}
function readFileSize(buf: Buffer, offset: number): { size: number; next: number } {
  // Nicotine quirk: Soulseek NS >2GiB uses truncated 32-bit + 0xFF sentinel
  if (offset + 8 > buf.length) throw new Error("Truncated file size");
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readUInt32LE(offset + 4);
  // If high bytes are 0xFF 0xFF 0xFF 0xFF sentinel, treat as 32-bit
  if (buf[offset + 7] === 0xff && hi === 0xffffffff) {
    return { size: lo, next: offset + 8 };
  }
  const size = lo + hi * 2 ** 32;
  return { size, next: offset + 8 };
}

export function parseFileSearchResponse(payload: Buffer): FileSearchResult {
  const buf = inflateWithCap(payload);
  let offset = 0;
  const readString = (): string => {
    const len = buf.readUInt32LE(offset); offset += 4;
    const raw = buf.subarray(offset, offset + len); offset += len;
    try { return new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { return raw.toString("latin1"); }
  };
  const readUint32 = (): number => { const v = buf.readUInt32LE(offset); offset += 4; return v; };
  const readBool = (): boolean => { const v = buf[offset] !== 0; offset += 1; return v; };
  const readUint8 = (): number => { const v = buf[offset]; offset += 1; return v; };
  const username = readString(); const token = readUint32(); const nfiles = readUint32();
  const results: SearchFile[] = [];
  const readOne = (isPrivate: boolean) => {
    readUint8();
    const name = readString().replace("/", "\\");
    const { size, next } = readFileSize(buf, offset); offset = next;
    const extLen = readUint32(); offset += extLen;
    const numAttrs = readUint32();
    const attrs: SearchFileAttributes = {};
    for (let j = 0; j < numAttrs; j++) {
      const type = readUint32(); const value = readUint32();
      if (type === FILE_ATTRIBUTE.BITRATE) attrs.bitrate = value;
      else if (type === FILE_ATTRIBUTE.LENGTH) attrs.length = value;
      else if (type === FILE_ATTRIBUTE.VBR) attrs.vbr = value;
      else if (type === FILE_ATTRIBUTE.SAMPLE_RATE) attrs.sampleRate = value;
      else if (type === FILE_ATTRIBUTE.BIT_DEPTH) attrs.bitDepth = value;
    }
    results.push({ name, size, attrs, private: isPrivate });
  };
  for (let i = 0; i < nfiles; i++) readOne(false);
  const freeUploadSlots = readBool(); const uploadSpeed = readUint32(); const inQueue = readUint32();
  // unknown 0 separator before private block (Peer Code 9 step 8)
  if (offset + 4 <= buf.length && buf.readUInt32LE(offset) === 0) {
    // if next value is 0 and there's still data, treat as unknown and consume
    const afterUnknown = offset + 4;
    if (afterUnknown + 4 <= buf.length || afterUnknown === buf.length) offset += 4;
    else if (buf.readUInt32LE(afterUnknown) <= 10000) offset += 4;
  }
  if (offset + 4 <= buf.length) {
    try {
      const npriv = buf.readUInt32LE(offset); offset += 4;
      if (npriv <= 10000 && offset < buf.length) {
        for (let i = 0; i < npriv; i++) {
          if (offset >= buf.length) break;
          readOne(true);
        }
      }
    } catch { /* truncated private block */ }
  }
  return { token, username, freeUploadSlots, uploadSpeed, inQueue, results };
}

/* Server message parsers */

export interface UserStatusMessage { username: string; status: number; privileged: boolean; }
export function parseUserStatus(payload: Buffer): UserStatusMessage {
  const r = new SlskReader(payload);
  const username = r.string(); const status = r.uint32(); const privileged = r.bool();
  return { username, status, privileged };
}
export interface UserStatsMessage { username: string; avgspeed: number; uploadnum: number; files: number; dirs: number; }
export function parseUserStats(payload: Buffer): UserStatsMessage {
  const r = new SlskReader(payload);
  const username = r.string(); const avgspeed = r.uint32(); const uploadnum = r.uint32();
  r.uint32(); const files = r.uint32(); const dirs = r.uint32();
  return { username, avgspeed, uploadnum, files, dirs };
}
export interface UserInterestsMessage { username: string; likes: string[]; hates: string[]; }
export function parseUserInterests(payload: Buffer): UserInterestsMessage {
  const r = new SlskReader(payload);
  const username = r.string(); const likes: string[] = []; const hates: string[] = [];
  const nLikes = r.uint32(); for (let i = 0; i < nLikes; i++) likes.push(r.string());
  const nHates = r.uint32(); for (let i = 0; i < nHates; i++) hates.push(r.string());
  return { username, likes, hates };
}
export interface Recommendation { thing: string; rating: number; }
export function parseRecommendations(payload: Buffer): { recommendations: Recommendation[]; unrecommendations: Recommendation[] } {
  const r = new SlskReader(payload);
  const recommendations: Recommendation[] = []; const unrecommendations: Recommendation[] = [];
  const nRecs = r.uint32(); for (let i = 0; i < nRecs; i++) { const thing = r.string(); const rating = r.int32(); recommendations.push({ thing, rating }); }
  const nUnrecs = r.uint32(); for (let i = 0; i < nUnrecs; i++) { const thing = r.string(); const rating = r.int32(); unrecommendations.push({ thing, rating }); }
  return { recommendations, unrecommendations };
}
export interface SimilarUser { username: string; rating: number; }
export function parseSimilarUsers(payload: Buffer): SimilarUser[] {
  const r = new SlskReader(payload); const count = r.uint32(); const users: SimilarUser[] = [];
  for (let i = 0; i < count; i++) { const username = r.string(); const rating = r.uint32(); users.push({ username, rating }); }
  return users;
}
export function parseItemRecommendations(payload: Buffer): { thing: string; recommendations: Recommendation[] } {
  const r = new SlskReader(payload); const thing = r.string(); const recommendations: Recommendation[] = []; const n = r.uint32();
  for (let i = 0; i < n; i++) { const recThing = r.string(); const rating = r.int32(); recommendations.push({ thing: recThing, rating }); }
  return { thing, recommendations };
}
export function parseItemSimilarUsers(payload: Buffer): { thing: string; users: SimilarUser[] } {
  const r = new SlskReader(payload); const thing = r.string(); const users: SimilarUser[] = []; const n = r.uint32();
  for (let i = 0; i < n; i++) { const username = r.string(); const rating = r.uint32(); users.push({ username, rating }); }
  return { thing, users };
}
export interface PeerAddress { username: string; ip: string; port: number; obfuscationType?: number; obfuscatedPort?: number; }
export function parsePeerAddress(payload: Buffer): PeerAddress {
  const r = new SlskReader(payload);
  const username = r.string(); const ip = r.ip();
  const port = r.uint32();
  let obfuscationType: number | undefined; let obfuscatedPort: number | undefined;
  if (r.remaining >= 8) { obfuscationType = r.uint32(); obfuscatedPort = r.uint32(); }
  else if (r.remaining >= 6) { obfuscationType = r.uint32(); obfuscatedPort = r.uint16(); }
  return { username, ip, port, obfuscationType, obfuscatedPort };
}
export interface ChatMessage { room: string; username: string; message: string; }
export function parseSayChatroom(payload: Buffer): ChatMessage {
  const r = new SlskReader(payload); const room = r.string(); const username = r.string(); const message = r.string();
  return { room, username, message };
}
export interface PrivateMessage { id: number; timestamp: number; username: string; message: string; isNew: boolean; }
export function parseMessageUser(payload: Buffer): PrivateMessage {
  const r = new SlskReader(payload);
  const id = r.uint32(); const timestamp = r.uint32(); const username = r.string(); const message = r.string(); const isNew = r.bool();
  return { id, timestamp, username, message, isNew };
}
export interface RoomListEntry { name: string; users: number; }
export function parseRoomList(payload: Buffer): { rooms: RoomListEntry[]; owned: RoomListEntry[]; member: RoomListEntry[]; operator: string[] } {
  const r = new SlskReader(payload);
  const parseRooms = (hasCount: boolean): RoomListEntry[] | string[] => {
    const n = r.uint32(); const names: string[] = [];
    for (let i = 0; i < n; i++) names.push(r.string());
    if (!hasCount) return names;
    const counts: number[] = []; for (let i = 0; i < n; i++) counts.push(r.uint32());
    return names.map((name, i) => ({ name, users: counts[i] ?? 0 }));
  };
  const rooms = parseRooms(true) as RoomListEntry[];
  const owned = parseRooms(true) as RoomListEntry[];
  const member = parseRooms(true) as RoomListEntry[];
  const operator = parseRooms(false) as string[];
  return { rooms, owned, member, operator };
}
export function parsePrivilegedUsers(payload: Buffer): string[] {
  const r = new SlskReader(payload); const n = r.uint32(); const users: string[] = [];
  for (let i = 0; i < n; i++) users.push(r.string()); return users;
}
export function parseCheckPrivileges(payload: Buffer): number { return new SlskReader(payload).uint32(); }
export function parseWishlistInterval(payload: Buffer): number { return new SlskReader(payload).uint32(); }
export function parseExcludedSearchPhrases(payload: Buffer): string[] {
  const r = new SlskReader(payload); const n = r.uint32(); const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(r.string()); return out;
}
export function parseRoomTickers(payload: Buffer): { room: string; tickers: Array<{ username: string; msg: string }> } {
  const r = new SlskReader(payload); const room = r.string(); const n = r.uint32(); const tickers: Array<{ username: string; msg: string }> = [];
  for (let i = 0; i < n; i++) { const username = r.string(); const msg = r.string(); tickers.push({ username, msg }); }
  return { room, tickers };
}
export function parsePossibleParents(payload: Buffer): Array<{ username: string; ip: string; port: number }> {
  const r = new SlskReader(payload); const n = r.uint32(); const out: Array<{ username: string; ip: string; port: number }> = [];
  for (let i = 0; i < n; i++) { const username = r.string(); const ip = r.ip(); const port = r.uint32(); out.push({ username, ip, port }); }
  return out;
}
export interface UserData { username: string; status: number; avgspeed: number; uploadnum: number; unknown: number; files: number; dirs: number; slotsfull: number; country: string; }
export function parseJoinRoom(payload: Buffer): { room: string; users: UserData[]; owner?: string; operators: string[] } {
  const r = new SlskReader(payload);
  const room = r.string();
  // parse_users interleaved
  const nUsers = r.uint32(); const users: UserData[] = [];
  for (let i = 0; i < nUsers; i++) users.push({ username: r.string(), status: 0, avgspeed: 0, uploadnum: 0, unknown: 0, files: 0, dirs: 0, slotsfull: 0, country: "" } as UserData);
  const statusLen = r.uint32(); for (let i = 0; i < statusLen; i++) users[i].status = r.uint32();
  const statsLen = r.uint32(); for (let i = 0; i < statsLen; i++) { users[i].avgspeed = r.uint32(); users[i].uploadnum = r.uint32(); users[i].unknown = r.uint32(); users[i].files = r.uint32(); users[i].dirs = r.uint32(); }
  const slotsLen = r.uint32(); for (let i = 0; i < slotsLen; i++) users[i].slotsfull = r.uint32();
  const cLen = r.uint32(); for (let i = 0; i < cLen; i++) users[i].country = r.string();
  if (!r.remaining) return { room, users, operators: [] };
  const owner = r.string(); const nOps = r.uint32(); const operators: string[] = [];
  for (let i = 0; i < nOps; i++) operators.push(r.string());
  return { room, users, owner, operators };
}
export function parseWatchUser(payload: Buffer): { username: string; exists: boolean; status?: number; avgspeed?: number; files?: number; dirs?: number; country?: string } {
  const r = new SlskReader(payload);
  const username = r.string(); const exists = r.bool();
  if (!exists) return { username, exists: false };
  const status = r.uint32(); const avgspeed = r.uint32(); r.uint32(); r.uint32(); const files = r.uint32(); const dirs = r.uint32();
  let country: string | undefined;
  if (r.remaining) country = r.string();
  return { username, exists: true, status, avgspeed, files, dirs, country };
}

/* Peer parsers/builders */

export function buildUserInfoRequest(): Buffer { return frameMessage(PEER_MESSAGE_CODES.userInfoRequest, Buffer.alloc(0)); }
export interface UserInfoResponseMessage { username: string; descr: string; pic: Buffer | null; totalupl: number; queuesize: number; slotsavail: boolean; uploadallowed: number; }
export function parseUserInfoResponse(payload: Buffer, username: string): UserInfoResponseMessage {
  const r = new SlskReader(payload);
  const descr = r.string(); const hasPic = r.bool(); const pic = hasPic ? r.bytes() : null;
  const totalupl = r.uint32(); const queuesize = r.uint32(); const slotsavail = r.bool();
  const uploadallowed = r.remaining >= 4 ? r.uint32() : 0;
  return { username, descr, pic, totalupl, queuesize, slotsavail, uploadallowed };
}
export function buildUserInfoResponse(opts: { descr: string; pic: Buffer | null; totalupl: number; queuesize: number; slotsavail: boolean; uploadallowed: number; }): Buffer {
  const parts: Buffer[] = [];
  parts.push(packString(opts.descr));
  if (opts.pic) { parts.push(packBool(true)); parts.push(packBytes(opts.pic)); } else parts.push(packBool(false));
  parts.push(packUint32(opts.totalupl)); parts.push(packUint32(opts.queuesize)); parts.push(packBool(opts.slotsavail)); parts.push(packUint32(opts.uploadallowed));
  return frameMessage(PEER_MESSAGE_CODES.userInfoResponse, Buffer.concat(parts));
}
export interface TransferRequestMsg { direction: number; token: number; file: string; size?: number | bigint; }
export function parseTransferRequest(payload: Buffer): TransferRequestMsg {
  const r = new SlskReader(payload); const direction = r.uint32(); const token = r.uint32(); const file = r.string();
  let size: number | bigint | undefined;
  if (direction === 1 && r.remaining >= 8) {
    const v = r.uint64();
    size = v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }
  return { direction, token, file, size };
}
export interface TransferResponseMsg { token: number; allowed: boolean; size?: number | bigint; reason?: string; }
export function parseTransferResponse(payload: Buffer): TransferResponseMsg {
  const r = new SlskReader(payload); const token = r.uint32(); const allowed = r.bool();
  if (allowed) {
    const raw = r.remaining >= 8 ? r.uint64() : BigInt(0);
    const size = raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : raw;
    return { token, allowed, size };
  }
  const reason = r.remaining ? r.string() : ""; return { token, allowed, reason };
}
export function parseQueueUpload(payload: Buffer): { file: string } { return { file: new SlskReader(payload).string() }; }
export function parsePlaceInQueueRequest(payload: Buffer): { file: string } { return { file: new SlskReader(payload).string() }; }
export function parsePlaceInQueueResponse(payload: Buffer): { file: string; place: number } {
  const r = new SlskReader(payload); const file = r.string(); const place = r.uint32(); return { file, place };
}
export function parseUploadFailed(payload: Buffer): { file: string } { return { file: new SlskReader(payload).string() }; }
export function parseUploadDenied(payload: Buffer): { file: string; reason: string } {
  const r = new SlskReader(payload); return { file: r.string(), reason: r.string() };
}

export function parseMessageUsers(payload: Buffer): PrivateMessage[] {
  const r = new SlskReader(payload);
  const n = r.uint32(); const out: PrivateMessage[] = [];
  for (let i=0;i<n;i++) {
    const id = r.uint32(); const ts = r.uint32(); const user = r.string(); const msg = r.string();
    out.push({ id, timestamp: ts, username: user, message: msg, isNew: false });
  }
  return out;
}
export function parseRoomMembers(payload: Buffer): { room: string; members: string[] } {
  const r = new SlskReader(payload);
  const room = r.string(); const n = r.uint32(); const members: string[] = [];
  for(let i=0;i<n;i++) members.push(r.string());
  return { room, members };
}
export function parseRoomMember(payload: Buffer): { room: string; username: string } {
  const r = new SlskReader(payload);
  return { room: r.string(), username: r.string() };
}
export function parseRoomOperators(payload: Buffer): { room: string; operators: string[] } {
  const r = new SlskReader(payload);
  const room = r.string(); const n = r.uint32(); const ops: string[] = [];
  for(let i=0;i<n;i++) ops.push(r.string());
  return { room, operators: ops };
}
export function parseGlobalRoomMessage(payload: Buffer): ChatMessage {
  const r = new SlskReader(payload);
  return { room: r.string(), username: r.string(), message: r.string() };
}
export function parseCantCreateRoom(payload: Buffer): string {
  const r = new SlskReader(payload);
  return r.string();
}
export function parsePrivileges(payload: Buffer): { username: string; timeLeft?: number } {
  const r = new SlskReader(payload);
  if (!r.remaining) return { username: "" };
  // 122 userPrivileged: string username
  // 92 checkPrivileges handled elsewhere; fallback generic
  try { const u = r.string(); if(r.remaining) return { username: u, timeLeft: r.uint32() }; return { username: u }; } catch { return { username: "" }; }
}
export interface RoomTickerEvent { room: string; username: string; msg: string; }
export function parseRoomTickerEvent(payload: Buffer): RoomTickerEvent {
  const r = new SlskReader(payload);
  return { room: r.string(), username: r.string(), msg: r.string() };
}

/* Browse shares — SharedFileListResponse 5 + FolderContentsResponse 37 */

export interface BrowseFileEntry { name: string; size: number; ext: string; attrs: Array<[number, number]>; }
export interface BrowseFolderEntry { name: string; files: BrowseFileEntry[]; }

function parseBrowseFile(r: SlskReader): BrowseFileEntry {
  const code = r.uint8(); // 1
  void code;
  const name = r.string();
  // size is uint64
  const raw = r.uint64();
  const size = raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : Number(raw & BigInt(0x1fffffffffffff));
  const ext = r.string();
  const nAttrs = r.uint32();
  const attrs: Array<[number, number]> = [];
  for (let i = 0; i < nAttrs; i++) {
    const type = r.uint32();
    const value = r.uint32();
    attrs.push([type, value]);
  }
  return { name, size, ext, attrs };
}

export function parseSharedFileListResponse(payload: Buffer): { folders: BrowseFolderEntry[] } {
  const buf = inflateSync(payload) as Buffer;
  const r = new SlskReader(Buffer.from(buf));
  const ndirs = r.uint32();
  const folders: BrowseFolderEntry[] = [];
  for (let i = 0; i < ndirs; i++) {
    const dirName = r.string();
    const nfiles = r.uint32();
    const files: BrowseFileEntry[] = [];
    for (let j = 0; j < nfiles; j++) files.push(parseBrowseFile(r));
    folders.push({ name: dirName, files });
  }
  // optional unknown int and private block — ignore remaining
  return { folders };
}

export function parseFolderContentsResponse(payload: Buffer): { token: number; dir: string; files: BrowseFileEntry[] } {
  const buf = inflateSync(payload) as Buffer;
  const r = new SlskReader(Buffer.from(buf));
  const token = r.uint32();
  const dir = r.string();
  const nfiles = r.uint32();
  const files: BrowseFileEntry[] = [];
  for (let i = 0; i < nfiles; i++) files.push(parseBrowseFile(r));
  return { token, dir, files };
}

/* Distrib */

export function parseDistribSearch(payload: Buffer): { username: string; token: number; query: string } {
  const r = new SlskReader(payload);
  // DistribSearch layout: uint32 unknown (49) | string username | uint32 token | string query
  if (r.remaining >= 4) {
    const ident = r.uint32();
    if (ident !== 49) throw new Error(`DistribSearch identifier !=49: ${ident}`);
  }
  const username = r.string(); const token = r.uint32(); const query = r.string();
  return { username, token, query };
}
export function parseBranchLevel(payload: Buffer): number { return new SlskReader(payload).uint32(); }
export function parseBranchRoot(payload: Buffer): string { return new SlskReader(payload).string(); }
export function parseChildDepth(payload: Buffer): number { return new SlskReader(payload).uint32(); }

/* File — F conn helpers */
export function parseFileTransferInit(buf: Buffer): { token: number } { return { token: buf.readUInt32LE(0) }; }
export function parseFileOffset(buf: Buffer): number {
  // Return as number for Phase 0 tests (exact up to 2^53), compatible with BigInt writer
  const lo = buf.readUInt32LE(0);
  const hi = buf.readUInt32LE(4);
  return lo + hi * 2 ** 32;
}
