"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { isDemo } from "@/lib/demo";

type HealthJson = {
  listenPort?: number;
  upnp?: { enabled: boolean; active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null };
};
type PortCheckJson = { port: number; open: boolean | null; error?: string; upnp?: HealthJson["upnp"] };

function getBridgeToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = localStorage.getItem("nicotineHub.bridgeToken") ?? localStorage.getItem("nicotine.bridgeToken");
    if (ls) return ls;
  } catch {}
  return (process.env.NEXT_PUBLIC_BRIDGE_TOKEN as string | undefined) || null;
}

function getBridgeCandidates(): Array<{ httpBase: string; token: string | null }> {
  const out: Array<{ httpBase: string; token: string | null }> = [];
  const seen = new Set<string>();
  const add = (wsUrl: string | null | undefined) => {
    if (!wsUrl) return;
    try {
      const u = new URL(wsUrl);
      const token = u.searchParams.get("token") || getBridgeToken();
      const httpBase = `${u.protocol === "wss:" ? "https:" : "http:"}//${u.hostname}:${u.port || "8787"}`;
      const key = `${httpBase}|${token ?? ""}`;
      if (!seen.has(key)) { seen.add(key); out.push({ httpBase, token }); }
      // Docker/host fallback: if ws hostname is internal, also try window hostname
      if (typeof window !== "undefined" && ["bridge", "host.docker.internal", "0.0.0.0", "127.0.0.1"].includes(u.hostname) && u.hostname !== window.location.hostname) {
        const altBase = `${u.protocol === "wss:" ? "https:" : "http:"}//${window.location.hostname}:${u.port || "8787"}`;
        const altKey = `${altBase}|${token ?? ""}`;
        if (!seen.has(altKey)) { seen.add(altKey); out.push({ httpBase: altBase, token }); }
      }
    } catch {}
  };
  if (typeof window !== "undefined") {
    add(localStorage.getItem("nicotineHub.bridgeUrl") ?? localStorage.getItem("nicotine.bridgeUrl"));
    add((process.env.NEXT_PUBLIC_BRIDGE_URL as string | undefined) || null);
    const scheme = window.location.protocol === "https:" ? "https:" : "http:";
    const host = window.location.hostname || "localhost";
    // worktree / compose fallbacks (3000→8787, 3001→8789, 3002→8790) + 8788 for worktree main
    const ports = ["8787", "8788", "8789", "8790"];
    // Prefer port matching current web port
    const preferred = window.location.port === "3001" ? "8789" : window.location.port === "3002" ? "8790" : window.location.port === "3000" ? "8787" : null;
    const ordered = preferred ? [preferred, ...ports.filter((p) => p !== preferred)] : ports;
    for (const p of ordered) {
      const base = `${scheme}//${host}:${p}`;
      const token = getBridgeToken();
      const key = `${base}|${token ?? ""}`;
      if (!seen.has(key)) { seen.add(key); out.push({ httpBase: base, token }); }
    }
  } else {
    out.push({ httpBase: "http://localhost:8787", token: null });
  }
  return out;
}

function getBridgeHttpBase(): string {
  return getBridgeCandidates()[0]?.httpBase ?? "http://localhost:8787";
}

function withToken(url: string, token: string | null): string {
  if (!token) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("token")) u.searchParams.set("token", token);
    return u.toString();
  } catch { return url; }
}

