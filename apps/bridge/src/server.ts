/**
 * WebSocket bridge server — nicotine-plus 1:1 parity, token auth, volume-backed transfers.
 *
 * WS JSON protocol — examples:
 *   client -> server: { type:"login", username, password, host?, port? }
 *   client -> server: { type:"search", searchId, query } | { type:"search:user", searchId, username, query }
 *   client -> server: { type:"chat:room", action:"join"|"leave"|"say", room, message? }
 *   client -> server: { type:"chat:private", action:"send", username, message }
 */

import { mkdirSync } from "node:fs";
import { z } from "zod";
import { SoulseekSession } from "./session.ts";
import { TransferManager } from "./transfers.ts";

/* Schemas */

const LoginMessageSchema = z.object({
  type: z.literal("login"),
  username: z.string().min(1).max(64),
  password: z.string().min(1),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

const SearchMessageSchema = z.object({
  type: z.literal("search"),
  searchId: z.string().min(1).max(64),
  query: z.string().min(1).max(255),
});
const SearchUserSchema = z.object({
  type: z.literal("search:user"),
  searchId: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  query: z.string().min(1).max(255),
});
const SearchRoomSchema = z.object({
  type: z.literal("search:room"),
  searchId: z.string().min(1).max(64),
  room: z.string().min(1).max(64),
  query: z.string().min(1).max(255),
});
const SearchWishlistSchema = z.object({
  type: z.literal("search:wishlist"),
  searchId: z.string().min(1).max(64),
  query: z.string().min(1).max(255),
});
const StopMessageSchema = z.object({
  type: z.literal("search:stop"),
  searchId: z.string().min(1).max(64),
});

const ProfileSchema = z.object({
  descr: z.string().max(10000),
  pic: z.string().max(5_000_000).optional(),
  totalupl: z.number().int().min(0).max(1e12),
  queuesize: z.number().int().min(0).max(1e9),
  slotsavail: z.boolean(),
  uploadallowed: z.number().int().min(0).max(3),
});

const UserInfoMessageSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("watch"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("unwatch"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("get"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("interests"), username: z.string().min(1).max(64) }),
  z.object({ action: z.literal("recommendations") }),
  z.object({ action: z.literal("globalRecommendations") }),
  z.object({ action: z.literal("similarUsers") }),
  z.object({ action: z.literal("itemRecommendations"), item: z.string().min(1).max(255) }),
  z.object({ action: z.literal("itemSimilarUsers"), item: z.string().min(1).max(255) }),
  z.object({ action: z.literal("addLike"), thing: z.string().min(1).max(255) }),
  z.object({ action: z.literal("removeLike"), thing: z.string().min(1).max(255) }),
  z.object({ action: z.literal("addHate"), thing: z.string().min(1).max(255) }),
  z.object({ action: z.literal("removeHate"), thing: z.string().min(1).max(255) }),
  z.object({ action: z.literal("givePrivileges"), username: z.string().min(1).max(64), days: z.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("setStatus"), status: z.number().int().min(0).max(2) }),
  z.object({ action: z.literal("setProfile"), profile: ProfileSchema }),
  z.object({ action: z.literal("checkPrivileges") }),
  z.object({ action: z.literal("changePassword"), password: z.string().min(1).max(128) }),
  z.object({ action: z.literal("reportShares"), dirs: z.number().int().min(0), files: z.number().int().min(0) }),
]);

const DownloadRequestSchema = z.object({
  type: z.literal("download:request"),
  username: z.string().min(1).max(64),
  virtualPath: z.string().min(1).max(1024),
  size: z.number().min(0).max(1e13),
  fileName: z.string().max(512).optional(),
});
const DownloadControlSchema = z.object({
  type: z.literal("download:control"),
  id: z.string().min(1).max(1024),
  action: z.enum(["cancel", "pause", "resume", "retry", "clear"]),
});
const UploadControlSchema = z.object({
  type: z.literal("upload:control"),
  id: z.string().min(1).max(1024),
  action: z.enum(["cancel", "clear"]),
});
const UserInfoRequestSchema = z.object({ type: z.literal("userinfo") }).and(UserInfoMessageSchema);

const ChatRoomSchema = z.object({
  type: z.literal("chat:room"),
  action: z.enum(["join", "leave", "say", "ticker", "setTicker"]),
  room: z.string().min(1).max(64),
  message: z.string().max(5000).optional(),
});
const ChatPrivateSchema = z.object({
  type: z.literal("chat:private"),
  action: z.enum(["send", "ack"]),
  username: z.string().min(1).max(64),
  message: z.string().max(5000).optional(),
  msgId: z.number().int().optional(),
});
const BrowseSchema = z.object({
  type: z.literal("browse"),
  action: z.enum(["shares", "folder"]),
  username: z.string().min(1).max(64),
  folder: z.string().max(1024).optional(),
  token: z.number().int().optional(),
});

function defaultProfile(username: string) {
  return { username, descr: "", pic: null, totalupl: 0, queuesize: 0, slotsavail: true, uploadallowed: 1 };
}

const LISTEN_PORT = Number(process.env.LISTEN_PORT || 2234);
const PORT = Number(process.env.PORT || 8787);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";
const DATA_DIR = process.env.DATA_DIR || "/data";

// Ensure data volume exists (dev fallback to /tmp if /data not writable)
try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // fallback checked in TransferManager
}

