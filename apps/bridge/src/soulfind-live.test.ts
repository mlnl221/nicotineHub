/**
 * Live bridge ↔ soulfind end-to-end suite. OPT-IN ONLY:
 *   SOULFIND_E2E=1 bun test src/soulfind-live.test.ts   (or `bun run test:soulfind`)
 * Without the env var every test is describe.skip — default `bun test` never
 * touches docker. See docs/soulfind-e2e-plan.md for the level map.
 *
 * The harness starts its own soulfind container (port 2244, bind-mounted DB)
 * so the shared manual-test server on :2243 is never disturbed.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  SoulseekSession,
  type BrowseEvent,
  type ChatEvent,
  type RoomEvent,
  type SearchResultPayload,
  type ServerEvent,
  type TransferEvent,
  type UserInfoEvent,
} from "./session.ts";
import { TransferManager } from "./transfers.ts";
import {
  buildAddRoomOperator,
  buildConnectToPeer,
  buildFileSearch,
  buildJoinRoom,
  buildLogin,
  buildRemoveRoomOperator,
  buildSetWaitPort,
  frameMessage,
  packString,
  parseConnectToPeer,
  parseLoginResponse,
  SERVER_MESSAGE_CODES,
} from "./soulseek.ts";

const LIVE = process.env.SOULFIND_E2E === "1";
const KEEP = process.env.SOULFIND_KEEP === "1";
const d = LIVE ? describe : describe.skip;

let soulProc: ReturnType<typeof Bun.spawn> | null = null;
let soulDb = "";

async function soulStart() {
  if (soulProc) return;
  soulProc = Bun.spawn([soulfindBin(), "-d", soulDb, "-p", String(PORT)], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitTcpReady(30000);
}
async function soulStop() {
  const p = soulProc;
  soulProc = null;
  if (!p) return;
  try {
    p.kill();
  } catch {}
  await p.exited.catch(() => {});
  await Bun.sleep(500);
}
const HOST = "127.0.0.1";
const PORT = Number(process.env.SOULFIND_PORT ?? 2244);
// Host-native soulfind binary (auto-downloaded to ~/.cache on first run).
// Docker is deliberately NOT used here: DNAT masks every client source IP as
// the container gateway, so all peer addresses come back unroutable and L3
// peer flows can never connect. The native binary sees real source IPs.
function soulfindBin(): string {
  if (process.env.SOULFIND_BIN && existsSync(process.env.SOULFIND_BIN)) return process.env.SOULFIND_BIN;
  const cached = join(homedir(), ".cache", "nicotine-hub", "soulfind", "soulfind");
  if (existsSync(cached)) return cached;
  throw new Error(
    `soulfind binary not found at ${cached}. Fetch it once: ` +
      `mkdir -p ~/.cache/nicotine-hub/soulfind && curl -sfSL -o /tmp/sf.zip ` +
      `https://github.com/soulfind-dev/soulfind/releases/latest/download/soulfind-linux-x86_64.zip ` +
      `&& unzip -o -q /tmp/sf.zip -d ~/.cache/nicotine-hub/soulfind && chmod +x ${cached}`,
  );
}

const RID = Date.now().toString(36); // unique names per run — no DB reset needed
const u = (tag: string) => `lv${tag}${RID}`.slice(0, 28);
const PASS = "livetest-pass";

let nextListen = 60756;
const takeListen = () => nextListen++;
let suiteTmp = "";
let bindData = "";

interface Cols {
  user: UserInfoEvent[];
  chat: ChatEvent[];
  room: RoomEvent[];
  server: ServerEvent[];
  browse: BrowseEvent[];
  transfer: TransferEvent[];
}
const emptyCols = (): Cols => ({ user: [], chat: [], room: [], server: [], browse: [], transfer: [] });

const openSessions: SoulseekSession[] = [];
const openManagers: TransferManager[] = [];

function makeSession(username: string, password: string, cols: Cols = emptyCols()) {
  const dataDir = mkdtempSync(join(tmpdir(), "slsk-sess-"));
  const s = new SoulseekSession({
    username,
    password,
    host: HOST,
    port: PORT,
    listenPort: takeListen(),
    profile: { username, descr: "", pic: null, totalupl: 0, queuesize: 0, slotsavail: true, uploadallowed: 1 },
    dataDir,
    onUserEvent: (e) => cols.user.push(e),
    onChatEvent: (e) => cols.chat.push(e),
    onRoomEvent: (e) => cols.room.push(e),
    onTransferEvent: (e) => cols.transfer.push(e),
    onBrowseEvent: (e) => cols.browse.push(e),
    onServerEvent: (e) => cols.server.push(e),
  });
  openSessions.push(s);
  return { s, cols, dataDir };
}

async function closeSession(s: SoulseekSession) {
  try {
    await s.close();
  } catch {}
  const i = openSessions.indexOf(s);
  if (i >= 0) openSessions.splice(i, 1);
}

/** Full production-style node: session + TransferManager wired like server.ts. */
function makeNode(username: string, password: string, cols: Cols = emptyCols()) {
  const dataDir = mkdtempSync(join(tmpdir(), "slsk-node-"));
  const finished: { id: string; fileName: string; size: number }[] = [];
  const updated: string[] = [];
  let tm!: TransferManager;
  const s = new SoulseekSession({
    username,
    password,
    host: HOST,
    port: PORT,
    listenPort: takeListen(),
    profile: { username, descr: "", pic: null, totalupl: 0, queuesize: 0, slotsavail: true, uploadallowed: 1 },
    dataDir,
    onFileConnection: (t, sock) => { try { tm.handleFileConnection(t, sock as never); } catch {} },
    onFileChunk: (t, c) => { try { tm.handleFileChunk(t, c); } catch {} },
    onFileClosed: (t) => { try { tm.handleFileClosed(t); } catch {} },
    onUploadPierce: (un, sock) => { try { void tm.handleUploadPierced(un, sock as never); } catch {} },
    getQueuePlace: (f) => { try { return tm.getQueuePlace(f); } catch { return 1; } },
    onUserEvent: (e) => cols.user.push(e),
    onChatEvent: (e) => cols.chat.push(e),
    onRoomEvent: (e) => cols.room.push(e),
    // Production glue mirror (server.ts sharedSessionCallbacks onTransferEvent).
    onTransferEvent: (e) => {
      cols.transfer.push(e);
      try {
        if (e.type === "place-in-queue" && e.file && e.place !== undefined) tm.handlePlaceInQueueResponse(e.file, e.place, e.username);
        else if (e.type === "transfer-request" && e.file && e.token !== undefined) tm.handleTransferRequest(e.direction ?? 1, e.token, e.file, e.username, e.size);
        else if (e.type === "transfer-response" && e.token !== undefined && e.username) {
          if (e.allowed) void tm.handleUploadGranted(e.username, e.token);
          else tm.handleUploadRejected(e.username, e.token, e.reason || "Cancelled");
        } else if (e.type === "queue-upload" && e.file && e.username) tm.handleQueueUpload(e.username, e.file);
        else if (e.type === "upload-denied" && e.file) tm.handleUploadDenied(e.file, e.reason || "Cancelled", e.username);
        else if (e.type === "upload-failed" && e.file) tm.handleUploadFailed(e.file, e.username);
      } catch {}
    },
    onBrowseEvent: (e) => cols.browse.push(e),
    onServerEvent: (e) => cols.server.push(e),
  });
  tm = new TransferManager({
    dataDir,
    onUpdate: (t) => { try { updated.push(`${t.id}:${t.status}`); } catch {} },
    onRemoved: () => {},
    onStats: () => {},
    onQueue: () => {},
    onFinished: (id, fileName, size) => { finished.push({ id, fileName, size }); },
    getSession: () => s as never,
  });
  tm.setSessionGetter(() => s as never);
  openSessions.push(s);
  openManagers.push(tm);
  return { s, tm, cols, dataDir, finished, updated };
}

