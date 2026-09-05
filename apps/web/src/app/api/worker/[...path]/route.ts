import { NextRequest } from "next/server";
import { proxyToService } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

// Same-origin proxy for the worker HTTP surface (/scrape, /spectrum/*,
// /tag/*, /verify, /analyze, /mediainfo, /rename, /audio, /health, …).
// The browser hits /api/worker/* on the web origin; we forward to the
// worker over the compose network (or localhost in bare dev). Spectrum
// PNGs and /audio streams pass through unbuffered with Range/206 intact.
const PREFIX = "/api/worker";

function target(): string {
  return process.env.WORKER_INTERNAL_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8789";
}

function serverToken(): string {
  return process.env.WORKER_TOKEN || process.env.NEXT_PUBLIC_WORKER_TOKEN || "";
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
