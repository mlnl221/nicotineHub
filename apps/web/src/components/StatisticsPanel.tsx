"use client";
import { useEffect, useState } from "react";
import { useStatistics, type StatsData } from "@/lib/statistics";
import { humanSize, humanSpeed } from "@/lib/format";
import { bridgeFetchUrl } from "@/lib/bridgeHttp";
import { getWorkerHealth } from "@/lib/worker";

function fmtSince(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const date = d.toLocaleDateString();
  if (days === 0) {
    if (hours === 0) return `${date} — less than an hour ago`;
    return `${date} — ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (days === 1) return `${date} — 1 day ago`;
  if (days < 30) return `${date} — ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return `${date} — 1 month ago`;
  return `${date} — ${months} months ago`;
}

function fmtUptime(sec: number): string {
  if (!sec || sec < 0) return "—";
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function pct(a: number, b: number): string {
  if (!b) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

function avgSize(bytes: number, n: number): string {
  if (!n) return "—";
  return humanSize(Math.round(bytes / n));
}

export function StatisticsPanel() {
  const { total, session, live, shares, refresh, reset, loading } = useStatistics() as unknown as {
    total: StatsData | null; session: StatsData | null;
    live: { downloadSpeed: number; uploadSpeed: number; activeDownloads: number; activeUploads: number; queuedDownloads: number; queuedUploads: number } | null;
    shares: { dirs: number; files: number; unavailable: number } | null;
    refresh: () => void; reset: () => void; loading: boolean;
  };
  const [bridge, setBridge] = useState<{ version?: string; uptime?: number; listenPort?: number } | null>(null);
  const [worker, setWorker] = useState<{ ok: boolean; queueDepth?: number; version?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(bridgeFetchUrl("/health?json"), { cache: "no-store" });
        if (res.ok && !cancelled) {
          const j = await res.json() as { version?: string; uptime?: number; listenPort?: number };
          setBridge({ version: j.version, uptime: j.uptime, listenPort: j.listenPort });
        }
      } catch {}
      try {
        const h = await getWorkerHealth();
        if (!cancelled) setWorker(h ? { ok: h.ok, version: h.version, queueDepth: (h as { queueDepth?: number }).queueDepth } : { ok: false });
      } catch {
        if (!cancelled) setWorker({ ok: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!total || !session) {
    return (
      <div className="glass-panel rounded-2xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-label text-sm font-semibold">Statistics</h3>
          <button onClick={refresh} disabled={loading} className="rounded-lg bg-surface-container-high px-3 py-1 text-xs">{loading ? "…" : "Refresh"}</button>
        </div>
        <p className="text-xs text-on-surface-variant">No statistics yet — connect to the bridge to load.</p>
        {loading && <p className="mt-2 text-[11px] text-on-surface-variant">Loading…</p>}
      </div>
    );
  }
  const t = total;
  const s = session;
  const liveBusy = !!live && (live.activeDownloads + live.activeUploads + live.queuedDownloads + live.queuedUploads > 0 || live.downloadSpeed + live.uploadSpeed > 0);
  return (
    <div className="flex flex-col gap-4">
      {(bridge || worker) && (
        <div className="glass-panel rounded-2xl px-4 py-3 font-body text-xs text-on-surface-variant">
          {bridge ? <span>Bridge{bridge.version ? ` v${bridge.version}` : ""} · up {fmtUptime(bridge.uptime ?? 0)}{bridge.listenPort ? ` · peer :${bridge.listenPort}` : ""}</span> : null}
          {bridge && worker ? <span> · </span> : null}
          {worker ? <span>Worker {worker.ok ? `ok${worker.version ? ` v${worker.version}` : ""}${worker.queueDepth ? ` · queue ${worker.queueDepth}` : ""}` : "unreachable"}</span> : null}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-label text-sm font-semibold">Right now</h3>
          <span className="font-body text-[11px] text-on-surface-variant">{liveBusy ? "active" : "idle"}</span>
        </div>
        {!live ? (
          <p className="text-xs text-on-surface-variant">Waiting for live snapshot…</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-container-low px-3 py-2"><div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">↓ speed</div><div className="font-body text-sm font-semibold">{humanSpeed(live.downloadSpeed) || "—"}</div></div>
            <div className="rounded-xl bg-surface-container-low px-3 py-2"><div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">↑ speed</div><div className="font-body text-sm font-semibold">{humanSpeed(live.uploadSpeed) || "—"}</div></div>
            <div className="rounded-xl bg-surface-container-low px-3 py-2"><div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Active ↓/↑</div><div className="font-body text-sm font-semibold">{live.activeDownloads} / {live.activeUploads}</div></div>
            <div className="rounded-xl bg-surface-container-low px-3 py-2"><div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Queued ↓/↑</div><div className="font-body text-sm font-semibold">{live.queuedDownloads} / {live.queuedUploads}</div></div>
            {shares ? (
              <div className="rounded-xl bg-surface-container-low px-3 py-2"><div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Sharing</div><div className="font-body text-sm font-semibold">{shares.files} files · {shares.dirs} dirs{shares.unavailable ? ` · ${shares.unavailable} missing` : ""}</div></div>
            ) : null}
          </div>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-label text-sm font-semibold">Transfers</h3>
          <div className="flex gap-2">
            <button onClick={refresh} disabled={loading} className="rounded-lg bg-surface-container-high px-3 py-1 text-xs">{loading ? "…" : "Refresh"}</button>
            <button onClick={() => { if (confirm("Reset all statistics?")) reset(); }} className="rounded-lg bg-error-container px-3 py-1 text-xs text-on-error-container">Reset</button>
          </div>
        </div>
        <p className="mb-3 text-xs text-on-surface-variant">Since {fmtSince(t.since_timestamp)} — total vs session.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-on-surface-variant">
                <th className="pb-2"></th>
                <th className="pb-2">Total</th>
                <th className="pb-2">Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              <tr><td className="py-1.5">Started downloads</td><td>{t.started_downloads}</td><td>{s.started_downloads}</td></tr>
              <tr><td className="py-1.5">Completed downloads</td><td>{t.completed_downloads}</td><td>{s.completed_downloads}</td></tr>
              <tr><td className="py-1.5">Failed downloads</td><td>{t.failed_downloads ?? 0}</td><td>{s.failed_downloads ?? 0}</td></tr>
              <tr><td className="py-1.5">Cancelled downloads</td><td>{t.cancelled_downloads ?? 0}</td><td>{s.cancelled_downloads ?? 0}</td></tr>
              <tr><td className="py-1.5">Downloaded size</td><td>{humanSize(t.downloaded_size)}</td><td>{humanSize(s.downloaded_size)}</td></tr>
              <tr><td className="py-1.5">Started uploads</td><td>{t.started_uploads}</td><td>{s.started_uploads}</td></tr>
              <tr><td className="py-1.5">Completed uploads</td><td>{t.completed_uploads}</td><td>{s.completed_uploads}</td></tr>
              <tr><td className="py-1.5">Failed / blocked uploads</td><td>{t.failed_uploads ?? 0}</td><td>{s.failed_uploads ?? 0}</td></tr>
              <tr><td className="py-1.5">Cancelled uploads</td><td>{t.cancelled_uploads ?? 0}</td><td>{s.cancelled_uploads ?? 0}</td></tr>
              <tr><td className="py-1.5">Uploaded size</td><td>{humanSize(t.uploaded_size)}</td><td>{humanSize(s.uploaded_size)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-body text-xs text-on-surface-variant">
          <span>↓ completion {pct(t.completed_downloads, t.started_downloads)}</span>
          <span>↑ completion {pct(t.completed_uploads, t.started_uploads)}</span>
          <span>avg ↓ file {avgSize(t.downloaded_size, t.completed_downloads)}</span>
          <span>avg ↑ file {avgSize(t.uploaded_size, t.completed_uploads)}</span>
          <span>up:down {t.downloaded_size ? `${(t.uploaded_size / t.downloaded_size).toFixed(2)}` : "—"}</span>
        </div>
      </div>
    </div>
  );
}
