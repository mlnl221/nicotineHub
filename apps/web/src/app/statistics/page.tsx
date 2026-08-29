"use client";
import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { StatisticsPanel } from "@/components/StatisticsPanel";
import { useSession } from "@/lib/session";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function StatisticsPage() {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => { if (state.status !== "connected") router.replace("/"); }, [state.status, router]);
  if (state.status !== "connected") return null;
  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Statistics" />
      <main className="relative md:ml-72 flex min-h-screen flex-1 flex-col overflow-hidden pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <header className="relative z-10 hidden md:flex w-full items-center justify-between px-4 py-3 md:px-10 md:py-6">
          <h1 className="font-headline text-2xl font-light tracking-tight">Statistics</h1>
          <Link href="/search" className="flex items-center gap-2 font-label text-xs uppercase tracking-widest text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span> Back to search
          </Link>
        </header>
        <div className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-10 md:py-8">
          <StatisticsPanel />
          <p className="mt-4 text-xs text-on-surface-variant">Mirrors <code>Statistics</code> in <code>pynicotine/transfers.py</code> — total vs session.</p>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
