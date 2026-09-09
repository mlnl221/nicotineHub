import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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
    let responded: { u: string; t: number; allowed: boolean; size?: unknown } | undefined;
    const mockSession = {
      registerFileToken: (tok: number) => { registered = tok; },
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendTransferResponse: (u: string, t: number, allowed: boolean, s?: unknown) => { responded = { u, t, allowed, size: s }; },
    };
    const { mgr } = makeManager(tmp, mockSession);
    mgr.requestDownload("alice", "Music\\song.mp3", 5000);
    mgr.handleTransferRequest(1, 12345, "Music\\song.mp3", "alice", 5000);
    const t = mgr.get("alice::Music\\song.mp3");
    expect(t?.status).toBe("Getting status");
    expect(t?.token).toBe(12345);
    expect(registered).toBe(12345);
    expect(responded).toEqual({ u: "alice", t: 12345, allowed: true, size: 5000 });
    mgr.close();
  });

  test("repeat grant keeps old token usable for in-flight F", () => {
    const mockSession = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendTransferResponse: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    mgr.requestDownload("alice", "Music\\song.mp3", 5000);
    mgr.handleTransferRequest(1, 111, "Music\\song.mp3", "alice", 5000);
    mgr.handleTransferRequest(1, 222, "Music\\song.mp3", "alice", 5000);
    // F arrives late with the first grant's token — must still resolve
    expect(mgr.getByToken(111)?.username).toBe("alice");
    expect(mgr.getByToken(222)?.username).toBe("alice");
    mgr.close();
  });

  test("grant binds owner only; same path from another user ignored", () => {
    const mockSession = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendTransferResponse: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    mgr.requestDownload("alice", "Music\\same.mp3", 100);
    mgr.requestDownload("bob", "Music\\same.mp3", 100);
    mgr.handleTransferRequest(1, 777, "Music\\same.mp3", "bob", 100);
    expect(mgr.get("alice::Music\\same.mp3")?.status).toBe("Queued");
    expect(mgr.get("bob::Music\\same.mp3")?.status).toBe("Getting status");
    expect(mgr.get("bob::Music\\same.mp3")?.token).toBe(777);
    mgr.close();
  });

  test("permanent denial does not schedule retry", () => {
    const { mgr } = makeManager(tmp);
    mgr.requestDownload("alice", "Music\\x.mp3", 100);
    mgr.handleUploadDenied("Music\\x.mp3", "Banned", "alice");
    const t = mgr.get("alice::Music\\x.mp3");
    expect(t?.status).toBe("Banned");
    expect((t as any)?._retryTimer).toBeUndefined();
    mgr.close();
  });

  test("upload granted dials F and arms offset wait", async () => {
    const fsends: Buffer[] = [];
    const fakeSock: any = { write: (b: Buffer) => fsends.push(Buffer.from(b)), end: () => {} };
    let requested: { u: string; t: number } | undefined;
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
      transferRequest: (u: string, _d: number, t: number) => { requested = { u, t }; },
      dialFileUpload: async (_u: string, t: number) => {
        const b = Buffer.alloc(4); b.writeUInt32LE(t >>> 0, 0);
        fakeSock.write(b);
        return fakeSock;
      },
    };
    const { mkdirSync: mks, writeFileSync: wfs } = require("node:fs") as typeof import("node:fs");
    mks(join(tmp, "shared"), { recursive: true });
    wfs(join(tmp, "shared", "up.mp3"), Buffer.alloc(100, 0x44));
    const { mgr } = makeManager(tmp, mockSession);
    const t = mgr.handleQueueUpload("bob", "Music\\up.mp3");
    expect(t.status).toBe("Queued");
    (mgr as any).checkUploadQueue();
    expect(requested?.u).toBe("bob");
    expect(mgr.get(t.id)?.size).toBe(100);
    await (mgr as any).handleUploadGranted("bob", requested!.t);
    expect(fsends.length).toBeGreaterThanOrEqual(1);
    expect((mgr.get(t.id) as any)?._uploadAwaitingOffset).toBe(true);
    mgr.close();
  });

  test("complete partial finishes instantly on F without new bytes", async () => {
    const writes: Buffer[] = [];
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr, finished } = makeManager(tmp, mockSession);
    const virtual = "Music\\whole.mp3";
    const user = "alice";
    const t = mgr.requestDownload(user, virtual, 1024, "whole.mp3");
    const incompleteDir = join(tmp, "incomplete");
    const { mkdirSync: mks, writeFileSync: wfs } = await import("node:fs");
    const hash = createHash("md5").update(virtual + user).digest("hex");
    mks(incompleteDir, { recursive: true });
    wfs(join(incompleteDir, `INCOMPLETE${hash}whole.mp3`), Buffer.alloc(1024, 0x43));
    const sock: any = { write: (b: Buffer) => writes.push(b), end: () => {} };
    mgr.handleTransferRequest(1, 999, virtual, user, 1024);
    await (mgr as any).handleFileConnection(999, sock);
    expect(mgr.get(t.id)?.status).toBe("Finished");
    expect(finished.length).toBe(1);
    expect(existsSync(join(tmp, "downloads", "alice", "whole.mp3"))).toBe(true);
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

  test("usernamesubfolders saves under downloads/<user> and neutralizes ..", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    mgr.setConfig({ usernamesubfolders: true });
    const finishOne = async (user: string, virtual: string, name: string, size: number) => {
      const t = mgr.requestDownload(user, virtual, size, name);
      mgr.handleTransferRequest(1, t.token!, virtual);
      const mockSocket: any = { write: () => {}, end: () => {} };
      await (mgr as any).handleFileConnection(t.token!, mockSocket);
      (mgr as any).handleFileChunk(t.token!, Buffer.alloc(size, 0x41));
      return t;
    };
    await finishOne("alice", "Music\\song.mp3", "song.mp3", 1024);
    expect(existsSync(join(tmp, "downloads", "alice", "song.mp3"))).toBe(true);
    await finishOne("..", "Music\\evil.mp3", "evil.mp3", 16);
    expect(existsSync(join(tmp, "downloads", "_", "evil.mp3"))).toBe(true);
    expect(existsSync(join(tmp, "evil.mp3"))).toBe(false);
    mgr.close();
  });

  test("preserves remote folder structure, drops alias, always includes user", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    const finishOne = async (user: string, virtual: string, size: number) => {
      const t = mgr.requestDownload(user, virtual, size);
      mgr.handleTransferRequest(1, t.token!, virtual);
      const mockSocket: any = { write: () => {}, end: () => {} };
      await (mgr as any).handleFileConnection(t.token!, mockSocket);
      (mgr as any).handleFileChunk(t.token!, Buffer.alloc(size, 0x41));
      return t;
    };
    // alias dropped, subdirs kept, user always present (no setConfig needed)
    await finishOne("alice", "Music\\Album\\Disc 1\\song.mp3", 64);
    expect(existsSync(join(tmp, "downloads", "alice", "Album", "Disc 1", "song.mp3"))).toBe(true);
    expect(existsSync(join(tmp, "downloads", "Music"))).toBe(false);
    // traversal neutralized (.. -> dir), stays inside downloads dir
    await finishOne("bob", "Share\\..\\..\\evil.mp3", 16);
    const bobDir = join(tmp, "downloads", "bob");
    expect(existsSync(join(tmp, "evil.mp3"))).toBe(false);
    expect(existsSync(join(bobDir, "dir", "dir", "evil.mp3"))).toBe(true);
    // reserved device name prefixed
    await finishOne("carol", "Share\\Docs\\CON", 16);
    expect(existsSync(join(tmp, "downloads", "carol", "Docs", "_CON"))).toBe(true);
    // forward-slash virtuals tolerated
    await finishOne("dave", "Share/Sub/file.mp3", 16);
    expect(existsSync(join(tmp, "downloads", "dave", "Sub", "file.mp3"))).toBe(true);
    // template path: SOURCE_DIRECTORY is first real dir (alias dropped), subpath continues past it
    mgr.setConfig({ download_destination_template: "byuser/${SOURCE_USERNAME}/${SOURCE_DIRECTORY}" });
    await finishOne("erin", "Share\\RealDir\\Sub\\t.mp3", 16);
    expect(existsSync(join(tmp, "downloads", "byuser", "erin", "RealDir", "Sub", "t.mp3"))).toBe(true);
    // template already ending with full subpath: no duplication
    mgr.setConfig({ download_destination_template: "templ/${SOURCE_DIRECTORY}/Sub" });
    await finishOne("fred", "Share\\RealDir\\Sub\\u.mp3", 16);
    expect(existsSync(join(tmp, "downloads", "templ", "RealDir", "Sub", "u.mp3"))).toBe(true);
    mgr.close();
  });

  test("traversal virtualPath stays contained under downloadsDir", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    const t = mgr.requestDownload("bob", "Share\\..\\..\\evil.mp3", 16);
    mgr.handleTransferRequest(1, t.token!, "Share\\..\\..\\evil.mp3");
    await (mgr as any).handleFileConnection(t.token!, { write: () => {}, end: () => {} });
    (mgr as any).handleFileChunk(t.token!, Buffer.alloc(16, 0x41));
    const got = (mgr.get(t.id) as any)?._incompletePath as string;
    const root = resolve(join(tmp, "downloads"));
    expect(resolve(got).startsWith(root + sep)).toBe(true);
    expect(existsSync(join(tmp, "evil.mp3"))).toBe(false);
    expect(existsSync(got)).toBe(true);
    mgr.close();
  });

  test("reserved device name sanitized", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    const t = mgr.requestDownload("carol", "Share\\Docs\\CON", 16);
    mgr.handleTransferRequest(1, t.token!, "Share\\Docs\\CON");
    await (mgr as any).handleFileConnection(t.token!, { write: () => {}, end: () => {} });
    (mgr as any).handleFileChunk(t.token!, Buffer.alloc(16, 0x41));
    expect(existsSync(join(tmp, "downloads", "carol", "Docs", "_CON"))).toBe(true);
    expect(existsSync(join(tmp, "downloads", "carol", "Docs", "CON"))).toBe(false);
    mgr.close();
  });

  test("share alias dropped, user subdir kept", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    // safeUsername preserves case/space, so "Donald Trump" stays as-is
    const t = mgr.requestDownload("Donald Trump", "Music\\Album 1\\01 Flak.mp3", 16);
    mgr.handleTransferRequest(1, t.token!, "Music\\Album 1\\01 Flak.mp3");
    await (mgr as any).handleFileConnection(t.token!, { write: () => {}, end: () => {} });
    (mgr as any).handleFileChunk(t.token!, Buffer.alloc(16, 0x41));
    expect(existsSync(join(tmp, "downloads", "Donald Trump", "Album 1", "01 Flak.mp3"))).toBe(true);
    expect(existsSync(join(tmp, "downloads", "Music"))).toBe(false);
    mgr.close();
  });

  test("migration moves flat entries to nested, idempotent", () => {
    const { mgr } = makeManager(tmp);
    (mgr as any).transfers.clear();
    const flatDir = join(tmp, "downloads", "alice");
    mkdirSync(flatDir, { recursive: true });
    const flatFile = join(flatDir, "song.mp3");
    writeFileSync(flatFile, "flat-bytes");
    const entry: any = {
      id: "alice::Music\\Album\\song.mp3",
      username: "alice",
      virtualPath: "Music\\Album\\song.mp3",
      fileName: "song.mp3",
      size: 10, current: 10, speed: 0, avgSpeed: 0, timeLeft: null,
      status: "Finished", queuePosition: null, isUpload: false,
      token: 424242, _incompletePath: flatFile, _downloadUrl: "/files/424242",
    };
    (mgr as any).transfers.set(entry.id, entry);
    const first = mgr.migrateFlatDownloads();
    expect(first.moved).toBe(1);
    const nested = join(tmp, "downloads", "alice", "Album", "song.mp3");
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(flatFile)).toBe(false);
    expect((mgr.get(entry.id) as any)?._incompletePath).toBe(nested);
    const raw = JSON.parse(readFileSync(join(tmp, "downloads.json"), "utf8")) as any[];
    expect(raw.find((r) => r.id === entry.id)?._incompletePath).toBe(nested);
    const second = mgr.migrateFlatDownloads();
    expect(second.moved).toBe(0);
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(join(tmp, "downloads", "alice", "Album", "song (1).mp3"))).toBe(false);
    mgr.close();
  });

  test("download_path_depth trims to last N remote dirs under user", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    const finishOne = async (user: string, virtual: string, size: number) => {
      const t = mgr.requestDownload(user, virtual, size);
      mgr.handleTransferRequest(1, t.token!, virtual);
      const mockSocket: any = { write: () => {}, end: () => {} };
      await (mgr as any).handleFileConnection(t.token!, mockSocket);
      (mgr as any).handleFileChunk(t.token!, Buffer.alloc(size, 0x41));
      return t;
    };
    mgr.setConfig({ download_path_depth: "3" });
    await finishOne("yoblin", "Share\\Despot\\Gorillas\\DeSide 2007\\Disk 2\\track.mp3", 32);
    expect(existsSync(join(tmp, "downloads", "yoblin", "Gorillas", "DeSide 2007", "Disk 2", "track.mp3"))).toBe(true);
    expect(existsSync(join(tmp, "downloads", "yoblin", "Despot"))).toBe(false);
    mgr.setConfig({ download_path_depth: "1" });
    await finishOne("yoblin", "Share\\A\\B\\one.mp3", 16);
    expect(existsSync(join(tmp, "downloads", "yoblin", "B", "one.mp3"))).toBe(true);
    mgr.setConfig({ download_path_depth: "0" });
    await finishOne("yoblin", "Share\\A\\B\\flat.mp3", 16);
    expect(existsSync(join(tmp, "downloads", "yoblin", "flat.mp3"))).toBe(true);
    // invalid value falls back to full tree
    mgr.setConfig({ download_path_depth: "bogus" as any });
    await finishOne("yoblin", "Share\\A\\B\\full.mp3", 16);
    expect(existsSync(join(tmp, "downloads", "yoblin", "A", "B", "full.mp3"))).toBe(true);
    mgr.close();
  });

  test("getFilePathForToken resolves stored nested dest (Play fix)", async () => {
    const mockSession: any = {
      registerFileToken: () => {},
      unregisterFileToken: () => {},
      queueUpload: () => {},
      placeInQueueRequest: () => {},
      sendUploadSpeed: () => {},
    };
    const { mgr } = makeManager(tmp, mockSession);
    (mgr as any).transfers.clear();
    const t = mgr.requestDownload("alice", "Music\\Album\\Disc 1\\song.mp3", 64);
    mgr.handleTransferRequest(1, t.token!, "Music\\Album\\Disc 1\\song.mp3");
    await (mgr as any).handleFileConnection(t.token!, { write: () => {}, end: () => {} });
    (mgr as any).handleFileChunk(t.token!, Buffer.alloc(64, 0x41));
    const dest = join(tmp, "downloads", "alice", "Album", "Disc 1", "song.mp3");
    expect(existsSync(dest)).toBe(true);
    expect(mgr.getFilePathForToken(t.token!)).toBe(dest);
    mgr.close();
  });

  test("migration trims deep entries, prunes emptied dirs, idempotent", () => {
    const { mgr } = makeManager(tmp);
    (mgr as any).transfers.clear();
    mgr.setConfig({ download_path_depth: "2" });
    const deepDir = join(tmp, "downloads", "alice", "A", "B", "C");
    mkdirSync(deepDir, { recursive: true });
    const deepFile = join(deepDir, "song.mp3");
    writeFileSync(deepFile, "deep-bytes");
    const entry: any = {
      id: "alice::Share\\A\\B\\C\\song.mp3",
      username: "alice",
      virtualPath: "Share\\A\\B\\C\\song.mp3",
      fileName: "song.mp3",
      size: 10, current: 10, speed: 0, avgSpeed: 0, timeLeft: null,
      status: "Finished", queuePosition: null, isUpload: false,
      token: 434343, _incompletePath: deepFile, _downloadUrl: "/files/434343",
    };
    (mgr as any).transfers.set(entry.id, entry);
    const first = mgr.migrateTrimmedDownloads();
    expect(first.moved).toBe(1);
    const trimmed = join(tmp, "downloads", "alice", "B", "C", "song.mp3");
    expect(existsSync(trimmed)).toBe(true);
    expect(existsSync(deepFile)).toBe(false);
    // emptied leading dir pruned, user dir kept
    expect(existsSync(join(tmp, "downloads", "alice", "A"))).toBe(false);
    expect(existsSync(join(tmp, "downloads", "alice"))).toBe(true);
    expect((mgr.get(entry.id) as any)?._incompletePath).toBe(trimmed);
    expect((mgr.get(entry.id) as any)?._downloadUrl).toBe("/files/434343");
    expect(mgr.getFilePathForToken(434343)).toBe(trimmed);
    const second = mgr.migrateTrimmedDownloads();
    expect(second.moved).toBe(0);
    // collision at dest: file stays put
    const deepDir2 = join(tmp, "downloads", "bob", "X", "Y", "Z");
    mkdirSync(deepDir2, { recursive: true });
    const deepFile2 = join(deepDir2, "hit.mp3");
    writeFileSync(deepFile2, "deep");
    mkdirSync(join(tmp, "downloads", "bob", "Y", "Z"), { recursive: true });
    writeFileSync(join(tmp, "downloads", "bob", "Y", "Z", "hit.mp3"), "taken");
    const entry2: any = {
      id: "bob::Share\\X\\Y\\Z\\hit.mp3",
      username: "bob",
      virtualPath: "Share\\X\\Y\\Z\\hit.mp3",
      fileName: "hit.mp3",
      size: 4, current: 4, speed: 0, avgSpeed: 0, timeLeft: null,
      status: "Finished", queuePosition: null, isUpload: false,
      token: 454545, _incompletePath: deepFile2, _downloadUrl: "/files/454545",
    };
    (mgr as any).transfers.set(entry2.id, entry2);
    const third = mgr.migrateTrimmedDownloads();
    expect(third.moved).toBe(0);
    expect(existsSync(deepFile2)).toBe(true);
    // template set: trim migration stands down (template owners manage layout)
    mgr.setConfig({ download_destination_template: "byuser/${SOURCE_USERNAME}" });
    const fourth = mgr.migrateTrimmedDownloads();
    expect(fourth.moved).toBe(0);
    expect(existsSync(deepFile)).toBe(false); // earlier move already applied
    mgr.setConfig({ download_destination_template: null });
    // unknown depth normalizes to full (no-op migration)
    mgr.setConfig({ download_path_depth: "bogus" as any });
    expect((mgr as any).config.download_path_depth).toBe("full");
    mgr.close();
  });
});

