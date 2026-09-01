"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTransfers } from "@/lib/transfers";
import { useStatistics } from "@/lib/statistics";
import { humanSize } from "@/lib/format";

export function DownloadStats() {
  const { downloads } = useTransfers();
  const { total, session } = useStatistics();
  const uniqueUsers = useMemo(() => new Set(downloads.map((d) => d.username)).size, [downloads]);
  const liveCount = downloads.length;

  // Fallbacks when statistics not yet loaded
  const tCompleted = total?.completed_downloads ?? downloads.filter((d) => d.status === "Finished").length;
  const tStarted = total?.started_downloads ?? downloads.length;
  const tSize = total?.downloaded_size ?? downloads.reduce((s, d) => s + (d.status === "Finished" ? d.size : 0), 0);
  const sCompleted = session?.completed_downloads ?? 0;
  const sSize = session?.downloaded_size ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-surface dark:bg-surface-container-low p-5 ghost-border flex flex-col gap-1">
          <span className="font-label text-[10px] uppercase tracking-widest text-outline">Completed Downloads</span>
          <span className="font-headline text-2xl font-bold text-on-surface">{tCompleted}</span>
          <span className="font-label text-xs text-on-surface-variant">{tStarted} started • {sCompleted} this session • {liveCount} active</span>
          <span className="font-label text-[10px] text-outline">All-time • Session {sCompleted}</span>
        </div>
        <div className="rounded-2xl bg-surface dark:bg-surface-container-low p-5 ghost-border flex flex-col gap-1">
          <span className="font-label text-[10px] uppercase tracking-widest text-outline">Data Downloaded</span>
          <span className="font-headline text-2xl font-bold text-primary">{humanSize(tSize)}</span>
          <span className="font-label text-xs text-on-surface-variant">Session {humanSize(sSize)}</span>
        </div>
        <div className="rounded-2xl bg-surface dark:bg-surface-container-low p-5 ghost-border flex flex-col gap-1">
          <span className="font-label text-[10px] uppercase tracking-widest text-outline">Peers</span>
          <span className="font-headline text-2xl font-bold text-on-surface">{uniqueUsers}</span>
          <span className="font-label text-xs text-on-surface-variant">Unique users downloaded from</span>
        </div>
      </div>
      <Link href="/statistics" className="self-end inline-flex items-center gap-1 font-label text-xs font-semibold uppercase tracking-widest text-primary hover:underline">
        View full statistics <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
      </Link>
    </section>
  );
}

export function UploadStats() {
  const { uploads } = useTransfers();
  const { total, session } = useStatistics();
  const uniqueUsers = useMemo(() => new Set(uploads.map((u) => u.username)).size, [uploads]);
  const liveCount = uploads.length;

  const tCompleted = total?.completed_uploads ?? uploads.filter((u) => u.status === "Finished").length;
  const tStarted = total?.started_uploads ?? uploads.length;
  const tSize = total?.uploaded_size ?? uploads.reduce((s, u) => s + (u.status === "Finished" ? u.size : 0), 0);
  const sCompleted = session?.completed_uploads ?? 0;
  const sSize = session?.uploaded_size ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-surface dark:bg-surface-container-low p-5 ghost-border flex flex-col gap-1">
          <span className="font-label text-[10px] uppercase tracking-widest text-outline">Completed Uploads</span>
          <span className="font-headline text-2xl font-bold text-on-surface">{tCompleted}</span>
          <span className="font-label text-xs text-on-surface-variant">{tStarted} started • {sCompleted} this session • {liveCount} active</span>
          <span className="font-label text-[10px] text-outline">All-time • Session {sCompleted}</span>
        </div>
        <div className="rounded-2xl bg-surface dark:bg-surface-container-low p-5 ghost-border flex flex-col gap-1">
          <span className="font-label text-[10px] uppercase tracking-widest text-outline">Data Uploaded</span>
          <span className="font-headline text-2xl font-bold text-tertiary">{humanSize(tSize)}</span>
          <span className="font-label text-xs text-on-surface-variant">Session {humanSize(sSize)}</span>
        </div>
        <div className="rounded-2xl bg-surface dark:bg-surface-container-low p-5 ghost-border flex flex-col gap-1">
          <span className="font-label text-[10px] uppercase tracking-widest text-outline">Peers Served</span>
          <span className="font-headline text-2xl font-bold text-on-surface">{uniqueUsers}</span>
          <span className="font-label text-xs text-on-surface-variant">Unique users uploaded to</span>
        </div>
      </div>
      <Link href="/statistics" className="self-end inline-flex items-center gap-1 font-label text-xs font-semibold uppercase tracking-widest text-primary hover:underline">
        View full statistics <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
      </Link>
    </section>
  );
}
