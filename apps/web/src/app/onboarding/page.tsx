"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { isOnboardingDone } from "@/lib/onboarding";

/** First-run setup guide. Already-done users bounce to search (or ?next=). */
export default function OnboardingPage() {
  const router = useRouter();
  const [next, setNext] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let dest: string | null = null;
    try {
      const raw = new URLSearchParams(window.location.search).get("next");
      if (raw) {
        const decoded = decodeURIComponent(raw);
        if (decoded.startsWith("/") && !decoded.startsWith("//")) dest = decoded;
      }
    } catch {}
    setNext(dest);
    if (isOnboardingDone()) router.replace(dest ?? "/search");
    else setChecked(true);
  }, [router]);

  if (!checked) return null;

  return (
    <RequireAuth>
      <OnboardingWizard next={next} />
    </RequireAuth>
  );
}
