import { NextRequest } from "next/server";
import { proxyToService } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

// Same-origin bridge health probe: /api/health?json → bridge /health?json.
// Prefix "/api" maps the pathname through unchanged (/api/health → /health),
// reusing the bridge target/auth/streaming logic of /api/bridge/[...path].
const PREFIX = "/api";

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

export async function HEAD(req: NextRequest) {
  return proxyToService(req, { targetBase: target(), prefix: PREFIX, serverToken: serverToken() });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}
