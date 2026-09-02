import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  buildLogin,
  buildSetWaitPort,
  buildFileSearch,
  buildPeerInit,
  parseLoginResponse,
  parsePeerInit,
  parseFileSearchResponse,
  tryParseMessage,
  packString,
  packUint32,
  packUint16,
  packIp,
  packBool,
  frameMessage,
  describeRejection,
  LOGIN_REJECT_REASONS,
  MAJOR_VERSION,
  MINOR_VERSION,
  SERVER_MESSAGE_CODES,
  PEER_MESSAGE_CODES,
  MAX_INCOMING,
  buildWatchUser,
  buildUserInterests,
  buildGetPeerAddress,
  parseUserStatus,
  parseUserStats,
  parseUserInterests,
  parseRecommendations,
  parseSimilarUsers,
  parseItemRecommendations,
  parseItemSimilarUsers,
  parsePeerAddress,
  parseConnectToPeer,
  parseCantConnectToPeer,
  buildCantConnectToPeer,
  buildSendUploadSpeed,
  buildRecommendationsEmpty,
  buildGlobalRecommendationsEmpty,
  buildSimilarUsersEmpty,
  buildUserInfoResponse,
  parseUserInfoResponse,
  buildQueueUpload,
  buildTransferRequest,
  buildTransferResponse,
  buildPlaceInQueueRequest,
  buildPlaceInQueueResponse,
  buildUploadFailed,
  buildUploadDenied,
  buildConnectToPeer,
  buildUserSearch,
  buildRoomSearch,
  buildWishlistSearch,
  packUint64LE,
  unpackUint64LE,
  parseTransferRequest,
  parseTransferResponse,
  parseQueueUpload,
  parsePlaceInQueueResponse,
  parseUploadFailed,
  parseUploadDenied,
  parsePlaceInQueueRequest,
  parseFileTransferInit,
  parseFileOffset,
  SlskReader,
} from "./soulseek.ts";

describe("packing primitives", () => {
  test("packString length-prefixes UTF-8", () => {
    const buf = packString("ab");
    expect(buf.length).toBe(2 + 4);
    expect(buf.readUInt32LE(0)).toBe(2);
    expect(buf.subarray(4).toString()).toBe("ab");
  });

  test("packString supports unicode", () => {
    const s = "héllo 😀";
    const buf = packString(s);
    expect(buf.readUInt32LE(0)).toBe(Buffer.byteLength(s, "utf8"));
    expect(buf.subarray(4).toString("utf8")).toBe(s);
  });

  test("packUint32 is little-endian", () => {
    expect(packUint32(0x04030201).toString("hex")).toBe("01020304");
  });

  test("packIp packs 4 bytes LE", () => {
    expect(packIp("192.168.1.1").toString("hex")).toBe("0101a8c0");
  });
});

describe("buildLogin matches the documented hex example", () => {
  // From doc/SLSKPROTOCOL.md "Sending Login Example": username=username,
  // password=password, major=177, minor=1.
  test("produces the exact wire bytes", () => {
    const raw = buildLogin("username", "password");
    // Skip the first 8 bytes (len + code) to inspect the payload.
    const len = raw.readUInt32LE(0);
    const hex = raw.toString("hex");

    // len == payload + 4
    expect(len).toBe(raw.length - 4);

    // Full hex stream from the docs:
    const expected =
      "48000000" + // message length 72
      "01000000" + // code 1 (Login)
      "08000000757365726e616d65" + // string(username)
      "0800000070617373776f7264" + // string(password)
      "b1000000" + // major version 177
      "200000006435316339613765393335333734366136303230663936303264343532393239" + // string(md5hex) = d51c9a7e...
      "01000000"; // minor version 1

    expect(hex).toBe(expected);
  });

  test("hash is md5(username+password)", () => {
    // Confirm via a fresh hash derivation to ensure the algorithm matches.
    // d51c9a7e9353746a6020f9602d452929 was computed externally as md5("usernamepassword").
    const raw = buildLogin("username", "password").toString("hex");
    expect(raw).toContain("6435316339613765393335333734366136303230663936303264343532393239");
  });
});

