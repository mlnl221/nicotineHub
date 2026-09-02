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

function humanTick(bps: number): string {
  if (bps <= 0) return "0";
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)}M`;
  if (bps >= 1024) return `${Math.round(bps / 1024)}K`;
  return `${bps}`;
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
      sampleRef.current = [...sampleRef.current.slice(-59), entry];
      setSamples([...sampleRef.current]);
    };
    push();
    const id = setInterval(push, 2000);
    return () => clearInterval(id);
  }, [totalDown, totalUp]);

  const maxDown = useMemo(() => {
    const m = Math.max(...samples.map((s) => s.down), 1024);
    return Math.max(m, 10 * 1024);
  }, [samples]);
  const maxUp = useMemo(() => {
    const m = Math.max(...samples.map((s) => s.up), 1024);
    return Math.max(m, 10 * 1024);
  }, [samples]);
  // shared max for visual grid, but axes use their own max for labels; paths use own max for accurate scaling
  const max = useMemo(() => Math.max(maxDown, maxUp), [maxDown, maxUp]);

  const downPath = useMemo(() => buildPath(samples, "down", maxDown), [samples, maxDown]);
  const upPath = useMemo(() => buildPath(samples, "up", maxUp), [samples, maxUp]);

  const hasData = samples.length >= 2 && samples.some((s) => s.down > 0 || s.up > 0);

  return (
    <section className="bg-surface dark:bg-surface-container-low rounded-2xl relative overflow-hidden h-56 md:h-64 flex flex-col ghost-border border border-outline-variant/10">
      {/* Chart + Y bars layer — always behind */}
      <div className="absolute inset-0 flex pointer-events-none">
        {/* Left Y bar — Download (primary) */}
        <div className="hidden md:flex w-12 shrink-0 flex-col justify-between py-10 pl-2 pr-1 border-r border-outline-variant/10 bg-surface/20 dark:bg-transparent">
          <span className="font-mono text-[9px] leading-none font-semibold text-primary dark:text-primary-fixed-dim">{humanTick(maxDown)}/s</span>
          <span className="font-mono text-[9px] leading-none text-primary/70 dark:text-primary-fixed-dim/70">{humanTick(maxDown / 2)}/s</span>
          <span className="font-mono text-[9px] leading-none text-primary/50 dark:text-primary-fixed-dim/50">0</span>
        </div>
        {/* Center chart */}
        <div className="flex-1 relative overflow-hidden">
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
        {/* Right Y bar — Upload (tertiary) */}
        <div className="hidden md:flex w-12 shrink-0 flex-col justify-between py-10 pr-2 pl-1 border-l border-outline-variant/10 bg-surface/20 dark:bg-transparent items-end text-right">
          <span className="font-mono text-[9px] leading-none font-semibold text-tertiary dark:text-tertiary-fixed">{humanTick(maxUp)}/s</span>
          <span className="font-mono text-[9px] leading-none text-tertiary/70 dark:text-tertiary-fixed/70">{humanTick(maxUp / 2)}/s</span>
          <span className="font-mono text-[9px] leading-none text-tertiary/50 dark:text-tertiary-fixed/50">0</span>
        </div>
      </div>

      {/* Mobile Y ticks overlay — tiny */}
      <div className="md:hidden absolute inset-0 pointer-events-none flex justify-between px-2 py-10">
        <div className="flex flex-col justify-between text-[8px] font-mono text-primary/60">
          <span>{humanTick(maxDown)}/s</span>
          <span>0</span>
        </div>
        <div className="flex flex-col justify-between text-[8px] font-mono text-tertiary/60 items-end">
          <span>{humanTick(maxUp)}/s</span>
          <span>0</span>
        </div>
      </div>

      {/* Header — always on top, with backdrop so trendline is behind and dimmed under text */}
      <div className="relative z-10 flex flex-1 flex-col justify-start p-5 md:p-6 pointer-events-none">
        <div className="pointer-events-auto w-fit max-w-full rounded-xl bg-surface/60 dark:bg-surface-container-lowest/60 backdrop-blur-sm shadow-sm ghost-border px-3 py-2.5 md:px-4 md:py-3">
          <h3 className="font-label text-xs md:text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline">Network Throughput</h3>
          <div className="font-headline text-xl md:text-2xl font-semibold dark:text-on-surface leading-tight">Real-time Bandwidth</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 md:gap-3 font-label text-xs">
            <span className="inline-flex items-center gap-1.5 text-primary dark:text-primary-fixed-dim">
              <span className="h-2 w-2 rounded-full bg-primary dark:bg-primary-fixed-dim shadow-sm" />↓ {humanSpeed(totalDown)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-tertiary dark:text-tertiary-fixed">
              <span className="h-2 w-2 rounded-full bg-tertiary dark:bg-tertiary-fixed shadow-sm" />↑ {humanSpeed(totalUp)}
            </span>
            <span className="hidden md:inline text-outline">· 60 samples · {max < 1024 * 1024 ? `${Math.round(max / 1024)} KB/s max` : `${(max / (1024 * 1024)).toFixed(1)} MB/s max`}</span>
          </div>
          {/* Mobile max line */}
          <div className="md:hidden mt-1 font-mono text-[10px] text-outline">
            {max < 1024 * 1024 ? `${Math.round(max / 1024)} KB/s max` : `${(max / (1024 * 1024)).toFixed(1)} MB/s max`} · 60 samples
          </div>
          {/* Y scale hint for mobile */}
          <div className="mt-2 flex items-center gap-2 text-[10px] font-mono md:hidden">
            <span className="inline-flex items-center gap-1 text-primary"><span className="h-3 w-[2px] rounded-full bg-primary" /> {humanTick(maxDown)}/s ↓</span>
            <span className="text-outline">·</span>
            <span className="inline-flex items-center gap-1 text-tertiary"><span className="h-3 w-[2px] rounded-full bg-tertiary" /> {humanTick(maxUp)}/s ↑</span>
          </div>
        </div>

        {!hasData ? (
          <p className="mt-4 w-fit rounded-full bg-surface/80 dark:bg-surface-container/80 backdrop-blur px-3 py-1 font-label text-xs text-outline shadow-sm pointer-events-auto">Waiting for data — start a download to see live throughput</p>
        ) : (
          <div className="hidden md:flex items-center justify-between mt-auto pt-4">
            <span className="font-mono text-[10px] text-outline/60">0s</span>
            <span className="font-mono text-[10px] text-outline/60">60 samples · 2s interval</span>
            <span className="font-mono text-[10px] text-outline/60">now</span>
          </div>
        )}
      </div>
    </section>
  );
}
