"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

function Spinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/**
 * Gate for protected pages. Redirects to the login page (preserving the
 * destination via `?next=`) once first-run resolution completes without a
 * session — this covers both `idle` (no stored creds, nothing pending) and
 * `failed`. Background reconnects (`reconnecting`) keep rendering children.
 *
 * Reads the destination from window.location inside the effect (instead of
 * usePathname/useSearchParams) so statically prerendered pages need no
 * Suspense boundary.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const router = useRouter();
  const redirected = useRef(false);

  const settled = state.initialized === true && state.status !== "connecting";
  const authed = state.status === "connected";
  const backgroundRetry = state.reconnecting === true;

  useEffect(() => {
    if (authed) {
      redirected.current = false;
      return;
    }
    if (!settled || backgroundRetry || redirected.current) return;
    redirected.current = true;
    const here = window.location.pathname + window.location.search;
    router.replace(here && here !== "/" ? `/?next=${encodeURIComponent(here)}` : "/");
  }, [settled, authed, backgroundRetry, router]);

  if (!settled) return <Spinner />;
  if (authed || backgroundRetry) return <>{children}</>;
  return null;
}