describe("buildSetWaitPort", () => {
  test("frames code 2 with the port", () => {
    const raw = buildSetWaitPort(1337);
    const parsed = tryParseMessage(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.code).toBe(SERVER_MESSAGE_CODES.setWaitPort);
    expect(parsed!.payload.readUInt32LE(0)).toBe(1337);
  });
});

describe("frameMessage / tryParseMessage", () => {
  test("frames a payload correctly", () => {
    const raw = frameMessage(42, Buffer.from("hi"));
    // len = 2 + 4 = 6, code = 42, payload = "hi"
    expect(raw.readUInt32LE(0)).toBe(6);
    expect(raw.readUInt32LE(4)).toBe(42);
    expect(raw.subarray(8).toString()).toBe("hi");
  });

  test("returns null when incomplete", () => {
    const raw = frameMessage(42, Buffer.from("hello world"));
    expect(tryParseMessage(raw.subarray(0, 5))).toBeNull();
    expect(tryParseMessage(Buffer.alloc(0))).toBeNull();
  });
});

describe("parseLoginResponse", () => {
  test("parses a success response", () => {
    const payload = Buffer.concat([
      Buffer.from([1]), // success
      packString("Welcome to Soulseek!"), // banner
      packIp("192.168.1.1"), // ip
      packString("abcd1234"), // checksum (md5 of password)
      packBool(true), // isSupporter
    ]);
    const resp = parseLoginResponse(payload);
    expect(resp.success).toBe(true);
    if (resp.success) {
      expect(resp.banner).toBe("Welcome to Soulseek!");
      expect(resp.ipAddress).toBe("192.168.1.1");
      expect(resp.checksum).toBe("abcd1234");
      expect(resp.isSupporter).toBe(true);
    }
  });

  test("parses a failure response with reason", () => {
    const payload = Buffer.concat([
      Buffer.from([0]),
      packString(LOGIN_REJECT_REASONS.INVALID_PASSWORD),
    ]);
    const resp = parseLoginResponse(payload);
    expect(resp.success).toBe(false);
    if (!resp.success) {
      expect(resp.rejectionReason).toBe(LOGIN_REJECT_REASONS.INVALID_PASSWORD);
      expect(resp.rejectionDetail).toBeUndefined();
    }
  });

  test("parses a failure response with detail (INVALIDUSERNAME)", () => {
    const payload = Buffer.concat([
      Buffer.from([0]),
      packString(LOGIN_REJECT_REASONS.INVALID_USERNAME),
      packString("The username does not exist."),
    ]);
    const resp = parseLoginResponse(payload);
    if (!resp.success) {
      expect(resp.rejectionReason).toBe(LOGIN_REJECT_REASONS.INVALID_USERNAME);
      expect(resp.rejectionDetail).toBe("The username does not exist.");
    }
  });
});

describe("describeRejection", () => {
  test("maps known reasons to friendly text", () => {
    expect(describeRejection(LOGIN_REJECT_REASONS.INVALID_PASSWORD)).toBe("Incorrect password.");
    expect(describeRejection(LOGIN_REJECT_REASONS.SERVER_FULL)).toContain("full");
  });

  test("falls back for unknown reasons", () => {
    expect(describeRejection("WEIRD")).toContain("WEIRD");
  });
});

