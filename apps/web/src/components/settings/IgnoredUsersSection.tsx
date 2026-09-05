"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, SectionSaveButton, TextFieldControl } from "@/components/settings/controls";

function isIpLike(s: string) {
  return /^(\*|\d{1,3}|\d{1,3}\.\*|\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\*|\d{1,3}\.\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\*|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(s.trim());
}

export function IgnoredUsersSection() {
  const { settings, setOption } = useConfig();
  const server = settings.server;

  const ignoredIpEntries = Object.entries(server.ipignorelist);
  const hasInvalidIgnoreIp = ignoredIpEntries.some(([ip]) => !isIpLike(ip) && ip !== "");

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Ignored users"
        description="Mirrors ignore.ui (preferences.py:1305). Messages and shares from ignored users/IPs are hidden. Stored in server.ignorelist (list) and server.ipignorelist (dict ip→user)."
        actions={<SectionSaveButton section="server" />}
      >
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          {server.ignorelist.length} ignored user(s), {ignoredIpEntries.length} ignored IP(s). Wildcard * allowed for IPs.
        </div>
        <TextFieldControl
          label="Ignored usernames (one per line)"
          value={server.ignorelist.join("\n")}
          multiline
          placeholder="annoyinguser&#10;bot"
          onChange={(v) => setOption("server", "ignorelist", v.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
        <TextFieldControl
          label="Ignored IPs (one per line)"
          description="Wildcard * allowed — format ip | user optional."
          value={ignoredIpEntries.map(([ip, user]) => (user ? `${ip} | ${user}` : ip)).join("\n")}
          multiline
          placeholder="203.0.113.5&#10;198.51.100.*"
          onChange={(v) => {
            const obj: Record<string, string> = {};
            for (const line of v.split("\n")) {
              const [ip, ...rest] = line.split("|");
              const trimmed = ip.trim();
              if (!trimmed) continue;
              obj[trimmed] = rest.join("|").trim();
            }
            setOption("server", "ipignorelist", obj);
          }}
        />
        {hasInvalidIgnoreIp ? (
          <div className="rounded-xl bg-error-container px-4 py-3 font-body text-xs text-on-error-container">
            One or more IPs look invalid — IPs should be like 1.2.3.4 or 1.2.3.*.
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
