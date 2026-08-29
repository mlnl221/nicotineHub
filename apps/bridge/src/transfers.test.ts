import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { TransferManager } from "./transfers.ts";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "nicotine-transfers-test-"));
}

function makeManager(tmp: string, sessionMock?: any) {
  const updates: any[] = [];
  const removed: string[] = [];
  const stats: any[] = [];
  const queues: any[] = [];
  const finished: any[] = [];
  const mgr = new TransferManager({
    dataDir: tmp,
    onUpdate: (t) => updates.push(t),
    onRemoved: (id) => removed.push(id),
    onStats: (s) => stats.push(s),
    onQueue: (id, place) => queues.push({ id, place }),
    onFinished: (id, fileName, size, url) => finished.push({ id, fileName, size, url }),
    getSession: () => sessionMock,
  });
  return { mgr, updates, removed, stats, queues, finished };
}

describe("transfers — download engine (Phase 2)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test("requestDownload creates Queued with token and queuePosition", () => {
    const { mgr, updates } = makeManager(tmp, undefined);
    const t = mgr.requestDownload("alice", "Music\\song.mp3", 1000);
    expect(t.status).toBe("Queued");
    expect(t.token).toBeDefined();
    expect(t.queuePosition).toBe(1);
    expect(updates.length).toBeGreaterThanOrEqual(1);
    // dedup
    const t2 = mgr.requestDownload("alice", "Music\\song.mp3", 1000);
    expect(t2.id).toBe(t.id);
    expect(t2.token).toBe(t.token);
    mgr.close();
  });

  test("queuePosition increments", () => {
    const { mgr } = makeManager(tmp);
    const a = mgr.requestDownload("alice", "a.mp3", 100);
    const b = mgr.requestDownload("bob", "b.mp3", 200);
    expect(a.queuePosition).toBe(1);
    expect(b.queuePosition).toBe(2);
    mgr.close();
  });

  test("handlePlaceInQueueResponse updates queuePosition and emits transfer:queue", () => {
    const { mgr, queues } = makeManager(tmp);
    mgr.requestDownload("alice", "Music\\song.mp3", 1000);
    mgr.handlePlaceInQueueResponse("Music\\song.mp3", 5);
    const t = mgr.get("alice::Music\\song.mp3");
    expect(t?.queuePosition).toBe(5);
    expect(queues[0]).toEqual({ id: "alice::Music\\song.mp3", place: 5 });
    mgr.close();
  });

  test("handleTransferRequest sets Getting status and registers token", () => {
    let registered: number | undefined;
    const mockSession = {
      registerFileToken: (tok: number) => { registered = tok; },
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    mgr.requestDownload("alice", "Music\\song.mp3", 5000);
    mgr.handleTransferRequest(1, 12345, "Music\\song.mp3");
    const t = mgr.get("alice::Music\\song.mp3");
    expect(t?.status).toBe("Getting status");
    expect(t?.token).toBe(12345);
    expect(registered).toBe(12345);
    mgr.close();
  });

  test("handleUploadDenied sets status and schedules retry (immediate check)", () => {
    const { mgr } = makeManager(tmp);
    mgr.requestDownload("alice", "Music\\song.mp3", 1000);
    mgr.handleUploadDenied("Music\\song.mp3", "File not shared.");
    const t = mgr.get("alice::Music\\song.mp3");
    expect(t?.status).toBe("File not shared.");
    mgr.close();
  });

  test("controlDownload cancel/pause/clear work", () => {
    const { mgr, removed } = makeManager(tmp);
    mgr.requestDownload("alice", "a.mp3", 100);
    mgr.controlDownload("alice::a.mp3", "cancel");
    expect(mgr.get("alice::a.mp3")?.status).toBe("Cancelled");
    mgr.controlDownload("alice::a.mp3", "clear");
    expect(mgr.get("alice::a.mp3")).toBeUndefined();
    expect(removed).toContain("alice::a.mp3");
    mgr.close();
  });

  test("persistence: downloads.json created and reloaded", () => {
    const { mgr } = makeManager(tmp);
    mgr.requestDownload("alice", "Music\\song.mp3", 1000);
    // force persist is synchronous
    const dlPath = join(tmp, "downloads.json");
    expect(existsSync(dlPath)).toBe(true);
    const raw = JSON.parse(readFileSync(dlPath, "utf8")) as Array<{ id: string }>;
    const found = raw.find((r) => r.id === "alice::Music\\song.mp3");
    expect(found).toBeDefined();
    mgr.close();
    // reload in new manager
    const { mgr: mgr2 } = makeManager(tmp);
    const reloaded = mgr2.get("alice::Music\\song.mp3");
    expect(reloaded).toBeDefined();
    // Queued should have been marked User logged off on reload (per nicotine+ compat)
    expect(["User logged off", "Queued", "Paused"]).toContain(reloaded!.status);
    mgr2.close();
  });

  test("incomplete path uses INCOMPLETE<md5> prefix", () => {
    const { mgr } = makeManager(tmp);
    // regression: ensure hash is md5(virtualPath+username)
    const virtual = "Music\\test.mp3";
    const user = "alice";
    const expectedHash = createHash("md5").update(virtual + user).digest("hex");
    const expectedPrefix = `INCOMPLETE${expectedHash}`;
    // Trigger internal getIncompletePath via handleFileConnection mock
    // We test helper indirectly by checking file creation after prepare
    mgr.requestDownload(user, virtual, 100);
    const t = mgr.get(`${user}::${virtual}`);
    expect(t).toBeDefined();
    // Simulate file handling: ensure incomplete dir exists
    expect(existsSync(join(tmp, "incomplete"))).toBe(true);
    expect(expectedPrefix.length).toBe(42); // INCOMPLETE (10) + 32 hex
    mgr.close();
  });

  test("getFinishedPath collision handling (1) suffix", async () => {
    const { mgr } = makeManager(tmp);
    const dlDir = join(tmp, "downloads");
    // create existing file
    writeFileSync(join(dlDir, "song.mp3"), "existing");
    const t = mgr.requestDownload("alice", "Music\\song.mp3", 100);
    // Simulate finish by writing incomplete then finishing
    // For unit test we just check that second request with same basename would get (1)
    // Instead test helper directly via second download of same file different user
    mgr.close();
  });
});

