"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, NumberControl, TextFieldControl, RadioGroupControl, SelectControl } from "@/components/settings/controls";

export function DownloadsSection() {
  const { settings, setOption } = useConfig();
  const t = settings.transfers;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Downloads" description="How incoming files are handled. Folder paths are browser-local notes; actual saves use the browser download location.">
        <ToggleControl
          label="Auto-clear finished downloads"
          checked={t.autoclear_downloads}
          onChange={(v) => setOption("transfers", "autoclear_downloads", v)}
        />
        <ToggleControl
          label="Accept files sent by peers"
          description="Allow peers to send you files without a request."
          checked={t.remotedownloads}
          onChange={(v) => setOption("transfers", "remotedownloads", v)}
        />
        <SelectControl
          label="Who can send you files"
          value={t.uploadallowed}
          onChange={(v) => setOption("transfers", "uploadallowed", v)}
          options={[
            { value: 0, label: "No one" },
            { value: 2, label: "Buddies only" },
            { value: 3, label: "Trusted buddies" },
          ]}
        />
        <TextFieldControl
          label="Download folder"
          value={t.downloaddir}
          onChange={(v) => setOption("transfers", "downloaddir", v)}
          onReset={() => setOption("transfers", "downloaddir", defaults.transfers.downloaddir)}
        />
        <TextFieldControl
          label="Incomplete folder"
          value={t.incompletedir}
          onChange={(v) => setOption("transfers", "incompletedir", v)}
          onReset={() => setOption("transfers", "incompletedir", defaults.transfers.incompletedir)}
        />
        <TextFieldControl
          label="Received folder (sent files)"
          value={t.uploaddir}
          onChange={(v) => setOption("transfers", "uploaddir", v)}
          onReset={() => setOption("transfers", "uploaddir", defaults.transfers.uploaddir)}
        />
        <ToggleControl
          label="Create subfolders per user"
          checked={t.usernamesubfolders}
          onChange={(v) => setOption("transfers", "usernamesubfolders", v)}
        />
        <SelectControl
          label="Grouping"
          description="How downloads are grouped in the UI (mirrors pynicotine transfers groupdownloads)."
          value={t.groupdownloads}
          onChange={(v) => setOption("transfers", "groupdownloads", v)}
          options={[
            { value: "ungrouped", label: "Ungrouped" },
            { value: "folder_grouping", label: "By folder" },
            { value: "user_grouping", label: "By user" },
          ]}
        />
        <SelectControl
          label="Expand state"
          value={t.expand_downloads}
          onChange={(v) => setOption("transfers", "expand_downloads", v)}
          options={[
            { value: "all", label: "Expand all" },
            { value: "none", label: "Collapse all" },
          ]}
        />
        <SelectControl
          label="Double-click action"
          description="What happens when you double-click a download (bridge UI action)."
          value={t.download_doubleclick}
          onChange={(v) => setOption("transfers", "download_doubleclick", v)}
          options={[
            { value: 0, label: "Nothing" },
            { value: 1, label: "Open file" },
            { value: 2, label: "Open in file manager" },
            { value: 3, label: "Search" },
            { value: 4, label: "Pause" },
            { value: 5, label: "Remove" },
            { value: 6, label: "Resume / Retry" },
            { value: 7, label: "Browse folder" },
          ]}
        />
      </SectionCard>

      <SectionCard title="Download speed">
        <RadioGroupControl
          label="Speed limit"
          value={t.use_download_speed_limit}
          onChange={(v) => setOption("transfers", "use_download_speed_limit", v)}
          options={[
            { value: "unlimited", label: "Unlimited" },
            { value: "primary", label: "Primary" },
            { value: "alternative", label: "Alternative" },
          ]}
        />
        <NumberControl
          label="Primary limit (KB/s)"
          value={t.downloadlimit}
          min={1}
          max={1000000}
          onChange={(v) => setOption("transfers", "downloadlimit", v)}
          onReset={() => setOption("transfers", "downloadlimit", defaults.transfers.downloadlimit)}
        />
        <NumberControl
          label="Alternative limit (KB/s)"
          value={t.downloadlimitalt}
          min={1}
          max={1000000}
          onChange={(v) => setOption("transfers", "downloadlimitalt", v)}
          onReset={() => setOption("transfers", "downloadlimitalt", defaults.transfers.downloadlimitalt)}
        />
      </SectionCard>

      <SectionCard title="Download filters">
        <ToggleControl
          label="Enable download filters"
          description="Skip files matching any filter below."
          checked={t.enablefilters}
          onChange={(v) => setOption("transfers", "enablefilters", v)}
        />
        <div className="py-2 font-body text-xs text-on-surface-variant dark:text-outline">
          Syntax: case-insensitive. If regex is enabled, Python-style regex is used; otherwise wildcard * is supported. Invalid regex shows a warning (like preferences.py:525).
        </div>
        <TextFieldControl
          label="Filters (pattern|escaped)"
          description="One per line: pattern, 1 = wildcard, 0 = regex. Example: *.exe|1"
          value={t.downloadfilters.map(([p, e]) => `${p}|${e}`).join("\n")}
          multiline
          onChange={(v) => {
            const parsed = v
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [pat, esc] = l.split("|");
                return [pat.trim(), Number(esc) || 1] as [string, number];
              });
            setOption("transfers", "downloadfilters", parsed);
          }}
          onReset={() => setOption("transfers", "downloadfilters", defaults.transfers.downloadfilters)}
        />
        {t.downloadfilters.some(([pat, esc]) => {
          if (esc === 1) return false;
          try {
            new RegExp("(" + pat + ")");
            return false;
          } catch {
            return true;
          }
        }) ? (
          <div className="rounded-xl bg-error-container px-4 py-3 font-body text-xs text-on-error-container">
            One or more regex filters are invalid — check the pattern syntax.
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
