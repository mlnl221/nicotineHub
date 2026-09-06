import { NextRequest } from "next/server";
import { proxyToService } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

// Same-origin proxy for the bridge HTTP surface (/health, /api/files/raw,
// /files/:token downloads, /logs, /diagnostics, /interfaces, /upnp/*, …).
// The browser hits /api/bridge/* on the web origin; we forward to the
// bridge over the compose network (or localhost in bare dev) and stream
// the response back unbuffered — Range/206 included for audio seeking.
const PREFIX = "/api/bridge";

function target(): string {
  return (
    process.env.BRIDGE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BRIDGE_URL?.replace(/^ws/, "http").replace(/\/ws.*$/, "") ||
    "http://localhost:8787"
  );
}

function serverToken(): string {
  return process.env.BRIDGE_TOKEN || process.env.NEXT_PUBLIC_BRIDGE_TOKEN || "";
}

export async function GET(req: NextRequest) {
  return proxyToService(req, { targetBase: target(), prefix: PREFIX, serverToken: serverToken() });
}

export async function POST(req: NextRequest) {
  return proxyToService(req, { targetBase: target(), prefix: PREFIX, serverToken: serverToken() });
}

export async function HEAD(req: NextRequest) {
  return proxyToService(req, { targetBase: target(), prefix: PREFIX, serverToken: serverToken() });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, range",
    },
  });
}
