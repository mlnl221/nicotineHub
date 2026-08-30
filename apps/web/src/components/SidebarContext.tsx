"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Ctx = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
};

const SidebarContext = createContext<Ctx>({ collapsed: false, toggle: () => {}, setCollapsed: () => {} });

const STORAGE_KEY = "nicotineHub.sidebarCollapsed";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "true") setCollapsedState(true);
      // listen for other tabs
      const onStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) setCollapsedState(e.newValue === "true");
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    } catch {}
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(STORAGE_KEY, String(v));
      // update css var for fallback global override
      document.documentElement.style.setProperty("--sidebar-width", v ? "4rem" : "18rem");
      document.documentElement.classList.toggle("sidebar-collapsed", v);
    } catch {}
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  useEffect(() => {
    if (!mounted) return;
    try {
      document.documentElement.style.setProperty("--sidebar-width", collapsed ? "4rem" : "18rem");
      document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
    } catch {}
  }, [collapsed, mounted]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarCollapsed() {
  return useContext(SidebarContext);
}
