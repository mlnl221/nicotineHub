"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

/** Internal destinations only — blocks open redirects via crafted ?next=. */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  } catch {}
  return null;
}

export function HomeRedirect() {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") return;
    // Read from window.location (not useSearchParams) so this
    // prerendered page needs no Suspense boundary.
    let next: string | null = null;
    try {
      next = safeNext(new URLSearchParams(window.location.search).get("next"));
    } catch {}
    router.replace(next ?? "/search");
  }, [state.status, router]);

  return null;
}
