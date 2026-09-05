"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { useTransfers } from "@/lib/transfers";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { PageHeader } from "@/components/PageHeader";
import type { DiagEntry, DiagLevel, DiagnosticsHealth } from "@/lib/protocol";
import { PortChecker } from "@/components/PortChecker";
import { useConfig } from "@/lib/config/provider";
import { formatStrftime } from "@/lib/chatFormat";
import { isDemo } from "@/lib/demo";
import { useStatistics } from "@/lib/statistics";
import { humanSize } from "@/lib/format";

const LEVELS: DiagLevel[] = ["debug", "info", "warn", "error"];
const LEVEL_COLOR: Record<DiagLevel, string> = {
  debug: "text-on-surface-variant dark:text-outline",
  info: "text-primary dark:text-primary-fixed",
  warn: "text-tertiary dark:text-tertiary-fixed",
  error: "text-error",
};

function formatTime(iso: string, fmt?: string): string {
  try {
    const d = new Date(iso);
    if (fmt && fmt !== "%x %X") return formatStrftime(d.getTime(), fmt);
    return d.toISOString().slice(11, 19) + "." + String(d.getMilliseconds()).padStart(3, "0");
  } catch { return iso; }
}

// Single source of truth for which bridge the UI talks to:
// runtime localStorage override → build-time NEXT_PUBLIC_BRIDGE_URL.
function configuredBridgeWsUrl(): string | null {
  try {
    const v = window.localStorage.getItem("nicotineHub.bridgeUrl") ?? window.localStorage.getItem("nicotine.bridgeUrl");
    if (v) return v;
  } catch {}
  return process.env.NEXT_PUBLIC_BRIDGE_URL || null;
}

function bridgeHttpBase(): string {
  const v = configuredBridgeWsUrl();
  if (v) {
    try {
      const u = new URL(v.replace(/^ws/, "http"));
      return `${u.protocol}//${u.host}`;
    } catch {}
  }
  // Same-origin default: browser reaches the bridge through the web
  // entrypoint (/api/bridge proxied), so no published bridge port needed.
  return "/api/bridge";
}

function HealthCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-4 ghost-border dark:bg-surface-container-low">
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary dark:text-primary-fixed">{icon}</span>
        <h3 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant dark:text-outline">{title}</h3>
      </div>
      <div className="space-y-1 font-body text-xs text-on-surface dark:text-on-surface">{children}</div>
    </div>
  );
}

