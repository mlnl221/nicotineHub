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
    const ls = typeof window !== "undefined" ? (window.localStorage.getItem("nicotineHub.bridgeUrl") ?? window.localStorage.getItem("nicotine.bridgeUrl")) : null;
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
  const { state, send } = useSession();
  const { current: bridgePort } = useBridgeListenPort();
  // Normalize portrange: nicotine-plus stores [port, port]; UI edits first element
  const listenPort = Array.isArray(server.portrange) ? server.portrange[0] : (server as unknown as { portrange?: number }).portrange ?? DEFAULT_LISTEN_PORT;
  const isConnected = state.status === "connected";

  return (
    <>
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
          hideSlider
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
          hideSlider
          onChange={(v) => {
            const p = Math.max(1024, Math.min(65535, Number(v) || DEFAULT_LISTEN_PORT));
            setOption("server", "portrange", [p, p] as unknown as never);
            // Explicitly push to bridge (ConfigBridgeSync no longer bulk-syncs portrange to avoid flip-flop)
            try { send({ type: "config:update", section: "server", key: "portrange", value: [p, p] } as unknown as never); } catch {}
          }}
          onReset={() => {
            setOption("server", "portrange", [DEFAULT_LISTEN_PORT, DEFAULT_LISTEN_PORT] as unknown as never);
            try { send({ type: "config:update", section: "server", key: "portrange", value: [DEFAULT_LISTEN_PORT, DEFAULT_LISTEN_PORT] } as unknown as never); } catch {}
          }}
        />
        {bridgePort ? (
          <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
            Bridge reports <span className="font-mono font-medium text-on-surface">{bridgePort}</span> via <span className="font-mono">/health?json</span>. If you change the listening port, the bridge will reconnect (like nicotine-plus <span className="font-mono">portrange</span>) and re-advertise via <span className="font-mono">SetWaitPort</span>. Ensure your router forwards <span className="font-mono">TCP+UDP {listenPort}</span> and Docker maps <span className="font-mono">{listenPort}:{listenPort}</span>.
            {!isConnected ? <span className="block pt-1 text-amber-700 dark:text-amber-300">Not connected — change will apply on next login.</span> : null}
          </div>
        ) : null}
        <ToggleControl
          label="UPnP port mapping"
          description="Automatically forward the listening port via UPnP/NAT-PMP (like nicotine-plus). Falls back from NAT-PMP to UPnP; renews every 2 h. Disable if your router doesn't support it or you forward manually."
          checked={server.upnp ?? true}
          onChange={(v) => setOption("server", "upnp", v)}
        />
        <TextFieldControl
          label="Network interface"
          description="Local interface to bind (browser-stored only; bridge uses env INTERFACE if set, like nicotine-plus server.interface)."
          value={server.interface ?? ""}
          placeholder="e.g. 192.168.1.10 or eth0 — empty = default"
          onChange={(v) => setOption("server", "interface", v)}
          onReset={() => setOption("server", "interface", "")}
        />
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

      <SectionCard
        title="Auto-join & watched users"
        description="Rooms to auto-join after login and users to watch (like nicotine-plus server.autojoin / server.userlist). One per line."
      >
        <TextFieldControl
          label="Auto-join rooms (autojoin)"
          description="Rooms to join automatically after login (nicotine-plus autojoin)."
          value={(server.autojoin ?? []).join("\n")}
          multiline
          placeholder="e.g. nicotine&#10;music"
          onChange={(v) => setOption("server", "autojoin", v.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
        <TextFieldControl
          label="Watched users (userlist)"
          description="Users to watch/status-poll after login (nicotine-plus userlist / buddies precursor)."
          value={(server.userlist ?? []).join("\n")}
          multiline
          placeholder="e.g. alice&#10;bob"
          onChange={(v) => setOption("server", "userlist", v.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
        <TextFieldControl
          label="Auto-search (autosearch)"
          description="Searches to run automatically after login (nicotine-plus autosearch)."
          value={(server.autosearch ?? []).join("\n")}
          multiline
          placeholder="e.g. pink floyd flac&#10;jazz 192"
          onChange={(v) => setOption("server", "autosearch", v.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
      </SectionCard>

      <SectionCard
        title="Auto-reply"
        description="Away reply sent when you are marked away (nicotine-plus server.autoreply + autoaway → SetStatus 28). Leave empty to disable."
      >
        <TextFieldControl
          label="Auto-reply message"
          description="Sent to anyone who messages you while you are away (if away status is set)."
          value={server.autoreply ?? ""}
          multiline
          placeholder="e.g. I am away, will reply later."
          onChange={(v) => setOption("server", "autoreply", v)}
          onReset={() => setOption("server", "autoreply", "")}
        />
      </SectionCard>
    </>
  );
}