function errorMessage(error: string): string { return JSON.stringify({ type: "error", error }); }

function extractToken(req: Request): string | null {
  const url = new URL(req.url);
  const qp = url.searchParams.get("token");
  if (qp) return qp;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const proto = req.headers.get("sec-websocket-protocol");
  // Client may send token as subprotocol like "bearer, <token>"
  if (proto) {
    const parts = proto.split(",").map((s) => s.trim());
    for (const p of parts) if (p && p !== "bearer") return p;
  }
  return null;
}

export const server = Bun.serve<{ session?: SoulseekSession; transfers?: TransferManager }>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/health" && req.method === "GET") return new Response("ok", { status: 200 });

    if (url.pathname === "/ws") {
      if (BRIDGE_TOKEN) {
        const tok = extractToken(req);
        if (tok !== BRIDGE_TOKEN) {
          return new Response("Unauthorized: invalid token", { status: 401 });
        }
      }
      const ok = server.upgrade(req, { data: {} });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Download finished files if volume enabled — GET /files/:id
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      // Simple static file serving from DATA_DIR/downloads
      // Deferred to transfers handler — return 404 for now if not found
      return new Response("Not found", { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.data = {};
      const tm = new TransferManager({
        dataDir: DATA_DIR,
        onUpdate: (transfer) => { try { ws.send(JSON.stringify({ type: "transfer:update", transfer })); } catch {} },
        onRemoved: (id) => { try { ws.send(JSON.stringify({ type: "transfer:removed", id })); } catch {} },
        onStats: (stats) => { try { ws.send(JSON.stringify({ type: "transfer:stats", ...stats })); } catch {} },
      });
      ws.data.transfers = tm;
      setTimeout(() => {
        for (const t of tm.list()) { try { ws.send(JSON.stringify({ type: "transfer:update", transfer: t })); } catch {} }
      }, 50);
    },
    message(ws, raw) {
      let parsed: unknown;
      try { parsed = JSON.parse(String(raw)); } catch { ws.send(errorMessage("Invalid JSON payload.")); return; }
      const data = parsed as { type?: string };

      if (data.type === "login") {
        const result = LoginMessageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid login message.")); return; }
        const { username, password, host, port } = result.data;
        // Close previous session if any
        ws.data.session?.close();
        const session = new SoulseekSession({
          username, password, host, port, listenPort: LISTEN_PORT, profile: defaultProfile(username),
          onUserEvent: (event) => { try { ws.send(JSON.stringify({ type: "userinfo:event", event })); } catch {} },
          onChatEvent: (event) => { try { ws.send(JSON.stringify({ type: "chat:event", event })); } catch {} },
          onRoomEvent: (event) => { try { ws.send(JSON.stringify({ type: "room:event", event })); } catch {} },
          onTransferEvent: (event) => { try { ws.send(JSON.stringify({ type: "peer:transfer", event })); } catch {} },
        });
        ws.data.session = session;
        ws.send(JSON.stringify({ type: "login:start" }));
        session.login()
          .then((outcome) => ws.send(JSON.stringify({ type: "login:result", ok: true, data: outcome })))
          .catch((err: Error) => ws.send(JSON.stringify({ type: "login:result", ok: false, error: err.message })));
        return;
      }

      // Helpers to enforce logged-in
      const requireLogin = (): SoulseekSession | null => {
        const s = ws.data.session;
        if (!s || !s.isLoggedIn) { ws.send(errorMessage("Not logged in.")); return null; }
        return s;
      };

      if (data.type === "search") {
        const result = SearchMessageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, query } = result.data;
        const token = session.search(query, searchId, {
          onResult: (p) => ws.send(JSON.stringify({ type: "search:result", ...p })),
          onEnd: (p) => ws.send(JSON.stringify({ type: "search:end", ...p })),
        });
        if (token === 0) ws.send(JSON.stringify({ type: "search:end", searchId, reason: "error" }));
        else ws.send(JSON.stringify({ type: "search:start", searchId, token }));
        return;
      }
      if (data.type === "search:user") {
        const result = SearchUserSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:user message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, username, query } = result.data;
        const token = session.searchUser(username, query, searchId, {
          onResult: (p) => ws.send(JSON.stringify({ type: "search:result", ...p })),
          onEnd: (p) => ws.send(JSON.stringify({ type: "search:end", ...p })),
        });
        ws.send(JSON.stringify({ type: "search:start", searchId, token }));
        return;
      }
      if (data.type === "search:room") {
        const result = SearchRoomSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:room message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, room, query } = result.data;
        const token = session.searchRoom(room, query, searchId, {
          onResult: (p) => ws.send(JSON.stringify({ type: "search:result", ...p })),
          onEnd: (p) => ws.send(JSON.stringify({ type: "search:end", ...p })),
        });
        ws.send(JSON.stringify({ type: "search:start", searchId, token }));
        return;
      }
      if (data.type === "search:wishlist") {
        const result = SearchWishlistSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search:wishlist message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { searchId, query } = result.data;
        const token = session.wishlistSearch(query, searchId, {
          onResult: (p) => ws.send(JSON.stringify({ type: "search:result", ...p })),
          onEnd: (p) => ws.send(JSON.stringify({ type: "search:end", ...p })),
        });
        ws.send(JSON.stringify({ type: "search:start", searchId, token }));
        return;
      }
      if (data.type === "search:stop") {
        const result = StopMessageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid stop message.")); return; }
        ws.data.session?.cancelSearch(result.data.searchId);
        return;
      }

      if (data.type === "download:request") {
        const result = DownloadRequestSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid download request.")); return; }
        const session = requireLogin(); if (!session) return;
        session.queueUpload(result.data.username, result.data.virtualPath);
        ws.data.transfers?.requestDownload(result.data.username, result.data.virtualPath, result.data.size, result.data.fileName);
        return;
      }
      if (data.type === "download:control") {
        const result = DownloadControlSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid download control.")); return; }
        ws.data.transfers?.controlDownload(result.data.id, result.data.action);
        return;
      }
      if (data.type === "upload:control") {
        const result = UploadControlSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid upload control.")); return; }
        ws.data.transfers?.controlUpload(result.data.id, result.data.action);
        return;
      }

      if (data.type === "chat:room") {
        const result = ChatRoomSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid chat:room message.")); return; }
        const session = requireLogin(); if (!session) return;
        const { action, room, message } = result.data;
        if (action === "join") session.joinRoom(room);
        else if (action === "leave") session.leaveRoom(room);
        else if (action === "say" && message) session.sayChatroom(room, message);
        else if (action === "setTicker" && message) session.setRoomTicker(room, message);
        else if (action === "ticker") { /* server pushes tickers, no client send needed */ }
        return;
      }
      if (data.type === "chat:private") {
        const result = ChatPrivateSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid chat:private message.")); return; }
        const session = requireLogin(); if (!session) return;
        if (result.data.action === "send" && result.data.message) session.sendPrivateMessage(result.data.username, result.data.message);
        return;
      }
      if (data.type === "chat:global") {
        const session = requireLogin(); if (!session) return;
        const msg = parsed as { action?: string };
        if (msg.action === "join") session.joinGlobalRoom();
        else if (msg.action === "leave") session.leaveGlobalRoom();
        return;
      }
      if (data.type === "browse") {
        const result = BrowseSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid browse message.")); return; }
        const session = requireLogin(); if (!session) return;
        if (result.data.action === "shares") session.requestSharedFileList(result.data.username);
        else if (result.data.action === "folder" && result.data.folder) session.requestFolderContents(result.data.username, result.data.folder, result.data.token ?? Math.floor(Math.random() * 1e9));
        return;
      }

      if (data.type === "peer:connect") {
        const session = requireLogin(); if (!session) return;
        const { username, connType = "P" } = parsed as { username?: string; connType?: string };
        if (!username) { ws.send(errorMessage("username required")); return; }
        session.connectPeer(username, connType)
          .then(() => ws.send(JSON.stringify({ type: "peer:connect", ok: true, username, connType })))
          .catch((e: Error) => ws.send(JSON.stringify({ type: "peer:connect", ok: false, username, error: e.message })));
        return;
      }

      if (data.type === "userinfo") {
        const result = UserInfoRequestSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid userinfo message.")); return; }
        const session = requireLogin(); if (!session) return;
        const msg = result.data;
        switch (msg.action) {
          case "watch": session.watchUser(msg.username); break;
          case "unwatch": session.unwatchUser(msg.username); break;
          case "get":
            session.requestUserInfo(msg.username)
              .then((info) => ws.send(JSON.stringify({ type: "user-info-response", username: info.username, descr: info.descr, pic: info.pic ? info.pic.toString("base64") : null, totalupl: info.totalupl, queuesize: info.queuesize, slotsavail: info.slotsavail, uploadallowed: info.uploadallowed })))
              .catch(() => ws.send(JSON.stringify({ type: "user-info-failed", username: msg.username })));
            break;
          case "interests": session.requestUserInterests(msg.username); break;
          case "recommendations": session.requestRecommendations(); break;
          case "globalRecommendations": session.requestGlobalRecommendations(); break;
          case "similarUsers": session.requestSimilarUsers(); break;
          case "itemRecommendations": session.requestItemRecommendations(msg.item); break;
          case "itemSimilarUsers": session.requestItemSimilarUsers(msg.item); break;
          case "addLike": session.addThingILike(msg.thing); break;
          case "removeLike": session.removeThingILike(msg.thing); break;
          case "addHate": session.addThingIHate(msg.thing); break;
          case "removeHate": session.removeThingIHate(msg.thing); break;
          case "givePrivileges": session.givePrivileges(msg.username, msg.days); break;
          case "setStatus": session.setStatus(msg.status); break;
          case "checkPrivileges": session.checkPrivileges(); break;
          case "changePassword": session.changePassword(msg.password); break;
          case "reportShares": session.reportShares(msg.dirs, msg.files); break;
          case "setProfile":
            session.setProfile({ username: session.username, descr: msg.profile.descr, pic: msg.profile.pic ? Buffer.from(msg.profile.pic, "base64") : null, totalupl: msg.profile.totalupl, queuesize: msg.profile.queuesize, slotsavail: msg.profile.slotsavail, uploadallowed: msg.profile.uploadallowed });
            break;
        }
        return;
      }

      ws.send(errorMessage("Unknown message type."));
    },
    close(ws) {
      ws.data.session?.close();
      ws.data.transfers?.close();
      ws.data = {};
    },
  },
});

if (import.meta.main) {
  console.log(`Nicotine Mobile bridge listening on ws://localhost:${PORT}/ws ${BRIDGE_TOKEN ? "(token auth enabled)" : "(open)"} DATA_DIR=${DATA_DIR}`);
}
