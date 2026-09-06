"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { LoginForm } from "@/components/LoginForm";
import { isDemo } from "@/lib/demo";

/** Internal destinations only — blocks open redirects via crafted ?next=. */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  } catch {}
  return null;
}

export default function Home() {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") return;
    // Read from window.location (not useSearchParams) so this statically
    // prerendered page needs no Suspense boundary.
    let next: string | null = null;
    try {
      next = safeNext(new URLSearchParams(window.location.search).get("next"));
    } catch {}
    router.replace(next ?? "/search");
  }, [state.status, router]);

  if (state.status === "connected") return null;

  return (
    <div suppressHydrationWarning className="relative flex min-h-dvh items-center justify-center overflow-x-hidden bg-surface font-body text-on-surface dark:bg-inverse-surface dark:text-inverse-on-surface px-6 py-12">
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
            {isDemo ? "Enter any username and password to try the demo." : "Enter any username and password to sign in."}
          </p>
        </div>

        <div className="w-full glass-panel p-6 md:p-8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-surface-container-high dark:border-white/10">
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