function StatisticsSummaryCard() {
  const { total, session } = useStatistics();
  if (!total || !session) {
    return (
      <div className="rounded-xl bg-surface p-4 ghost-border dark:bg-surface-container-low">
        <div className="mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary dark:text-primary-fixed">bar_chart</span>
          <h3 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant dark:text-outline">Statistics</h3>
        </div>
        <p className="font-body text-xs text-on-surface-variant dark:text-outline">No statistics yet — connect to the bridge to load.</p>
        <Link href="/statistics" className="mt-3 inline-flex items-center gap-1 font-label text-xs font-semibold uppercase tracking-widest text-primary hover:underline">
          View full statistics <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-surface p-4 ghost-border dark:bg-surface-container-low">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary dark:text-primary-fixed">bar_chart</span>
          <h3 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant dark:text-outline">Statistics</h3>
        </div>
        <Link href="/statistics" className="inline-flex items-center gap-1 font-label text-[11px] font-semibold uppercase tracking-widest text-primary hover:underline">
          View all <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>
      <div className="space-y-1 font-body text-xs text-on-surface dark:text-on-surface">
        <div>↓ {total.completed_downloads} completed <span className="text-on-surface-variant">({session.completed_downloads} session)</span> · {humanSize(total.downloaded_size)}</div>
        <div>↑ {total.completed_uploads} completed <span className="text-on-surface-variant">({session.completed_uploads} session)</span> · {humanSize(total.uploaded_size)}</div>
        <div className="pt-1 text-[11px] text-on-surface-variant dark:text-outline">Since {new Date(total.since_timestamp * 1000).toLocaleDateString()} · Total vs session</div>
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const { state, send, subscribe } = useSession();
  const { settings } = useConfig();
  const router = useRouter();
  const transfersApi = useTransfers();

  const [health, setHealth] = useState<DiagnosticsHealth | null>(null);
  const [healthLatency, setHealthLatency] = useState<number | null>(null);
  const [logs, setLogs] = useState<DiagEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<DiagLevel>("debug");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [bridgeUrlDisplay, setBridgeUrlDisplay] = useState("same-origin (proxied /ws)");

  useEffect(() => {
    if (state.status === "idle" || state.status === "connecting") return;
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  // subscribe to diagnostics WS messages
  useEffect(() => {
    if (state.status !== "connected") return;
    const unsub = subscribe((msg) => {
      if (msg.type === "diagnostics:init") {
        setLogs(msg.entries.slice(-500));
      } else if (msg.type === "diagnostics:log") {
        if (paused) return;
        setLogs((prev) => {
          const next = [...prev, msg.entry];
          if (next.length > 500) return next.slice(-500);
          return next;
        });
      } else if (msg.type === "diagnostics:health") {
        setHealth(msg.health);
      } else if (msg.type === "diagnostics:cleared") {
        setLogs([]);
      }
    });
    // request current tail in case we missed init (e.g. re-render)
    try { send({ type: "diagnostics:subscribe", level: levelFilter }); } catch {}
    return unsub;
  }, [state.status, subscribe, send, levelFilter, paused]);

  // HTTP fallback: fetch logs directly from bridge (covers mock mode and early ws miss)
  // Demo has no bridge — skip HTTP poll entirely, mock supplies via WS.
  useEffect(() => {
    if (isDemo) return;
    if (state.status !== "connected") return;
    let cancelled = false;
    const fetchLogs = async () => {
      const bridgeHttpUrl = `${bridgeHttpBase()}/logs?tail=500`;
      try {
        const res = await fetch(bridgeHttpUrl, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { entries: DiagEntry[] };
        if (cancelled) return;
        if (data.entries && data.entries.length) {
          setLogs((prev) => prev.length === 0 ? data.entries.slice(-500) : prev);
        }
      } catch {}
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [state.status]);

  // poll health via HTTP if WS doesn't supply
  useEffect(() => {
    if (isDemo) return;
    if (state.status !== "connected") return;
    let timer: ReturnType<typeof setInterval>;
    const fetchHealth = async () => {
      const bridgeUrl = `${bridgeHttpBase()}/health?json=1`;
      if (!bridgeUrl) return;
      const start = performance.now();
      try {
        const res = await fetch(bridgeUrl, { cache: "no-store" });
        const latency = Math.round(performance.now() - start);
        setHealthLatency(latency);
        if (res.ok) {
          const data = await res.json();
          setHealth((prev) => ({
            ts: data.ts || new Date().toISOString(),
            uptime: data.uptime || prev?.uptime || 0,
            port: data.port || 8787,
            listenPort: data.listenPort || 60754,
            dataDir: data.dataDir || "/data",
            tokenAuth: !!data.tokenAuth,
          }));
        }
      } catch { setHealthLatency(null); }
    };
    fetchHealth();
    timer = setInterval(fetchHealth, 15000);
    return () => clearInterval(timer);
  }, [state.status]);

  // auto-scroll
  useEffect(() => {
    if (!autoScroll || paused) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll, paused]);

  const filtered = logs.filter((e) => {
    const levelOrder: Record<DiagLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levelOrder[e.level] < levelOrder[levelFilter]) return false;
    if (scopeFilter !== "all" && e.scope !== scopeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${e.msg} ${e.scope} ${e.level} ${JSON.stringify(e.meta || {})}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const handleCopy = useCallback(async () => {
    const text = filtered.map((e) => `[${e.scope}] ${formatTime(e.ts, settings.logging.log_timestamp)} ${e.level.toUpperCase()} ${e.msg}${e.meta ? " " + JSON.stringify(e.meta) : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }, [filtered, settings.logging.log_timestamp]);

  const handleClear = useCallback(() => {
    try { send({ type: "diagnostics:clear" }); } catch {}
    setLogs([]);
  }, [send]);

  const handleDownload = useCallback(() => {
    const text = filtered.map((e) => JSON.stringify(e)).join("\n");
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `diagnostics-${new Date().toISOString().slice(0,10)}.jsonl`; a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const handleBrowserLog = useCallback((level: DiagLevel, scope: string, msg: string, meta?: Record<string, unknown>) => {
    try { send({ type: "diagnostics:browser-log", level, scope: scope as never, msg, meta }); } catch {}
  }, [send]);

  // Log page mount/unmount to bridge (covers browser logs requirement)
  useEffect(() => {
    if (state.status !== "connected") return;
    handleBrowserLog("info", "system", "Diagnostics page opened", { user: state.user });
    const onError = (e: ErrorEvent) => handleBrowserLog("error", "system", e.message, { filename: e.filename, lineno: e.lineno });
    const onRejection = (e: PromiseRejectionEvent) => handleBrowserLog("error", "system", String(e.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      handleBrowserLog("info", "system", "Diagnostics page closed");
    };
  }, [state.status, state.user, handleBrowserLog]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = configuredBridgeWsUrl();
    if (v) { setBridgeUrlDisplay(v.replace(/token=[^&]+/, "token=***")); return; }
    if (isDemo) { setBridgeUrlDisplay("demo (offline — no bridge)"); return; }
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      setBridgeUrlDisplay(`${proto}//${window.location.hostname}:8787/ws`);
    } catch {}
  }, []);

  if (state.status !== "connected") {
    if (state.status === "idle" || state.status === "connecting") {
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface-dim dark:bg-inverse-surface">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      );
    }
    return null;
  }

  const stats = transfersApi.stats;

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Diagnostics" />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-x-hidden max-w-full min-w-0 pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{ background: "radial-gradient(circle at 50% 0%, rgba(51,102,204,0.12) 0%, transparent 60%)" }} />
        <PageHeader
          title="Diagnostics"
          subtitle="System diagnostics and connection health — live logs (500 lines, persistent)."
          settingsHref="/settings?tab=logging#logging"
          actions={
            <Link href="/search" className="hidden items-center gap-2 font-label text-xs uppercase tracking-widest text-on-surface-variant transition-colors hover:text-primary dark:text-outline sm:flex">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span> Back to search
            </Link>
          }
        />

        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 md:gap-6 px-4 pb-6 md:px-10 md:pb-8">
          {/* Health cards + new panels */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
            <PortChecker />
            <StatisticsSummaryCard />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <HealthCard title="Bridge" icon="dns">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${state.status==="connected" ? "bg-primary" : "bg-error"}`} />
                <span className="font-semibold">{state.status}</span>
                {healthLatency !== null && <span className="text-on-surface-variant">· {healthLatency} ms</span>}
              </div>
              <div className="break-all text-[11px] text-on-surface-variant">{bridgeUrlDisplay}</div>
              <div>Port {health?.port ?? 8787} · Listen {health?.listenPort ?? 60754} {health?.tokenAuth ? "· token auth" : "· open"}</div>
              <div className="text-[11px]">Uptime {health ? `${Math.floor(health.uptime)}s` : "—"} · {health ? new Date(health.ts).toLocaleString() : "—"}</div>
            </HealthCard>
            <HealthCard title="Soulseek" icon="cloud">
              <div>User <span className="font-semibold">{state.user ?? "—"}</span></div>
              <div>Server server.slsknet.org:2242</div>
              <div className="text-[11px] text-on-surface-variant">Login {state.status==="connected" ? "ok" : state.status} · reconnect via bridge logs</div>
            </HealthCard>
            <HealthCard title="Transfers" icon="downloading">
              {stats ? (
                <>
                  <div>↓ {((stats.downloadSpeed||0)/1024).toFixed(1)} KB/s · ↑ {((stats.uploadSpeed||0)/1024).toFixed(1)} KB/s</div>
                  <div>Active ↓ {stats.activeDownloads} ↑ {stats.activeUploads} · Queued ↓ {stats.queuedDownloads} ↑ {stats.queuedUploads}</div>
                  <div className="text-[11px] text-on-surface-variant">Total {transfersApi.transfers.length} tracked</div>
                </>
              ) : <span className="text-on-surface-variant">No stats yet {isDemo ? "· demo offline" : ""}</span>}
            </HealthCard>
          </div>

          {/* Always-visible live tail */}
          <section className="flex min-h-[420px] flex-1 flex-col rounded-xl bg-surface p-4 ghost-border dark:bg-surface-container-low sm:p-5" data-testid="diagnostics-log-panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant dark:text-outline">
                <span className="material-symbols-outlined text-[18px]">terminal</span>
                Live logs
                <span className="rounded-full bg-primary-container/30 px-2 py-0.5 font-mono text-[11px] normal-case tracking-normal dark:bg-primary-container/20">{filtered.length} / {logs.length}</span>
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setPaused((v)=>!v)} className={`rounded-full px-3 py-1.5 font-label text-xs uppercase tracking-widest ${paused ? "bg-tertiary text-on-tertiary" : "bg-surface-container-high text-on-surface-variant dark:bg-surface-variant"}`}>{paused ? "Resume" : "Pause"}</button>
                <button onClick={handleCopy} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs uppercase tracking-widest text-on-surface-variant dark:bg-surface-variant">{copied ? "Copied" : "Copy"}</button>
                <button onClick={handleDownload} className="rounded-full bg-surface-container-high px-3 py-1.5 font-label text-xs uppercase tracking-widest text-on-surface-variant dark:bg-surface-variant">Download</button>
                <button onClick={handleClear} className="rounded-full bg-error-container px-3 py-1.5 font-label text-xs uppercase tracking-widest text-on-error-container">Clear</button>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <div className="flex gap-1">
                {LEVELS.map((lvl) => (
                  <button key={lvl} onClick={() => setLevelFilter(lvl)} className={`rounded-full px-2.5 py-1 font-label text-xs uppercase tracking-widest ${levelFilter===lvl ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant dark:bg-surface-variant"}`}>{lvl}</button>
                ))}
              </div>
              <select value={scopeFilter} onChange={(e)=>setScopeFilter(e.target.value)} className="rounded-full bg-surface-container-high px-3 py-1 font-label text-xs uppercase tracking-widest text-on-surface-variant dark:bg-surface-variant">
                <option value="all">all scopes</option>
                <option value="bridge">bridge</option>
                <option value="server">server</option>
                <option value="peer">peer</option>
                <option value="transfer">transfer</option>
                <option value="search">search</option>
                <option value="chat">chat</option>
                <option value="system">system</option>
                <option value="auth">auth</option>
              </select>
              <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Filter text…" className="min-w-[140px] flex-1 rounded-full bg-surface-container-high px-3 py-1 font-body text-xs text-on-surface placeholder:text-on-surface-variant dark:bg-surface-variant sm:max-w-[240px]" />
              <label className="flex items-center gap-1.5 font-label text-xs uppercase tracking-widest text-on-surface-variant">
                <input type="checkbox" checked={autoScroll} onChange={(e)=>setAutoScroll(e.target.checked)} className="accent-primary" /> autoscroll
              </label>
            </div>

            <div
              ref={logRef}
              className="flex max-h-[52vh] min-h-[280px] flex-1 flex-col overflow-auto rounded-lg bg-surface-container-lowest p-3 font-mono text-[11px] leading-5 dark:bg-inverse-surface"
              data-testid="diagnostics-log-tail"
              style={{ scrollbarWidth: "thin" }}
            >
              {filtered.length === 0 ? (
                <div className="py-8 text-center font-body text-xs text-on-surface-variant dark:text-outline">No logs yet — logs appear here in real time (bridge + browser). Try a search or download.</div>
              ) : filtered.map((e, i) => (
                <div key={i} className="flex gap-2 whitespace-pre-wrap break-words">
                  <span className="shrink-0 text-on-surface-variant dark:text-outline">[{e.scope}]</span>
                  <span className="shrink-0 text-on-surface-variant dark:text-outline">{formatTime(e.ts, settings.logging.log_timestamp)}</span>
                  <span className={`shrink-0 font-semibold uppercase ${LEVEL_COLOR[e.level]}`}>{e.level}</span>
                  <span className="text-on-surface dark:text-inverse-on-surface">{e.msg}</span>
                  {e.meta && <span className="text-on-surface-variant dark:text-outline">{JSON.stringify(e.meta)}</span>}
                </div>
              ))}
            </div>
            <p className="mt-2 font-body text-[11px] text-on-surface-variant dark:text-outline">
              Persistent ring: last 500 shown (2000 stored) in <code className="rounded bg-surface-container-high px-1 dark:bg-surface-variant">DATA_DIR/diagnostics.log</code> · visible to all logged-in users · passwords redacted.
            </p>
          </section>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