async function waitStatus(s: SoulseekSession, name: string, want: number | null, ms: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const got = s.getUserStatus(name);
    if (want === null ? typeof got === "number" && got !== 0 : got === want) return;
    if (Date.now() - t0 > ms) throw new Error(`status of ${name} never became ${want} (now ${got})`);
    await Bun.sleep(100);
  }
}
async function waitFor<T>(arr: T[], pred: (e: T) => boolean, ms: number, what: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const f = arr.find(pred);
    if (f) return f;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await Bun.sleep(75);
  }
}

/** Minimal raw Soulseek client for deterministic relay asserts. */
class RawSlsk {
  private buf = Buffer.alloc(0);
  private waiters = new Map<number, ((f: { code: number; payload: Buffer }) => void)[]>();
  private queues = new Map<number, { code: number; payload: Buffer }[]>();
  private sock: { write: (b: Buffer) => void; end: () => void } | null = null;

  static async connect(): Promise<RawSlsk> {
    const c = new RawSlsk();
    c.sock = (await Bun.connect({
      hostname: HOST,
      port: PORT,
      socket: {
        open: () => {},
        data: (_s, chunk) => c.feed(Buffer.from(chunk)),
        error: () => {},
        close: () => {},
      },
    })) as unknown as { write: (b: Buffer) => void; end: () => void };
    return c;
  }

  private feed(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    let off = 0;
    while (this.buf.length - off >= 8) {
      const len = this.buf.readUInt32LE(off);
      if (len < 4 || this.buf.length - off - 4 < len) break;
      const code = this.buf.readUInt32LE(off + 4);
      const frame = { code, payload: this.buf.subarray(off + 8, off + 4 + len) };
      off += 4 + len;
      const w = this.waiters.get(code);
      if (w?.length) w.shift()!(frame);
      else this.queues.set(code, [...(this.queues.get(code) ?? []), frame]);
    }
    this.buf = this.buf.subarray(off);
  }

  send(b: Buffer) {
    this.sock?.write(b);
  }

  async login(username: string, password: string) {
    this.send(Buffer.concat([buildLogin(username, password), buildSetWaitPort(60799)]));
    const f = await this.waitFor(1, 15000);
    return parseLoginResponse(f.payload);
  }

  async waitFor(code: number, ms: number) {
    const q = this.queues.get(code);
    if (q?.length) return q.shift()!;
    return new Promise<{ code: number; payload: Buffer }>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`raw timeout waiting code ${code}`)), ms);
      const arr = this.waiters.get(code) ?? [];
      arr.push((f) => {
        clearTimeout(t);
        res(f);
      });
      this.waiters.set(code, arr);
    });
  }

  close() {
    try {
      this.sock?.end();
    } catch {}
  }
}