describe("constants", () => {
  test("experimental client version is used", () => {
    expect(MAJOR_VERSION).toBe(177);
    expect(MINOR_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("buildFileSearch", () => {
  test("frames code 26 with token and query", () => {
    const raw = buildFileSearch(42, "hello world");
    const parsed = tryParseMessage(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.code).toBe(SERVER_MESSAGE_CODES.fileSearch);
    let offset = 0;
    const token = parsed!.payload.readUInt32LE(offset);
    offset += 4;
    const len = parsed!.payload.readUInt32LE(offset);
    offset += 4;
    const query = parsed!.payload.subarray(offset, offset + len).toString("utf8");
    expect(token).toBe(42);
    expect(query).toBe("hello world");
  });
});

describe("buildPeerInit / parsePeerInit", () => {
  test("frames init code 1 as uint8 and round-trips user/type", () => {
    const raw = buildPeerInit("alice", "P");
    // [uint32 len][uint8 code=1][payload...]
    expect(raw[4]).toBe(1);
    const init = parsePeerInit(raw.subarray(5));
    expect(init.targetUser).toBe("alice");
    expect(init.connType).toBe("P");
  });
});

describe("parseFileSearchResponse", () => {
  function buildPayload(opts: {
    username: string;
    token: number;
    freeUploadSlots: boolean;
    uploadSpeed: number;
    inQueue: number;
    files: Array<{ name: string; size: number; attrs: Array<[number, number]> }>;
  }): Buffer {
    const parts: Buffer[] = [];
    parts.push(packString(opts.username));
    parts.push(packUint32(opts.token));
    parts.push(packUint32(opts.files.length));
    for (const f of opts.files) {
      parts.push(Buffer.from([1])); // result code
      parts.push(packString(f.name));
      parts.push(Buffer.concat([packUint32(f.size >>> 0), packUint32(0)])); // uint64 (low + high)
      parts.push(packUint32(0)); // obsolete ext length
      parts.push(packUint32(f.attrs.length));
      for (const [type, value] of f.attrs) {
        parts.push(packUint32(type));
        parts.push(packUint32(value));
      }
    }
    parts.push(Buffer.from([opts.freeUploadSlots ? 1 : 0]));
    parts.push(packUint32(opts.uploadSpeed));
    parts.push(packUint32(opts.inQueue));
    return Buffer.concat(parts);
  }

  test("parses zlib-compressed results with attributes", () => {
    const payload = buildPayload({
      username: "bob",
      token: 7,
      freeUploadSlots: true,
      uploadSpeed: 1234,
      inQueue: 0,
      files: [
        {
          name: "song.mp3",
          size: 5_000_000,
          attrs: [
            [0, 320], // bitrate
            [1, 210], // length (seconds)
            [2, 0], // vbr
          ],
        },
        {
          name: "track.flac",
          size: 40_000_000,
          attrs: [
            [1, 300], // length
            [4, 44100], // sample rate
            [5, 16], // bit depth
          ],
        },
      ],
    });

    const result = parseFileSearchResponse(deflateSync(payload));
    expect(result.token).toBe(7);
    expect(result.username).toBe("bob");
    expect(result.freeUploadSlots).toBe(true);
    expect(result.uploadSpeed).toBe(1234);
    expect(result.inQueue).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("song.mp3");
    expect(result.results[0].size).toBe(5_000_000);
    expect(result.results[0].attrs.bitrate).toBe(320);
    expect(result.results[0].attrs.length).toBe(210);
    expect(result.results[1].attrs.sampleRate).toBe(44100);
    expect(result.results[1].attrs.bitDepth).toBe(16);
  });
});

describe("user info — server message builders", () => {
  test("buildWatchUser frames code 5", () => {
    const raw = buildWatchUser("alice");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.watchUser);
    expect(p.payload.subarray(4).toString("utf8")).toBe("alice");
  });

  test("buildUserInterests frames code 57", () => {
    const raw = buildUserInterests("bob");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.userInterests);
    expect(p.payload.subarray(4).toString("utf8")).toBe("bob");
  });

  test("buildGetPeerAddress frames code 3", () => {
    const raw = buildGetPeerAddress("carol");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.getPeerAddress);
    expect(p.payload.subarray(4).toString("utf8")).toBe("carol");
  });
});

describe("user info — server message parsers", () => {
  test("parseUserStatus", () => {
    const payload = Buffer.concat([
      packString("alice"),
      packUint32(2), // online
      packBool(true), // privileged
    ]);
    const s = parseUserStatus(payload);
    expect(s.username).toBe("alice");
    expect(s.status).toBe(2);
    expect(s.privileged).toBe(true);
  });

  test("parseUserStats", () => {
    const payload = Buffer.concat([
      packString("bob"),
      packUint32(1234), // avgspeed
      packUint32(5), // uploadnum
      packUint32(0), // unknown
      packUint32(100), // files
      packUint32(7), // dirs
    ]);
    const s = parseUserStats(payload);
    expect(s.avgspeed).toBe(1234);
    expect(s.files).toBe(100);
    expect(s.dirs).toBe(7);
  });

  test("parseUserInterests", () => {
    const parts = [
      packString("carol"),
      packUint32(2),
      packString("jazz"),
      packString("soul"),
      packUint32(1),
      packString("pop"),
    ];
    const i = parseUserInterests(Buffer.concat(parts));
    expect(i.likes).toEqual(["jazz", "soul"]);
    expect(i.hates).toEqual(["pop"]);
  });

  test("parseRecommendations", () => {
    const parts = [
      packUint32(1),
      packString("rock"),
      Buffer.from([5, 0, 0, 0]), // int32 rating = 5 (little-endian)
      packUint32(0),
    ];
    const { recommendations, unrecommendations } = parseRecommendations(Buffer.concat(parts));
    expect(recommendations).toEqual([{ thing: "rock", rating: 5 }]);
    expect(unrecommendations).toHaveLength(0);
  });

  test("parseSimilarUsers", () => {
    const parts = [
      packUint32(1),
      packString("dave"),
      packUint32(3), // rating
    ];
    const users = parseSimilarUsers(Buffer.concat(parts));
    expect(users).toEqual([{ username: "dave", rating: 3 }]);
  });

  test("parseItemRecommendations and parseItemSimilarUsers", () => {
    const recParts = [packString("rock"), packUint32(1), packString("alt"), packUint32(2)];
    const rec = parseItemRecommendations(Buffer.concat(recParts));
    expect(rec.thing).toBe("rock");
    expect(rec.recommendations).toEqual([{ thing: "alt", rating: 2 }]);

    const simParts = [packString("rock"), packUint32(1), packString("eve"), packUint32(4)];
    const sim = parseItemSimilarUsers(Buffer.concat(simParts));
    expect(sim.thing).toBe("rock");
    expect(sim.users).toEqual([{ username: "eve", rating: 4 }]);
  });

  test("parsePeerAddress", () => {
    const payload = Buffer.concat([
      packString("frank"),
      packIp("10.0.0.5"),
      packUint32(2234),
    ]);
    const addr = parsePeerAddress(payload);
    expect(addr.username).toBe("frank");
    expect(addr.ip).toBe("10.0.0.5");
    expect(addr.port).toBe(2234);
  });
});

describe("user info — peer UserInfoResponse", () => {
  test("round-trips description, picture and upload fields", () => {
    const pic = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // fake PNG header
    const raw = buildUserInfoResponse({
      descr: "hello world",
      pic,
      totalupl: 3,
      queuesize: 2,
      slotsavail: true,
      uploadallowed: 1,
    });
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(16);
    const msg = parseUserInfoResponse(p.payload, "grace");
    expect(msg.username).toBe("grace");
    expect(msg.descr).toBe("hello world");
    expect(msg.pic?.equals(pic)).toBe(true);
    expect(msg.totalupl).toBe(3);
    expect(msg.queuesize).toBe(2);
    expect(msg.slotsavail).toBe(true);
    expect(msg.uploadallowed).toBe(1);
  });

  test("handles missing picture", () => {
    const raw = buildUserInfoResponse({
      descr: "no pic",
      pic: null,
      totalupl: 0,
      queuesize: 0,
      slotsavail: false,
      uploadallowed: 0,
    });
    const p = tryParseMessage(raw)!;
    const msg = parseUserInfoResponse(p.payload, "heidi");
    expect(msg.pic).toBeNull();
    expect(msg.descr).toBe("no pic");
  });
});

describe("Phase 0 — recommendations empty + 1001 + 121", () => {
  test("Recommendations 54 empty frame", () => {
    const raw = buildRecommendationsEmpty();
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.recommendations);
    expect(p.payload.length).toBe(0);
  });
  test("GlobalRecommendations 56 empty frame", () => {
    const raw = buildGlobalRecommendationsEmpty();
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.globalRecommendations);
    expect(p.payload.length).toBe(0);
  });
  test("SimilarUsers 110 empty frame", () => {
    const raw = buildSimilarUsersEmpty();
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.similarUsers);
    expect(p.payload.length).toBe(0);
  });
  test("CantConnectToPeer 1001 round-trip", () => {
    const raw = buildCantConnectToPeer(12345, "alice");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.cantConnectToPeer);
    const parsed = parseCantConnectToPeer(p.payload);
    expect(parsed.token).toBe(12345);
    expect(parsed.username).toBe("alice");
  });
  test("SendUploadSpeed 121 round-trip", () => {
    const raw = buildSendUploadSpeed(98765);
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.sendUploadSpeed);
    expect(p.payload.readUInt32LE(0)).toBe(98765);
  });
  test("tryParseMessage enforces MAX_INCOMING", () => {
    const oversized = Buffer.alloc(8);
    oversized.writeUInt32LE(MAX_INCOMING.server16M + 1, 0);
    oversized.writeUInt32LE(42, 4);
    expect(tryParseMessage(oversized)).toBeNull();
    expect(tryParseMessage(oversized, MAX_INCOMING.server448M)).toBeNull();
  });
});

