import { NextResponse } from "next/server";
import { networkInterfaces } from "node:os";

export const dynamic = "force-dynamic";

function listLocal(): Array<{ name: string; address: string; netmask: string; family: string; internal: boolean; mac: string; cidr: string | null }> {
  const raw = networkInterfaces();
  return Object.entries(raw).flatMap(([name, addrs]) =>
    (addrs ?? [])
      .filter((a) => a.family === "IPv4")
      .map((a) => ({
        name,
        address: a.address,
        netmask: a.netmask,
        family: a.family,
        internal: a.internal,
        mac: a.mac,
        cidr: (a as unknown as { cidr?: string }).cidr ?? null,
      }))
  );
}

export async function GET() {
  // Try bridge first (canonical – bridge's interfaces are what Soulseek binds to, especially with host network + VPN tun0)
  const candidates: string[] = [];
  // In Docker, web can reach bridge via http://bridge:8787; in dev via localhost:8787
  const bridgeBase =
    process.env.BRIDGE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BRIDGE_URL?.replace(/^ws/, "http").replace(/\/ws.*$/, "") ||
    "http://localhost:8787";
  const token = process.env.BRIDGE_TOKEN || process.env.NEXT_PUBLIC_BRIDGE_TOKEN || "";
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Also try localStorage bridgeUrl? Server side can't read localStorage – client will fallback via direct fetch to bridge from browser if proxy fails
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const r = await fetch(`${bridgeBase.replace(/\/$/, "")}/interfaces`, { headers, cache: "no-store", signal: controller.signal });
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j) && j.length > 0) return NextResponse.json(j);
    }
  } catch {}
  // Fallback: web's own host interfaces (dev without Docker)
  try {
    const local = listLocal();
    return NextResponse.json(local);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
