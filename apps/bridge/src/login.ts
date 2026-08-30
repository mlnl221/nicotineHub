// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/slskproto.py login flow

/**
 * Performs the Soulseek login handshake over a raw TCP socket.
 * Uses Bun's Bun.connect().
 */
import type { Socket } from "bun";
import {
  buildLogin,
  buildSetWaitPort,
  describeRejection,
  parseLoginResponse,
  tryParseMessage,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  SERVER_MESSAGE_CODES,
  type LoginResponse,
} from "./soulseek.ts";

export interface LoginOptions {
  username: string;
  password: string;
  host?: string;
  port?: number;
  /**
   * Placeholder port reported to the server via SetWaitPort. Kept minimal;
   * the MVP does not open an inbound listener.
   */
  listenPort?: number;
  /** Max time to wait for the server's login response (ms). */
  timeoutMs?: number;
}

export type LoginOutcome =
  | { ok: true; data: LoginResponse & { success: true } }
  | { ok: false; error: string };

interface SocketData {
  sentLogin: boolean;
  sentWaitPort: boolean;
}

export async function loginToServer(
  opts: LoginOptions,
  signal?: AbortSignal,
): Promise<LoginOutcome> {
  const host = opts.host || DEFAULT_SERVER_HOST;
  const port = opts.port || DEFAULT_SERVER_PORT;
  const listenPort = opts.listenPort ?? 2234;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let settled = false;
  let buffer = Buffer.alloc(0);
  let socket: Socket<SocketData> | undefined;

  const settle = (outcome: LoginOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    try {
      socket?.end();
    } catch {
      /* noop */
    }
    resolve(outcome);
  };

  let resolve!: (value: LoginOutcome) => void;
  const promise = new Promise<LoginOutcome>((r) => (resolve = r));

  const onAbort = () => settle({ ok: false, error: "Login request was cancelled." });
  const timer = setTimeout(
    () => settle({ ok: false, error: "Timed out waiting for the server to respond." }),
    timeoutMs,
  );

  signal?.addEventListener("abort", onAbort, { once: true });

  const openHandler = (sock: Socket<SocketData>) => {
    sock.data.sentLogin = true;
    sock.data.sentWaitPort = true;
    // Send Login immediately, followed by SetWaitPort. Batch into a single
    // write to avoid extra syscalls on the handshake.
    sock.write(buildLogin(opts.username, opts.password));
    sock.write(buildSetWaitPort(listenPort));
  };

  const dataHandler = (sock: Socket<SocketData>, chunk: ArrayBuffer | Uint8Array) => {
    const chunkBytes =
      chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    buffer = Buffer.concat([buffer, Buffer.from(chunkBytes)]);

    while (true) {
      const msg = tryParseMessage(buffer);
      if (!msg) break;
      buffer = buffer.subarray(8 + msg.payload.length);

      if (msg.code === SERVER_MESSAGE_CODES.login) {
        const resp = parseLoginResponse(msg.payload);
        if (resp.success) {
          settle({ ok: true, data: resp });
        } else {
          settle({ ok: false, error: describeRejection(resp.rejectionReason) });
        }
      }
    }
  };

  try {
    socket = await Bun.connect<SocketData>({
      hostname: host,
      port,
      data: { sentLogin: false, sentWaitPort: false },
      socket: {
        open: openHandler,
        data: dataHandler,
        error(_sock, error) {
          settle({ ok: false, error: `Connection error: ${error.message}` });
        },
        close() {
          settle({
            ok: false,
            error: "The connection to the server was closed before login completed.",
          });
        },
      },
    });
  } catch (error) {
    settle({ ok: false, error: `Unable to connect: ${(error as Error).message}` });
  }

  return promise;
}