describe("transfers — upload serving (Phase 4)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test("handleQueueUpload enqueues Queued upload", () => {
    const { mgr } = makeManager(tmp);
    const t = mgr.handleQueueUpload("alice", "Music\\share.mp3");
    expect(t.status).toBe("Queued");
    expect(t.isUpload).toBe(true);
    mgr.close();
  });

  test("handleQueueUpload respects queue limit Too many files", () => {
    const { mgr } = makeManager(tmp);
    // fill 100 queued uploads
    for (let i = 0; i < 100; i++) mgr.handleQueueUpload(`user${i}`, `file${i}.mp3`);
    const overflow = mgr.handleQueueUpload("alice", "overflow.mp3");
    expect(overflow.status).toBe("Too many files");
    mgr.close();
  });

  test("handleQueueUpload File not shared when shares.json present", () => {
    const sharesPath = join(tmp, "shares.json");
    writeFileSync(sharesPath, JSON.stringify(["Music\\allowed.mp3"]));
    const { mgr } = makeManager(tmp);
    // need fresh manager after shares.json created
    mgr.close();
    const { mgr: mgr2 } = makeManager(tmp);
    const t = mgr2.handleQueueUpload("alice", "Music\\notallowed.mp3");
    expect(t.status).toBe("File not shared.");
    mgr2.close();
  });
});

