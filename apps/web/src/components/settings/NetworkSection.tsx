"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/lib/config/provider";
import { defaults, DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, DEFAULT_LISTEN_PORT } from "@/lib/config/defaults";
import { SectionCard, TextFieldControl, ToggleControl, NumberControl, SelectControl } from "@/components/settings/controls";
import { useSession } from "@/lib/session";

type UpnpStatus = { enabled: boolean; active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null; hasPort: boolean } | null;
function useBridgeListenPort(): { current: number | null; bridgeUrl: string; setCurrent: (n: number | null) => void; upnp: UpnpStatus; setUpnp: (s: UpnpStatus) => void } {
  const [current, setCurrent] = useState<number | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState<string>("");
  const [upnp, setUpnp] = useState<UpnpStatus>(null);
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
        const j = await r.json() as { listenPort?: number; upnp?: UpnpStatus };
        if (typeof j.listenPort === "number") setCurrent(j.listenPort);
        if (j.upnp) setUpnp(j.upnp);
      } catch {}
    };
    fetchPort();
    const id = setInterval(fetchPort, 15000);
    return () => clearInterval(id);
  }, []);
  return { current, bridgeUrl, setCurrent, upnp, setUpnp };
}

type IfaceEntry = { name: string; address: string; netmask: string; family: string; internal: boolean; mac: string; cidr: string | null };

