/**
 * Minimal Soulseek (SLSK) protocol implementation for server login.
 *
 * Based on Nicotine+'s protocol documentation (doc/SLSKPROTOCOL.md) and the
 * reference implementation in pynicotine/slskmessages.py and slskproto.py.
 *
 * We only implement what's needed to authenticate with the server:
 *   - message framing  [uint32 len][uint32 code][payload]
 *   - Login (code 1)   send + parse response
 *   - SetWaitPort (code 2)
 */

/** Server message codes (subset). */
export const SERVER_MESSAGE_CODES = {
  login: 1,
  setWaitPort: 2,
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
  // We don't expose inbound peers in the MVP; a placeholder port satisfies
  // the server handshake. SetWaitPort is required immediately after Login.
  return frameMessage(SERVER_MESSAGE_CODES.setWaitPort, packUint32(port));
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
