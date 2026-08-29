"use client";
import { useState } from "react";
import { useSession } from "@/lib/session";

export function PortChecker() {
  const { state } = useSession();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const bridgeUrl = typeof window !== "undefined" ? localStorage.getItem("nicotine.bridgeUrl") || `ws://${window.location.hostname}:8787/ws` : "ws://localhost:8787/ws";
      const httpBase = bridgeUrl.replace(/^ws/, "http").replace(/\/ws.*$/, "");
      const res = await fetch(`${httpBase}/health?json=1`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (res.ok) setResult({ ok: true, msg: `Bridge reachable at ${httpBase} — listen port ${j.listenPort ?? 2234}. Ensure ${j.listenPort ?? 2234} is port-forwarded for incoming searches.` });
      else setResult({ ok: false, msg: `Health check failed: ${res.status}` });
    } catch (e) {
      setResult({ ok: false, msg: `Cannot reach bridge. Check NEXT_PUBLIC_BRIDGE_URL / localStorage.nicotine.bridgeUrl. ${(e as Error).message}` });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-label text-sm font-semibold">Port Checker</h3>
        <span className={`h-2 w-2 rounded-full ${state.status === "connected" ? "bg-green-500" : "bg-outline"}`} />
      </div>
      <p className="mb-3 text-xs text-on-surface-variant">
        Search results require a reachable inbound peer listener. Default <code>LISTEN_PORT 2234</code> must be port-forwarded (see README).
      </p>
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
