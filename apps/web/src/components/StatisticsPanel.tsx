"use client";
import { useStatistics } from "@/lib/statistics";

function humanSize(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

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

export function StatisticsPanel() {
  const { total, session, refresh, reset, loading } = useStatistics() as unknown as { total: ReturnType<typeof useStatistics>["total"]; session: ReturnType<typeof useStatistics>["session"]; refresh: () => void; reset: () => void; loading: boolean };
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
  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-label text-sm font-semibold">Statistics</h3>
        <div className="flex gap-2">
          <button onClick={refresh} disabled={loading} className="rounded-lg bg-surface-container-high px-3 py-1 text-xs">{loading ? "…" : "Refresh"}</button>
          <button onClick={() => { if (confirm("Reset all statistics? This mirrors pynicotine/transfers.py:Statistics reset.")) reset(); }} className="rounded-lg bg-error-container px-3 py-1 text-xs text-on-error-container">Reset</button>
        </div>
      </div>
      <p className="mb-3 text-xs text-on-surface-variant">Since {fmtSince(t.since_timestamp)} — mirrors <code>pynicotine/transfers.py:Statistics</code></p>
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
            <tr><td className="py-1.5">Downloaded size</td><td>{humanSize(t.downloaded_size)}</td><td>{humanSize(s.downloaded_size)}</td></tr>
            <tr><td className="py-1.5">Started uploads</td><td>{t.started_uploads}</td><td>{s.started_uploads}</td></tr>
            <tr><td className="py-1.5">Completed uploads</td><td>{t.completed_uploads}</td><td>{s.completed_uploads}</td></tr>
            <tr><td className="py-1.5">Uploaded size</td><td>{humanSize(t.uploaded_size)}</td><td>{humanSize(s.uploaded_size)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
