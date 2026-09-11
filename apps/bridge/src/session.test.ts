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
