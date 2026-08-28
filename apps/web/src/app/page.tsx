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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-container-low font-body text-on-surface">
      {/* Abstract background pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 50%, rgba(9, 76, 178, 0.05) 0%, transparent 60%)",
        }}
      />

      <main className="relative z-10 flex w-full max-w-md flex-col items-center p-8">
        {/* Logo and header */}
        <div className="mb-12 flex w-full flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-container shadow-lg shadow-primary/20">
            <span className="font-headline text-3xl font-bold text-on-primary">N</span>
          </div>
          <h1 className="mb-3 font-headline text-3xl font-bold tracking-tight text-on-surface">
            Nicotine Mobile
          </h1>
          <p className="font-body text-sm text-on-surface-variant">
            Your Soulseek network, in the browser.
          </p>
        </div>

        <LoginForm />
      </main>
    </div>
  );
}