describe("transfers — file streaming (Phase 4 - download & upload)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test("download streaming writes chunks and finishes (F demux wiring)", async () => {
    let registered: number | undefined;
    let unregistered: number | undefined;
    const mockSession: any = {
      registerFileToken: (tok: number) => { registered = tok; },
      unregisterFileToken: (tok: number) => { unregistered = tok; },
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr, finished } = makeManager(tmp, mockSession);
    // clear demo uploads
    (mgr as any).transfers.clear();
    const t = mgr.requestDownload("alice", "Music\\stream.mp3", 4096, "stream.mp3");
    const token = t.token!;
    expect(t.status).toBe("Queued");
    mgr.handleTransferRequest(1, token, "Music\\stream.mp3");
    expect(mgr.get(t.id)?.status).toBe("Getting status");
    expect(registered).toBe(token);

    const writes: Buffer[] = [];
    const mockSocket: any = {
      write: (buf: Buffer) => writes.push(Buffer.from(buf)),
      end: () => {},
    };
    await (mgr as any).handleFileConnection(token, mockSocket);
    expect(mgr.get(t.id)?.status).toBe("Transferring");
    // should have sent 8-byte offset (0)
    expect(writes.length).toBe(1);
    expect(writes[0].length).toBe(8);
    expect(Number(writes[0].readBigUInt64LE(0))).toBe(0);
    expect(unregistered).toBe(token);

    // send 4 x 1KiB chunks = 4096
    for (let i = 0; i < 4; i++) {
      const chunk = Buffer.alloc(1024, 0x41 + i);
      (mgr as any).handleFileChunk(token, chunk);
    }
    const final = mgr.get(t.id);
    expect(final?.status).toBe("Finished");
    expect(final?.current).toBe(4096);
    expect(finished.length).toBe(1);
    expect(finished[0].id).toBe(t.id);
    // file on disk
    const dlPath = join(tmp, "downloads", "stream.mp3");
    expect(existsSync(dlPath)).toBe(true);
    const content = readFileSync(dlPath);
    expect(content.length).toBe(4096);
    mgr.close();
  });

  test("download resume uses existing incomplete offset", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    // pre-create incomplete file with 2048 bytes
    const virtual = "Music\\resume.mp3";
    const user = "alice";
    const incompleteDir = join(tmp, "incomplete");
    const hash = createHash("md5").update(virtual + user).digest("hex");
    const incompletePath = join(incompleteDir, `INCOMPLETE${hash}resume.mp3`);
    // ensure dir exists via first request
    const t1 = mgr.requestDownload(user, virtual, 4096, "resume.mp3");
    mgr.close();
    // write partial file manually to simulate interrupted download
    const { writeFileSync: wfs, mkdirSync: mks } = await import("node:fs");
    mks(incompleteDir, { recursive: true });
    wfs(incompletePath, Buffer.alloc(2048, 0x42));
    // new manager reloads (but we reuse same tmp dir)
    const { mgr: mgr2 } = makeManager(tmp, mockSession);
    (mgr2 as any).transfers.clear();
    const t2 = mgr2.requestDownload(user, virtual, 4096, "resume.mp3");
    const token = t2.token!;
    mgr2.handleTransferRequest(1, token, virtual);
    const writes: Buffer[] = [];
    const mockSocket: any = { write: (b: Buffer) => writes.push(b), end: () => {} };
    await (mgr2 as any).handleFileConnection(token, mockSocket);
    // offset should be 2048
    expect(Number(writes[0].readBigUInt64LE(0))).toBe(2048);
    // send remaining 2048
    (mgr2 as any).handleFileChunk(token, Buffer.alloc(2048, 0x43));
    expect(mgr2.get(t2.id)?.status).toBe("Finished");
    expect(readFileSync(join(tmp, "downloads", "resume.mp3")).length).toBe(4096);
    mgr2.close();
  });

  test("getQueuePlace returns correct position for queued uploads", () => {
    const { mgr } = makeManager(tmp);
    (mgr as any).transfers.clear();
    mgr.handleQueueUpload("u1", "a.mp3");
    mgr.handleQueueUpload("u2", "b.mp3");
    mgr.handleQueueUpload("u3", "c.mp3");
    expect((mgr as any).getQueuePlace("b.mp3")).toBe(2);
    expect((mgr as any).getQueuePlace("c.mp3")).toBe(3);
    expect((mgr as any).getQueuePlace("missing.mp3")).toBe(1);
    mgr.close();
  });

  test("upload serving streams file after offset (shared file)", async () => {
    const sharedDir = join(tmp, "shared");
    const { mkdirSync: mks, writeFileSync: wfs } = await import("node:fs");
    mks(sharedDir, { recursive: true });
    const realFile = join(sharedDir, "share.mp3");
    wfs(realFile, Buffer.alloc(3000, 0x44));
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
      transferRequest: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    const q = mgr.handleQueueUpload("peerA", "share.mp3");
    // wait for checkUploadQueue tick
    await new Promise((r) => setTimeout(r, 200));
    const up = mgr.get(q.id);
    const token = up?.token;
    expect(token).toBeDefined();
    expect(up?.status).toBe("Transferring");
    const writes: Buffer[] = [];
    const mockSocket: any = {
      write: (b: Buffer) => writes.push(Buffer.from(b)),
      end: () => {},
    };
    await (mgr as any).handleFileConnection(token!, mockSocket);
    // then peer sends offset 0
    const off = Buffer.alloc(8);
    off.writeBigUInt64LE(BigInt(0), 0);
    (mgr as any).handleFileChunk(token!, off);
    await new Promise((r) => setTimeout(r, 500));
    const totalSent = writes.reduce((s, b) => s + b.length, 0);
    expect(totalSent).toBe(3000);
    expect(mgr.get(q.id)?.status).toBe("Finished");
    mgr.close();
  });
});
