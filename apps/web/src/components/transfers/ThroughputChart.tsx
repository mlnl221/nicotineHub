"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTransfers } from "@/lib/transfers";

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  const mb = bps / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bps / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

type Sample = { t: number; down: number; up: number };

function buildPath(samples: Sample[], key: "down" | "up", max: number): { line: string; area: string } {
  if (samples.length < 2 || max === 0) return { line: "", area: "" };
  const n = samples.length;
  const pts = samples.map((s, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 100 - (s[key] / max) * 70 - 15; // 15-85 range, leave margins
    return { x, y };
  });
  // Smooth with quadratic
  let line = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const cx = (prev.x + cur.x) / 2;
    line += ` Q${prev.x},${prev.y} ${cx},${(prev.y + cur.y) / 2}`;
    if (i === pts.length - 1) line += ` Q${cur.x},${cur.y} ${cur.x},${cur.y}`;
  }
  const area = line + ` L${pts[pts.length - 1].x},100 L${pts[0].x},100 Z`;
  return { line, area };
}

export function ThroughputChart() {
  const { stats, downloads, uploads } = useTransfers();
  const [samples, setSamples] = useState<Sample[]>([]);

  const totalDown = stats?.downloadSpeed ?? downloads.filter((d) => d.status === "Transferring").reduce((s, t) => s + t.speed, 0);
  const totalUp = stats?.uploadSpeed ?? uploads.filter((u) => u.status === "Transferring").reduce((s, t) => s + t.speed, 0);

  const sampleRef = useRef<Sample[]>([]);
  // Sample on stats change and on interval for live feel
  useEffect(() => {
    const push = () => {
      const now = Date.now();
      const entry: Sample = { t: now, down: totalDown, up: totalUp };
      // Avoid duplicate burst if unchanged and very recent (<500ms) and zero
      sampleRef.current = [...sampleRef.current.slice(-59), entry];
      setSamples([...sampleRef.current]);
    };
    push();
    const id = setInterval(push, 2000);
    return () => clearInterval(id);
  }, [totalDown, totalUp]);

  const max = useMemo(() => {
    const m = Math.max(...samples.map((s) => Math.max(s.down, s.up)), 1024);
    // Avoid flat line jump: at least 10KB
    return Math.max(m, 10 * 1024);
  }, [samples]);

  const downPath = useMemo(() => buildPath(samples, "down", max), [samples, max]);
  const upPath = useMemo(() => buildPath(samples, "up", max), [samples, max]);

  const hasData = samples.length >= 2 && (samples.some((s) => s.down > 0 || s.up > 0));

  return (
    <section className="bg-surface dark:bg-surface-container-low rounded-2xl p-5 md:p-6 relative overflow-hidden h-56 md:h-64 flex flex-col justify-between ghost-border">
      <div className="z-10 relative">
        <h3 className="font-label text-xs md:text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline mb-1">Network Throughput</h3>
        <div className="font-headline text-xl md:text-2xl font-semibold dark:text-on-surface">Real-time Bandwidth</div>
        <div className="mt-1 flex items-center gap-3 font-label text-xs">
          <span className="inline-flex items-center gap-1 text-primary">
            <span className="h-2 w-2 rounded-full bg-primary" />↓ {humanSpeed(totalDown)}
          </span>
          <span className="inline-flex items-center gap-1 text-tertiary">
            <span className="h-2 w-2 rounded-full bg-tertiary" />↑ {humanSpeed(totalUp)}
          </span>
          <span className="text-outline hidden md:inline">· 60 samples · {max < 1024 * 1024 ? `${Math.round(max / 1024)} KB/s max` : `${(max / (1024 * 1024)).toFixed(1)} MB/s max`}</span>
        </div>
      </div>

      <div className="absolute inset-0 w-full h-full pointer-events-none">
        {/* gradient backdrop */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 20%, rgba(9,76,178,0.04) 100%)" }} />
        <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          {/* grid */}
          <line x1="0" y1="15" x2="100" y2="15" stroke="currentColor" className="text-outline-variant/20" strokeWidth="0.3" strokeDasharray="1 2" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" className="text-outline-variant/20" strokeWidth="0.3" strokeDasharray="1 2" />
          <line x1="0" y1="85" x2="100" y2="85" stroke="currentColor" className="text-outline-variant/20" strokeWidth="0.3" strokeDasharray="1 2" />
          {/* Up (tertiary) underneath */}
          {hasData && upPath.area && <path d={upPath.area} fill="rgba(109,94,0,0.08)" className="dark:fill-[rgba(224,196,100,0.08)]" />}
          {hasData && upPath.line && <path d={upPath.line} fill="none" stroke="#6d5e00" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-[#dcc661]" />}
          {/* Down (primary) on top */}
          {hasData && downPath.area && <path d={downPath.area} fill="rgba(9,76,178,0.08)" />}
          {hasData && downPath.line && <path d={downPath.line} fill="none" stroke="#094cb2" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-[#b1c5ff]" />}
          {/* Placeholder when no data */}
          {!hasData && (
            <>
              <path d="M0,80 Q25,60 50,70 T100,40" fill="none" stroke="#094cb2" strokeWidth="0.5" opacity="0.25" />
              <path d="M0,90 Q30,85 60,95 T100,80" fill="none" stroke="#6d5e00" strokeWidth="0.5" opacity="0.2" />
            </>
          )}
        </svg>
      </div>

      {!hasData && (
        <p className="z-10 font-label text-xs text-outline">Waiting for data — start a download to see live throughput</p>
      )}
    </section>
  );
}
