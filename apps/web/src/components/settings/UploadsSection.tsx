"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, SectionSaveButton, ToggleControl, NumberControl, RadioGroupControl, SelectControl, TextFieldControl } from "@/components/settings/controls";

export function UploadsSection() {
  const { settings, setOption } = useConfig();
  const t = settings.transfers;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Uploads" description="Queueing and bandwidth for files you share. Maps to the bridge upload queue when P2P serving is active." actions={<SectionSaveButton section="transfers" />}>
        <ToggleControl
          label="Auto-clear finished uploads"
          checked={t.autoclear_uploads}
          onChange={(v) => setOption("transfers", "autoclear_uploads", v)}
        />
        <NumberControl
          label="Upload bandwidth share (%)"
          value={t.uploadbandwidth}
          min={1}
          max={100}
          onChange={(v) => setOption("transfers", "uploadbandwidth", v)}
          onReset={() => setOption("transfers", "uploadbandwidth", defaults.transfers.uploadbandwidth)}
        />
        <ToggleControl
          label="Use fixed upload slots"
          description="If off, slots are determined dynamically from bandwidth."
          checked={t.useupslots}
          onChange={(v) => setOption("transfers", "useupslots", v)}
        />
        <NumberControl
          label="Upload slots"
          value={t.uploadslots}
          min={1}
          max={100}
          onChange={(v) => setOption("transfers", "uploadslots", v)}
          onReset={() => setOption("transfers", "uploadslots", defaults.transfers.uploadslots)}
        />
        <RadioGroupControl
          label="Upload speed limit"
          value={t.use_upload_speed_limit}
          onChange={(v) => setOption("transfers", "use_upload_speed_limit", v)}
          options={[
            { value: "unlimited", label: "Unlimited" },
            { value: "primary", label: "Primary" },
            { value: "alternative", label: "Alternative" },
          ]}
        />
        <NumberControl
          label="Primary upload limit (KB/s)"
          value={t.uploadlimit}
          min={1}
          max={1000000}
          onChange={(v) => setOption("transfers", "uploadlimit", v)}
          onReset={() => setOption("transfers", "uploadlimit", defaults.transfers.uploadlimit)}
        />
        <NumberControl
          label="Alternative upload limit (KB/s)"
          value={t.uploadlimitalt}
          min={1}
          max={1000000}
          onChange={(v) => setOption("transfers", "uploadlimitalt", v)}
          onReset={() => setOption("transfers", "uploadlimitalt", defaults.transfers.uploadlimitalt)}
        />
        <SelectControl
          label="Queue type"
          value={t.fifoqueue ? 1 : 0}
          onChange={(v) => setOption("transfers", "fifoqueue", v === 1)}
          options={[
            { value: 0, label: "Round Robin" },
            { value: 1, label: "First In, First Out" },
          ]}
        />
        <RadioGroupControl
          label="Limit queue by"
          value={t.limitby ? "size" : "count"}
          onChange={(v) => setOption("transfers", "limitby", v === "size")}
          options={[
            { value: "size", label: "Total size" },
            { value: "count", label: "File count" },
          ]}
        />
        <NumberControl
          label="Queue size limit (MB)"
          value={t.queuelimit}
          min={1}
          max={1000000}
          onChange={(v) => setOption("transfers", "queuelimit", v)}
          onReset={() => setOption("transfers", "queuelimit", defaults.transfers.queuelimit)}
        />
        <NumberControl
          label="Queue file limit"
          value={t.filelimit}
          min={1}
          max={10000}
          onChange={(v) => setOption("transfers", "filelimit", v)}
          onReset={() => setOption("transfers", "filelimit", defaults.transfers.filelimit)}
        />
        <ToggleControl
          label="No limits for buddies"
          checked={t.friendsnolimits}
          onChange={(v) => setOption("transfers", "friendsnolimits", v)}
        />
        <ToggleControl
          label="Prioritize buddies"
          checked={t.preferfriends}
          onChange={(v) => setOption("transfers", "preferfriends", v)}
        />
        <SelectControl
          label="Grouping"
          value={t.groupuploads}
          onChange={(v) => setOption("transfers", "groupuploads", v)}
          options={[
            { value: "ungrouped", label: "Ungrouped" },
            { value: "folder_grouping", label: "By folder" },
            { value: "user_grouping", label: "By user" },
          ]}
        />
        <SelectControl
          label="Expand state"
          value={t.expand_uploads}
          onChange={(v) => setOption("transfers", "expand_uploads", v)}
          options={[
            { value: "all", label: "Expand all" },
            { value: "none", label: "Collapse all" },
          ]}
        />
        <SelectControl
          label="Double-click action"
          value={t.upload_doubleclick}
          onChange={(v) => setOption("transfers", "upload_doubleclick", v)}
          options={[
            { value: 0, label: "Nothing" },
            { value: 1, label: "Open file" },
            { value: 2, label: "Open in file manager" },
            { value: 3, label: "Search" },
            { value: 4, label: "Abort" },
            { value: 5, label: "Remove" },
            { value: 6, label: "Retry" },
            { value: 7, label: "Browse folder" },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="HoneyPot bait"
        actions={<SectionSaveButton section="transfers" />}
        description="Trap for scanners that probe for a known bait file. When a peer requests the bait name, they are banned. Exact basename, case-insensitive. Default off. Buddies/privileged are exempt."
      >
        <ToggleControl
          label="Enable HoneyPot"
          description="When enabled, requesting !banned.txt (or names below) bans the requester."
          checked={t.honeypot_enabled}
          onChange={(v) => setOption("transfers", "honeypot_enabled", v)}
        />
        <TextFieldControl
          label="Bait file names (one per line)"
          description="Exact filenames, e.g. !banned.txt . Case-insensitive."
          value={(t.honeypot_names ?? []).join("\n")}
          multiline
          placeholder="!banned.txt"
          onChange={(v) => setOption("transfers", "honeypot_names", v.split("\n").map((s) => s.trim()).filter(Boolean))}
          onReset={() => setOption("transfers", "honeypot_names", defaults.transfers.honeypot_names)}
        />
      </SectionCard>
    </div>
  );
}
