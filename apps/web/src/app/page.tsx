"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { LoginForm } from "@/components/LoginForm";

export default function Home() {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "connected") router.replace("/search");
  }, [state.status, router]);

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
        <div className="mb-8 flex w-full flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
            <span className="font-headline text-3xl font-black text-on-primary">N</span>
          </div>
          <h1 className="mb-2 font-headline text-3xl md:text-4xl font-bold tracking-tight text-on-surface dark:text-inverse-on-surface">
            Nicotine Mobile
          </h1>
          <p className="font-body text-sm text-on-surface-variant dark:text-outline-variant">
            Enter your credentials to access the hub.
          </p>
        </div>

        <div className="w-full glass-panel p-6 md:p-8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-surface-container-high dark:border-white/10">
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
