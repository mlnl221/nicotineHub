"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Settings } from "@/lib/config/defaults";
import { useConfig } from "@/lib/config/provider";
import { useSaveSection } from "@/lib/config/save";
import { useSession } from "@/lib/session";
import { InfoTooltip, useInfoSplit } from "@/components/ui/InfoTooltip";

/**
 * Reusable settings controls bound to the config store. All are mobile-first,
 * touch-friendly, and follow the Alexandria/Material design language.
 */

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  const { isLong, first, full } = useInfoSplit(description);
  const testId = `setting-info-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
          <span>{label}</span>
          {isLong ? <InfoTooltip text={full} testId={testId} /> : null}
        </div>
        {description ? (
          <div className="mt-0.5 font-body text-xs text-on-surface-variant dark:text-outline">
            {isLong ? first : description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function ToggleControl({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <Row label={label} description={description}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-surface-container-highest dark:bg-surface-variant"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface-container-lowest shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </Row>
  );
}

export function TextFieldControl({
  value,
  onChange,
  label,
  description,
  placeholder,
  inputMode,
  multiline,
  onReset,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  description?: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "url";
  multiline?: boolean;
  onReset?: () => void;
}) {
  const inputClass =
    "w-full rounded-xl bg-surface-container-lowest px-4 py-3 font-body text-sm text-on-surface placeholder:text-outline ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
  const field = multiline ? (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={4}
      className={`${inputClass} resize-none`}
    />
  ) : (
    <input
      value={value}
      inputMode={inputMode}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className={inputClass}
    />
  );

  const { isLong: isLongTf, first: firstTf, full: fullTf } = useInfoSplit(description);
  const testIdTf = `setting-info-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
          <span>{label}</span>
          {isLongTf ? <InfoTooltip text={fullTf} testId={testIdTf} /> : null}
        </span>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="font-label text-[11px] uppercase tracking-widest text-tertiary hover:underline dark:text-tertiary-fixed"
          >
            Reset
          </button>
        ) : null}
      </div>
      {description ? (
        <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">
          {isLongTf ? firstTf : description}
        </div>
      ) : null}
      {field}
    </div>
  );
}

