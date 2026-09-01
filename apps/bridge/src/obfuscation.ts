// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Port of slskr crates/slskr-protocol/src/obfuscation.rs (AGPL-3.0) — type-1 rotated key stream

export const ROTATED_OBFUSCATION_TYPE = 1;

/**
 * Encode `input` with rotated obfuscation `key`.
 * Wire format: [u32 LE key][payload XOR keystream]
 * Keystream: key = key.rotate_left(1) per 4-byte chunk.
 * Mirrors slskr encode_rotated.
 */
export function encodeRotated(input: Buffer, key: number): Buffer {
  const k = key >>> 0;
  const out = Buffer.alloc(4 + input.length);
  out.writeUInt32LE(k, 0);
  input.copy(out, 4);
  applyRotatedKeystream(out.subarray(4), k);
  return out;
}

export function decodeRotated(input: Buffer): Buffer {
  if (input.length < 4) throw new Error("obfuscation: too short (<4)");
  const key = input.readUInt32LE(0);
  const out = Buffer.from(input.subarray(4));
  applyRotatedKeystream(out, key);
  return out;
}

function applyRotatedKeystream(buf: Buffer, initialKey: number): void {
  let key = initialKey >>> 0;
  for (let off = 0; off < buf.length; off += 4) {
    key = ((key << 1) | (key >>> 31)) >>> 0; // rotate_left(1)
    const k0 = key & 0xff;
    const k1 = (key >>> 8) & 0xff;
    const k2 = (key >>> 16) & 0xff;
    const k3 = (key >>> 24) & 0xff;
    if (off < buf.length) buf[off] ^= k0;
    if (off + 1 < buf.length) buf[off + 1] ^= k1;
    if (off + 2 < buf.length) buf[off + 2] ^= k2;
    if (off + 3 < buf.length) buf[off + 3] ^= k3;
  }
}

/**
 * Encode a Soulseek init/message frame `[len][code][payload]` with obfuscation.
 * Same as slskr `write_obfuscated_init_frame` etc.
 */
export function encodeObfuscatedFrame(frame: Buffer, key?: number): Buffer {
  const useKey = (key ?? (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0;
  return encodeRotated(frame, useKey);
}

export function decodeObfuscatedFrame(obfuscated: Buffer): Buffer {
  return decodeRotated(obfuscated);
}

/** Try decode as obfuscated; return null if too short or decode would yield invalid length. */
export function tryDecodeObfuscated(buf: Buffer): Buffer | null {
  if (buf.length < 8) return null;
  try {
    const decoded = decodeRotated(buf);
    if (decoded.length < 4) return null;
    const len = decoded.readUInt32LE(0);
    if (len > 16 * 1024 * 1024) return null; // MAX frame 16M like slskr
    if (len + 4 !== decoded.length && len + 1 !== decoded.length) {
      // Might be partial buffer — still consider valid if len+4 <= decoded.length+slack
      // Require at least len bytes present for init vs message ambiguity
      if (decoded.length < 4 + len && decoded.length < 1 + len) return null;
    }
    return decoded;
  } catch { return null; }
}

/** Try parse obfuscated init frame [key][len][code8][payload] */
export function tryParseObfuscatedInit(buf: Buffer): { code: number; payload: Buffer; rawLen: number } | null {
  if (buf.length < 9) return null;
  try {
    // Need to peek len+code; decode first 9 raw = key4 + encoded len4+code1
    const probe = buf.subarray(0, 9);
    const decProbe = decodeRotated(probe); // decProbe = [len4][code1]
    if (decProbe.length < 5) return null;
    const len = decProbe.readUInt32LE(0);
    const code = decProbe[4];
    if (code !== 0 && code !== 1) return null;
    if (len < 1 || len > 1024 * 1024) return null;
    const rawNeeded = 4 + 4 + len; // key + len+code+payload
    if (buf.length < rawNeeded) return null;
    const rawFrame = buf.subarray(0, rawNeeded);
    const decoded = decodeRotated(rawFrame); // decoded = [len4][code1][payload]
    if (decoded.length < 4 + len) return null;
    const c = decoded[4];
    const payload = decoded.subarray(5, 5 + len - 1);
    if (c !== 0 && c !== 1) return null;
    return { code: c, payload, rawLen: rawNeeded };
  } catch { return null; }
}

/** Try parse obfuscated message frame [key][len][code32][payload] */
export function tryParseObfuscatedMessage(buf: Buffer): { code: number; payload: Buffer; rawLen: number } | null {
  if (buf.length < 12) return null; // key4 + len4 + code4 minimum
  try {
    // Probe first 12 raw = key4 + encoded len4+code4
    const probe = buf.subarray(0, 12);
    const decProbe = decodeRotated(probe);
    if (decProbe.length < 8) return null;
    const len = decProbe.readUInt32LE(0);
    const code = decProbe.readUInt32LE(4);
    if (len < 4 || len > 16 * 1024 * 1024) return null;
    const rawNeeded = 4 + 4 + len;
    if (buf.length < rawNeeded) return null;
    const rawFrame = buf.subarray(0, rawNeeded);
    const decoded = decodeRotated(rawFrame);
    if (decoded.length < 4 + len) return null;
    const c = decoded.readUInt32LE(4);
    const payload = decoded.subarray(8, 8 + len - 4);
    // Validate code is plausible peer code (allow unknown too but at least 1..1000)
    // For now accept any; caller validates per-code max
    return { code: c, payload, rawLen: rawNeeded };
  } catch { return null; }
}
