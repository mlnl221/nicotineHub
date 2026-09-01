import { describe, expect, test } from "bun:test";
import { encodeRotated, decodeRotated, ROTATED_OBFUSCATION_TYPE, tryParseObfuscatedInit, tryParseObfuscatedMessage, encodeObfuscatedFrame } from "./obfuscation.ts";
import { frameInitMessage, frameMessage, packString, packUint32 } from "./soulseek.ts";

describe("obfuscation rotated", () => {
  test("ROTATED type is 1", () => {
    expect(ROTATED_OBFUSCATION_TYPE).toBe(1);
  });

  test("encode/decode roundtrip", () => {
    const input = Buffer.from("hello world soulseek");
    const key = 0x12345678;
    const enc = encodeRotated(input, key);
    expect(enc.length).toBe(4 + input.length);
    expect(enc.readUInt32LE(0)).toBe(key >>> 0);
    const dec = decodeRotated(enc);
    expect(dec.toString()).toBe(input.toString());
  });

  test("decode too short throws", () => {
    expect(() => decodeRotated(Buffer.alloc(3))).toThrow();
  });

  test("encodeObfuscatedFrame roundtrip init", () => {
    const plain = frameInitMessage(1, Buffer.concat([packString("user"), packString("P"), packUint32(0)]));
    const ob = encodeObfuscatedFrame(plain, 0xdeadbeef);
    const dec = decodeRotated(ob);
    expect(dec.equals(plain)).toBe(true);
  });

  test("encodeObfuscatedFrame roundtrip message", () => {
    const plain = frameMessage(15, Buffer.alloc(0));
    const ob = encodeObfuscatedFrame(plain, 0x01020304);
    const dec = decodeRotated(ob);
    expect(dec.equals(plain)).toBe(true);
  });

  test("keystream rotate_left 1 per chunk", () => {
    // Verify slskr vector: key 0 -> first chunk key 0 rotated 0 -> 0, so xor with 0 => unchanged
    const input = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const enc0 = encodeRotated(input, 0);
    // key 0 -> after rotate key=0, xor with 0 => same bytes
    expect(enc0.subarray(4).equals(input)).toBe(true);
    // key 0x80000000 -> rotate_left => 0x00000001 -> LE bytes [01,00,00,00]
    const enc1 = encodeRotated(Buffer.from([0x00, 0x00, 0x00, 0x00]), 0x80000000);
    // first chunk xor with 01 00 00 00 => [01,00,00,00]
    expect(enc1.subarray(4).equals(Buffer.from([0x01, 0x00, 0x00, 0x00]))).toBe(true);
  });

  test("tryParseObfuscatedInit detects valid", () => {
    const plainInit = frameInitMessage(1, Buffer.concat([packString("alice"), packString("P"), packUint32(0)]));
    const ob = encodeRotated(plainInit, 12345);
    const parsed = tryParseObfuscatedInit(ob);
    expect(parsed).not.toBeNull();
    expect(parsed!.code).toBe(1);
    expect(parsed!.rawLen).toBe(ob.length);
  });

  test("tryParseObfuscatedInit rejects plain", () => {
    const plainInit = frameInitMessage(1, Buffer.concat([packString("bob"), packString("P"), packUint32(0)]));
    expect(tryParseObfuscatedInit(plainInit)).toBeNull();
  });

  test("tryParseObfuscatedMessage detects valid", () => {
    const plainMsg = frameMessage(5, Buffer.from("hello"));
    const ob = encodeRotated(plainMsg, 9999);
    const parsed = tryParseObfuscatedMessage(ob);
    expect(parsed).not.toBeNull();
    expect(parsed!.code).toBe(5);
    expect(parsed!.rawLen).toBe(ob.length);
  });

  test("tryParseObfuscatedMessage rejects short", () => {
    expect(tryParseObfuscatedMessage(Buffer.alloc(5))).toBeNull();
  });

  test("random key roundtrip many sizes", () => {
    for (let i = 0; i < 20; i++) {
      const sz = Math.floor(Math.random() * 200);
      const input = Buffer.alloc(sz, i);
      const key = Math.floor(Math.random() * 0xffffffff) >>> 0;
      const enc = encodeRotated(input, key);
      const dec = decodeRotated(enc);
      expect(dec.equals(input)).toBe(true);
    }
  });
});
