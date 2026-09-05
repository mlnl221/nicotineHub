import { NextRequest, NextResponse } from "next/server";

/**
 * Shared reverse-proxy helper for same-origin API routes.
 *
 * Lets the browser reach bridge/worker through the web origin
 * (`/api/bridge/*`, `/api/worker/*`) so neither service needs a
 * published host port — only web:3000 + LISTEN_PORT stay exposed.
 * Server-to-service hops use Docker DNS (`http://bridge:8787`,
 * `http://worker:8789`) or localhost in bare dev.
 *
 * Bodies and responses stream through unbuffered (downloads, /audio
 * with Range/206, spectrum PNGs). Auth: client's Authorization Bearer
 * is forwarded; server-side BRIDGE_TOKEN/WORKER_TOKEN env is fallback.
 */

// Request headers we forward (allowlist — no cookies, no host).
const FORWARD_REQ = new Set([
  "content-type",
  "content-length",
  "authorization",
  "range",
  "accept",
  "accept-language",
  "if-none-match",
  "if-modified-since",
  "if-range",
]);

// Response headers we pass back (drops hop-by-hop framing).
const FORWARD_RES = new Set([
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "content-disposition",
  "etag",
  "last-modified",
  "cache-control",
  "x-bridge-token-auth",
]);

export async function proxyToService(
  req: NextRequest,
  opts: { targetBase: string; prefix: string; serverToken?: string }
): Promise<Response> {
  const path = req.nextUrl.pathname.replace(opts.prefix, "") || "/";
  const url = `${opts.targetBase.replace(/\/$/, "")}${path}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (FORWARD_REQ.has(k.toLowerCase())) headers.set(k, v);
  }
  if (!headers.get("authorization") && opts.serverToken) {
    headers.set("authorization", `Bearer ${opts.serverToken}`);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
    // Propagate client aborts: without this, a cancelled browser request
    // (or a load-generator client timeout) leaves the server-side fetch
    // running against bridge/worker indefinitely, piling up backlog under
    // load. No total timeout here — legit /files/:token downloads stream
    // for minutes; cancellation is the bound.
    signal: req.signal,
  };
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    init.body = req.body;
    (init as Record<string, unknown>).duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (e) {
    return NextResponse.json(
      { error: `service unreachable (${(e as Error).message || "fetch failed"})` },
      { status: 502 }
    );
  }

  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (FORWARD_RES.has(k.toLowerCase())) resHeaders.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