describe("Phase 0 — obfuscation tail", () => {
  test("parseConnectToPeer handles uint32 obfuscation trailing", () => {
    const parts = [
      packString("bob"), packString("P"),
      packIp("1.2.3.4"), packUint32(2234), packUint32(999), Buffer.from([1]),
      packUint32(1), packUint32(4321),
    ];
    const payload = Buffer.concat(parts);
    const ctp = parseConnectToPeer(payload);
    expect(ctp.obfuscationType).toBe(1);
    expect(ctp.obfuscatedPort).toBe(4321);
  });
  test("parseConnectToPeer handles uint16 trailing", () => {
    const parts = [
      packString("carol"), packString("F"),
      packIp("5.6.7.8"), packUint32(2234), packUint32(555), Buffer.from([0]),
      packUint32(2), packUint16(1234),
    ];
    const payload = Buffer.concat(parts);
    const ctp = parseConnectToPeer(payload);
    expect(ctp.obfuscationType).toBe(2);
    expect(ctp.obfuscatedPort).toBe(1234);
  });
  test("parsePeerAddress handles obfuscation", () => {
    const payload = Buffer.concat([packString("dave"), packIp("10.0.0.1"), packUint32(2234), packUint32(3), packUint16(5678)]);
    const addr = parsePeerAddress(payload);
    expect(addr.obfuscationType).toBe(3);
    expect(addr.obfuscatedPort).toBe(5678);
  });
});

