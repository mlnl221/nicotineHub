"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, TextFieldControl, NumberControl } from "@/components/settings/controls";

export function ChatsSection() {
  const { settings, setOption } = useConfig();
  const w = settings.words;
  const logging = settings.logging;
  const pc = settings.privatechat;
  const server = settings.server;
  const ui = settings.ui;
  const ctcp = settings.ctcp;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Chat — General">
        <ToggleControl
          label="Allow private room invitations"
          checked={server.private_chatrooms}
          onChange={(v) => setOption("server", "private_chatrooms", v)}
        />
        <ToggleControl
          label="Reopen private chats on startup"
          checked={pc.store}
          onChange={(v) => setOption("privatechat", "store", v)}
        />
        <NumberControl
          label="Recent room messages to remember"
          value={logging.readroomlines}
          min={0}
          max={10000}
          onChange={(v) => setOption("logging", "readroomlines", v)}
          onReset={() => setOption("logging", "readroomlines", defaults.logging.readroomlines)}
        />
        <NumberControl
          label="Recent private messages to remember"
          value={logging.readprivatelines}
          min={0}
          max={10000}
          onChange={(v) => setOption("logging", "readprivatelines", v)}
          onReset={() => setOption("logging", "readprivatelines", defaults.logging.readprivatelines)}
        />
        <TextFieldControl
          label="Room timestamp format"
          description="Python strftime codes. See https://docs.python.org/3/library/datetime.html#format-codes"
          value={logging.rooms_timestamp}
          onChange={(v) => setOption("logging", "rooms_timestamp", v)}
          onReset={() => setOption("logging", "rooms_timestamp", defaults.logging.rooms_timestamp)}
        />
        <TextFieldControl
          label="Private chat timestamp format"
          value={logging.private_timestamp}
          onChange={(v) => setOption("logging", "private_timestamp", v)}
          onReset={() => setOption("logging", "private_timestamp", defaults.logging.private_timestamp)}
        />
      </SectionCard>

      <SectionCard title="Completion">
        <ToggleControl label="Tab completion" checked={w.tab} onChange={(v) => setOption("words", "tab", v)} />
        <ToggleControl label="Completion dropdown" checked={w.dropdown} onChange={(v) => setOption("words", "dropdown", v)} />
        <NumberControl
          label="Minimum characters for dropdown"
          value={w.characters}
          min={1}
          max={10}
          onChange={(v) => setOption("words", "characters", v)}
          onReset={() => setOption("words", "characters", defaults.words.characters)}
        />
        <ToggleControl label="Complete room names" checked={w.roomnames} onChange={(v) => setOption("words", "roomnames", v)} />
        <ToggleControl label="Complete buddy names" checked={w.buddies} onChange={(v) => setOption("words", "buddies", v)} />
        <ToggleControl label="Complete usernames in rooms" checked={w.roomusers} onChange={(v) => setOption("words", "roomusers", v)} />
        <ToggleControl label="Complete commands" checked={w.commands} onChange={(v) => setOption("words", "commands", v)} />
        <ToggleControl
          label="Spell check"
          description="Browser-native spell checker."
          checked={ui.spellcheck}
          onChange={(v) => setOption("ui", "spellcheck", v)}
        />
        <ToggleControl label="CTCP support" checked={ctcp.enable} onChange={(v) => setOption("ctcp", "enable", v)} />
      </SectionCard>

      <SectionCard title="Mentions / Keywords">
        <ToggleControl
          label="Highlight keywords"
          checked={w.watch_keywords}
          onChange={(v) => setOption("words", "watch_keywords", v)}
        />
        <TextFieldControl
          label="Keywords (one per line)"
          value={w.keywords.join("\n")}
          multiline
          placeholder="myband&#10;username"
          onChange={(v) => setOption("words", "keywords", v.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
      </SectionCard>

      <SectionCard title="Censor">
        <ToggleControl label="Censor patterns" checked={w.censorwords} onChange={(v) => setOption("words", "censorwords", v)} />
        <TextFieldControl
          label="Patterns (one per line)"
          value={w.censored.join("\n")}
          multiline
          onChange={(v) => setOption("words", "censored", v.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
      </SectionCard>

      <SectionCard title="Auto-replace">
        <ToggleControl label="Auto-replace words" checked={w.replacewords} onChange={(v) => setOption("words", "replacewords", v)} />
        <TextFieldControl
          label="Replacements (pattern=replacement per line)"
          description="Default: teh → the, etc. One per line as from=to"
          value={Object.entries(w.autoreplaced)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")}
          multiline
          placeholder="teh =the &#10;youre=you're"
          onChange={(v) => {
            const obj: Record<string, string> = {};
            for (const line of v.split("\n")) {
              const [k, ...rest] = line.split("=");
              if (!k) continue;
              const val = rest.join("=").trim();
              if (val) obj[k.trim()] = val;
            }
            setOption("words", "autoreplaced", obj);
          }}
          onReset={() => setOption("words", "autoreplaced", defaults.words.autoreplaced)}
        />
      </SectionCard>
    </div>
  );
}
