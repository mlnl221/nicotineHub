/**
 * Persistent Soulseek session.
 *
 * Mirrors nicotine-plus: authenticate over the server TCP connection, advertise
 * a real listen port via SetWaitPort, keep the connection open, and accept
 * inbound peer connections to receive FileSearchResponse (peer code 9) results.
 */
import type { Socket, TCPSocketListener } from "bun";
import { inflateSync } from "node:zlib";
import {
  buildFileSearch,
  buildLogin,
  buildPeerInit,
  buildSetWaitPort,
  parseFileSearchResponse,
  parseLoginResponse,
  parsePeerInit,
  tryParseMessage,
  SERVER_MESSAGE_CODES,
  type LoginResponse,
} from "./soulseek.ts";

export interface SearchFile {
  name: string;
  size: number;
  attrs: {
    bitrate?: number;
    length?: number;
    vbr?: number;
    sampleRate?: number;
    bitDepth?: number;
  };
}

export interface SearchResponse {
  token: number;
  username: string;
  freeUploadSlots: boolean;
  uploadSpeed: number;
  inQueue: number;
  results: SearchFile[];
}

export interface SearchHandlers {
  onResult: (resp: SearchResponse) => void;
  onDone: () => void;
  timeoutMs?: number;
}

interface ActiveSearch extends SearchHandlers {
  timer?: ReturnType<typeof setTimeout>;
}

export interface SessionOptions {
  username: string;
  password: string;
  host?: string;
  port?: number;
  listenPort: number;
  signal?: AbortSignal;
}

export class SoulseekSession {
  readonly username: string;
  private serverSocket: Socket | undefined;
  private listener: TCPSocketListener | undefined;
  private serverBuffer = Buffer.alloc(0);
  private peerBuffers = new WeakMap<Socket, Buffer>();
  private searches = new Map<number, ActiveSearch>();
  private tokenCounter = 1;
  private loggedIn = false;
  private loginResolve: ((r: LoginResponse & { success: true }) => void) | undefined;
  private loginReject: ((e: Error) => void) | undefined;

  constructor(private readonly opts: SessionOptions) {
    this.username = opts.username;
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
      }
    }
  }

  private startListener() {
    this.listener = Bun.listen({
      port: this.opts.listenPort,
      hostname: "0.0.0.0",
      socket: {
        open: () => {},
        data: (peer, chunk) => this.handlePeerData(peer as Socket, chunk),
        error: () => {},
        close: () => {},
      },
    });
  }

  private handlePeerData(peer: Socket, chunk: ArrayBuffer | Uint8Array) {
    const bytes = chunk instanceof Uint8Array ? Uint8Array.from(chunk) : new Uint8Array(chunk);
    let buf = this.peerBuffers.get(peer) ?? Buffer.alloc(0);
    buf = Buffer.concat([buf, Buffer.from(bytes)]);

    while (true) {
      const msg = tryParseMessage(buf);
      if (!msg) break;
      buf = buf.subarray(8 + msg.payload.length);

      if (msg.code === 1) {
        // PeerInit handshake — we are the connected-to peer; just acknowledge.
        parsePeerInit(msg.payload);
      } else if (msg.code === 9) {
        // FileSearchResponse (zlib compressed).
        try {
          const resp = parseFileSearchResponse(msg.payload);
          this.searches.get(resp.token)?.onResult(resp);
        } catch {
          // Malformed response; ignore.
        }
      }
    }

    this.peerBuffers.set(peer, buf);
  }

  /** Send a FileSearch and stream results to the supplied handlers. Returns the token. */
  search(query: string, handlers: SearchHandlers): number {
    const token = this.tokenCounter++;
    const search: ActiveSearch = {
      ...handlers,
      timeoutMs: handlers.timeoutMs ?? 15_000,
    };
    search.timer = setTimeout(() => {
      this.searches.delete(token);
      handlers.onDone();
    }, search.timeoutMs);
    this.searches.set(token, search);

    this.serverSocket?.write(buildFileSearch(token, query));
    return token;
  }

  /** Stop a search early (e.g. user cancelled or navigated away). */
  cancelSearch(token: number) {
    const search = this.searches.get(token);
    if (!search) return;
    if (search.timer) clearTimeout(search.timer);
    this.searches.delete(token);
    search.onDone();
  }

  /** Tear down the server connection and peer listener. */
  close() {
    for (const search of this.searches.values()) {
      if (search.timer) clearTimeout(search.timer);
      search.onDone();
    }
    this.searches.clear();
    this.serverSocket?.end();
    this.listener?.stop();
    this.serverSocket = undefined;
    this.listener = undefined;
  }
}
