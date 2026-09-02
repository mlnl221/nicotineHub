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
import { defaults, type Settings } from "@/lib/config/defaults";
import { deepMerge } from "@/lib/config/merge";
import { getLocal } from "@/lib/storage";

const STORAGE_KEY = "nicotineHub.settings";
function readStored(): Settings {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = getLocal(STORAGE_KEY);
    if (!raw) return defaults;
    return deepMerge(defaults, JSON.parse(raw));
  } catch {
    return defaults;
  }
}

interface ConfigApi {
  settings: Settings;
  setOption: <S extends keyof Settings, K extends keyof Settings[S]>(
    section: S,
    key: K,
    value: Settings[S][K],
  ) => void;
  setSection: <S extends keyof Settings>(section: S, patch: Partial<Settings[S]>) => void;
  resetSection: <S extends keyof Settings>(section: S) => void;
  resetAll: () => void;
}

const ConfigContext = createContext<ConfigApi | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const hydrated = useRef(false);

  useEffect(() => {
    setSettings(readStored());
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

  const resetSection = useCallback<ConfigApi["resetSection"]>((section) => {
    setSettings((prev) => ({ ...prev, [section]: { ...defaults[section] } }));
  }, []);

  const resetAll = useCallback(() => {
    setSettings(defaults);
  }, []);

  const api = useMemo<ConfigApi>(
    () => ({ settings, setOption, setSection, resetSection, resetAll }),
    [settings, setOption, setSection, resetSection, resetAll],
  );

  return <ConfigContext.Provider value={api}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigApi {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
