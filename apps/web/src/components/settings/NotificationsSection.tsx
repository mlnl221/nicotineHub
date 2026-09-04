"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/lib/config/provider";
import { SectionCard, SectionSaveButton, ToggleControl } from "@/components/settings/controls";

export function NotificationsSection() {
  const { settings, setOption } = useConfig();
  const n = settings.notifications;
  const [perm, setPerm] = useState<string>(() => typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [swReady, setSwReady] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // try register minimal sw for push display
      navigator.serviceWorker.register("/sw.js").then(() => setSwReady(true)).catch(() => setSwReady(false));
    }
  }, []);

  const requestPush = async () => {
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p === "granted" && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        // show test notification via SW if possible
        try { await reg.showNotification("Nicotine Hub", { body: "Notifications enabled", icon: "/icon-192.png" }); } catch {}
      }
    } catch {}
  };

  return (
    <SectionCard
      title="Notifications"
      description="Choose which events raise a browser notification or sound. Web Push uses Service Worker when available."
      actions={<SectionSaveButton section="notifications" />}
    >
      <div className="rounded-xl bg-surface-container-low p-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-label text-xs font-bold">Web Push permission</p>
          <p className="font-body text-xs text-on-surface-variant">Browser {perm} {swReady ? "• SW ready" : "• no SW"}</p>
        </div>
        <button onClick={requestPush} className="rounded-full bg-primary px-4 py-2 font-label text-xs font-bold text-on-primary">Enable</button>
      </div>
      <ToggleControl
        label="Window title"
        description="Show an alert in the document title."
        checked={n.notification_window_title}
        onChange={(v) => setOption("notifications", "notification_window_title", v)}
      />
      <ToggleControl
        label="Tab colors"
        description="Highlight tabs with notification colors (mirrors notification_tab_colors)."
        checked={n.notification_tab_colors}
        onChange={(v) => setOption("notifications", "notification_tab_colors", v)}
      />
      <ToggleControl
        label="Sound"
        checked={n.notification_popup_sound}
        onChange={(v) => setOption("notifications", "notification_popup_sound", v)}
      />
      <ToggleControl
        label="File download"
        checked={n.notification_popup_file}
        onChange={(v) => setOption("notifications", "notification_popup_file", v)}
      />
      <ToggleControl
        label="Folder download"
        checked={n.notification_popup_folder}
        onChange={(v) => setOption("notifications", "notification_popup_folder", v)}
      />
      <ToggleControl
        label="Queued upload"
        checked={n.notification_popup_queued_upload}
        onChange={(v) => setOption("notifications", "notification_popup_queued_upload", v)}
      />
      <ToggleControl
        label="Private message"
        checked={n.notification_popup_private_message}
        onChange={(v) => setOption("notifications", "notification_popup_private_message", v)}
      />
      <ToggleControl
        label="Private mention"
        checked={n.notification_popup_private_mention}
        onChange={(v) => setOption("notifications", "notification_popup_private_mention", v)}
      />
      <ToggleControl
        label="Chat room"
        checked={n.notification_popup_chatroom}
        onChange={(v) => setOption("notifications", "notification_popup_chatroom", v)}
      />
      <ToggleControl
        label="Chat room mention"
        checked={n.notification_popup_chatroom_mention}
        onChange={(v) => setOption("notifications", "notification_popup_chatroom_mention", v)}
      />
      <ToggleControl
        label="Wishlist hit"
        checked={n.notification_popup_wish}
        onChange={(v) => setOption("notifications", "notification_popup_wish", v)}
      />
    </SectionCard>
  );
}