function useInterfaces(): { ifaces: IfaceEntry[]; loading: boolean; error: string | null; refresh: () => void } {
  const [ifaces, setIfaces] = useState<IfaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchIfaces = async () => {
    setLoading(true);
    setError(null);
    try {
      // Prefer bridge via /api/interfaces (proxies to bridge, sees tun0 with host network)
      const r = await fetch("/api/interfaces", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (Array.isArray(j)) {
        const filtered = (j as IfaceEntry[]).filter((a) => a.family === "IPv4");
        setIfaces(filtered);
      } else if (j && typeof j === "object" && "error" in j) throw new Error((j as { error: string }).error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchIfaces(); }, []);
  return { ifaces, loading, error, refresh: fetchIfaces };
}

export function NetworkSection() {
  const { settings, setOption } = useConfig();
  const server = settings.server;
  const { state, subscribe, send } = useSession();
  const { current: bridgePort, setCurrent: setBridgePort, upnp: bridgeUpnp, setUpnp: setBridgeUpnp } = useBridgeListenPort();
  const { ifaces, loading: ifaceLoading, error: ifaceError, refresh: refreshIfaces } = useInterfaces();
  // Normalize portrange: nicotine-plus stores [port, port]; UI edits first element
  const listenPort = Array.isArray(server.portrange) ? server.portrange[0] : (server as unknown as { portrange?: number }).portrange ?? DEFAULT_LISTEN_PORT;
  const isConnected = state.status === "connected";

  // Save-gated editing: pending is local until Save triggers fresh connect (WS stays open)
  const [pendingPort, setPendingPort] = useState<number>(listenPort);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    // Sync pending from persisted listenPort when not dirty or after external update (e.g. successful bridge reconfigure)
    if (saveStatus !== "saving") setPendingPort(listenPort);
  }, [listenPort, saveStatus]);
  // Subscribe to bridge feedback for save lifecycle (no WS drop)
  useEffect(() => {
    const unsub = subscribe((msg) => {
      const t = (msg as { type: string }).type;
      if (t === "diagnostics:health") {
        const h = (msg as unknown as { health: { listenPort?: number; upnp?: typeof bridgeUpnp } }).health;
        if (typeof h.listenPort === "number") {
          setBridgePort(h.listenPort);
          if (saveStatus === "saving" && h.listenPort === pendingPort) {
            setSaveStatus("success");
            setSaveError(null);
            setTimeout(() => setSaveStatus("idle"), 3000);
          }
        }
        if (h.upnp) setBridgeUpnp(h.upnp);
      } else if (t === "server:reconnect") {
        const d = msg as unknown as { error?: string; ok?: boolean; listenPort?: number };
        if (d.ok && typeof d.listenPort === "number") {
          setBridgePort(d.listenPort);
          if (saveStatus === "saving") {
            setSaveStatus("success");
            setSaveError(null);
            setTimeout(() => setSaveStatus("idle"), 3000);
          }
        } else if (d.error && saveStatus === "saving") {
          setSaveStatus("error");
          setSaveError(d.error);
        }
      } else if (t === "error") {
        const err = (msg as unknown as { error: string }).error || "";
        if (saveStatus === "saving" && /Cannot listen on port|Invalid listen port/i.test(err)) {
          setSaveStatus("error");
          setSaveError(err);
          // Revert pending to last good (bridgePort or listenPort) so UI doesn't stay dirty on failure
          const fallback = bridgePort ?? listenPort;
          setPendingPort(fallback);
        }
      } else if (t === "config:updated") {
        const d = msg as unknown as { section: string; key: string; value: unknown };
        if (d.section === "server" && d.key === "portrange" && Array.isArray(d.value) && saveStatus === "saving") {
          // config:updated with old value on revert also handled via diagnostics:health/error
        }
      }
    });
    return unsub;
  }, [subscribe, saveStatus, pendingPort, bridgePort, listenPort, setBridgePort, setBridgeUpnp, bridgeUpnp]);
  const dirty = pendingPort !== listenPort;
  const isSaving = saveStatus === "saving" || state.status === "connecting";
  const handleSave = () => {
    const p = Math.max(1024, Math.min(65535, Number(pendingPort) || DEFAULT_LISTEN_PORT));
    setPendingPort(p);
    setSaveError(null);
    // Persist locally (so reload keeps 49127) – triggers ConfigBridgeSync but we also send explicitly for instant feedback
    setOption("server", "portrange", [p, p] as unknown as never);
    if (!isConnected) {
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
      return;
    }
    setSaveStatus("saving");
    try {
      send({ type: "config:update", section: "server", key: "portrange", value: [p, p] } as unknown as never);
    } catch (e) {
      setSaveStatus("error");
      setSaveError((e as Error).message);
    }
    // Fallback: if bridge doesn't respond in 8s, clear saving (health poll will catch)
    setTimeout(() => setSaveStatus((s) => (s === "saving" ? "idle" : s)), 8000);
  };
  const handleCancel = () => {
    setPendingPort(listenPort);
    setSaveStatus("idle");
    setSaveError(null);
  };

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
            dirty
              ? `Inbound peer port. Bridge is currently on ${bridgePort ?? "—"} — click Save to hot-swap Bun.listen + reconnect Soulseek (WS stays up). Will re-advertise via SetWaitPort ${pendingPort}.`
              : bridgePort && bridgePort !== listenPort
                ? `Inbound peer port. Bridge is currently on ${bridgePort} — pending save for ${listenPort}.`
                : `Inbound peer port for direct searches & transfers. Requires port-forward of TCP+UDP ${pendingPort} on your VPN/router. Save triggers fresh connect (like nicotine-plus). Default ${DEFAULT_LISTEN_PORT} for VPN forward.`
          }
          value={pendingPort}
          min={1024}
          max={65535}
          step={1}
          hideSlider
          onChange={(v) => {
            const p = Math.max(1024, Math.min(65535, Number(v) || DEFAULT_LISTEN_PORT));
            setPendingPort(p);
            if (saveStatus !== "idle") { setSaveStatus("idle"); setSaveError(null); }
          }}
          onReset={() => {
            setPendingPort(DEFAULT_LISTEN_PORT);
            setOption("server", "portrange", [DEFAULT_LISTEN_PORT, DEFAULT_LISTEN_PORT] as unknown as never);
            setSaveStatus("idle");
            setSaveError(null);
          }}
        />
        {/* Save-gated port apply – UI stays up, bridge hot-swaps + Soulseek reconnect */}
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || isSaving}
            className={`rounded-xl px-5 py-2.5 font-label text-sm font-medium transition-all ${!dirty || isSaving ? "bg-surface-container-high text-on-surface-variant/60 cursor-not-allowed" : "bg-primary text-on-primary hover:bg-primary/90 shadow-sm"}`}
          >
            {saveStatus === "saving" || state.status === "connecting" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={!dirty || isSaving}
            className={`rounded-xl px-4 py-2.5 font-label text-xs uppercase tracking-widest ${!dirty || isSaving ? "text-on-surface-variant/30 cursor-not-allowed" : "text-tertiary hover:underline"}`}
          >
            Cancel
          </button>
          {dirty ? <span className="font-body text-xs text-amber-700 dark:text-amber-300">Unsaved change: {listenPort} → {pendingPort}</span> : null}
          {saveStatus === "success" ? <span className="font-body text-xs text-green-700 dark:text-green-300">✓ Saved – bridge reconnected on {pendingPort}</span> : null}
          {saveStatus === "error" && saveError ? <span className="font-body text-xs text-error">{saveError}</span> : null}
          {state.status === "connecting" && saveStatus === "saving" ? <span className="font-body text-xs text-on-surface-variant">Reconnecting Soulseek… WS stays open</span> : null}
        </div>
        {bridgePort ? (
          <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
            Bridge reports <span className="font-mono font-medium text-on-surface">{bridgePort}</span> via <span className="font-mono">/health?json</span> + WS. Click Save to hot-swap <span className="font-mono">Bun.listen</span> and fresh Soulseek connect – re-advertises via <span className="font-mono">SetWaitPort {pendingPort}</span>. For VPN (forwarded {DEFAULT_LISTEN_PORT}) use <span className="font-mono">network_mode: host</span> (see compose.override.example.yaml) – then no Docker recreate needed; otherwise Docker host mapping needs <span className="font-mono">LISTEN_PORT={pendingPort} docker compose up -d</span>.
            {!isConnected ? <span className="block pt-1 text-amber-700 dark:text-amber-300">Not connected — Save will apply on next login.</span> : null}
          </div>
        ) : null}
        <ToggleControl
          label="UPnP port mapping"
          description="Automatically forward the listening port via UPnP/NAT-PMP (like nicotine-plus). Falls back from NAT-PMP to UPnP; renews every 2 h. Disable if your router doesn't support it or you forward manually."
          checked={server.upnp ?? true}
          onChange={(v) => setOption("server", "upnp", v)}
        />
        {bridgeUpnp ? (
          <div className={`rounded-xl px-4 py-3 font-body text-xs ${bridgeUpnp.active ? "bg-green-500/10 text-green-700 dark:text-green-300" : bridgeUpnp.error ? "bg-error-container text-on-error-container" : bridgeUpnp.enabled ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-surface-container-high text-on-surface-variant dark:bg-surface-container-highest/40"}`}>
            {bridgeUpnp.enabled ? (
              bridgeUpnp.active ? (
                <span>✓ Mapped via <span className="font-mono font-medium">{bridgeUpnp.active}</span> — external <span className="font-mono">{bridgeUpnp.port}</span> → <span className="font-mono">{bridgeUpnp.ip}:{bridgeUpnp.port}</span> (TCP, lease 12 h, renew 2 h)</span>
              ) : bridgeUpnp.error ? (
                <span>UPnP failed: <span className="font-mono">{bridgeUpnp.error.slice(0, 120)}</span> — router may not support UPnP/NAT-PMP, or container is on Docker bridge (172.x). Use <span className="font-mono">network_mode: host</span> so bridge sees host LAN IP.</span>
              ) : (
                <span>UPnP enabled — discovering router (SSDP multicast 239.255.255.250:1900) … will fallback NAT-PMP → UPnP.</span>
              )
            ) : (
              <span>UPnP disabled — port {bridgePort ?? pendingPort} must be forwarded manually (TCP) for incoming searches & transfers.</span>
            )}
            {bridgeUpnp.lastSuccessAt ? <span className="block pt-1 text-[11px] opacity-70">Last success: {new Date(bridgeUpnp.lastSuccessAt).toLocaleString()}</span> : null}
          </div>
        ) : null}
        {/* Network interface – server-side list via /api/interfaces (bridge sees tun0 with host network) – stores interface NAME human-friendly, immediate apply */}
        {(() => {
          // Use top-level hook values (ifaces, ifaceLoading, ifaceError, refreshIfaces) – no hook call inside render
          const loading = ifaceLoading;
          const refresh = refreshIfaces;
          // Deduplicate by name (store name, bridge resolves name → IP)
          const byName = new Map<string, IfaceEntry>();
          for (const i of ifaces) if (!byName.has(i.name)) byName.set(i.name, i);
          const ifaceList = Array.from(byName.values()).sort((a, b) => {
            // Sort: non-internal first, VPN (tun/wg) first
            if (a.internal !== b.internal) return a.internal ? 1 : -1;
            const av = a.name.startsWith("tun") || a.name.startsWith("wg") ? 0 : 1;
            const bv = b.name.startsWith("tun") || b.name.startsWith("wg") ? 0 : 1;
            if (av !== bv) return av - bv;
            return a.name.localeCompare(b.name);
          });
          const currentIface = server.interface ?? "";
          const options = [
            { value: "", label: "Default (0.0.0.0 – all interfaces)" },
            ...ifaceList.map((i) => ({
              value: i.name,
              label: `${i.name} — ${i.address}${i.internal ? " (internal)" : ""}${i.name.startsWith("tun") || i.name.startsWith("wg") ? " (VPN)" : ""}`,
            })),
          ];
          // If stored name not in list (e.g. stale or typed IP), keep it as option so it doesn't disappear
          if (currentIface && !options.some((o) => o.value === currentIface)) {
            options.push({ value: currentIface, label: `${currentIface} (custom)` });
          }
          return (
            <>
              <SelectControl
                label="Network interface"
                description={
                  loading
                    ? "Loading interfaces from bridge…"
                    : ifaceError
                      ? `Could not list interfaces: ${ifaceError} – bridge must be reachable (host network shows tun0).`
                      : `Bind Soulseek peer listener to this interface's IP (name stored, bridge resolves name → IP at apply). Server-side only – browser cannot see eth0/tun0, so list comes from bridge via /api/interfaces. Default 0.0.0.0 listens all. For VPN (tun0 10.8.0.6) use network_mode: host so bridge sees host tun0. Change applies immediately (reconnect, WS stays open).`
                }
                value={currentIface}
                options={options}
                onChange={(v) => {
                  setOption("server", "interface", v);
                  // immediate – ConfigBridgeSync will push, but send now for instant bind
                  try { send({ type: "config:update", section: "server", key: "interface", value: v } as unknown as never); } catch {}
                }}
              />
              <div className="flex items-center gap-3 pb-2">
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  className="rounded-xl bg-surface-container-high px-4 py-2 font-label text-xs uppercase tracking-widest text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50"
                >
                  {loading ? "Refreshing…" : "Refresh interfaces"}
                </button>
                {ifaceError ? <span className="font-body text-xs text-error">{ifaceError}</span> : null}
                {!loading && ifaceList.length === 0 && !ifaceError ? (
                  <span className="font-body text-xs text-on-surface-variant">No interfaces returned – bridge may be down or Docker bridge network (no host tun0). Switch to host network.</span>
                ) : null}
              </div>
              {bridgePort ? (
                <div className="rounded-xl bg-surface-container-low px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-high/40">
                  Current bind: <span className="font-mono font-medium text-on-surface">{currentIface || "0.0.0.0 (all)"}</span>
                  {currentIface && byName.get(currentIface) ? (
                    <span> → <span className="font-mono">{byName.get(currentIface)!.address}</span></span>
                  ) : null}
                  . Peer listener <span className="font-mono">{bridgePort}</span> will bind to this IP (or <span className="font-mono">0.0.0.0</span> if empty). VPN example: <span className="font-mono">tun0 10.8.0.6</span>.
                </div>
              ) : null}
            </>
          );
        })()}
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
