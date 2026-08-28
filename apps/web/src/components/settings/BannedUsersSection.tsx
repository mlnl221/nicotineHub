"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, TextFieldControl } from "@/components/settings/controls";

function isIpLike(s: string) {
  // Parity with pynicotine core.network_filter.is_ip_address — * wildcard allowed, IPv4-ish
  return /^(\*|\d{1,3}|\d{1,3}\.\*|\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\*|\d{1,3}\.\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\*|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(s.trim());
}

export function BannedUsersSection() {
  const { settings, setOption } = useConfig();
  const server = settings.server;
  const t = settings.transfers;

  const bannedIpEntries = Object.entries(server.ipblocklist);
  const hasInvalidBanIp = bannedIpEntries.some(([ip]) => !isIpLike(ip) && ip !== "");

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Banned users"
        description="Mirrors ban.ui (preferences.py:1507). Users and IPs blocked from your shares/uploads. Wildcards (*) allowed for IPs; handled via pynicotine core.network_filter in desktop."
      >
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          {server.banlist.length} banned user(s), {bannedIpEntries.length} banned IP(s). Banned users are stored in <span className="font-mono">server.banlist</span>, IPs in{" "}
          <span className="font-mono">server.ipblocklist</span> (dict ip→user).
        </div>
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
          value={bannedIpEntries.map(([ip, user]) => (user ? `${ip} | ${user}` : ip)).join("\n")}
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
        {hasInvalidBanIp ? (
          <div className="rounded-xl bg-error-container px-4 py-3 font-body text-xs text-on-error-container">
            One or more IPs look invalid — IPs should be like 1.2.3.4 or 1.2.3.* (desktop validates via is_ip_address).
          </div>
        ) : null}
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

      <SectionCard title="Geo blocking" description="Mirrors transfers geoblock (pynicotine/config.py:219). Requires GeoIP in desktop; browser stores the setting for bridge parity.">
        <ToggleControl
          label="Enable geo blocking"
          checked={t.geoblock}
          onChange={(v) => setOption("transfers", "geoblock", v)}
        />
        <TextFieldControl
          label="Blocked country code"
          description="ISO 3166-1 alpha-2, e.g. US. Stored as single-element array geoblockcc (desktop uppercases)."
          value={t.geoblockcc[0] ?? ""}
          onChange={(v) => setOption("transfers", "geoblockcc", [v.toUpperCase().trim()])}
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
