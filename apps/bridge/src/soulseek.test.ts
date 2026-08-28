import { describe, expect, test } from "bun:test";
import {
  buildLogin,
  buildSetWaitPort,
  parseLoginResponse,
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
