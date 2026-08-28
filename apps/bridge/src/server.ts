/**
 * WebSocket bridge server.
 *
 * Exposes a single endpoint at /ws that accepts login requests and speaks
 * the Soulseek protocol on the server's behalf (the browser cannot open raw
 * TCP sockets). Protocol (JSON over WS):
 *
 *   client -> server:  { type: "login", username, password, host?, port? }
 *   server -> client:  { type: "login:result", ok, error?, data? }
 */
import { z } from "zod";
import { loginToServer } from "./login.ts";
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from "./soulseek.ts";

const LoginMessageSchema = z.object({
  type: z.literal("login"),
  username: z.string().min(1, "Username is required.").max(64),
  password: z.string().min(1, "Password is required."),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

const PORT = Number(process.env.PORT || 8787);

export const server = Bun.serve<{ username?: string }>({
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
        ws.send(JSON.stringify({ type: "error", error: "Invalid JSON payload." }));
        return;
      }

      const result = LoginMessageSchema.safeParse(parsed);
      if (!result.success) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: result.error.issues[0]?.message ?? "Invalid login message.",
          }),
        );
        return;
      }

      const { username, password, host, port } = result.data;

      const controller = new AbortController();
      ws.data.username = username;

      // Close the in-flight request if the client disconnects.
      ws.send(JSON.stringify({ type: "login:start" }));

      loginToServer(
        { username, password, host, port },
        controller.signal,
      ).then((outcome) => {
        if (outcome.ok) {
          ws.send(
            JSON.stringify({
              type: "login:result",
              ok: true,
              data: outcome.data,
            }),
          );
        } else {
          ws.send(JSON.stringify({ type: "login:result", ok: false, error: outcome.error }));
        }
      });
    },
    close(ws) {
      // Any in-flight login aborts when the socket closes.
      ws.data = {};
    },
  },
});

if (import.meta.main) {
  console.log(`Nicotine Mobile bridge listening on ws://localhost:${PORT}/ws`);
}
