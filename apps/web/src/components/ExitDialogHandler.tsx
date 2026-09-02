"use client";

import { useEffect } from "react";
import { useConfig } from "@/lib/config/provider";

/**
 * Mirrors nicotine-plus ui.exitdialog:
 * 0 = Quit (no confirm), 1 = Show confirmation (beforeunload), 2 = Run in background (no confirm, keep session)
 * Web can only implement "show confirmation" via beforeunload prompt.
 */
export function ExitDialogHandler() {
  const { settings, hasUnsavedChanges } = useConfig();
  const mode = settings.ui.exitdialog ?? 0;

  useEffect(() => {
    if (mode !== 1 || !hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [mode, hasUnsavedChanges]);

  return null;
}
