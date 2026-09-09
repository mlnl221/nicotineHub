"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defaults, migrateLogDir, migrateLoggingDirsToConfig, type Settings } from "@/lib/config/defaults";
import { deepMerge } from "@/lib/config/merge";
import { getLocal, setLocal } from "@/lib/storage";

const STORAGE_KEY = "nicotineHub.settings";
// One-time flip: publicFiles default was false, now true. Stored false is
// indistinguishable from explicit opt-out, so migrate once (marker) and let
// later opt-outs stick.
const PUBLIC_ONLY_MIGRATION_KEY = "nicotineHub.settingsMigrated.publicOnlyDefault";
export function migratePublicOnlyDefault<S extends { searches?: { defilter?: { publicFiles?: boolean } } }>(
  merged: S,
  alreadyMigrated: boolean,
): S {
  if (alreadyMigrated || merged.searches?.defilter?.publicFiles !== false) return merged;
  return { ...merged, searches: { ...merged.searches, defilter: { ...merged.searches.defilter, publicFiles: true } } };
}
function readStored(): Settings {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = getLocal(STORAGE_KEY);
    if (!raw) return defaults;
    const merged = migrateLoggingDirsToConfig(deepMerge(defaults, JSON.parse(raw)));
    const out = migratePublicOnlyDefault(merged, getLocal(PUBLIC_ONLY_MIGRATION_KEY) !== null);
    setLocal(PUBLIC_ONLY_MIGRATION_KEY, "1");
    return out;
  } catch {
    return defaults;
  }
}

/**
 * Keys that change outside the settings UI (search history, window geometry).
 * They persist to localStorage but never mark their section dirty — there is
 * nothing for the user to "save" for these.
 */
const VOLATILE_KEYS: Partial<Record<keyof Settings, readonly string[]>> = {
  searches: ["history"],
  ui: ["width", "height", "xposition", "yposition", "maximized"],
};

function stripVolatile<S extends keyof Settings>(section: S, value: Settings[S]): Settings[S] {
  const skip = VOLATILE_KEYS[section];
  if (!skip || typeof value !== "object" || value === null) return value;
  const out = { ...(value as Record<string, unknown>) };
  for (const k of skip) delete out[k];
  return out as Settings[S];
}

const stable = (v: unknown): string => JSON.stringify(v);

interface ConfigApi {
  /** Live draft — every control binds here. Edits stay local until saved. */
  settings: Settings;
  /** Last-saved snapshot (localStorage + bridge). */
  saved: Settings;
  isDirty: (section: keyof Settings) => boolean;
  hasUnsavedChanges: boolean;
  setOption: <S extends keyof Settings, K extends keyof Settings[S]>(
    section: S,
    key: K,
    value: Settings[S][K],
  ) => void;
  setSection: <S extends keyof Settings>(section: S, patch: Partial<Settings[S]>) => void;
  /** Mark a section saved after its save flow (localStorage + bridge push) completed. */
  markSectionSaved: (section: keyof Settings, snapshot?: Settings[typeof section]) => void;
  /**
   * Reconcile durable bridge state (config:get) into local settings.
   * Only fills keys that are still at defaults locally — never clobbers
   * user-saved values or pending drafts. Adopted values count as saved.
   */
  applyBridgedState: (remote: Record<string, Record<string, unknown>>) => void;
  resetSection: <S extends keyof Settings>(section: S) => void;
  resetAll: () => void;
}

const ConfigContext = createContext<ConfigApi | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [saved, setSaved] = useState<Settings>(defaults);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hydrated = useRef(false);

  useEffect(() => {
    const stored = readStored();
    setSettings(stored);
    setSaved(stored);
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore quota/serialization errors; settings stay in-memory.
    }
  }, [settings]);

  const setOption = useCallback<ConfigApi["setOption"]>((section, key, value) => {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  }, []);

  const setSection = useCallback<ConfigApi["setSection"]>((section, patch) => {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], ...patch },
    }));
  }, []);

  const isDirty = useCallback(
    (section: keyof Settings) =>
      stable(stripVolatile(section, settings[section])) !== stable(stripVolatile(section, saved[section])),
    [settings, saved],
  );

  const hasUnsavedChanges = useMemo(
    () => (Object.keys(settings) as (keyof Settings)[]).some((s) => stable(stripVolatile(s, settings[s])) !== stable(stripVolatile(s, saved[s]))),
    [settings, saved],
  );

  const markSectionSaved = useCallback((section: keyof Settings, snapshot?: Settings[typeof section]) => {
    // Accept the exact snapshot the save flow pushed — settingsRef can still be
    // pre-setOption when setOption + save run back-to-back in the same tick.
    const current = snapshot ?? settingsRef.current[section];
    setSaved((prev) => ({ ...prev, [section]: current }));
  }, []);

  const applyBridgedState = useCallback((remote: Record<string, Record<string, unknown>>) => {
    if (!remote || typeof remote !== "object") return;
    const prevSettings = settingsRef.current;
    let nextSettings = prevSettings;
    let nextSaved: Settings | null = null;
    for (const [section, keys] of Object.entries(remote)) {
      if (!(section in defaults) || !keys || typeof keys !== "object") continue;
      const s = section as keyof Settings;
      const local = nextSettings[s] as Record<string, unknown>;
      const base = defaults[s] as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(keys)) {
        if (!(k in base)) continue; // unknown key — ignore, defaults win
        const nv = s === "logging" ? migrateLogDir(v) : v;
        if (stable(local[k]) === stable(base[k])) patch[k] = nv; // still default locally → adopt bridge value
      }
      if (Object.keys(patch).length > 0) {
        const merged = { ...(local as object), ...patch };
        nextSettings = { ...nextSettings, [s]: merged };
        nextSaved = { ...(nextSaved ?? savedRef.current), [s]: merged };
      }
    }
    if (nextSaved) {
      setSettings(nextSettings);
      setSaved(nextSaved);
    }
  }, []);

  const savedRef = useRef(saved);
  savedRef.current = saved;

  const resetSection = useCallback<ConfigApi["resetSection"]>((section) => {
    setSettings((prev) => ({ ...prev, [section]: { ...defaults[section] } }));
  }, []);

  const resetAll = useCallback(() => {
    setSettings(defaults);
  }, []);

  const api = useMemo<ConfigApi>(
    () => ({ settings, saved, isDirty, hasUnsavedChanges, setOption, setSection, markSectionSaved, applyBridgedState, resetSection, resetAll }),
    [settings, saved, isDirty, hasUnsavedChanges, setOption, setSection, markSectionSaved, applyBridgedState, resetSection, resetAll],
  );

  return <ConfigContext.Provider value={api}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigApi {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
