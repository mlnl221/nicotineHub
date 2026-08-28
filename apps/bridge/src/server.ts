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
 * Once logged in the same socket is reused for searches:
 *
 *   client -> server:  { type: "search", query }
 *   server -> client:  { type: "search:start", token }
 *                       { type: "search:result", token, username, freeUploadSlots, uploadSpeed, inQueue, results }
 *                       { type: "search:done", token }
 */
import { z } from "zod";
import { SoulseekSession } from "./session.ts";

const LoginMessageSchema = z.object({
  type: z.literal("login"),
  username: z.string().min(1, "Username is required.").max(64),
  password: z.string().min(1, "Password is required."),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

const SearchMessageSchema = z.object({
  type: z.literal("search"),
  query: z.string().min(1, "Search query is required.").max(255),
});

const LISTEN_PORT = Number(process.env.LISTEN_PORT || 2234);
const PORT = Number(process.env.PORT || 8787);

function errorMessage(error: string): string {
  return JSON.stringify({ type: "error", error });
}

export const server = Bun.serve<{ session?: SoulseekSession }>({
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

        const { query } = result.data;
        const token = session.search(query, {
          onResult: (resp) =>
            ws.send(JSON.stringify({ type: "search:result", ...resp })),
          onDone: () => ws.send(JSON.stringify({ type: "search:done", token })),
        });

        ws.send(JSON.stringify({ type: "search:start", token }));
        return;
      }

      ws.send(errorMessage("Unknown message type."));
    },
    close(ws) {
      ws.data.session?.close();
      ws.data = {};
    },
  },
});

if (import.meta.main) {
  console.log(`Nicotine Mobile bridge listening on ws://localhost:${PORT}/ws`);
}
