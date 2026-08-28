"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, TextFieldControl } from "@/components/settings/controls";

export function LoggingSection() {
  const { settings, setOption } = useConfig();
  const l = settings.logging;

  return (
    <SectionCard
      title="Logging"
      description="In the browser, logs are stored client-side (localStorage/IndexedDB). Folder paths are notes, not filesystem locations."
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
        </a>
      </div>
      <ToggleControl label="Log private chats" checked={l.privatechat} onChange={(v) => setOption("logging", "privatechat", v)} />
      <TextFieldControl
        label="Private log folder"
        value={l.privatelogsdir}
        onChange={(v) => setOption("logging", "privatelogsdir", v)}
        onReset={() => setOption("logging", "privatelogsdir", defaults.logging.privatelogsdir)}
      />
      <ToggleControl label="Log chatrooms" checked={l.chatrooms} onChange={(v) => setOption("logging", "chatrooms", v)} />
      <TextFieldControl
        label="Room log folder"
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
        value={l.log_timestamp}
        onChange={(v) => setOption("logging", "log_timestamp", v)}
        onReset={() => setOption("logging", "log_timestamp", defaults.logging.log_timestamp)}
      />
      <ToggleControl label="Debug mode" checked={l.debug} onChange={(v) => setOption("logging", "debug", v)} />
    </SectionCard>
  );
}
