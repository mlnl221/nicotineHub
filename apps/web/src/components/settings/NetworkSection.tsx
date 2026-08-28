"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults, DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from "@/lib/config/defaults";
import { SectionCard, TextFieldControl, ToggleControl, NumberControl } from "@/components/settings/controls";

export function NetworkSection() {
  const { settings, setOption } = useConfig();
  const server = settings.server;

  return (
    <SectionCard
      title="Connection"
      description="Soulseek server the bridge connects to. Credentials are never stored in the browser."
    >
      <ToggleControl
        label="Connect on startup"
        description="Auto-connect when the app opens."
        checked={server.auto_connect_startup}
        onChange={(v) => setOption("server", "auto_connect_startup", v)}
      />
      <TextFieldControl
        label="Server host"
        description="Hostname of the Soulseek server."
        value={server.server.host}
        inputMode="url"
        onChange={(v) => setOption("server", "server", { ...server.server, host: v || DEFAULT_SERVER_HOST })}
        onReset={() => setOption("server", "server", { ...server.server, host: DEFAULT_SERVER_HOST })}
      />
      <NumberControl
        label="Server port"
        description="TCP port of the Soulseek server."
        value={server.server.port}
        min={1}
        max={65535}
        onChange={(v) => setOption("server", "server", { ...server.server, port: v || DEFAULT_SERVER_PORT })}
        onReset={() => setOption("server", "server", { ...server.server, port: DEFAULT_SERVER_PORT })}
      />
      <NumberControl
        label="Idle minutes before away"
        description={`Automatically mark you away after ${defaults.server.autoaway} minutes of inactivity.`}
        value={server.autoaway}
        min={1}
        max={10000}
        step={5}
        onChange={(v) => setOption("server", "autoaway", v)}
        onReset={() => setOption("server", "autoaway", defaults.server.autoaway)}
      />
    </SectionCard>
  );
}
