/**
 * WebSocket bridge server.
 *
 * Exposes a single endpoint at /ws that accepts login requests and speaks
 * the Soulseek protocol on the server's behalf (the browser cannot open raw
 * TCP sockets). Protocol (JSON over WS):
 *
 *   client -> server:  { type: "login", username, password, host?, port? }
 *   server -> client:  { type: "login:result", ok, error?, data? }
 *
 * Once logged in, searches are issued over the same socket:
 *
 *   client -> server:  { type: "search", searchId, query }
 *   server -> client:  { type: "search:start", searchId, token }
 *                      { type: "search:result", searchId, token, rows: SearchRow[] }
 *                      { type: "search:end", searchId, reason }
 *   client -> server:  { type: "search:stop", searchId }
 */
import { z } from "zod";
import { SoulseekSession } from "./session.ts";
import { TransferManager } from "./transfers.ts";

const LoginMessageSchema = z.object({
  type: z.literal("login"),
  username: z.string().min(1, "Username is required.").max(64),
  password: z.string().min(1, "Password is required."),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

const SearchMessageSchema = z.object({
  type: z.literal("search"),
  searchId: z.string().min(1).max(64),
  query: z.string().min(1, "Search query is required.").max(255),
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

/** Default profile served when peers browse us (before the client overrides it). */
function defaultProfile(username: string) {
  return {
    username,
    descr: "",
    pic: null,
    totalupl: 0,
    queuesize: 0,
    slotsavail: true,
    uploadallowed: 1,
  };
}

const LISTEN_PORT = Number(process.env.LISTEN_PORT || 2234);
const PORT = Number(process.env.PORT || 8787);

function errorMessage(error: string): string {
  return JSON.stringify({ type: "error", error });
}

export const server = Bun.serve<{ session?: SoulseekSession; transfers?: TransferManager }>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // Simple health check for container orchestration.
    if (url.pathname === "/health" && req.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/ws") {
      const ok = server.upgrade(req, { data: {} });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.data = {};
      // Attach a per-connection transfer manager that pushes updates to this socket.
      const tm = new TransferManager({
        onUpdate: (transfer) => {
          try {
            ws.send(JSON.stringify({ type: "transfer:update", transfer }));
          } catch {}
        },
        onRemoved: (id) => {
          try {
            ws.send(JSON.stringify({ type: "transfer:removed", id }));
          } catch {}
        },
        onStats: (stats) => {
          try {
            ws.send(JSON.stringify({ type: "transfer:stats", ...stats }));
          } catch {}
        },
      });
      ws.data.transfers = tm;
      // Push initial demo uploads and stats on next tick so client can subscribe first.
      setTimeout(() => {
        for (const t of tm.list()) {
          try {
            ws.send(JSON.stringify({ type: "transfer:update", transfer: t }));
          } catch {}
        }
      }, 50);
    },
    message(ws, raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        ws.send(errorMessage("Invalid JSON payload."));
        return;
      }

      const data = parsed as { type?: string };

      if (data.type === "login") {
        const result = LoginMessageSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid login message."));
          return;
        }

        const { username, password, host, port } = result.data;
        const session = new SoulseekSession({
          username,
          password,
          host,
          port,
          listenPort: LISTEN_PORT,
          profile: defaultProfile(username),
          onUserEvent: (event) => {
            ws.send(JSON.stringify({ type: "userinfo:event", event }));
          },
        });
        ws.data.session = session;

        ws.send(JSON.stringify({ type: "login:start" }));

        session
          .login()
          .then((outcome) => {
            ws.send(JSON.stringify({ type: "login:result", ok: true, data: outcome }));
          })
          .catch((err: Error) => {
            ws.send(JSON.stringify({ type: "login:result", ok: false, error: err.message }));
          });
        return;
      }

      if (data.type === "search") {
        const result = SearchMessageSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid search message."));
          return;
        }

        const session = ws.data.session;
        if (!session) {
          ws.send(errorMessage("Not logged in."));
          return;
        }

        const { searchId, query } = result.data;
        const token = session.search(query, searchId, {
          onResult: (p) => ws.send(JSON.stringify({ type: "search:result", ...p })),
          onEnd: (p) => ws.send(JSON.stringify({ type: "search:end", ...p })),
        });
        ws.send(JSON.stringify({ type: "search:start", searchId, token }));
        return;
      }

      if (data.type === "search:stop") {
        const result = StopMessageSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid stop message."));
          return;
        }
        ws.data.session?.cancelSearch(result.data.searchId);
        return;
      }

      // Transfers
      if (data.type === "download:request") {
        const result = DownloadRequestSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid download request."));
          return;
        }
        ws.data.transfers?.requestDownload(result.data.username, result.data.virtualPath, result.data.size, result.data.fileName);
        return;
      }
      if (data.type === "download:control") {
        const result = DownloadControlSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid download control."));
          return;
        }
        ws.data.transfers?.controlDownload(result.data.id, result.data.action);
        return;
      }
      if (data.type === "upload:control") {
        const result = UploadControlSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid upload control."));
          return;
        }
        ws.data.transfers?.controlUpload(result.data.id, result.data.action);
        return;
      }

      if (data.type === "userinfo") {
        const result = UserInfoRequestSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(errorMessage(result.error.issues[0]?.message ?? "Invalid userinfo message."));
          return;
        }

        const session = ws.data.session;
        if (!session) {
          ws.send(errorMessage("Not logged in."));
          return;
        }

        const msg = result.data;
        switch (msg.action) {
          case "watch":
            session.watchUser(msg.username);
            break;
          case "unwatch":
            session.unwatchUser(msg.username);
            break;
          case "get":
            session
              .requestUserInfo(msg.username)
              .then((info) => {
                ws.send(
                  JSON.stringify({
                    type: "user-info-response",
                    username: info.username,
                    descr: info.descr,
                    pic: info.pic ? info.pic.toString("base64") : null,
                    totalupl: info.totalupl,
                    queuesize: info.queuesize,
                    slotsavail: info.slotsavail,
                    uploadallowed: info.uploadallowed,
                  }),
                );
              })
              .catch(() => {
                ws.send(JSON.stringify({ type: "user-info-failed", username: msg.username }));
              });
            break;
          case "interests":
            session.requestUserInterests(msg.username);
            break;
          case "recommendations":
            session.requestRecommendations();
            break;
          case "globalRecommendations":
            session.requestGlobalRecommendations();
            break;
          case "similarUsers":
            session.requestSimilarUsers();
            break;
          case "itemRecommendations":
            session.requestItemRecommendations(msg.item);
            break;
          case "itemSimilarUsers":
            session.requestItemSimilarUsers(msg.item);
            break;
          case "addLike":
            session.addThingILike(msg.thing);
            break;
          case "removeLike":
            session.removeThingILike(msg.thing);
            break;
          case "addHate":
            session.addThingIHate(msg.thing);
            break;
          case "removeHate":
            session.removeThingIHate(msg.thing);
            break;
          case "givePrivileges":
            session.givePrivileges(msg.username, msg.days);
            break;
          case "setStatus":
            session.setStatus(msg.status);
            break;
          case "setProfile":
            session.setProfile({
              username: session.username,
              descr: msg.profile.descr,
              pic: msg.profile.pic ? Buffer.from(msg.profile.pic, "base64") : null,
              totalupl: msg.profile.totalupl,
              queuesize: msg.profile.queuesize,
              slotsavail: msg.profile.slotsavail,
              uploadallowed: msg.profile.uploadallowed,
            });
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
  console.log(`Nicotine Mobile bridge listening on ws://localhost:${PORT}/ws`);
}
