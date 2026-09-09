import { describe, expect, test } from "bun:test";
import type { Socket } from "bun";
import { buildPeerInit, frameMessage } from "./soulseek.ts";
import { SoulseekSession } from "./session.ts";

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
});