async function fetchWithCandidates(path: string, candidates: Array<{ httpBase: string; token: string | null }>): Promise<{ res: Response | null; json: unknown | null; httpBase: string | null }> {
  let lastErr: unknown = null;
  for (const c of candidates) {
    const url = withToken(`${c.httpBase}${path}`, c.token);
    try {
      const headers: Record<string, string> = {};
      if (c.token) headers["authorization"] = `Bearer ${c.token}`;
      const res = await fetch(url, { cache: "no-store", headers });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return { res, json, httpBase: c.httpBase };
      // 401 with tokenAuth — try next candidate (maybe different token/host)
      if (res.status === 401) { lastErr = new Error(`401 Unauthorized for ${c.httpBase}`); continue; }
      return { res, json, httpBase: c.httpBase };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr ?? new Error("All bridge candidates failed");
}

export function PortChecker() {
  const { state } = useSession();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [health, setHealth] = useState<HealthJson | null>(null);

  const fetchHealth = async (): Promise<HealthJson | null> => {
    try {
      const candidates = getBridgeCandidates();
      const { res, json } = await fetchWithCandidates("/health?json=1", candidates);
      const j = (json ?? {}) as HealthJson;
      if (res && res.ok) setHealth(j);
      return res && res.ok ? j : null;
    } catch { return null; }
  };

  useEffect(() => {
    // Demo (Vercel): no bridge exists — never poll dead candidates
    if (isDemo) return;
    fetchHealth();
    const id = setInterval(fetchHealth, 15000);
    return () => clearInterval(id);
  }, []);

  const check = async () => {
    if (isDemo) return;
    setChecking(true);
    setResult(null);
    try {
      const candidates = getBridgeCandidates();
      // health with fallback across candidates
      let hRes: Response | null = null;
      let hJson: HealthJson | null = null;
      let httpBase: string | null = null;
      let lastErr: unknown = null;
      for (const c of candidates) {
        const url = withToken(`${c.httpBase}/health?json=1`, c.token);
        try {
          const headers: Record<string, string> = {};
          if (c.token) headers["authorization"] = `Bearer ${c.token}`;
          const res = await fetch(url, { cache: "no-store", headers });
          const j = (await res.json().catch(() => ({}))) as HealthJson;
          if (res.ok) { hRes = res; hJson = j; httpBase = c.httpBase; break; }
          if (res.status === 401) { lastErr = new Error(`401 for ${c.httpBase}`); continue; }
          hRes = res; hJson = j; httpBase = c.httpBase; break;
        } catch (e) { lastErr = e; continue; }
      }
      if (!hRes || !hJson) throw lastErr ?? new Error("No bridge candidate responded");
      // upnp / portchecker best-effort on same base (if health succeeded)
      let upnp: HealthJson["upnp"] | null = hJson.upnp ?? null;
      let pc: PortCheckJson | null = null;
      if (httpBase) {
        const token = candidates.find((c) => c.httpBase === httpBase)?.token ?? null;
        const hdr: Record<string, string> = {};
        if (token) hdr["authorization"] = `Bearer ${token}`;
        try {
          const uRes = await fetch(withToken(`${httpBase}/api/upnp/status`, token), { cache: "no-store", headers: hdr });
          if (uRes.ok) upnp = ((await uRes.json().catch(() => ({}))) as HealthJson["upnp"]) ?? upnp;
        } catch {}
        try {
          const pRes = await fetch(withToken(`${httpBase}/api/portchecker`, token), { cache: "no-store", headers: hdr });
          if (pRes.ok) pc = (await pRes.json().catch(() => ({}))) as PortCheckJson;
          else pc = (await pRes.json().catch(() => ({}))) as PortCheckJson;
        } catch {}
      }
      if (!hRes.ok) {
        setResult({ ok: false, msg: `Health check failed: ${hRes.status} at ${httpBase}` });
        return;
      }
      const j = hJson;
      const port = j.listenPort ?? 60754;
      const upnpInfo = upnp ?? j.upnp;
      let upnpMsg = "";
      if (upnpInfo) {
        if (!upnpInfo.enabled) upnpMsg = " UPnP disabled (manual forward required).";
        else if (upnpInfo.active) upnpMsg = ` UPnP via ${upnpInfo.active} mapped ${upnpInfo.port} → ${upnpInfo.ip}:${upnpInfo.port} ✓`;
        else if (upnpInfo.error) upnpMsg = ` UPnP attempted but failed: ${upnpInfo.error} — ensure router supports UPnP/NAT-PMP or forward manually. Host network required inside Docker (else container 172.x).`;
        else upnpMsg = " UPnP enabled — waiting for mapping (or router not found).";
      }
      let extMsg = "";
      if (pc) {
        if (pc.open === true) extMsg = ` External check: ${port}/tcp open ✓ (slsknet.org)`;
        else if (pc.open === false) extMsg = ` External check: ${port}/tcp closed — forward ${port} on router/VPN or enable UPnP (slsknet.org).`;
        else if (pc.error) extMsg = ` External check error: ${pc.error}`;
      }
      setHealth(j);
      setResult({ ok: true, msg: `Bridge reachable at ${httpBase} — listen port ${port}.${upnpMsg}${extMsg} Ensure ${port} is reachable (TCP) for incoming searches.` });
    } catch (e) {
      const candidates = getBridgeCandidates().map((c) => c.httpBase).join(", ");
      setResult({ ok: false, msg: `Cannot reach bridge. Tried ${candidates}. Check NEXT_PUBLIC_BRIDGE_URL / localStorage.nicotineHub.bridgeUrl and BRIDGE_TOKEN. ${(e as Error).message}` });
    } finally {
      setChecking(false);
    }
  };

  const upnp = health?.upnp;

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-label text-sm font-semibold">Port Checker</h3>
        <span className={`h-2 w-2 rounded-full ${state.status === "connected" ? "bg-green-500" : "bg-outline"}`} title={state.status} />
      </div>
      <p className="mb-3 text-xs text-on-surface-variant">
        Search results require a reachable inbound peer listener. Default <code>LISTEN_PORT 60754</code> (configurable) must be port-forwarded (TCP, see README) — edit in Settings → Network. UPnP/NAT-PMP auto-forwards when enabled (toggle in Network, renews every 2 h). Currently <code>{health?.listenPort ?? 60754}</code>.
      </p>
      {health && (
        <div className="mb-3 rounded-xl bg-surface-container-high px-3 py-2 text-xs dark:bg-surface-container-highest/40">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span>Bridge <span className="font-mono font-medium">{health.listenPort ?? "—"}</span></span>
            {upnp ? (
              <>
                <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${!upnp.enabled ? "bg-surface-variant text-on-surface-variant" : upnp.active ? "bg-green-500/20 text-green-700 dark:text-green-300" : upnp.error ? "bg-error-container text-on-error-container" : "bg-amber-500/20 text-amber-700 dark:text-amber-300"}`}>
                  {!upnp.enabled ? "UPnP off" : upnp.active ? `${upnp.active} ✓` : upnp.error ? "UPnP failed" : "UPnP pending"}
                </span>
                {upnp.active ? <span className="font-mono text-[11px]">{upnp.active} {upnp.ip}:{upnp.port}</span> : null}
                {upnp.error ? <span className="max-w-full truncate text-error" title={upnp.error}>{upnp.error.slice(0, 80)}</span> : null}
              </>
            ) : null}
          </div>
        </div>
      )}
      {isDemo ? (
        <p className="rounded-xl bg-surface-container-high px-3 py-2 text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
          Bridge check unavailable in demo (offline — no bridge).
        </p>
      ) : (
        <button
          onClick={check}
          disabled={checking}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check bridge & port"}
        </button>
      )}
      {result && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${result.ok ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-error-container text-on-error-container"}`}>
          {result.msg}
        </div>
      )}
    </div>
  );
}
