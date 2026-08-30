"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { LoginForm } from "@/components/LoginForm";

export default function Home() {
  const { state } = useSession();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (state.status === "connected") router.replace("/search");
  }, [state.status, router]);

  if (!mounted) {
    // Render consistent skeleton on both server and client initial hydration to avoid mismatch
    // (prevents overflow-x-hidden vs overflow-hidden and img vs div drifts from stale HMR)
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface font-body text-on-surface dark:bg-inverse-surface dark:text-inverse-on-surface px-6 py-12">
        <div className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-20" style={{ backgroundImage: "radial-gradient(circle at 50% -20%, rgba(51,102,204,0.15) 0%, transparent 60%)" }} />
        <div className="pointer-events-none absolute inset-0 opacity-30 dark:opacity-10" style={{ backgroundImage: "radial-gradient(circle at 50% 120%, rgba(9,76,178,0.08) 0%, transparent 50%)" }} />
        <main className="relative z-10 flex w-full max-w-md flex-col items-center">
          <div className="mb-8 flex w-full flex-col items-center text-center">
            <img src="/logo.png" alt="Nicotine Hub" width={220} height={120} className="mb-4 h-auto w-[220px] max-w-[70vw] object-contain drop-shadow-[0_4px_24px_rgba(9,76,178,0.12)]" />
            <h1 className="sr-only">Nicotine Hub</h1>
            <p className="font-body text-sm text-on-surface-variant dark:text-outline-variant">Loading…</p>
          </div>
          <div className="w-full glass-panel p-6 md:p-8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-surface-container-high dark:border-white/10">
            <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" />
          </div>
        </main>
      </div>
    );
  }

  if (state.status === "connected") return null;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface font-body text-on-surface dark:bg-inverse-surface dark:text-inverse-on-surface px-6 py-12">
      {/* Ambient background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% -20%, rgba(51,102,204,0.15) 0%, transparent 60%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 opacity-30 dark:opacity-10" style={{ backgroundImage: "radial-gradient(circle at 50% 120%, rgba(9,76,178,0.08) 0%, transparent 50%)" }} />

      <main className="relative z-10 flex w-full max-w-md flex-col items-center">
        {/* Logo and header */}
        <div suppressHydrationWarning className="mb-8 flex w-full flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="Nicotine Hub"
            width={220}
            height={120}
            className="mb-4 h-auto w-[220px] max-w-[70vw] object-contain drop-shadow-[0_4px_24px_rgba(9,76,178,0.12)]"
            suppressHydrationWarning
          />
          <h1 className="sr-only">Nicotine Hub</h1>
          <p className="font-body text-sm text-on-surface-variant dark:text-outline-variant">
            Enter any username and password to try the demo.
          </p>
        </div>

        <div className="w-full glass-panel p-6 md:p-8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-surface-container-high dark:border-white/10">
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
