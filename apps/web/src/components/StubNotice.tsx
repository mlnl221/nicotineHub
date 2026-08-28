"use client";

export function StubNotice({
  title,
  icon,
  description,
}: {
  title: string;
  icon: string;
  description?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
      <div
        data-testid="stub-notice"
        role="status"
        aria-live="polite"
        className="w-full max-w-lg rounded-xl bg-surface p-8 text-center ghost-border dark:bg-surface-container-low sm:p-10"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/20 dark:bg-primary-container/30">
          <span className="material-symbols-outlined text-2xl text-primary dark:text-primary-fixed">{icon}</span>
        </div>
        <h2 className="font-headline text-xl font-semibold text-on-surface dark:text-on-surface">{title}</h2>
        {description ? (
          <p className="mt-2 font-body text-sm text-on-surface-variant dark:text-outline">{description}</p>
        ) : null}
        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-tertiary-fixed/30 px-4 py-2 dark:bg-tertiary-container/20">
          <span className="material-symbols-outlined text-[18px] text-tertiary">construction</span>
          <span className="font-label text-xs font-semibold uppercase tracking-widest text-on-tertiary-container dark:text-tertiary-fixed">
            This page has not been implemented yet
          </span>
        </div>
      </div>
    </div>
  );
}
