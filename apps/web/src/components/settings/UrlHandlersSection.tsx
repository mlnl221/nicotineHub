"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, SectionSaveButton, TextFieldControl } from "@/components/settings/controls";

export function UrlHandlersSection() {
  const { settings, setOption } = useConfig();

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="URL handlers"
        description="Desktop-only: protocol → command mappings and file manager (urlhandlers.ui, preferences.py:3001). Hidden in isolated mode in Nicotine+ (preferences.py:3784). In the browser, links are handled natively."
        actions={<SectionSaveButton section="urls" />}
      >
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          No configuration needed in the browser. Your system/browser opens <span className="font-mono">http://, https://</span> and file links. Desktop default protocols include{" "}
          <span className="font-mono">http://, https://, audio, image, video, document, text, archive, .mp3, .jpg, .pdf</span> with commands like{" "}
          <span className="font-mono">xdg-open $, firefox $</span> (preferences.py:3039). This tab is kept for parity and hidden when{" "}
          <span className="font-mono">NEXT_PUBLIC_BRIDGE_URL</span> is isolated-like in future.
        </div>
        <TextFieldControl
          label="Protocols (protocol=command per line)"
          description="Stub — stored locally in urls.protocols but not executed in the browser; $ is replaced with URL in desktop."
          value={Object.entries(settings.urls.protocols)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")}
          multiline
          placeholder="http://=xdg-open $&#10;audio=firefox $&#10;.mp3=xdg-open $"
          onChange={(v) => {
            const obj: Record<string, string> = {};
            for (const line of v.split("\n")) {
              const [k, ...rest] = line.split("=");
              if (!k) continue;
              // Mirror desktop normalization: .tar.gz → .gz, bare protocol → ://
              let proto = k.trim();
              if (proto.startsWith(".") && proto.includes(".", 1)) proto = "." + proto.split(".").pop();
              obj[proto] = rest.join("=").trim();
            }
            setOption("urls", "protocols", obj);
          }}
        />
      </SectionCard>

      <SectionCard title="File manager" description="Desktop ui.filemanager — omitted in browser.">
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          Desktop file manager command (e.g. <span className="font-mono">xdg-open $, nautilus $, explorer $</span>) has no browser equivalent — files open via the browser download handling.
        </div>
      </SectionCard>
    </div>
  );
}
