"use client";

import Link from "next/link";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";

type Props = {
  title: string;
  subtitle?: string;
  meta?: string;
  /** e.g. "2 active • Monitoring 2 connections" — will be split for mobile pill */
  mobileSubtitle?: string;
  desktopSubtitle?: string;
  downloadSpeed?: string;
  uploadSpeed?: string;
  showSpeeds?: boolean;
  settingsHref?: string;
  actions?: React.ReactNode;
};

export function PageHeader({
  title,
  subtitle,
  meta,
  mobileSubtitle,
  desktopSubtitle,
  downloadSpeed,
  uploadSpeed,
  showSpeeds = false,
  settingsHref,
  actions,
}: Props) {
  return (
    <header className="hidden md:flex sticky top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
      <div className="min-w-0 flex-1">
        <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight truncate">{title}</h2>
        {(subtitle || mobileSubtitle || desktopSubtitle || meta) ? (
          <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">
            {mobileSubtitle && desktopSubtitle ? (
              <>
                {mobileSubtitle}{" "}
                <span className="md:hidden font-label text-xs">{downloadSpeed ?? "—"} ↓ • {uploadSpeed ?? "—"} ↑</span>
                <span className="hidden md:inline">{desktopSubtitle}</span>
              </>
            ) : subtitle ? (
              subtitle
            ) : null}
            {meta ? <span className="ml-1 text-outline">• {meta}</span> : null}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        {showSpeeds ? (
          <>
            <div data-testid="download-speed" className="hidden md:flex bg-surface-container-low dark:bg-surface-container-high px-4 py-2 rounded-full md:rounded-lg items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">arrow_downward</span>
              <span className="font-label font-semibold text-xs md:text-sm">{downloadSpeed ?? "—"}</span>
            </div>
            <div data-testid="upload-speed" className="hidden md:flex bg-surface-container-low dark:bg-surface-container-high px-4 py-2 rounded-full md:rounded-lg items-center gap-2">
              <span className="material-symbols-outlined text-tertiary text-[18px]">arrow_upward</span>
              <span className="font-label font-semibold text-xs md:text-sm">{uploadSpeed ?? "—"}</span>
            </div>
          </>
        ) : null}
        {actions}
        <ThemeToggleButton />
        {settingsHref ? (
          <Link
            href={settingsHref}
            className="hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center shrink-0"
            aria-label="Settings"
          >
            <span className="material-symbols-outlined">settings</span>
          </Link>
        ) : null}
      </div>
    </header>
  );
}
