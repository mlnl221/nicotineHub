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
import { diagClear, diagLog, diagTail, diagSubscribe, logger, type LogLevel } from "./logger.ts";

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

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

export const server = Bun.serve<{ session?: SoulseekSession; transfers?: TransferManager; logUnsub?: () => void }>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.pathname === "/health" && req.method === "GET") {
      // Detailed health JSON if ?json or Accept: application/json, else plain "ok" for compose healthcheck
      const wantJson = url.searchParams.has("json") || (req.headers.get("accept") || "").includes("application/json");
      if (wantJson) {
        const peerCount = (() => {
          // best-effort: count sessions — not tracked globally, so 0 here; diagnostics page uses WS-derived counts
          return 0;
        })();
        return new Response(JSON.stringify({
          ok: true,
          ts: new Date().toISOString(),
          uptime: process.uptime(),
          port: PORT,
          listenPort: LISTEN_PORT,
          dataDir: DATA_DIR,
          tokenAuth: !!BRIDGE_TOKEN,
        }), { status: 200, headers: { "content-type": "application/json", ...CORS_HEADERS } });
      }
      return new Response("ok", { status: 200, headers: CORS_HEADERS });
    }
    if (url.pathname === "/logs" && req.method === "GET") {
      // Simple auth check via token param/header (mirror /ws)
      if (BRIDGE_TOKEN) {
        const tok = extractToken(req);
        if (tok !== BRIDGE_TOKEN) return new Response("Unauthorized", { status: 401 });
      }
      const tail = Math.min(Math.max(Number(url.searchParams.get("tail") || "500"), 1), 2000);
      const level = (url.searchParams.get("level") as LogLevel) || "debug";
      const scope = url.searchParams.get("scope") || undefined;
      let entries = diagTail(2000, level as LogLevel);
      if (scope) entries = entries.filter((e) => e.scope === scope);
      entries = entries.slice(-tail);
      return new Response(JSON.stringify({ entries, total: entries.length }), { status: 200, headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }
    if (url.pathname === "/diagnostics" && req.method === "GET") {
      if (BRIDGE_TOKEN) {
        const tok = extractToken(req);
        if (tok !== BRIDGE_TOKEN) return new Response("Unauthorized", { status: 401 });
      }
      const tail = Math.min(Math.max(Number(url.searchParams.get("tail") || "500"), 1), 2000);
      const level = (url.searchParams.get("level") as LogLevel) || "debug";
      let entries = diagTail(2000, level as LogLevel);
      entries = entries.slice(-tail);
      return new Response(JSON.stringify({
        health: { ok: true, ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: LISTEN_PORT, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN },
        logs: entries,
      }), { status: 200, headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }

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

    // GET /files/:token — serve finished downloads from DATA_DIR/downloads
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      const tokenStr = url.pathname.slice("/files/".length).split("/")[0];
      const token = Number(tokenStr);
      if (!Number.isFinite(token)) return new Response("Not found", { status: 404 });
      // Try to locate file in DATA_DIR/downloads by token — we don't have ws context here,
      // so attempt direct FS lookup: scan downloads dir for files and also check downloads.json
      try {
        const { existsSync, readFileSync, createReadStream } = require("node:fs") as typeof import("node:fs");
        const { join } = require("node:path") as typeof import("node:path");
        // Try to find transfer by token via downloads.json
        const dlPath = join(DATA_DIR, "downloads.json");
        let fileName: string | undefined;
        let size: number | undefined;
        if (existsSync(dlPath)) {
          try {
            const arr = JSON.parse(readFileSync(dlPath, "utf8")) as Array<{ token?: number; fileName?: string; size?: number; status?: string }>;
            const entry = arr.find((e) => e.token === token && e.status === "Finished");
            if (entry) { fileName = entry.fileName; size = entry.size; }
          } catch {}
        }
        // Fallback: try transfers.json
        if (!fileName) {
          const alt = join(DATA_DIR, "transfers.json");
          if (existsSync(alt)) {
            try {
              const arr = JSON.parse(readFileSync(alt, "utf8")) as Array<{ token?: number; fileName?: string; size?: number; status?: string }>;
              const entry = arr.find((e) => e.token === token && e.status === "Finished");
              if (entry) fileName = entry.fileName;
            } catch {}
          }
        }
        let filePath: string | undefined;
        if (fileName) {
          const cand = join(DATA_DIR, "downloads", fileName);
          if (existsSync(cand)) filePath = cand;
        }
        if (!filePath) {
          // Last resort: first file in downloads
          const { readdirSync } = require("node:fs") as typeof import("node:fs");
          try {
            const files = readdirSync(join(DATA_DIR, "downloads"));
            if (files.length === 1) filePath = join(DATA_DIR, "downloads", files[0]);
          } catch {}
        }
        if (!filePath || !existsSync(filePath)) return new Response("Not found", { status: 404 });
        const file = Bun.file(filePath);
        const headers: Record<string, string> = {
          "Content-Disposition": `attachment; filename="${(fileName || "download").replace(/"/g, "")}"`,
        };
        // Let Bun handle range/streaming
        return new Response(file as unknown as BodyInit, { headers });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.data = {};
      logger.info("bridge", "ws open", { ip: (ws as unknown as { remoteAddress?: string }).remoteAddress });
      const tm = new TransferManager({
        dataDir: DATA_DIR,
        onUpdate: (transfer) => { try { ws.send(JSON.stringify({ type: "transfer:update", transfer })); } catch {} },
        onRemoved: (id) => { try { ws.send(JSON.stringify({ type: "transfer:removed", id })); } catch {} },
        onStats: (stats) => { try { ws.send(JSON.stringify({ type: "transfer:stats", ...stats })); } catch {} },
        onQueue: (id, place) => { try { ws.send(JSON.stringify({ type: "transfer:queue", id, place })); } catch {} },
        onFinished: (id, fileName, size, downloadUrl) => { try { ws.send(JSON.stringify({ type: "transfer:finished", id, fileName, size, downloadUrl })); } catch {} },
        getSession: () => ws.data.session as unknown as ReturnType<TransferManager["getByToken"]> extends never ? never : unknown as never,
      });
      // Link session getter after creation
      (tm as unknown as { setSessionGetter: (fn: () => unknown) => void }).setSessionGetter(() => ws.data.session as unknown as never);
      ws.data.transfers = tm;
      setTimeout(() => {
        for (const t of tm.list()) { try { ws.send(JSON.stringify({ type: "transfer:update", transfer: t })); } catch {} }
      }, 50);
      // Subscribe this socket to live diagnostics logs (all logged-in users OK — ws is already the auth boundary)
      const unsub = diagSubscribe((entry) => {
        try { ws.send(JSON.stringify({ type: "diagnostics:log", entry })); } catch {}
      });
      (ws.data as unknown as { logUnsub?: () => void }).logUnsub = unsub;
      // Send initial tail (500)
      try {
        const tail = diagTail(500, "debug");
        ws.send(JSON.stringify({ type: "diagnostics:init", entries: tail }));
      } catch {}
      // Send initial diagnostics health
      try {
        ws.send(JSON.stringify({ type: "diagnostics:health", health: { ts: new Date().toISOString(), uptime: process.uptime(), port: PORT, listenPort: LISTEN_PORT, dataDir: DATA_DIR, tokenAuth: !!BRIDGE_TOKEN } }));
      } catch {}
    },
    message(ws, raw) {
      let parsed: unknown;
      try { parsed = JSON.parse(String(raw)); } catch { ws.send(errorMessage("Invalid JSON payload.")); return; }
      const data = parsed as { type?: string };

      if (data.type === "login") {
        const result = LoginMessageSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid login message.")); return; }
        const { username, password, host, port } = result.data;
        logger.info("auth", "login attempt", { username, host: host || "server.slsknet.org", port: port || 2242 });
        // Close previous session if any
        ws.data.session?.close();
        const session = new SoulseekSession({
          username, password, host, port, listenPort: LISTEN_PORT, profile: defaultProfile(username), dataDir: DATA_DIR,
          onUserEvent: (event) => {
            logger.debug("server", "user event", { type: event.type, username: event.username });
            try { ws.send(JSON.stringify({ type: "userinfo:event", event })); } catch {}
          },
          onChatEvent: (event) => {
            logger.debug("chat", "chat event", { type: event.type, room: event.room, username: event.username });
            try { ws.send(JSON.stringify({ type: "chat:event", event })); } catch {}
          },
          onRoomEvent: (event) => {
            logger.debug("chat", "room event", { type: event.type, room: event.room });
            try { ws.send(JSON.stringify({ type: "room:event", event })); } catch {}
          },
          onTransferEvent: (event) => {
            logger.debug("transfer", "transfer event", { type: event.type, username: event.username, file: event.file?.slice(0,80), token: event.token });
            try { ws.send(JSON.stringify({ type: "peer:transfer", event })); } catch {}
            // Delegate to TransferManager for queue / transfer-request handling
            const tm = ws.data.transfers;
            if (!tm) return;
            try {
              if (event.type === "place-in-queue" && event.file && event.place !== undefined) {
                (tm as unknown as { handlePlaceInQueueResponse: (f: string, p: number) => void }).handlePlaceInQueueResponse(event.file, event.place);
              } else if (event.type === "transfer-request" && event.file && event.token !== undefined) {
                // direction 1 = upload (peer wants to send to us)
                (tm as unknown as { handleTransferRequest: (d: number, t: number, f: string) => void }).handleTransferRequest(1, event.token, event.file);
              } else if (event.type === "transfer-response" && event.reason) {
                // treat as denied
                const f = event.file || "";
                (tm as unknown as { handleUploadDenied: (f: string, r: string) => void }).handleUploadDenied(f, event.reason);
              } else if (event.type === "queue-upload" && event.file && event.username) {
                (tm as unknown as { handleQueueUpload: (u: string, f: string) => void }).handleQueueUpload(event.username, event.file);
              } else if (event.type === "upload-denied" && event.file) {
                (tm as unknown as { handleUploadDenied: (f: string, r: string) => void }).handleUploadDenied(event.file, event.reason || "Cancelled");
              } else if (event.type === "upload-failed" && event.file) {
                (tm as unknown as { handleUploadFailed: (f: string) => void }).handleUploadFailed(event.file);
              }
            } catch {}
          },
          onServerEvent: (event) => {
            logger.info("server", "server reconnect", event as unknown as Record<string, unknown>);
            try { ws.send(JSON.stringify({ type: "server:reconnect", ...event })); } catch {}
          },
        });
        ws.data.session = session;
        // Ensure TransferManager can call back into session
        try { ws.data.transfers?.setSessionGetter(() => session as unknown as never); } catch {}
        ws.send(JSON.stringify({ type: "login:start" }));
        session.login()
          .then((outcome) => {
            logger.info("auth", "login success", { username, ip: (outcome as unknown as { ipAddress?: string }).ipAddress });
            ws.send(JSON.stringify({ type: "login:result", ok: true, data: outcome }));
          })
          .catch((err: Error) => {
            logger.warn("auth", "login failed", { username, error: err.message });
            ws.send(JSON.stringify({ type: "login:result", ok: false, error: err.message }));
          });
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
        logger.info("search", "search request", { searchId, query: query.slice(0,80) });
        const token = session.search(query, searchId, {
          onResult: (p) => {
            logger.debug("search", "search result", { searchId, rows: p.rows?.length });
            ws.send(JSON.stringify({ type: "search:result", ...p }));
          },
          onEnd: (p) => {
            logger.info("search", "search end", { searchId, reason: p.reason });
            ws.send(JSON.stringify({ type: "search:end", ...p }));
          },
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
        logger.info("transfer", "download request", { username: result.data.username, path: result.data.virtualPath.slice(0,80), size: result.data.size });
        session.queueUpload(result.data.username, result.data.virtualPath);
        ws.data.transfers?.requestDownload(result.data.username, result.data.virtualPath, result.data.size, result.data.fileName);
        return;
      }
      if (data.type === "download:control") {
        const result = DownloadControlSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid download control.")); return; }
        logger.info("transfer", "download control", { id: result.data.id, action: result.data.action });
        ws.data.transfers?.controlDownload(result.data.id, result.data.action);
        return;
      }
      if (data.type === "upload:control") {
        const result = UploadControlSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid upload control.")); return; }
        logger.info("transfer", "upload control", { id: result.data.id, action: result.data.action });
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
        logger.info("peer", "peer connect requested", { username, connType });
        session.connectPeer(username, connType)
          .then(() => {
            logger.info("peer", "peer connect ok", { username, connType });
            ws.send(JSON.stringify({ type: "peer:connect", ok: true, username, connType }));
          })
          .catch((e: Error) => {
            logger.warn("peer", "peer connect failed", { username, connType, error: e.message });
            ws.send(JSON.stringify({ type: "peer:connect", ok: false, username, error: e.message }));
          });
        return;
      }

      if (data.type === "diagnostics:clear") {
        logger.info("system", "diagnostics clear requested");
        diagClear();
        ws.send(JSON.stringify({ type: "diagnostics:cleared" }));
        return;
      }
      if (data.type === "diagnostics:subscribe") {
        const { level } = parsed as { level?: LogLevel };
        logger.info("system", "diagnostics subscribe", { level: level || "debug" });
        try {
          const tail = diagTail(500, (level as LogLevel) || "debug");
          ws.send(JSON.stringify({ type: "diagnostics:init", entries: tail }));
        } catch {}
        return;
      }
      if (data.type === "diagnostics:browser-log") {
        const { level, scope, msg, meta } = parsed as { level?: string; scope?: string; msg?: string; meta?: Record<string, unknown> };
        if (msg) diagLog((level as LogLevel) || "info", (scope as never) || "system", `[browser] ${msg}`, meta);
        return;
      }

      if (data.type === "userinfo") {
        const result = UserInfoRequestSchema.safeParse(parsed);
        if (!result.success) { ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid userinfo message.")); return; }
        const session = requireLogin(); if (!session) return;
        const msg = result.data;
        logger.debug("server", "userinfo request", { action: msg.action });
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

      logger.debug("bridge", "unknown message type", { type: data.type });
      ws.send(errorMessage("Unknown message type."));
    },
    close(ws) {
      try { (ws.data as unknown as { logUnsub?: () => void }).logUnsub?.(); } catch {}
      logger.info("bridge", "ws close");
      ws.data.session?.close();
      ws.data.transfers?.close();
      ws.data = {};
    },
  },
});

if (import.meta.main) {
  diagLog("info", "bridge", `bridge listening on ws://localhost:${PORT}/ws ${BRIDGE_TOKEN ? "(token auth enabled)" : "(open)"} DATA_DIR=${DATA_DIR}`, { port: PORT, listenPort: LISTEN_PORT });
  console.log(`Nicotine Mobile bridge listening on ws://localhost:${PORT}/ws ${BRIDGE_TOKEN ? "(token auth enabled)" : "(open)"} DATA_DIR=${DATA_DIR}`);
}
