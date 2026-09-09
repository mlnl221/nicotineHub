"use client";

import { useEffect, useState } from "react";

export function matchesFine(mql: { matches: boolean } | null | undefined): boolean {
  return mql?.matches ?? false;
}

export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(pointer:fine)");
    setFine(matchesFine(mql));
    const onChange = (e: MediaQueryListEvent) => setFine(matchesFine(e));
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
  return fine;
}
