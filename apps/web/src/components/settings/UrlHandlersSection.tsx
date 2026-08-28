"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, TextFieldControl } from "@/components/settings/controls";

export function UrlHandlersSection() {
  const { settings, setOption } = useConfig();

  return (
    <SectionCard
      title="URL handlers"
      description="Desktop-only: protocol → command mappings and file manager. Hidden in isolated mode in Nicotine+ (preferences.py:3784). In the browser, links are handled natively."
    >
      <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
        No configuration needed in the browser. Your system/browser opens <span className="font-mono">http://, https://</span> and file links. This tab is kept for parity.
      </div>
      <TextFieldControl
        label="Protocols (protocol=command per line)"
        description="Stub — stored locally but not executed in the browser."
        value={Object.entries(settings.urls.protocols)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")}
        multiline
        placeholder="http://=xdg-open $&#10;audio=firefox $"
        onChange={(v) => {
          const obj: Record<string, string> = {};
          for (const line of v.split("\n")) {
            const [k, ...rest] = line.split("=");
            if (!k) continue;
            obj[k.trim()] = rest.join("=").trim();
          }
          setOption("urls", "protocols", obj);
        }}
      />
    </SectionCard>
  );
}
