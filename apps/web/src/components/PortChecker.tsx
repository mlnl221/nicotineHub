"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";

type HealthJson = {
  listenPort?: number;
  upnp?: { enabled: boolean; active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null };
};
type PortCheckJson = { port: number; open: boolean | null; error?: string; upnp?: HealthJson["upnp"] };

function getBridgeHttpBase(): string {
  const envUrl = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_BRIDGE_URL : undefined;
  const bridgeUrl = typeof window !== "undefined" ? (localStorage.getItem("nicotineHub.bridgeUrl") ?? localStorage.getItem("nicotine.bridgeUrl")) || envUrl || `ws://${window.location.hostname}:${window.location.port === "3001" ? "8789" : window.location.port === "3002" ? "8790" : "8787"}/ws` : "ws://localhost:8787/ws";
  return bridgeUrl.replace(/^ws/, "http").replace(/\/ws.*$/, "");
}

export function PortChecker() {
  const { state } = useSession();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [health, setHealth] = useState<HealthJson | null>(null);

  const fetchHealth = async (): Promise<HealthJson | null> => {
    try {
      const httpBase = getBridgeHttpBase();
      const res = await fetch(`${httpBase}/health?json=1`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as HealthJson;
      if (res.ok) setHealth(j);
      return res.ok ? j : null;
    } catch { return null; }
  };

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 15000);
    return () => clearInterval(id);
  }, []);

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const httpBase = getBridgeHttpBase();
      const [hRes, upnpRes, pcRes] = await Promise.all([
        fetch(`${httpBase}/health?json=1`, { cache: "no-store" }),
        fetch(`${httpBase}/api/upnp/status`, { cache: "no-store" }).catch(() => null),
        // external port check via slsknet.org (like nicotine-plus portchecker.py)
        fetch(`${httpBase}/api/portchecker`, { cache: "no-store" }).catch(() => null),
      ]);
      const j = (await hRes.json().catch(() => ({}))) as HealthJson;
      const upnp = upnpRes ? ((await upnpRes.json().catch(() => ({}))) as HealthJson["upnp"]) : j.upnp;
      if (!hRes.ok) {
        setResult({ ok: false, msg: `Health check failed: ${hRes.status}` });
        return;
      }
      const port = j.listenPort ?? 60754;
      const upnpInfo = upnp ?? j.upnp;
      let upnpMsg = "";
      if (upnpInfo) {
        if (!upnpInfo.enabled) upnpMsg = " UPnP disabled (manual forward required).";
        else if (upnpInfo.active) upnpMsg = ` UPnP via ${upnpInfo.active} mapped ${upnpInfo.port} → ${upnpInfo.ip}:${upnpInfo.port} ✓`;
        else if (upnpInfo.error) upnpMsg = ` UPnP attempted but failed: ${upnpInfo.error} — ensure router supports UPnP/NAT-PMP or forward manually. Host network required inside Docker (else container 172.x). Use compose.gluetun.yaml if on Gluetun.`;
        else upnpMsg = " UPnP enabled — waiting for mapping (or router not found).";
      }
      let extMsg = "";
      if (pcRes) {
        const pc = (await pcRes.json().catch(() => ({}))) as PortCheckJson;
        if (pc.open === true) extMsg = ` External check: ${port}/tcp open ✓ (slsknet.org)`;
        else if (pc.open === false) extMsg = ` External check: ${port}/tcp closed — forward ${port} on router/VPN or enable UPnP (slsknet.org).`;
        else if (pc.error) extMsg = ` External check error: ${pc.error}`;
      }
      setHealth(j);
      setResult({ ok: true, msg: `Bridge reachable at ${httpBase} — listen port ${port}.${upnpMsg}${extMsg} Ensure ${port} is reachable (TCP) for incoming searches.` });
    } catch (e) {
      setResult({ ok: false, msg: `Cannot reach bridge. Check NEXT_PUBLIC_BRIDGE_URL / localStorage.nicotineHub.bridgeUrl. ${(e as Error).message}` });
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
      <button
        onClick={check}
        disabled={checking}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
      >
        {checking ? "Checking…" : "Check bridge & port"}
      </button>
      {result && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${result.ok ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-error-container text-on-error-container"}`}>
          {result.msg}
        </div>
      )}
    </div>
  );
}