describe("Phase 1 — zlib caps", () => {
  test("parseFileSearchResponse rejects oversized compressed (>16M)", () => {
    const big = Buffer.alloc(16 * 1024 * 1024 + 1);
    expect(() => parseFileSearchResponse(big)).toThrow("too large");
  });
});

describe("transfers — protocol shims (Phase 0)", () => {
  test("packUint64LE / unpackUint64LE round-trips, incl. 2^32", () => {
    expect(unpackUint64LE(packUint64LE(1024))).toBe(1024);
    expect(unpackUint64LE(packUint64LE(4_294_967_296))).toBe(4_294_967_296);
    expect(packUint64LE(4_294_967_296).toString("hex")).toBe("0000000001000000");
  });

  test("buildQueueUpload frames peer code 43 and round-trips", () => {
    const raw = buildQueueUpload("file.mp3");
    expect(raw.toString("hex")).toBe("100000002b0000000800000066696c652e6d7033");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(PEER_MESSAGE_CODES.queueUpload);
    expect(parseQueueUpload(p.payload).file).toBe("file.mp3");
  });

  test("buildTransferRequest (upload) carries direction/token/file/size", () => {
    const raw = buildTransferRequest(1, 5, "a.mp3", 1024);
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(PEER_MESSAGE_CODES.transferRequest);
    const msg = parseTransferRequest(p.payload);
    expect(msg.direction).toBe(1);
    expect(msg.token).toBe(5);
    expect(msg.file).toBe("a.mp3");
    expect(msg.size).toBe(1024);
  });

  test("buildTransferRequest (download) omits size", () => {
    const raw = buildTransferRequest(0, 9, "b.mp3");
    const msg = parseTransferRequest(tryParseMessage(raw)!.payload);
    expect(msg.direction).toBe(0);
    expect(msg.token).toBe(9);
    expect(msg.file).toBe("b.mp3");
    expect(msg.size).toBeUndefined();
  });

  test("buildTransferResponse allowed carries size, denied carries reason", () => {
    const ok = tryParseMessage(buildTransferResponse(7, true, 2048))!;
    expect(ok.code).toBe(PEER_MESSAGE_CODES.transferResponse);
    expect(parseTransferResponse(ok.payload)).toEqual({ token: 7, allowed: true, size: 2048 });
    const no = tryParseMessage(buildTransferResponse(7, false, "File not shared."))!;
    expect(parseTransferResponse(no.payload)).toEqual({ token: 7, allowed: false, reason: "File not shared." });
  });

  test("PlaceInQueue / UploadFailed / UploadDenied round-trip", () => {
    const q = tryParseMessage(buildPlaceInQueueResponse("x.flac", 3))!;
    expect(q.code).toBe(PEER_MESSAGE_CODES.placeInQueueResponse);
    expect(parsePlaceInQueueResponse(q.payload)).toEqual({ file: "x.flac", place: 3 });
    expect(parseUploadFailed(tryParseMessage(buildUploadFailed("y.wav"))!.payload).file).toBe("y.wav");
    expect(parseUploadDenied(tryParseMessage(buildUploadDenied("z.mp3", "Banned"))!.payload)).toEqual({ file: "z.mp3", reason: "Banned" });
    expect(parsePlaceInQueueRequest(tryParseMessage(buildPlaceInQueueRequest("q.ogg"))!.payload).file).toBe("q.ogg");
  });

  test("server relays frame correct codes", () => {
    expect(tryParseMessage(buildConnectToPeer(11, "bob", "F"))!.code).toBe(SERVER_MESSAGE_CODES.connectToPeer);
    expect(tryParseMessage(buildCantConnectToPeer(11))!.code).toBe(SERVER_MESSAGE_CODES.cantConnectToPeer);
    expect(tryParseMessage(buildSendUploadSpeed(500_000))!.code).toBe(SERVER_MESSAGE_CODES.sendUploadSpeed);
  });

  test("FileTransferInit / FileOffset parse raw F bytes", () => {
    const init = Buffer.alloc(4);
    init.writeUInt32LE(42, 0);
    expect(parseFileTransferInit(init).token).toBe(42);
    expect(parseFileOffset(packUint64LE(8192))).toBe(8192);
  });

  test("buildUserSearch frames code 42 with username/token/query", () => {
    const raw = buildUserSearch("bob", 99, "hello");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.userSearch);
    const r = new SlskReader(p.payload);
    expect(r.string()).toBe("bob");
    expect(r.uint32()).toBe(99);
    expect(r.string()).toBe("hello");
  });

  test("buildRoomSearch frames code 120 with room/token/query", () => {
    const raw = buildRoomSearch("myroom", 77, "query term");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.roomSearch);
    const r = new SlskReader(p.payload);
    expect(r.string()).toBe("myroom");
    expect(r.uint32()).toBe(77);
    expect(r.string()).toBe("query term");
  });

  test("buildWishlistSearch frames code 103 with token/query", () => {
    const raw = buildWishlistSearch(55, "wishlist query");
    const p = tryParseMessage(raw)!;
    expect(p.code).toBe(SERVER_MESSAGE_CODES.wishlistSearch);
    const r = new SlskReader(p.payload);
    expect(r.uint32()).toBe(55);
    expect(r.string()).toBe("wishlist query");
  });

  test("PlaceInQueueRequest uses code 51, Response uses 44 (not confused)", () => {
    const req = tryParseMessage(buildPlaceInQueueRequest("file.mp3"))!;
    const resp = tryParseMessage(buildPlaceInQueueResponse("file.mp3", 3))!;
    expect(req.code).toBe(PEER_MESSAGE_CODES.placeInQueueRequest);
    expect(req.code).toBe(51);
    expect(resp.code).toBe(PEER_MESSAGE_CODES.placeInQueueResponse);
    expect(resp.code).toBe(44);
    expect(parsePlaceInQueueRequest(req.payload).file).toBe("file.mp3");
    expect(parsePlaceInQueueResponse(resp.payload).place).toBe(3);
  });
});
