import { describe, expect, test } from "bun:test";
import type { Socket } from "bun";
import { buildPeerInit, frameMessage, packString, packUint32, PEER_MESSAGE_CODES, SERVER_MESSAGE_CODES } from "./soulseek.ts";
import { SoulseekSession } from "./session.ts";
import { PermissionLevel, ShareDB } from "./shares.ts";

describe("peer TCP framing", () => {
  test("keeps initialized state when init and next frame arrive in separate packets", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    const peer = {
      end() {},
      write() {},
    } as unknown as Socket;
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    const init = buildPeerInit("alice", "P");
    processPeer(peer, init.subarray(0, 7), false);
    processPeer(peer, init.subarray(7), false);

    const state = peerStates.get(peer) as { initDone: boolean; username?: string; connType?: string };
    expect(state.initDone).toBe(true);
    expect(state.username).toBe("alice");
    expect(state.connType).toBe("P");

    const next = frameMessage(999, Buffer.alloc(0));
    processPeer(peer, next.subarray(0, 4), false);
    processPeer(peer, next.subarray(4), false);
    expect(peerStates.has(peer)).toBe(true);

    const largeSharePrefix = Buffer.alloc(1_048_577);
    largeSharePrefix.writeUInt32LE(1_048_580, 0);
    largeSharePrefix.writeUInt32LE(5, 4);
    processPeer(peer, largeSharePrefix, false);
    expect(peerStates.has(peer)).toBe(true);
  });

  test("splits PeerInit bob P across packets", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    const peer = {
      end() {},
      write() {},
    } as unknown as Socket;
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    const init = buildPeerInit("bob", "P");
    processPeer(peer, init.subarray(0, 7), false);
    processPeer(peer, init.subarray(7), false);

    const state = peerStates.get(peer) as { initDone: boolean; username?: string; connType?: string };
    expect(state.initDone).toBe(true);
    expect(state.username).toBe("bob");
    expect(state.connType).toBe("P");
    expect(peerStates.has(peer)).toBe(true);
  });

  test("closes on oversized generic frame", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    let ended = false;
    const peer = {
      end() { ended = true; },
      write() {},
    } as unknown as Socket;
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    processPeer(peer, buildPeerInit("bob", "P"), false);
    expect(ended).toBe(false);

    const oversized = frameMessage(999, Buffer.alloc(1_048_577));
    processPeer(peer, oversized, false);
    expect(ended).toBe(true);
    expect(peerStates.has(peer)).toBe(false);
  });

  test("rejects pre-handshake buffer over 1M", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    let ended = false;
    const peer = {
      end() { ended = true; },
      write() {},
    } as unknown as Socket;
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    processPeer(peer, Buffer.alloc(1_048_577), false);
    expect(ended).toBe(true);
    expect(peerStates.has(peer)).toBe(false);
  });

  test("retains large share-response prefix", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    let ended = false;
    const peer = {
      end() { ended = true; },
      write() {},
    } as unknown as Socket;
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    processPeer(peer, buildPeerInit("bob", "P"), false);
    expect(ended).toBe(false);

    const prefix = Buffer.alloc(1_048_577);
    prefix.writeUInt32LE(10_000_000, 0);
    prefix.writeUInt32LE(5, 4);
    processPeer(peer, prefix, false);
    expect(ended).toBe(false);
    expect(peerStates.has(peer)).toBe(true);
  });

  test("serves first inbound SharedFileListRequest (no self-throttle)", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    const shareDB = Object.create(ShareDB.prototype) as ShareDB;
    Object.assign(shareDB as unknown as Record<string, unknown>, {
      lastShareRequests: new Map<string, number>(),
      folders: [],
      publicFolders: [],
      buddyFolders: [],
      trustedFolders: [],
      revealBuddyShares: false,
      revealTrustedShares: false,
    });
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      shareDB,
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      getSharePermissionLevel: () => PermissionLevel.PUBLIC,
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    const written: Buffer[] = [];
    const peer = {
      end() {},
      write(b: Buffer) { written.push(Buffer.from(b)); },
    } as unknown as Socket;
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    processPeer(peer, buildPeerInit("alice", "P"), false);
    processPeer(peer, frameMessage(PEER_MESSAGE_CODES.sharedFileListRequest, Buffer.alloc(0)), false);
    // code-5 reply must be written, not throttled by the log-line check
    expect(written.some((b) => b.length >= 8 && b.readUInt32LE(4) === PEER_MESSAGE_CODES.sharedFileListResponse)).toBe(true);
  });

  test("preserves distrib BranchLevel arriving before PeerInit on outbound D dial", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    const potentialParents = new Map([
      ["parent1", { username: "parent1", ip: "10.0.0.1", port: 41234, branchLevel: null, branchRoot: null }],
    ]);
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      potentialParents,
      parent: null,
      childPeers: new Map<Socket, unknown>(),
      branchLevel: 0,
      branchRoot: "me",
      isServerParent: false,
      maxDistribChildren: 10,
      tokenCounter: 1,
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    let ended = false;
    const peer = {
      end() { ended = true; },
      write() {},
    } as unknown as Socket;
    // outbound parent-candidate dial: username/connType known, init not yet seen
    peerStates.set(peer, {
      buf: Buffer.alloc(0), initDone: false, username: "parent1", outbound: true,
      connType: "D", lastActive: Date.now(), createdAt: Date.now(), bytesReceived: 0, msgsParsed: 0,
    });
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    // parent sends BranchLevel before any PeerInit (no PeerInit on this path)
    const levelPayload = packUint32(2);
    const levelFrame = Buffer.concat([packUint32(levelPayload.length + 1), Buffer.from([4]), levelPayload]);
    processPeer(peer, levelFrame, false);
    // frame must survive as distrib handshake, not be consumed as unknown init
    expect(ended).toBe(false);
    expect(peerStates.has(peer)).toBe(true);
    expect((potentialParents.get("parent1") as { branchLevel: number | null }).branchLevel).toBe(2);

    const rootPayload = packString("root1");
    const rootFrame = Buffer.concat([packUint32(rootPayload.length + 1), Buffer.from([5]), rootPayload]);
    processPeer(peer, rootFrame, false);
    expect((session as unknown as { parent: { username: string } | null }).parent?.username).toBe("parent1");
  });

  test("closes fast on truly unknown init code instead of leaking to dead sweep", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    let ended = false;
    const peer = {
      end() { ended = true; },
      write() {},
    } as unknown as Socket;
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    const badInit = Buffer.concat([packUint32(1), Buffer.from([99])]);
    processPeer(peer, badInit, false);
    expect(ended).toBe(true);
    expect(peerStates.has(peer)).toBe(false);
  });

  test("routes distrib ping before PeerInit on outbound D dial (not pierce-park)", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const peerStates = new Map<Socket, unknown>();
    const parkedPierce = new Map<number, unknown>();
    Object.assign(session as unknown as Record<string, unknown>, {
      peerStates,
      closedPeers: new Set<Socket>(),
      pendingFileTokens: new Set<number>(),
      pendingConnects: new Map(),
      pendingPeerMessages: new Map(),
      allowedPeerResponses: new Map(),
      pendingPeerQueue: [],
      parkedPierce,
      parent: null,
      childPeers: new Map<Socket, unknown>(),
      opts: { username: "me", onTransferEvent: () => {} },
      username: "me",
    });

    let ended = false;
    const peer = {
      end() { ended = true; },
      write() {},
    } as unknown as Socket;
    peerStates.set(peer, {
      buf: Buffer.alloc(0), initDone: false, username: "parent1", outbound: true,
      connType: "D", lastActive: Date.now(), createdAt: Date.now(), bytesReceived: 0, msgsParsed: 0,
    });
    const processPeer = (session as unknown as { processPeer: (peer: Socket, chunk: Buffer, initDone: boolean) => void }).processPeer.bind(session);
    // distrib ping: [len=5][u8 0][u32 token] — must not be parked as PierceFireWall
    const ping = Buffer.concat([packUint32(5), Buffer.from([0]), packUint32(1234)]);
    processPeer(peer, ping, false);
    expect(ended).toBe(false);
    expect(parkedPierce.size).toBe(0);
    const state = peerStates.get(peer) as { initDone: boolean; buf: Buffer };
    expect(state.initDone).toBe(true);
    // ping consumed by the distrib branch (no reply: not our child), never parked as pierce
    expect(state.buf.length).toBe(0);
  });

  test("handlePeerSocketClosed notifies transfers only for F channels", () => {
    const mk = (onFileClosed: (t: number) => void) => {
      const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
      const peerStates = new Map<Socket, unknown>();
      Object.assign(session as unknown as Record<string, unknown>, {
        peerStates,
        closedPeers: new Set<Socket>(),
        opts: { username: "me", onTransferEvent: () => {}, onFileClosed },
        username: "me",
      });
      return { session, peerStates };
    };
    const closeIt = (session: SoulseekSession, peer: Socket) => {
      const st = (session as unknown as { peerStates: Map<Socket, unknown> }).peerStates.get(peer);
      (session as unknown as { handlePeerSocketClosed: (s: Socket, st: unknown) => void }).handlePeerSocketClosed(peer, st);
    };

    // F channel with token: notify + forget, tombstoned against resurrect
    {
      const seen: number[] = [];
      const { session, peerStates } = mk((t) => { seen.push(t); });
      const peer = { end() {}, write() {} } as unknown as Socket;
      peerStates.set(peer, { buf: Buffer.alloc(0), initDone: true, isFileConn: true, fileToken: 4242, username: "u", connType: "F", lastActive: Date.now(), createdAt: Date.now() });
      closeIt(session, peer);
      expect(seen).toEqual([4242]);
      expect(peerStates.has(peer)).toBe(false);
    }
    // P channel: no notify, still forgotten
    {
      const seen: number[] = [];
      const { session, peerStates } = mk((t) => { seen.push(t); });
      const peer = { end() {}, write() {} } as unknown as Socket;
      peerStates.set(peer, { buf: Buffer.alloc(0), initDone: true, username: "u", connType: "P", lastActive: Date.now(), createdAt: Date.now() });
      closeIt(session, peer);
      expect(seen).toEqual([]);
      expect(peerStates.has(peer)).toBe(false);
    }
    // unknown socket: no notify, no throw
    {
      const seen: number[] = [];
      const { session, peerStates } = mk((t) => { seen.push(t); });
      const peer = { end() {}, write() {} } as unknown as Socket;
      closeIt(session, peer);
      expect(seen).toEqual([]);
      expect(peerStates.has(peer)).toBe(false);
    }
  });

  test("handleServerData drops a bad frame without killing the read loop", () => {
    const session = Object.create(SoulseekSession.prototype) as SoulseekSession;
    const seen: string[] = [];
    Object.assign(session as unknown as Record<string, unknown>, {
      serverBuffer: Buffer.alloc(0),
      serverSocket: { write() {}, end() {} },
      hasReceivedLoginResponse: false,
      consecutiveSilentCloses: 0,
      shouldReconnect: true,
      loginResolve: undefined,
      // first dispatch (login reject) throws out of the user callback — loop must survive it
      loginReject: () => { throw new Error("boom"); },
      opts: { username: "me", onUserEvent: (e: { type: string }) => { seen.push(e.type); } },
      username: "me",
    });
    const handleServerData = (session as unknown as { handleServerData: (c: Buffer) => void }).handleServerData.bind(session);
    const badLogin = frameMessage(SERVER_MESSAGE_CODES.login, Buffer.concat([Buffer.from([0]), packString("INVALIDPASS")]));
    const goodPriv = frameMessage(SERVER_MESSAGE_CODES.checkPrivileges, packUint32(60));
    expect(() => handleServerData(Buffer.concat([badLogin, goodPriv]))).not.toThrow();
    // bad login frame was still consumed/processed (no reconnect), good frame dispatched after it
    expect((session as unknown as { hasReceivedLoginResponse: boolean }).hasReceivedLoginResponse).toBe(true);
    expect(seen).toEqual(["check-privileges"]);
    // truncated tail is retained, not dispatched and not fatal
    const before = seen.length;
    expect(() => handleServerData(goodPriv.subarray(0, 5))).not.toThrow();
    expect(seen.length).toBe(before);
  });
});
