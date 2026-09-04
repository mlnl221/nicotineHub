"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, SectionSaveButton, ToggleControl, TextFieldControl } from "@/components/settings/controls";

export function LoggingSection() {
  const { settings, setOption } = useConfig();
  const l = settings.logging;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Logging"
        description="Mirrors log.ui (preferences.py:2743). In the browser, logs are stored client-side (localStorage/IndexedDB). Folder paths are notes — they map to retention/storage, not filesystem locations (settings-mapping.md:266)."
        actions={<SectionSaveButton section="logging" />}
      >
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          Python strftime codes for timestamps:{" "}
          <a
            href="https://docs.python.org/3/library/datetime.html#format-codes"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-primary"
          >
            format codes
          </a>{" "}
          — also used for Chat timestamps (rooms_timestamp, private_timestamp).
        </div>
        <ToggleControl label="Log private chats" checked={l.privatechat} onChange={(v) => setOption("logging", "privatechat", v)} />
        <TextFieldControl
          label="Private log folder"
          description="Browser note — not a real path."
          value={l.privatelogsdir}
          onChange={(v) => setOption("logging", "privatelogsdir", v)}
          onReset={() => setOption("logging", "privatelogsdir", defaults.logging.privatelogsdir)}
        />
        <ToggleControl label="Log chatrooms" checked={l.chatrooms} onChange={(v) => setOption("logging", "chatrooms", v)} />
        <TextFieldControl
          label="Room log folder"
          description="Browser note — not a real path."
          value={l.roomlogsdir}
          onChange={(v) => setOption("logging", "roomlogsdir", v)}
          onReset={() => setOption("logging", "roomlogsdir", defaults.logging.roomlogsdir)}
        />
        <ToggleControl label="Log transfers" checked={l.transfers} onChange={(v) => setOption("logging", "transfers", v)} />
        <TextFieldControl
          label="Transfer log folder"
          value={l.transferslogsdir}
          onChange={(v) => setOption("logging", "transferslogsdir", v)}
          onReset={() => setOption("logging", "transferslogsdir", defaults.logging.transferslogsdir)}
        />
        <ToggleControl label="Debug to file" checked={l.debug_file_output} onChange={(v) => setOption("logging", "debug_file_output", v)} />
        <TextFieldControl
          label="Debug log folder"
          value={l.debuglogsdir}
          onChange={(v) => setOption("logging", "debuglogsdir", v)}
          onReset={() => setOption("logging", "debuglogsdir", defaults.logging.debuglogsdir)}
        />
        <TextFieldControl
          label="Log timestamp format"
          description="Default %x %X (locale date + time). Reset restores config.defaults."
          value={l.log_timestamp}
          onChange={(v) => setOption("logging", "log_timestamp", v)}
          onReset={() => setOption("logging", "log_timestamp", defaults.logging.log_timestamp)}
        />
      </SectionCard>

      <SectionCard title="Debug & display" actions={<SectionSaveButton section="logging" />}>
        <ToggleControl
          label="Debug mode"
          description="Verbose logging (pynicotine logfacility debug)."
          checked={l.debug}
          onChange={(v) => setOption("logging", "debug", v)}
        />
        <ToggleControl
          label="Collapse logs"
          description="Legacy — logs are now flat one-line [scope] time LEVEL msg (B2 simple); toggle kept for compat but no longer groups diagnostics view."
          checked={l.logcollapsed}
          onChange={(v) => setOption("logging", "logcollapsed", v)}
        />
      </SectionCard>
    </div>
  );
}