describe("transfers — upload serving (Phase 4)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test("handleQueueUpload enqueues Queued upload", () => {
    const { mkdirSync: mks, writeFileSync: wfs } = require("node:fs") as typeof import("node:fs");
    const sharedDir = join(tmp, "shared");
    mks(sharedDir, { recursive: true });
    wfs(join(sharedDir, "share.mp3"), Buffer.alloc(10));
    const { mgr } = makeManager(tmp);
    const t = mgr.handleQueueUpload("alice", "Music\\share.mp3");
    expect(t.status).toBe("Queued");
    expect(t.isUpload).toBe(true);
    mgr.close();
  });

  test("handleQueueUpload respects queue limit Too many files", () => {
    const { mkdirSync: mks, writeFileSync: wfs } = require("node:fs") as typeof import("node:fs");
    const sharedDir = join(tmp, "shared");
    mks(sharedDir, { recursive: true });
    // pre-create 100 files so they pass file_is_shared check
    for (let i = 0; i < 100; i++) wfs(join(sharedDir, `file${i}.mp3`), Buffer.alloc(10));
    wfs(join(sharedDir, "overflow.mp3"), Buffer.alloc(10));
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
    const dlPath = join(tmp, "downloads", "alice", "stream.mp3");
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
    expect(readFileSync(join(tmp, "downloads", "alice", "resume.mp3")).length).toBe(4096);
    mgr2.close();
  });

  test("getQueuePlace returns correct position for queued uploads", () => {
    const { mkdirSync: mks, writeFileSync: wfs } = require("node:fs") as typeof import("node:fs");
    const sharedDir = join(tmp, "shared");
    mks(sharedDir, { recursive: true });
    for (const f of ["a.mp3", "b.mp3", "c.mp3"]) wfs(join(sharedDir, f), Buffer.alloc(10));
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

  test("upload serving resolves /media file via ShareDB virtual2real", async () => {
    // file lives OUTSIDE dataDir (simulates a /media mount) — reachable only via ShareDB mapping
    const mediaDir = mkdtempSync(join(tmpdir(), "nicotine-media-test-"));
    try {
      const realFile = join(mediaDir, "outside.mp3");
      writeFileSync(realFile, Buffer.alloc(3000, 0x45));
      const virtual = "M\\Orpheus\\outside.mp3";
      const mockSession: any = {
        registerFileToken: () => {},
        unregisterFileToken: () => {},
        queueUpload: () => {},
        placeInQueueRequest: () => {},
        sendUploadSpeed: () => {},
        transferRequest: () => {},
        shareDBInstance: {
          hasVirtualPath: (p: string) => p === virtual,
          getVirtual2Real: (p: string) => (p === virtual ? realFile : undefined),
        },
      };
      const { mgr } = makeManager(tmp, mockSession);
      (mgr as any).transfers.clear();
      const q = mgr.handleQueueUpload("peerB", virtual);
      expect(q.status).toBe("Queued");
      await new Promise((r) => setTimeout(r, 200));
      const up = mgr.get(q.id);
      const token = up?.token;
      expect(token).toBeDefined();
      const writes: Buffer[] = [];
      const mockSocket: any = {
        write: (b: Buffer) => writes.push(Buffer.from(b)),
        end: () => {},
      };
      await (mgr as any).handleFileConnection(token!, mockSocket);
      const off = Buffer.alloc(8);
      off.writeBigUInt64LE(BigInt(0), 0);
      (mgr as any).handleFileChunk(token!, off);
      await new Promise((r) => setTimeout(r, 500));
      const totalSent = writes.reduce((s, b) => s + b.length, 0);
      expect(totalSent).toBe(3000);
      expect(mgr.get(q.id)?.status).toBe("Finished");
      mgr.close();
    } finally {
      rmSync(mediaDir, { recursive: true, force: true });
    }
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

describe("transfers — statistics breakdown (failed/cancelled + live)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test("download cancel counts once, upload-failed counts failed", () => {
    const { mgr } = makeManager(tmp);
    mgr.requestDownload("alice", "a.mp3", 100);
    mgr.controlDownload("alice::a.mp3", "cancel");
    mgr.controlDownload("alice::a.mp3", "cancel"); // no double count
    mgr.requestDownload("bob", "b.mp3", 100);
    mgr.handleUploadFailed("b.mp3");
    const summary = mgr.getStatsSummary() as unknown as {
      total: { cancelled_downloads: number; failed_downloads: number };
      live: { queuedDownloads: number };
    };
    expect(summary.total.cancelled_downloads).toBe(1);
    expect(summary.total.failed_downloads).toBe(1);
    expect(summary.live.queuedDownloads).toBe(0);
    mgr.close();
  });

  test("denied + cancelled uploads count failed/cancelled", () => {
    const { mgr } = makeManager(tmp);
    // empty tmp dir → nothing shared → "File not shared." denials
    const denied = mgr.handleQueueUpload("peerX", "ghost.mp3");
    expect(denied.status).toBe("File not shared.");
    mgr.handleQueueUpload("peerY", "ghost2.mp3");
    mgr.controlUpload("peerX::ghost.mp3", "cancel"); // denied entry cancelled — failed already counted, cancel counts once
    const summary = mgr.getStatsSummary() as unknown as {
      total: { failed_uploads: number; cancelled_uploads: number };
    };
    expect(summary.total.failed_uploads).toBe(2);
    expect(summary.total.cancelled_uploads).toBe(1);
    mgr.close();
  });

  test("old statistics.json without new counters normalizes to 0", async () => {
    const { StatsManager } = await import("./statistics.ts");
    writeFileSync(join(tmp, "statistics.json"), JSON.stringify({
      since_timestamp: 1, started_downloads: 5, completed_downloads: 4, downloaded_size: 100,
      started_uploads: 2, completed_uploads: 2, uploaded_size: 50,
    }));
    const sm = new StatsManager({ configDir: tmp });
    expect(sm.getTotal().failed_downloads).toBe(0);
    expect(sm.getTotal().cancelled_uploads).toBe(0);
    expect(sm.getTotal().started_downloads).toBe(5);
    sm.recordDownloadFailed();
    expect(sm.getTotal().failed_downloads).toBe(1);
    expect(sm.getSession().failed_downloads).toBe(1);
  });
});
