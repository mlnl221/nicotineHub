"use client";

import { useConfig } from "@/lib/config/provider";
import { useTheme } from "@/components/ThemeProvider";
import {
  SectionCard,
  ToggleControl,
  SelectControl,
  RadioGroupControl,
} from "@/components/settings/controls";

const LANGUAGES = [
  { value: "", label: "System default" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
];

export function UiSection() {
  const { settings, setOption } = useConfig();
  const { theme, toggle } = useTheme();
  const ui = settings.ui;

  return (
    <SectionCard
      title="Appearance"
      description="Theme, language and display formatting for this browser client."
    >
      <ToggleControl
        label="Dark mode"
        description="Switch between light and dark surfaces."
        checked={theme === "dark"}
        onChange={(v) => {
          // v is the intended next checked state from ToggleControl (!checked)
          if (v !== (theme === "dark")) toggle();
          setOption("ui", "dark_mode", v);
        }}
      />
      <SelectControl
        label="Language"
        description="Interface language (currently cosmetic)."
        value={ui.language}
        onChange={(v) => setOption("ui", "language", v)}
        options={LANGUAGES}
      />
      <ToggleControl
        label="Colorise usernames"
        description="Highlight usernames according to their network status."
        checked={ui.usernamehotspots}
        onChange={(v) => setOption("ui", "usernamehotspots", v)}
      />
      <RadioGroupControl
        label="Username style"
        description="How usernames are rendered in chat."
        value={ui.usernamestyle}
        onChange={(v) => setOption("ui", "usernamestyle", v)}
        options={[
          { value: "bold", label: "Bold" },
          { value: "italic", label: "Italic" },
          { value: "hyperlinks", label: "Hyperlinks" },
          { value: "none", label: "None" },
        ]}
      />
      <ToggleControl
        label="Show file sizes exactly"
        description="Display precise byte counts instead of human-friendly units."
        checked={ui.file_size_unit === "B"}
        onChange={(v) => setOption("ui", "file_size_unit", v ? "B" : "")}
      />
      <ToggleControl
        label="Reverse file paths"
        description="Display the file name before its full path."
        checked={ui.reverse_file_paths}
        onChange={(v) => setOption("ui", "reverse_file_paths", v)}
      />
      <ToggleControl
        label="Spell check"
        description="Browser-native spellcheck for chat/search inputs."
        checked={ui.spellcheck}
        onChange={(v) => setOption("ui", "spellcheck", v)}
      />
      <ToggleControl
        label="Header bar"
        description="Use compact header bar (desktop GTK). Visible as option for PWA parity."
        checked={ui.header_bar}
        onChange={(v) => setOption("ui", "header_bar", v)}
      />
      <ToggleControl
        label="Tab close buttons"
        checked={ui.tabclosers}
        onChange={(v) => setOption("ui", "tabclosers", v)}
      />
      <ToggleControl
        label="Restore previous tab on close"
        checked={ui.tab_select_previous}
        onChange={(v) => setOption("ui", "tab_select_previous", v)}
      />
      <SelectControl
        label="Buddy list placement"
        value={ui.buddylistinchatrooms}
        onChange={(v) => setOption("ui", "buddylistinchatrooms", v)}
        options={[
          { value: "tab", label: "Separate Buddies tab" },
          { value: "chatrooms", label: "Sidebar in Chat Rooms" },
          { value: "always", label: "Always visible sidebar" },
        ]}
      />
      <SelectControl
        label="On close"
        description="Close dialog behavior (desktop exitdialog)."
        value={ui.exitdialog}
        onChange={(v) => setOption("ui", "exitdialog", v)}
        options={[
          { value: 0, label: "Quit" },
          { value: 1, label: "Show confirmation" },
          { value: 2, label: "Run in background" },
        ]}
      />
    </SectionCard>
  );
}
