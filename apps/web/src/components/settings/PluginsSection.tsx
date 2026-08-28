"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, ToggleControl } from "@/components/settings/controls";

export function PluginsSection() {
  const { settings, setOption } = useConfig();

  return (
    <SectionCard
      title="Plugins"
      description="Desktop Nicotine+ supports Python plugins (plugin.ui). The browser build has no plugin runtime — enable is stored locally for future bridge parity."
    >
      <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
        No plugins in the browser build. Installed plugins, per-plugin settings, and enable/disable per plugin are desktop-only. This toggle is a placeholder.
      </div>
      <ToggleControl
        label="Enable plugins"
        description="Master switch (no effect in browser yet)."
        checked={settings.plugins.enable}
        onChange={(v) => setOption("plugins", "enable", v)}
      />
    </SectionCard>
  );
}
