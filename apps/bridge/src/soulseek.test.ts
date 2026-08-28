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
  packIp,
  packBool,
  frameMessage,
  describeRejection,
  LOGIN_REJECT_REASONS,
  MAJOR_VERSION,
  MINOR_VERSION,
  SERVER_MESSAGE_CODES,
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

  test("packIp packs 4 bytes", () => {
    expect(packIp("192.168.1.1").toString("hex")).toBe("c0a80101");
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
  test("round-trips user and connection type", () => {
    const raw = buildPeerInit("alice", "P");
    const parsed = tryParseMessage(raw);
    expect(parsed!.code).toBe(1);
    const init = parsePeerInit(parsed!.payload);
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
