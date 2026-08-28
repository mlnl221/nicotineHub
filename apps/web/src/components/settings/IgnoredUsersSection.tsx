"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, TextFieldControl } from "@/components/settings/controls";

export function IgnoredUsersSection() {
  const { settings, setOption } = useConfig();
  const server = settings.server;

  return (
    <SectionCard title="Ignored users" description="Messages and shares from ignored users/IPs are hidden.">
      <TextFieldControl
        label="Ignored usernames (one per line)"
        value={server.ignorelist.join("\n")}
        multiline
        placeholder="annoyinguser&#10;bot"
        onChange={(v) => setOption("server", "ignorelist", v.split("\n").map((s) => s.trim()).filter(Boolean))}
      />
      <TextFieldControl
        label="Ignored IPs (one per line)"
        description="Wildcard * allowed."
        value={Object.entries(server.ipignorelist)
          .map(([ip, user]) => (user ? `${ip} | ${user}` : ip))
          .join("\n")}
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
    </SectionCard>
  );
}