async function sqlite(dbPath: string, sql: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "python3",
      "-c",
      "import sqlite3,sys; con=sqlite3.connect(sys.argv[1]); cur=con.cursor(); cur.execute(sys.argv[2]); rows=cur.fetchall(); con.commit(); print('\\n'.join('|'.join(str(c) for c in r) for r in rows))",
      dbPath,
      sql,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`sqlite failed: ${err.trim()} [${sql}]`);
  return out.trim();
}

async function dockerStop() {
  await soulStop();
}
async function dockerStart() {
  await soulStart();
}
async function waitTcpReady(ms: number) {
  const t0 = Date.now();
  for (;;) {
    try {
      const s = await Bun.connect({
        hostname: HOST,
        port: PORT,
        socket: { open: () => {}, data: () => {}, error: () => {}, close: () => {} },
      });
      try {
        (s as unknown as { end: () => void }).end();
      } catch {}
      return;
    } catch {
      if (Date.now() - t0 > ms) throw new Error("soulfind TCP never became ready");
      await Bun.sleep(500);
    }
  }
}

d("soulfind live e2e", () => {
  beforeAll(async () => {
    suiteTmp = mkdtempSync(join(tmpdir(), "slsk-live-"));
    bindData = join(suiteTmp, "data");
    mkdirSync(bindData, { recursive: true });
    process.env.CONFIG_DIR = join(suiteTmp, "config");
    mkdirSync(process.env.CONFIG_DIR, { recursive: true });
    soulDb = join(bindData, "soulfind.db");
    await soulStart();
  }, 120000);

  afterAll(async () => {
    for (const s of [...openSessions]) await closeSession(s);
    for (const tm of openManagers) {
      try {
        tm.close();
      } catch {}
    }
    if (KEEP) {
      console.log(`SOULFIND_KEEP=1 — soulfind left running (db ${soulDb})`);
      return;
    }
    await soulStop();
    try {
      rmSync(suiteTmp, { recursive: true, force: true });
    } catch {}
  }, 60000);

  describe("L0 smoke", () => {
  test("L0.1 TCP ready", () => {
    if (!bindData) throw new Error("setup failed");
  });

  test("L0.2 dual session login", async () => {
    const a = makeSession(u("a"), PASS);
    const b = makeSession(u("b"), PASS);
    try {
      const ra = await a.s.login();
      const rb = await b.s.login();
      if (!ra.success || !rb.success) throw new Error("login failed");
      if (!ra.banner.startsWith("Soulfind")) throw new Error(`unexpected banner ${ra.banner}`);
    } finally {
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 60000);

  test("L0.3 FileSearch relay raw", async () => {
    const a = await RawSlsk.connect();
    const b = await RawSlsk.connect();
    try {
      const ra = await a.login(u("ra"), PASS);
      const rb = await b.login(u("rb"), PASS);
      if (!ra.success || !rb.success) throw new Error("raw login failed");
      const token = 424242;
      const q = `relayprobe${RID}`;
      a.send(buildFileSearch(token, q));
      const got = await b.waitFor(26, 8000);
      const hex = got.payload.toString("hex");
      if (!Buffer.from(got.payload).toString("latin1").includes(q)) throw new Error(`relay payload missing query: ${hex.slice(0, 120)}`);
    } finally {
      a.close();
      b.close();
    }
  }, 60000);

  test("L0.4 room join + presence", async () => {
    const room = `room${RID}`;
    const a = makeSession(u("pa"), PASS);
    const b = makeSession(u("pb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      a.s.joinRoom(room);
      await waitFor(a.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "A join-room");
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "B join-room");
      await waitFor(a.cols.room, (e) => e.type === "user-joined-room" && e.username === b.s.username, 10000, "A sees B join");
    } finally {
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 90000);
  });

  d("L1 server-relay core", () => {
  test("1.1 room list contains joined room", async () => {
    const room = `list${RID}`;
    const a = makeSession(u("la"), PASS);
    try {
      await a.s.login();
      a.s.joinRoom(room);
      await waitFor(a.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "join");
      a.cols.room.length = 0;
      a.s.requestRoomList();
      const ev = await waitFor(a.cols.room, (e) => e.type === "room-list", 10000, "room-list");
      if (!JSON.stringify(ev.data).includes(room)) throw new Error("room list missing joined room");
    } finally {
      await closeSession(a.s);
    }
  }, 60000);

  test("1.2 room chat echo + 1.3 leave presence", async () => {
    const room = `chat${RID}`;
    const msg = `hello-${RID}`;
    const a = makeSession(u("ca"), PASS);
    const b = makeSession(u("cb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      a.s.joinRoom(room);
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "B join");
      a.s.sayChatroom(room, msg);
      const got = await waitFor(
        b.cols.chat,
        (e) => e.type === "say-chatroom" && e.room === room && e.message === msg,
        10000,
        "chat echo",
      );
      if (got.username !== a.s.username) throw new Error("wrong sender");
      b.s.leaveRoom(room);
      await waitFor(a.cols.room, (e) => e.type === "user-left-room" && e.username === b.s.username, 10000, "left presence");
    } finally {
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 90000);

  test("1.4 PM + ack + offline backlog", async () => {
    const a = makeSession(u("ma"), PASS);
    const b = makeSession(u("mb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      const text = `pm-${RID}`;
      a.s.sendPrivateMessage(b.s.username, text);
      const got = await waitFor(
        b.cols.chat,
        (e) => e.type === "private-message" && e.username === a.s.username && e.message === text,
        10000,
        "PM",
      );
      if (got.msgId === undefined) throw new Error("PM missing msgId");
      // NOTE: no sender-side ack exists — the server consumes MessageAcked
      // without relaying (by protocol design), and the bridge emits no
      // private-message-acked event. Delivery to the peer is the assert.
      // offline backlog: B goes away, A sends, fresh B login receives it
      await closeSession(b.s);
      await Bun.sleep(500);
      const offline = `pm-offline-${RID}`;
      a.s.sendPrivateMessage(b.s.username, offline);
      await Bun.sleep(1500);
      const b2 = makeSession(b.s.username, PASS);
      try {
        await b2.s.login();
        await waitFor(
          b2.cols.chat,
          (e) => e.type === "private-message" && e.message === offline,
          15000,
          "offline backlog",
        );
      } finally {
        await closeSession(b2.s);
      }
    } finally {
      await closeSession(a.s);
    }
  }, 120000);

  test("1.5 watch / status / stats", async () => {
    const a = makeSession(u("wa"), PASS);
    const b = makeSession(u("wb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      a.s.watchUser(b.s.username);
      const w = await waitFor(
        a.cols.user,
        (e) => e.type === "watch-user" && e.username === b.s.username,
        10000,
        "watch-user",
      );
      if (JSON.stringify(w).length < 10) throw new Error("empty watch event");
      // NOTE: the server sends no GetUserStatus(7) frame on watch — status is
      // carried in the watch reply the bridge caches. Assert the cache.
      await waitStatus(a.s, b.s.username, null, 10000);
      await waitFor(a.cols.user, (e) => e.type === "user-stats" && e.username === b.s.username, 10000, "stats");
      await closeSession(b.s);
      await Bun.sleep(500);
      a.cols.user.length = 0;
      a.s.watchUser(b.s.username);
      await waitFor(
        a.cols.user,
        (e) => e.type === "watch-user" && e.username === b.s.username,
        10000,
        "re-watch",
      );
      await waitStatus(a.s, b.s.username, 0, 10000);
    } finally {
      await closeSession(a.s);
    }
  }, 90000);

  test("1.6 peer address roundtrip", async () => {
    const a = makeSession(u("na"), PASS);
    const b = makeSession(u("nb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      a.s.requestPeerAddress(b.s.username);
      const ev = await waitFor(
        a.cols.user,
        (e) => e.type === "peer-address" && e.username === b.s.username,
        25000,
        "peer-address",
      );
      const pa = ev.peerAddress as { ip?: string; port?: number };
      if (!pa?.ip || !pa.port) throw new Error(`empty peer address ${JSON.stringify(pa)}`);
    } finally {
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 90000);

  test("1.7 ConnectToPeer relay + 1001 fast-fail (raw)", async () => {
    const a = await RawSlsk.connect();
    const b = await RawSlsk.connect();
    try {
      const meA = u("xa");
      const meB = u("xb");
      if (!(await a.login(meA, PASS)).success) throw new Error("raw A login failed");
      if (!(await b.login(meB, PASS)).success) throw new Error("raw B login failed");
      const token = 918273;
      a.send(buildConnectToPeer(token, meB, "P"));
      const relay = await b.waitFor(18, 8000);
      const parsed = parseConnectToPeer(relay.payload);
      if (parsed.username !== meA || parsed.token !== token) throw new Error(`bad 18 relay ${JSON.stringify(parsed)}`);
      const ghost = `ghost${RID}`;
      const token2 = 918274;
      a.send(buildConnectToPeer(token2, ghost, "P"));
      const fail = await a.waitFor(1001, 8000);
      if (fail.payload.readUInt32LE(0) !== token2) throw new Error("1001 token mismatch");
    } finally {
      a.close();
      b.close();
    }
  }, 60000);

  test("1.8 interests roundtrip + privilege clamp", async () => {
    const a = makeSession(u("ia"), PASS);
    const liker = await RawSlsk.connect();
    try {
      await a.s.login();
      const meLiker = u("il");
      if (!(await liker.login(meLiker, PASS)).success) throw new Error("liker login failed");
      const term = `cheese${RID}`;
      liker.send(frameMessage(51, packString(term)));
      await Bun.sleep(1000);
      a.s.requestUserInterests(meLiker);
      const ev = await waitFor(
        a.cols.user,
        (e) => e.type === "user-interests" && e.username === meLiker,
        10000,
        "user-interests",
      );
      if (!JSON.stringify(ev.interests).includes(term)) throw new Error(`interest missing: ${JSON.stringify(ev.interests)}`);
      // fresh users hold no privileges — give clamps to donor balance (0)
      a.s.givePrivileges(meLiker, 5);
      a.s.checkPrivileges();
      const cp = await waitFor(a.cols.user, (e) => e.type === "check-privileges", 10000, "check-privileges");
      if (cp.checkPrivileges !== 0) throw new Error(`expected 0 privilege seconds, got ${cp.checkPrivileges}`);
    } finally {
      liker.close();
      await closeSession(a.s);
    }
  }, 90000);

  test("1.9 login auto-push: wishlist interval + excluded phrases", async () => {
    const c = makeSession(u("ap"), PASS);
    try {
      await c.s.login();
      await waitFor(c.cols.user, (e) => e.type === "wishlist-interval" && typeof e.wishlistInterval === "number", 10000, "wishlist-interval");
      await waitFor(c.cols.user, (e) => e.type === "excluded-search-phrases" && Array.isArray(e.excludedPhrases), 10000, "excluded-phrases");
    } finally {
      await closeSession(c.s);
    }
  }, 60000);

  test("1.10 room tickers set + remove", async () => {
    const room = `tick${RID}`;
    const tick = `tickmsg-${RID}`;
    const a = makeSession(u("ta"), PASS);
    const b = makeSession(u("tb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      a.s.joinRoom(room);
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "B join");
      a.s.setRoomTicker(room, tick);
      await waitFor(
        b.cols.room,
        (e) => e.type === "ticker-added" && e.room === room && JSON.stringify(e.data).includes(tick),
        10000,
        "ticker-added",
      );
      a.s.setRoomTicker(room, "");
      await waitFor(b.cols.room, (e) => e.type === "ticker-removed" && e.room === room, 10000, "ticker-removed");
    } finally {
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 90000);

  test("1.11 private room access + operators", async () => {
    const room = `priv${RID}`;
    const room2 = `privop${RID}`;
    const a = makeSession(u("oa"), PASS);
    const b = makeSession(u("ob"), PASS);
    const o = await RawSlsk.connect();
    try {
      await a.s.login();
      await b.s.login();
      const meO = u("oo");
      if (!(await o.login(meO, PASS)).success) throw new Error("owner login failed");
      a.s.joinRoom(room, true);
      await waitFor(a.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "owner join");
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "cant-create-room" && e.room === room, 10000, "cant-create-room");
      // Operator dance needs a member target; the bridge has no add-member
      // sender, so the raw owner drives membership (134 = room + username).
      // Grants require the target to accept room invitations (server default off).
      b.s.setEnableRoomInvitations(true);
      await Bun.sleep(500);
      o.send(buildJoinRoom(room2, true));
      await o.waitFor(14, 8000);
      o.send(frameMessage(SERVER_MESSAGE_CODES.addRoomMember, Buffer.concat([packString(room2), packString(b.s.username)])));
      await waitFor(
        b.cols.room,
        (e) => e.type === "membership-granted" && e.room === room2,
        10000,
        "membership-granted",
      );
      b.s.joinRoom(room2);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room2, 10000, "member join");
      o.send(buildAddRoomOperator(room2, b.s.username));
      await waitFor(
        b.cols.room,
        (e) => e.type === "operator-added" && JSON.stringify(e).includes(b.s.username),
        10000,
        "operator-added",
      );
      await waitFor(
        b.cols.room,
        (e) => e.type === "operatorship-granted" && e.room === room2,
        10000,
        "operatorship-granted",
      );
      o.send(buildRemoveRoomOperator(room2, b.s.username));
      await waitFor(
        b.cols.room,
        (e) => e.type === "operator-removed" && JSON.stringify(e).includes(b.s.username),
        10000,
        "operator-removed",
      );
      await waitFor(
        b.cols.room,
        (e) => e.type === "operatorship-revoked" && e.room === room2,
        10000,
        "operatorship-revoked",
      );
    } finally {
      o.close();
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 120000);

  test("1.12 global room delivers room chat as 152", async () => {
    // NOTE: the server sends no echo for joinGlobalRoom itself (by design —
    // members just start receiving GlobalRoomMessage). Every normal room say
    // is mirrored to global members, which is the observable assert.
    const room = `glob${RID}`;
    const msg = `global-${RID}`;
    const a = makeSession(u("ga"), PASS);
    const b = makeSession(u("gb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      a.s.joinGlobalRoom();
      b.s.joinGlobalRoom();
      a.s.joinRoom(room);
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "B join");
      a.s.sayChatroom(room, msg);
      const g = await waitFor(
        b.cols.chat,
        (e) => e.type === "global-room-message" && e.room === room && e.message === msg,
        10000,
        "global-room-message",
      );
      if (g.username !== a.s.username) throw new Error("wrong global sender");
      a.s.leaveGlobalRoom();
      b.s.leaveGlobalRoom();
    } finally {
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 60000);

  test("1.13 password change roundtrip", async () => {
    const name = u("pw");
    const p2 = `new-${PASS}`;
    const first = makeSession(name, PASS);
    try {
      await first.s.login();
      first.s.changePassword(p2);
      await Bun.sleep(1500); // soulfind rehashes async
    } finally {
      await closeSession(first.s);
    }
    const second = makeSession(name, p2);
    try {
      const r = await second.s.login();
      if (!r.success) throw new Error("login with new password failed");
    } finally {
      await closeSession(second.s);
    }
    const stale = makeSession(name, PASS);
    try {
      await stale.s.login();
      throw new Error("old password still accepted");
    } catch (e) {
      if (!/INVALIDPASS|Incorrect/i.test((e as Error).message)) throw e;
    } finally {
      await closeSession(stale.s);
    }
  }, 90000);

  test("1.14 directed search relay to raw observer", async () => {
    const room = `rs${RID}`;
    const b = makeSession(u("sb"), PASS);
    const c = await RawSlsk.connect();
    try {
      await b.s.login();
      const meC = u("sc");
      if (!(await c.login(meC, PASS)).success) throw new Error("observer login failed");
      const qUser = `uq${RID}`;
      b.s.searchUser(meC, qUser, `sid-u-${RID}`, { onResult: () => {}, onEnd: () => {}, timeoutMs: 8000 });
      // NOTE: the server relays every search flavour as FileSearch(26) —
      // UserSearch(42)/RoomSearch(120)/WishlistSearch(103) never arrive as
      // those codes on any client (bridge correctly ignores inbound 42).
      const gotU = await c.waitFor(26, 8000);
      if (!gotU.payload.toString("latin1").includes(qUser)) throw new Error("UserSearch not relayed");
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "B room");
      // raw observer joins via raw join frame
      c.send(buildJoinRoom(room));
      await c.waitFor(14, 8000);
      const qRoom = `rq${RID}`;
      b.s.searchRoom(room, qRoom, `sid-r-${RID}`, { onResult: () => {}, onEnd: () => {}, timeoutMs: 8000 });
      const gotR = await c.waitFor(26, 8000);
      if (!gotR.payload.toString("latin1").includes(qRoom)) throw new Error("RoomSearch not relayed");
      const qWish = `wq${RID}`;
      b.s.wishlistSearch(qWish, `sid-w-${RID}`, { onResult: () => {}, onEnd: () => {}, timeoutMs: 8000 });
      const gotW = await c.waitFor(26, 8000);
      if (!gotW.payload.toString("latin1").includes(qWish)) throw new Error("WishlistSearch not relayed");
    } finally {
      c.close();
      await closeSession(b.s);
    }
  }, 120000);
});

d("L2 errors + reconnect", () => {
  test("2.1 wrong password rejected", async () => {
    const name = u("wp");
    const reg = makeSession(name, PASS);
    try {
      await reg.s.login();
    } finally {
      await closeSession(reg.s);
    }
    const bad = makeSession(name, "wrong-pass");
    try {
      await bad.s.login();
      throw new Error("bad password accepted");
    } catch (e) {
      if (!/INVALIDPASS|Incorrect/i.test((e as Error).message)) throw e;
    } finally {
      await closeSession(bad.s);
    }
  }, 60000);

  test("2.2 ban via seeded admin → BANNED, then unban", async () => {
    const admin = u("adm");
    const victim = u("vic");
    const v = makeSession(victim, PASS);
    try {
      await v.s.login();
    } finally {
      await closeSession(v.s);
    }
    const a = makeSession(admin, PASS);
    try {
      await a.s.login();
    } finally {
      await closeSession(a.s);
    }
    const dbPath = join(bindData, "soulfind.db");
    const cols = await sqlite(dbPath, "SELECT name FROM pragma_table_info('users')");
    if (!cols.includes("admin") || !cols.includes("banned")) throw new Error(`users table missing admin/banned cols: ${cols}`);
    await dockerStop();
    try {
      const farFuture = 9999999999;
      const changed = await sqlite(dbPath, `UPDATE users SET admin=${farFuture} WHERE username='${admin}'`);
      void changed;
      const check = await sqlite(dbPath, `SELECT admin FROM users WHERE username='${admin}'`);
      if (!check.startsWith(String(farFuture))) throw new Error(`admin seed failed: '${check}'`);
    } finally {
      await dockerStart();
    }
    const adm = makeSession(admin, PASS);
    try {
      await adm.s.login();
      adm.cols.chat.length = 0;
      adm.s.sendPrivateMessage("server", `ban ${victim}`);
      const resp = await waitFor(
        adm.cols.chat,
        (e) => e.type === "private-message" && e.username === "server",
        15000,
        "ban confirmation PM",
      );
      if (!/banned/i.test(resp.message ?? "")) throw new Error(`ban not confirmed: ${resp.message}`);
      const vb = makeSession(victim, PASS);
      try {
        await vb.s.login();
        throw new Error("banned user logged in");
      } catch (e) {
        // Banned logins get no response; the server holds the socket ~60-75s.
        // Fast <5s silent close → code BANNED; slower watchdog timeout or the
        // server-side close both prove the login never succeeds. Either way
        // it must reject, never hang forever.
        if ((e as Error).message === "banned user logged in") throw e;
        if (
          (e as { code?: string }).code !== "BANNED" &&
          !/timed out|closed|reconnect-failed/i.test((e as Error).message)
        ) {
          throw new Error(`unexpected banned-login error: ${(e as Error).message}`);
        }
      } finally {
        await closeSession(vb.s);
      }
      adm.cols.chat.length = 0;
      adm.s.sendPrivateMessage("server", `unban ${victim}`);
      await waitFor(adm.cols.chat, (e) => e.type === "private-message" && e.username === "server", 15000, "unban PM");
      const v2 = makeSession(victim, PASS);
      try {
        const r = await v2.s.login();
        if (!r.success) throw new Error("victim login failed after unban");
      } finally {
        await closeSession(v2.s);
      }
    } finally {
      await closeSession(adm.s);
    }
  }, 180000);

  test("2.3 SVRPRIVATE + SVRFULL via config", async () => {
    const dbPath = join(bindData, "soulfind.db");
    const info = await sqlite(dbPath, "SELECT name FROM pragma_table_info('config')");
    const rows = await sqlite(dbPath, "SELECT * FROM config LIMIT 5");
    const kv = info.includes("option") && info.includes("value");
    const setCfg = (k: string, v: string) =>
      kv ? sqlite(dbPath, `UPDATE config SET value='${v}' WHERE option='${k}'`) : sqlite(dbPath, `UPDATE config SET ${k}='${v}'`);
    const getCfg = (k: string) => (kv ? sqlite(dbPath, `SELECT value FROM config WHERE option='${k}'`) : sqlite(dbPath, `SELECT ${k} FROM config LIMIT 1`));
    const origPriv = await getCfg("private_mode");
    const origMax = await getCfg("max_users");
    if (!rows && !kv) throw new Error("config table unreadable");
    // Register the known user while the server is still public.
    const keeperName = u("keep");
    {
      const k0 = makeSession(keeperName, PASS);
      try {
        await k0.s.login();
      } finally {
        await closeSession(k0.s);
      }
    }
    try {
      await dockerStop();
      try {
        await setCfg("private_mode", "1");
      } finally {
        await dockerStart();
      }
      const stranger = makeSession(u("str"), PASS);
      try {
        await stranger.s.login();
        throw new Error("private server accepted stranger");
      } catch (e) {
        if (!/SVRPRIVATE|private/i.test((e as Error).message)) throw e;
      } finally {
        await closeSession(stranger.s);
      }
      // Known users still get in under private_mode.
      const keeper = makeSession(keeperName, PASS);
      try {
        const r = await keeper.s.login();
        if (!r.success) throw new Error("known user rejected by private server");
      } finally {
        await closeSession(keeper.s);
      }
      await dockerStop();
      try {
        await setCfg("private_mode", "0");
        await setCfg("max_users", "1");
      } finally {
        await dockerStart();
      }
      // Single slot: filler takes it, extra gets SVRFULL. Deterministic —
      // no session is online when the slot fills.
      await Bun.sleep(1000);
        const filler = makeSession(u("fil"), PASS);
        try {
          await filler.s.login();
          const extra = makeSession(u("ext"), PASS);
          try {
            await extra.s.login();
            throw new Error("full server accepted extra user");
          } catch (e) {
            if (!/SVRFULL|full/i.test((e as Error).message)) throw e;
          } finally {
            await closeSession(extra.s);
          }
        } finally {
          await closeSession(filler.s);
        }
    } finally {
      await dockerStop();
      try {
        await setCfg("private_mode", origPriv || "0");
        await setCfg("max_users", origMax || "100000");
      } finally {
        await dockerStart();
      }
    }
  }, 240000);

  test("2.4 kill + restart → reconnect → working chat", async () => {
    const room = `re${RID}`;
    const a = makeSession(u("ka"), PASS);
    const b = makeSession(u("kb"), PASS);
    try {
      await a.s.login();
      await b.s.login();
      a.s.joinRoom(room);
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room, 10000, "B join");
      await dockerStop();
      await waitFor(a.cols.server, (e) => e.type === "reconnect", 25000, "reconnect event");
      await dockerStart();
      await waitFor(a.cols.server, (e) => e.type === "reconnected", 60000, "reconnected event");
      await waitFor(b.cols.server, (e) => e.type === "reconnected", 60000, "B reconnected");
      // soulfind keeps no room state across restart — rejoin, then chat works
      a.s.joinRoom(room);
      b.s.joinRoom(room);
      await waitFor(b.cols.room, (e) => e.type === "join-room" && e.room === room, 15000, "B rejoin");
      const msg = `after-restart-${RID}`;
      a.s.sayChatroom(room, msg);
      await waitFor(b.cols.chat, (e) => e.type === "say-chatroom" && e.message === msg, 15000, "post-restart chat");
    } finally {
      await closeSession(a.s);
      await closeSession(b.s);
    }
  }, 240000);

  test("2.5 search timeout frees token", async () => {
    const a = makeSession(u("to"), PASS);
    try {
      await a.s.login();
      const end = await new Promise<{ reason: string }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("onEnd never fired")), 15000);
        a.s.search(`nosuchfile${RID}`, `sid-t-${RID}`, {
          onResult: () => {},
          onEnd: (p) => {
            clearTimeout(t);
            resolve({ reason: p.reason });
          },
          timeoutMs: 2500,
        });
      });
      if (end.reason !== "timeout") throw new Error(`expected timeout, got ${end.reason}`);
      // token slot reusable — second search runs, not stuck
      const end2 = await new Promise<{ reason: string }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("second onEnd never fired")), 15000);
        a.s.search(`nosuchfile2${RID}`, `sid-t2-${RID}`, {
          onResult: () => {},
          onEnd: (p) => {
            clearTimeout(t);
            resolve({ reason: p.reason });
          },
          timeoutMs: 2500,
        });
      });
      if (end2.reason !== "timeout") throw new Error(`second search: ${end2.reason}`);
    } finally {
      await closeSession(a.s);
    }
  }, 60000);

  test("2.6 validation limits", async () => {
    const c = await RawSlsk.connect();
    try {
      const bad = await c.login(`this-username-is-way-too-long-${RID}`, PASS);
      if (bad.success) throw new Error("overlong username accepted");
      if (bad.success === false && !/INVALIDUSERNAME/i.test(bad.rejectionReason)) {
        throw new Error(`wrong reason: ${bad.rejectionReason}`);
      }
    } finally {
      c.close();
    }
    const a = await RawSlsk.connect();
    const b = await RawSlsk.connect();
    try {
      if (!(await a.login(u("va"), PASS)).success) throw new Error("A login failed");
      if (!(await b.login(u("vb"), PASS)).success) throw new Error("B login failed");
      a.send(buildFileSearch(777001, "x".repeat(300)));
      try {
        await b.waitFor(26, 2500);
        throw new Error("overlong search was relayed");
      } catch (e) {
        if (!/raw timeout/i.test((e as Error).message)) throw e;
      }
    } finally {
      a.close();
      b.close();
    }
  }, 60000);
});

d("L3 two-node peer flows", () => {
  test("3.1 share + search response via peer", async () => {
    const an = makeNode(u("ua"), PASS);
    const bn = makeNode(u("ub"), PASS);
    try {
      await an.s.login();
      await bn.s.login();
      const shareDir = join(an.dataDir, "share");
      mkdirSync(shareDir, { recursive: true });
      const fname = `lshaped${RID}.bin`;
      writeFileSync(join(shareDir, fname), Buffer.from(`live-bytes-${RID}`));
      an.s.setShareRoots([["livshare", shareDir]], "public");
      const scanned = await an.s.rescanShares();
      const files = scanned.reduce((n, f) => n + (f.files?.length ?? 0), 0);
      if (files < 1) throw new Error("rescan found no files");
      const rows = await new Promise<SearchResultPayload[]>((resolve, reject) => {
        const out: SearchResultPayload[] = [];
        const t = setTimeout(() => reject(new Error("no search rows from peer")), 30000);
        bn.s.search(`lshaped${RID}`, `sid-31-${RID}`, {
          onResult: (p) => {
            out.push(p);
            if (out.some((r) => r.rows.length > 0)) {
              clearTimeout(t);
              resolve(out);
            }
          },
          onEnd: () => {},
          timeoutMs: 30000,
        });
      });
      const hit = rows.flatMap((r) => r.rows).find((r) => r.user === an.s.username && r.path.includes(fname));
      if (!hit) throw new Error(`no row from uploader: ${JSON.stringify(rows).slice(0, 400)}`);
    } finally {
      await closeSession(an.s);
      await closeSession(bn.s);
    }
  }, 120000);

  test("3.2 browse shares via peer", async () => {
    const an = makeNode(u("ba"), PASS);
    const bn = makeNode(u("bb"), PASS);
    try {
      await an.s.login();
      await bn.s.login();
      const shareDir = join(an.dataDir, "share");
      mkdirSync(shareDir, { recursive: true });
      const fname = `browse${RID}.bin`;
      writeFileSync(join(shareDir, fname), Buffer.from("browse-bytes"));
      an.s.setShareRoots([["livshare", shareDir]], "public");
      await an.s.rescanShares();
      bn.s.requestSharedFileList(an.s.username);
      const ev = await waitFor(
        bn.cols.browse,
        (e) => e.type === "browse-shares" && e.username === an.s.username,
        45000,
        "browse-shares",
      );
      if (!JSON.stringify(ev.folders).includes(fname)) throw new Error(`browse missing file: ${JSON.stringify(ev.folders).slice(0, 300)}`);
    } finally {
      await closeSession(an.s);
      await closeSession(bn.s);
    }
  }, 120000);

  test("3.3 download bytes via peer", async () => {
    const an = makeNode(u("da"), PASS);
    const bn = makeNode(u("db"), PASS);
    try {
      await an.s.login();
      await bn.s.login();
      const shareDir = join(an.dataDir, "share");
      mkdirSync(shareDir, { recursive: true });
      const fname = `payload${RID}.bin`;
      const bytes = Buffer.from(`download-bytes-${RID}-`.repeat(2000));
      writeFileSync(join(shareDir, fname), bytes);
      an.s.setShareRoots([["livshare", shareDir]], "public");
      await an.s.rescanShares();
      const hit = await new Promise<{ path: string; size: number }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no search hit for download")), 30000);
        bn.s.search(`payload${RID}`, `sid-33-${RID}`, {
          onResult: (p) => {
            const row = p.rows.find((r) => r.user === an.s.username && r.path.includes(fname));
            if (row) {
              clearTimeout(t);
              resolve({ path: row.path, size: row.size });
            }
          },
          onEnd: () => {},
          timeoutMs: 30000,
        });
      });
      const done = new Promise<{ id: string }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("download never finished")), 90000);
        const iv = setInterval(() => {
          const f = bn.finished.find((x) => x.fileName.includes(fname));
          if (f) {
            clearTimeout(t);
            clearInterval(iv);
            resolve({ id: f.id });
          }
        }, 250);
      });
      const t = bn.tm.requestDownload(an.s.username, hit.path, hit.size);
      void t;
      await done;
      const fp = bn.tm.getFilePathForToken((t as { token?: number }).token ?? -1) ?? null;
      const local = fp ? readFileSync(fp) : null;
      const rounded = bn.finished.find((x) => x.fileName.includes(fname));
      if (!rounded) throw new Error("finished record missing");
      if (!local || !local.equals(bytes)) {
        // fall back: locate via downloadsRoot scan
        const found: string[] = [];
        const walk = (dir: string) => {
          for (const e of readdirSync(dir)) {
            const p = join(dir, e);
            try {
              if (statSync(p).isDirectory()) walk(p);
              else if (e.includes(fname)) found.push(p);
            } catch {}
          }
        };
        try {
          walk(bn.tm.downloadsRoot());
        } catch {}
        const cand = found.map((p) => readFileSync(p)).find((b) => b.equals(bytes));
        if (!cand) throw new Error(`downloaded bytes mismatch (tokenPath=${fp}, found=${found.length})`);
      }
    } finally {
      await closeSession(an.s);
      await closeSession(bn.s);
    }
  }, 180000);
  });
});