export function NumberControl({
  value,
  onChange,
  label,
  description,
  min,
  max,
  step,
  onReset,
  hideSlider,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  onReset?: () => void;
  hideSlider?: boolean;
}) {
  const clamp = (v: number) => Math.min(max ?? v, Math.max(min ?? v, v));
  const { isLong: isLongNum, first: firstNum, full: fullNum } = useInfoSplit(description);
  const testIdNum = `setting-info-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
          <span>{label}</span>
          {isLongNum ? <InfoTooltip text={fullNum} testId={testIdNum} /> : null}
        </span>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="font-label text-[11px] uppercase tracking-widest text-tertiary hover:underline dark:text-tertiary-fixed"
          >
            Reset
          </button>
        ) : null}
      </div>
      {description ? (
        <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">
          {isLongNum ? firstNum : description}
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          className="w-28 rounded-xl bg-surface-container-lowest px-4 py-3 font-body text-sm text-on-surface ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {typeof min === "number" && typeof max === "number" && !hideSlider ? (
          <input
            type="range"
            min={min}
            max={max}
            step={step ?? 1}
            value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value)))}
            className="flex-1 accent-primary"
          />
        ) : null}
      </div>
    </div>
  );
}

export function SelectControl<T extends string | number>({
  value,
  onChange,
  label,
  description,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  label: string;
  description?: string;
  options: { value: T; label: string }[];
}) {
  return (
    <Row label={label} description={description}>
      <select
        value={String(value)}
        onChange={(e) => {
          const match = options.find(
            (o) => String(o.value) === e.target.value,
          );
          if (match) onChange(match.value);
        }}
        className="rounded-xl bg-surface-container-lowest px-3 py-2.5 font-label text-sm text-on-surface ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:text-inverse-on-surface"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function RadioGroupControl<T extends string | number>({
  value,
  onChange,
  label,
  description,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  label: string;
  description?: string;
  options: { value: T; label: string }[];
}) {
  const { isLong: isLongRadio, first: firstRadio, full: fullRadio } = useInfoSplit(description);
  const testIdRadio = `setting-info-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="py-4">
      <div className="flex items-center gap-1.5 font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
        <span>{label}</span>
        {isLongRadio ? <InfoTooltip text={fullRadio} testId={testIdRadio} /> : null}
      </div>
      {description ? (
        <div className="mt-0.5 font-body text-xs text-on-surface-variant dark:text-outline">
          {isLongRadio ? firstRadio : description}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => onChange(o.value)}
              className={`rounded-xl px-4 py-2.5 font-label text-xs uppercase tracking-widest transition-all ${
                active
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high dark:bg-surface-variant dark:text-outline dark:hover:bg-surface-container-highest"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-surface-container-low shadow-sm dark:bg-surface-container-high">
      <header className="border-b border-surface-container-high px-5 py-4 dark:border-surface-container-highest/40">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-headline text-lg font-semibold text-on-surface dark:text-inverse-primary">
            {title}
          </h2>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {description ? (
          <p className="mt-1 font-body text-xs text-on-surface-variant dark:text-outline">
            {description}
          </p>
        ) : null}
      </header>
      <div className="divide-y divide-surface-container-high px-5 dark:divide-surface-container-highest/40">
        {children}
      </div>
    </section>
  );
}

/**
 * Per-section Save button for SectionCard headers. Enabled only when the
 * section draft differs from last-saved; pushes to the bridge (awaiting acks
 * when connected) and commits locally. Sections with bespoke flows (listening
 * port hot-swap, worker tokens) pass `dirty` + `onSave` overrides.
 */
export function SectionSaveButton({
  section,
  sections,
  dirty: dirtyOverride,
  onSave: onSaveOverride,
}: {
  /** Settings section for generic save; optional when `onSave` override is provided (e.g. worker tokens). */
  section?: keyof Settings;
  /** Save multiple settings sections from one card (e.g. Chat — General spans server/chatrooms/privatechat/logging). */
  sections?: (keyof Settings)[];
  dirty?: boolean;
  onSave?: () => Promise<void>;
}) {
  const { settings, isDirty } = useConfig();
  const saveSection = useSaveSection();
  const { state } = useSession();
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const list = sections ?? (section ? [section] : []);
  const dirty = dirtyOverride ?? list.some((s) => isDirty(s));

  useEffect(() => {
    if (dirty) {
      setPhase("idle");
      setError(null);
    }
  }, [dirty]);

  useEffect(() => {
    if (phase !== "saved") return;
    const t = setTimeout(() => setPhase("idle"), 2500);
    return () => clearTimeout(t);
  }, [phase]);

  const handleSave = async () => {
    if (phase === "saving") return;
    setPhase("saving");
    setError(null);
    try {
      if (onSaveOverride) await onSaveOverride();
      else for (const s of list) await saveSection(s, () => settings);
      setPhase("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setPhase("error");
    }
  };

  const label = phase === "saving" ? "Saving…" : phase === "saved" ? "Saved ✓" : "Save";
  return (
    <span className="flex items-center gap-2">
      {phase === "error" && error ? (
        <span title={error} className="max-w-40 truncate font-body text-xs text-error">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || phase === "saving" || phase === "saved"}
        title={state.status !== "connected" ? "Bridge offline — saves locally, syncs on connect" : dirty ? "Save changes" : "No unsaved changes"}
        className={`rounded-xl px-4 py-2 font-label text-xs uppercase tracking-widest transition-all ${
          phase === "saved"
            ? "bg-primary-container text-on-primary-container"
            : dirty
              ? "bg-primary text-on-primary"
              : "bg-surface-container-high text-outline"
        } disabled:opacity-60`}
      >
        {label}
      </button>
    </span>
  );
}
