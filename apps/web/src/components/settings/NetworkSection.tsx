"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/lib/config/provider";
import { defaults, DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, DEFAULT_LISTEN_PORT } from "@/lib/config/defaults";
import { SectionCard, TextFieldControl, ToggleControl, NumberControl } from "@/components/settings/controls";
import { useSession } from "@/lib/session";

function useBridgeListenPort(): { current: number | null; bridgeUrl: string } {
  const [current, setCurrent] = useState<number | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState<string>("");
  useEffect(() => {
    const ls = typeof window !== "undefined" ? window.localStorage.getItem("nicotine.bridgeUrl") : null;
    const url = ls || process.env.NEXT_PUBLIC_BRIDGE_URL || "";
    if (url) {
      try {
        const u = new URL(url.replace(/^ws/, "http"));
        setBridgeUrl(`${u.protocol}//${u.host}`);
      } catch { setBridgeUrl(""); }
    } else if (typeof window !== "undefined") {
      const scheme = window.location.protocol === "https:" ? "https:" : "http:";
      setBridgeUrl(`${scheme}//${window.location.hostname}:8787`);
    }
    const fetchPort = async () => {
      const base = ls
        ? (() => { try { return new URL(ls.replace(/^ws/, "http")).origin; } catch { return ""; } })()
        : typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname}:8787`
          : "";
      if (!base) return;
      try {
        const r = await fetch(`${base}/health?json=1`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json() as { listenPort?: number };
        if (typeof j.listenPort === "number") setCurrent(j.listenPort);
      } catch {}
    };
    fetchPort();
    const id = setInterval(fetchPort, 15000);
    return () => clearInterval(id);
  }, []);
  return { current, bridgeUrl };
}

export function NetworkSection() {
  const { settings, setOption } = useConfig();
  const server = settings.server;
  const { state } = useSession();
  const { current: bridgePort } = useBridgeListenPort();
  // Normalize portrange: nicotine-plus stores [port, port]; UI edits first element
  const listenPort = Array.isArray(server.portrange) ? server.portrange[0] : (server as unknown as { portrange?: number }).portrange ?? DEFAULT_LISTEN_PORT;
  const isConnected = state.status === "connected";

  return (
    <SectionCard
      title="Connection"
      description="Soulseek server the bridge connects to. Credentials are never stored in the browser."
    >
      <ToggleControl
        label="Connect on startup"
        description="Auto-connect when the app opens."
        checked={server.auto_connect_startup}
        onChange={(v) => setOption("server", "auto_connect_startup", v)}
      />
      <TextFieldControl
        label="Server host"
        description="Hostname of the Soulseek server."
        value={server.server.host}
        inputMode="url"
        onChange={(v) => setOption("server", "server", { ...server.server, host: v || DEFAULT_SERVER_HOST })}
        onReset={() => setOption("server", "server", { ...server.server, host: DEFAULT_SERVER_HOST })}
      />
      <NumberControl
        label="Server port"
        description="TCP port of the Soulseek server."
        value={server.server.port}
        min={1}
        max={65535}
        onChange={(v) => setOption("server", "server", { ...server.server, port: v || DEFAULT_SERVER_PORT })}
        onReset={() => setOption("server", "server", { ...server.server, port: DEFAULT_SERVER_PORT })}
      />
      <NumberControl
        label="Listening port"
        description={
          bridgePort && bridgePort !== listenPort
            ? `Inbound peer port. Bridge is currently on ${bridgePort} — change applies after reconnect (port-forward TCP+UDP ${listenPort}).`
            : `Inbound peer port for direct searches & transfers. Requires port-forward of TCP+UDP ${listenPort} on your router. Changing triggers reconnect (like nicotine-plus).`
        }
        value={listenPort}
        min={1024}
        max={65535}
        step={1}
        onChange={(v) => {
          const p = Math.max(1024, Math.min(65535, Number(v) || DEFAULT_LISTEN_PORT));
          setOption("server", "portrange", [p, p] as unknown as never);
        }}
        onReset={() => setOption("server", "portrange", [DEFAULT_LISTEN_PORT, DEFAULT_LISTEN_PORT] as unknown as never)}
      />
      {bridgePort ? (
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
          Bridge reports <span className="font-mono font-medium text-on-surface">{bridgePort}</span> via <span className="font-mono">/health?json</span>. If you change the listening port, the bridge will reconnect (like nicotine-plus <span className="font-mono">portrange</span>) and re-advertise via <span className="font-mono">SetWaitPort</span>. Ensure your router forwards <span className="font-mono">TCP+UDP {listenPort}</span> and Docker maps <span className="font-mono">{listenPort}:{listenPort}</span>.
          {!isConnected ? <span className="block pt-1 text-amber-700 dark:text-amber-300">Not connected — change will apply on next login.</span> : null}
        </div>
      ) : null}
      <NumberControl
        label="Idle minutes before away"
        description={`Automatically mark you away after ${defaults.server.autoaway} minutes of inactivity.`}
        value={server.autoaway}
        min={1}
        max={10000}
        step={5}
        onChange={(v) => setOption("server", "autoaway", v)}
        onReset={() => setOption("server", "autoaway", defaults.server.autoaway)}
      />
    </SectionCard>
  );
}
