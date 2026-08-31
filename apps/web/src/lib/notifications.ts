"use client";
import { useCallback, useEffect, useRef } from "react";
import { useConfig } from "@/lib/config/provider";
import { useSession } from "@/lib/session";

/**
 * Browser notifications + in-app toasts for search wishlist/PM/chat.
 * Mirrors pynicotine/notifications.py toggles.
 */
export function useNotifications() {
  const { settings } = useConfig();
  const { subscribe } = useSession();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const maybePlaySound = useCallback(() => {
    if (!settings.notifications.notification_popup_sound) return;
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==");
      }
      audioRef.current.play().catch(() => {});
    } catch {}
  }, [settings.notifications.notification_popup_sound]);

  const maybeNotify = useCallback((title: string, body: string, enabled: boolean) => {
    if (!enabled) return;
    if (settings.notifications.notification_window_title) {
      try { document.title = `${title} — Nicotine Hub`; setTimeout(() => { document.title = "Nicotine Hub"; }, 4000); } catch {}
    }
    if (settings.notifications.notification_tab_colors) {
      try { document.documentElement.style.setProperty("--notif-flash", "#497EC2"); setTimeout(() => document.documentElement.style.removeProperty("--notif-flash"), 1500); } catch {}
    }
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        // Prefer ServiceWorker showNotification for better persistence
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.ready.then((reg) => {
            try { reg.showNotification(title, { body, icon: "/icon-192.png" }); } catch { new Notification(title, { body, icon: "/icon-192.png" }); }
          }).catch(() => { try { new Notification(title, { body, icon: "/icon-192.png" }); } catch {} });
        } else {
          new Notification(title, { body, icon: "/icon-192.png" });
        }
      } else if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title, body } }));
    } catch {}
    maybePlaySound();
  }, [settings.notifications.notification_window_title, settings.notifications.notification_tab_colors, maybePlaySound]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      const m = msg as unknown as { type: string; event?: { type: string }; transfer?: { fileName?: string } };
      if (m.type === "chat:event") {
        const ev = (m as unknown as { event: { type: string; room?: string; username?: string; message?: string } }).event;
        if (ev.type === "say-chatroom" && ev.message) {
          const isMention = settings.words.watch_keywords && settings.words.keywords.some((kw) => ev.message!.toLowerCase().includes(kw.toLowerCase()));
          if (isMention) maybeNotify(`Mention in ${ev.room}`, `${ev.username}: ${ev.message}`, settings.notifications.notification_popup_chatroom_mention);
          else maybeNotify(`Message in ${ev.room}`, `${ev.username}: ${ev.message}`, settings.notifications.notification_popup_chatroom);
        }
        if (ev.type === "private-message" && ev.message) {
          const isMention = settings.words.watch_keywords && settings.words.keywords.some((kw) => ev.message!.toLowerCase().includes(kw.toLowerCase()));
          if (isMention) maybeNotify(`Mention from ${ev.username}`, ev.message, settings.notifications.notification_popup_private_mention);
          else maybeNotify(`Private message from ${ev.username}`, ev.message, settings.notifications.notification_popup_private_message);
        }
      }
      if (m.type === "transfer:finished") {
        const fin = m as unknown as { fileName: string; size: number; downloadUrl?: string };
        // Folder vs file: heuristic — if filename contains path separator and no extension? Treat same for now; gate both toggles.
        const isFolder = fin.fileName.includes("\\") && !fin.fileName.includes(".");
        if (isFolder) maybeNotify("Folder download finished", fin.fileName, settings.notifications.notification_popup_folder);
        else maybeNotify("Download finished", fin.fileName, settings.notifications.notification_popup_file);
      }
      if (m.type === "transfer:queue") {
        const q = m as unknown as { id: string; place: number };
        maybeNotify("Upload queued", `#${q.place} in queue`, settings.notifications.notification_popup_queued_upload);
      }
      if (m.type === "transfer:update") {
        // Check queued upload notification batched — simple
        // Wishlist notification
        // Search result wishlist notification handled via search:end + wishlist terms
      }
      if (m.type === "search:result") {
        // wishlist popup if query matches wishlist term
        const sr = m as unknown as { searchId: string; rows: unknown[] };
        if (sr.searchId.startsWith("wishlist:") && (sr.rows as unknown[]).length) {
          maybeNotify("Wishlist results", `${(sr.rows as unknown[]).length} new results`, settings.notifications.notification_popup_wish);
        }
      }
    });
    return unsub;
  }, [subscribe, maybeNotify, settings]);

  return { maybeNotify };
}


