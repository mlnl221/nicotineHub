"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { markOnboardingDone } from "@/lib/onboarding";
import {
  AppearanceStep,
  CaptchaStep,
  LeechersStep,
  ScraperStep,
  SharesStep,
  WelcomeStep,
  type StepNav,
} from "./steps";

const STEPS: { id: string; label: string; render: (nav: StepNav) => ReactNode }[] = [
  { id: "welcome", label: "Welcome", render: (nav) => <WelcomeStep {...nav} /> },
  { id: "shares", label: "Shares", render: (nav) => <SharesStep {...nav} /> },
  { id: "leechers", label: "Leechers", render: (nav) => <LeechersStep {...nav} /> },
  { id: "captcha", label: "Captcha", render: (nav) => <CaptchaStep {...nav} /> },
  { id: "appearance", label: "Appearance", render: (nav) => <AppearanceStep {...nav} /> },
  { id: "keys", label: "Keys", render: (nav) => <ScraperStep {...nav} /> },
];

/** Apple-style first-run flow: one idea per screen, dots, single primary action. */
export function OnboardingWizard({ next }: { next: string | null }) {
  const [index, setIndex] = useState(0);
  const router = useRouter();

  const finish = useCallback(() => {
    markOnboardingDone();
    router.replace(next ?? "/search");
  }, [router, next]);

  const nav: StepNav = {
    onNext: () => {
      if (index >= STEPS.length - 1) finish();
      else setIndex((i) => i + 1);
    },
    onBack: () => setIndex((i) => Math.max(0, i - 1)),
    isFirst: index === 0,
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center bg-surface px-4 py-6 font-body text-on-surface dark:bg-inverse-surface dark:text-inverse-on-surface pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-[calc(1.5rem+env(safe-area-inset-top,0px))]">
      {/* Ambient background (same language as login) */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-20"
        style={{
          backgroundImage: "radial-gradient(circle at 50% -20%, rgba(51,102,204,0.15) 0%, transparent 60%)",
        }}
      />
      <div className="relative z-10 flex w-full max-w-md flex-1 flex-col">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-label text-[11px] font-bold uppercase tracking-widest text-on-surface-variant dark:text-outline">
            Setup · {index + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            onClick={finish}
            className="font-label text-xs uppercase tracking-widest text-on-surface-variant hover:underline dark:text-outline"
          >
            Skip — I know what I&apos;m doing
          </button>
        </div>
        {/* Progress dots */}
        <div className="mb-6 flex items-center gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              title={s.label}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= index ? "bg-primary" : "bg-surface-container-highest dark:bg-surface-variant"
              }`}
            />
          ))}
        </div>
        <div className="glass-panel flex-1 rounded-2xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)] md:p-8">
          {STEPS[index].render(nav)}
        </div>
      </div>
    </div>
  );
}
