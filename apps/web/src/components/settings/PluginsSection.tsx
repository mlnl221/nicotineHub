"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, ToggleControl } from "@/components/settings/controls";

export function PluginsSection() {
  const { settings, setOption } = useConfig();

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Plugins"
        description="Desktop Nicotine+ supports Python plugins (plugin.ui, preferences.py:3414, pynicotine/plugins). The browser build has no plugin runtime — enable is stored locally for future bridge parity."
      >
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          No plugins in the browser build. Installed plugins, per-plugin settings, and enable/disable per plugin are desktop-only. This master toggle is a placeholder stored in{" "}
          <span className="font-mono">plugins.enable</span> (<span className="font-mono">plugins.enabled</span> list omitted — desktop only). See{" "}
          <a href="https://nicotine-plus.org" target="_blank" rel="noreferrer" className="underline hover:text-primary">
            nicotine-plus.org
          </a>{" "}
          for available plugins.
        </div>
        <ToggleControl
          label="Enable plugins"
          description="Master switch — no effect in browser yet; persisted for bridge parity."
          checked={settings.plugins.enable}
          onChange={(v) => setOption("plugins", "enable", v)}
        />
      </SectionCard>

      <SectionCard title="Installed plugins" description="Desktop plugin list — no runtime in browser.">
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          No plugins available in this build. Desktop plugins (e.g. slskd, auto-join, etc.) require Python and are managed via <span className="font-mono">pluginsettings</span> dialog in Nicotine+. Install/uninstall and per-plugin settings are intentionally omitted.
        </div>
      </SectionCard>
    </div>
  );
}
