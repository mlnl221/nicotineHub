"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTransfers, DOWNLOAD_CLEAR_SETS, UPLOAD_CLEAR_SETS } from "@/lib/transfers";
import { useSearchesOptional } from "@/lib/search";

export const HOTKEY_LIST: Array<{ keys: string; label: string }> = [
  { keys: "g then s", label: "Go to Search" },
  { keys: "g then d", label: "Go to Downloads" },
  { keys: "g then u", label: "Go to Uploads" },
  { keys: "g then f", label: "Go to Files" },
  { keys: "g then c", label: "Go to Private Chat" },
  { keys: "g then b", label: "Go to Browse" },
  { keys: "g then e", label: "Go to Buddies" },
  { keys: "g then r", label: "Go to Chat Rooms" },
  { keys: "g then i", label: "Go to Profiles" },
  { keys: "g then ,", label: "Go to Settings" },
  { keys: "Alt+1…5", label: "Jump to Search / Downloads / Uploads / Files / Chat" },
  { keys: "/", label: "Focus search field" },
  { keys: "Ctrl+K", label: "Focus search field" },
  { keys: "s", label: "Stop active search" },
  { keys: "Shift+S", label: "Retry active search" },
  { keys: "p", label: "Pause all active downloads" },
  { keys: "r", label: "Resume / retry all paused downloads" },
  { keys: "Delete", label: "Clear finished transfers" },
  { keys: "j / k", label: "Move selection in Downloads / Uploads / Files" },
  { keys: "?", label: "Show / hide this help" },
];

const NAV: Record<string, string> = {
  s: "/search",
  d: "/downloads",
  u: "/uploads",
  f: "/files",
  c: "/private-chat",
  b: "/browse",
  e: "/buddies",
  r: "/chat",
  i: "/profile",
  ",": "/settings",
};

const PRIMARY = ["/search", "/downloads", "/uploads", "/files", "/private-chat"];

const PAUSABLE = new Set(["Transferring", "Getting status", "Queued"]);
const RESUMABLE = new Set(["Paused", "Cancelled", "Connection closed", "Connection timeout"]);

function isEditable(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function toast(title: string, body: string) {
  window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title, body } }));
}

function focusSearch(): boolean {
  const el = document.querySelector<HTMLInputElement>("[data-search-input]");
  if (el) {
    el.focus();
    el.select?.();
    return true;
  }
  return false;
}

export function Hotkeys() {
  const router = useRouter();
  const { downloads, pauseDownload, resumeDownload, retryDownload, clearMany } = useTransfers();
  const searches = useSearchesOptional();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingG = useRef<number>(0);

  const pauseAll = useCallback(() => {
    const targets = downloads.filter((t) => PAUSABLE.has(t.status));
    targets.forEach((t) => pauseDownload(t.id));
    toast("Pause all", targets.length ? `Paused ${targets.length} download${targets.length === 1 ? "" : "s"}` : "No active downloads");
  }, [downloads, pauseDownload]);

  const resumeAll = useCallback(() => {
    const targets = downloads.filter((t) => RESUMABLE.has(t.status));
    targets.forEach((t) => (t.status === "Paused" ? resumeDownload(t.id) : retryDownload(t.id)));
    toast("Resume all", targets.length ? `Resumed ${targets.length} download${targets.length === 1 ? "" : "s"}` : "No paused downloads");
  }, [downloads, resumeDownload, retryDownload]);

  const clearFinished = useCallback(() => {
    clearMany(false, DOWNLOAD_CLEAR_SETS["finished-filtered"] ?? null);
    clearMany(true, UPLOAD_CLEAR_SETS["finished-cancelled"] ?? null);
    toast("Clear finished", "Cleared finished transfers");
  }, [clearMany]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = document.activeElement;
      const editing = isEditable(target);

      // Ctrl/Cmd+K works everywhere (even in inputs)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!focusSearch()) {
          router.push("/search");
          window.setTimeout(focusSearch, 300);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      // Alt+1..5 primary tabs
      if (e.altKey && ["1", "2", "3", "4", "5"].includes(e.key)) {
        e.preventDefault();
        router.push(PRIMARY[Number(e.key) - 1]);
        pendingG.current = 0;
        return;
      }
      if (e.altKey) return;

      // Pending g-sequence second key
      if (pendingG.current && Date.now() - pendingG.current < 900) {
        pendingG.current = 0;
        if (editing) return;
        const dest = NAV[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }
      pendingG.current = 0;
      if (editing) return;

      switch (e.key) {
        case "g":
        case "G":
          pendingG.current = Date.now();
          break;
        case "/":
          e.preventDefault();
          if (!focusSearch()) {
            router.push("/search");
            window.setTimeout(focusSearch, 300);
          }
          break;
        case "?":
          e.preventDefault();
          setHelpOpen((v) => !v);
          break;
        case "p":
        case "P":
          e.preventDefault();
          pauseAll();
          break;
        case "r":
        case "R":
          e.preventDefault();
          resumeAll();
          break;
        case "s":
          e.preventDefault();
          if (searches?.activeTab && searches.activeTab.status === "searching") {
            searches.stopSearch(searches.activeTab.id);
            toast("Search stopped", searches.activeTab.query);
          } else toast("Stop search", "No active search");
          break;
        case "S":
          e.preventDefault();
          if (searches?.activeTab) {
            searches.retrySearch(searches.activeTab.id);
            toast("Search retried", searches.activeTab.query);
          } else toast("Retry search", "No search tab");
          break;
        case "Delete":
        case "Backspace":
          // ponytail: Backspace doubles as Clear on keyboards without Delete
          e.preventDefault();
          clearFinished();
          break;
        case "Escape":
          setHelpOpen(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pauseAll, resumeAll, clearFinished, searches]);

  // `?` needs shift on most layouts — keypress reports "?" with shiftKey set,
  // but the switch above already handles it since shift-only modifiers fall through.
  useEffect(() => {
    const onToggle = () => setHelpOpen((v) => !v);
    window.addEventListener("nicotineHub:hotkeys-help", onToggle);
    return () => window.removeEventListener("nicotineHub:hotkeys-help", onToggle);
  }, []);

  if (!helpOpen) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="hotkeys-help" onClick={() => setHelpOpen(false)}>
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-4 shadow-xl ghost-border dark:bg-surface-container-high" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-headline text-lg font-semibold">Keyboard shortcuts</h2>
          <button type="button" aria-label="Close shortcuts" onClick={() => setHelpOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {HOTKEY_LIST.map((h) => (
            <li key={h.keys} className="flex items-center justify-between gap-3 py-1">
              <span className="font-body text-sm">{h.label}</span>
              <kbd className="shrink-0 rounded-md bg-surface-container-high px-2 py-1 font-label text-xs font-semibold">{h.keys}</kbd>
            </li>
          ))}
        </ul>
        <p className="mt-2 font-body text-xs text-outline">Keys are ignored while typing. <kbd className="rounded bg-surface-container-high px-1 font-semibold">Esc</kbd> closes dialogs.</p>
      </div>
    </div>
  );
}
