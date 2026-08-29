"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, ToggleControl } from "@/components/settings/controls";

export function NotificationsSection() {
  const { settings, setOption } = useConfig();
  const n = settings.notifications;

  return (
    <SectionCard
      title="Notifications"
      description="Choose which events raise a browser notification or sound."
    >
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
