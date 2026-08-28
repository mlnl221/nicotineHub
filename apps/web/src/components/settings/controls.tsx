"use client";

import type { ReactNode } from "react";

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
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
          {label}
        </div>
        {description ? (
          <div className="mt-0.5 font-body text-xs text-on-surface-variant dark:text-outline">
            {description}
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

  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
          {label}
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
          {description}
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
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  onReset?: () => void;
}) {
  const clamp = (v: number) => Math.min(max ?? v, Math.max(min ?? v, v));
  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
          {label}
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
          {description}
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
        {typeof min === "number" && typeof max === "number" ? (
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
  return (
    <div className="py-4">
      <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
        {label}
      </div>
      {description ? (
        <div className="mt-0.5 font-body text-xs text-on-surface-variant dark:text-outline">
          {description}
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
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-surface-container-low shadow-sm dark:bg-surface-container-high">
      <header className="border-b border-surface-container-high px-5 py-4 dark:border-surface-container-highest/40">
        <h2 className="font-headline text-lg font-semibold text-on-surface dark:text-inverse-primary">
          {title}
        </h2>
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
