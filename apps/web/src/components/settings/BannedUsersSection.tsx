"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, TextFieldControl } from "@/components/settings/controls";

export function BannedUsersSection() {
  const { settings, setOption } = useConfig();
  const server = settings.server;
  const t = settings.transfers;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Banned users" description="Users and IPs blocked from your shares/uploads. Wildcards (*) are allowed for IPs.">
        <TextFieldControl
          label="Banned usernames (one per line)"
          value={server.banlist.join("\n")}
          multiline
          placeholder="baduser&#10;spammer"
          onChange={(v) => setOption("server", "banlist", v.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
        <TextFieldControl
          label="Banned IPs (one per line, IP → user mapping)"
          description="Format: 1.2.3.4 or 1.2.3.* — stored as ip→username dict; usernames are resolved when possible."
          value={Object.entries(server.ipblocklist)
            .map(([ip, user]) => (user ? `${ip} | ${user}` : ip))
            .join("\n")}
          multiline
          placeholder="192.168.1.10&#10;10.0.0.*"
          onChange={(v) => {
            const obj: Record<string, string> = {};
            for (const line of v.split("\n")) {
              const [ip, ...rest] = line.split("|");
              const trimmed = ip.trim();
              if (!trimmed) continue;
              obj[trimmed] = rest.join("|").trim();
            }
            setOption("server", "ipblocklist", obj);
          }}
        />
        <ToggleControl
          label="Custom ban message"
          checked={t.usecustomban}
          onChange={(v) => setOption("transfers", "usecustomban", v)}
        />
        <TextFieldControl
          label="Ban message"
          value={t.customban}
          onChange={(v) => setOption("transfers", "customban", v)}
          onReset={() => setOption("transfers", "customban", defaults.transfers.customban)}
        />
      </SectionCard>

      <SectionCard title="Geo blocking">
        <ToggleControl
          label="Enable geo blocking"
          checked={t.geoblock}
          onChange={(v) => setOption("transfers", "geoblock", v)}
        />
        <TextFieldControl
          label="Blocked country code"
          description="ISO country code, e.g. US. Stored as single-element array geoblockcc."
          value={t.geoblockcc[0] ?? ""}
          onChange={(v) => setOption("transfers", "geoblockcc", [v.toUpperCase()])}
          onReset={() => setOption("transfers", "geoblockcc", defaults.transfers.geoblockcc)}
        />
        <ToggleControl
          label="Custom geo block message"
          checked={t.usecustomgeoblock}
          onChange={(v) => setOption("transfers", "usecustomgeoblock", v)}
        />
        <TextFieldControl
          label="Geo block message"
          value={t.customgeoblock}
          onChange={(v) => setOption("transfers", "customgeoblock", v)}
          onReset={() => setOption("transfers", "customgeoblock", defaults.transfers.customgeoblock)}
        />
      </SectionCard>
    </div>
  );
}
