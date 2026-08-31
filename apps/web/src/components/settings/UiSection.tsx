"use client";

import { useConfig } from "@/lib/config/provider";
import { useTheme } from "@/components/ThemeProvider";
import {
  SectionCard,
  ToggleControl,
  SelectControl,
  RadioGroupControl,
  NumberControl,
} from "@/components/settings/controls";

const LANGUAGES = [
  { value: "", label: "System default" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
] as const;

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
        description="Interface language — currently cosmetic, stored locally (English-only by design, see docs/DESIGN.md)."
        value={ui.language}
        onChange={(v) => setOption("ui", "language", v)}
        options={[...LANGUAGES]}
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
      <div className="rounded-xl bg-surface-container-low p-4">
        <h4 className="font-label text-xs font-bold uppercase tracking-widest">Visible sections</h4>
        <p className="font-body text-xs text-on-surface-variant">Choose which nav items appear in sidebar / bottom nav. Order below controls sidebar order.</p>
        <div className="mt-3 space-y-2">
          {(ui.modes_order || []).map((id, idx) => {
            const label: Record<string, string> = { search: "Search", browse: "Browse", downloads: "Downloads", uploads: "Uploads", chat: "Chat Rooms", privateChat: "Private Chat", buddies: "Buddies", interests: "Interests", profile: "Profile" };
            const visible = ui.modes_visible?.[id] !== false;
            return (
              <div key={id} className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 ghost-border">
                <label className="flex items-center gap-2 font-body text-sm cursor-pointer">
                  <input type="checkbox" checked={visible} onChange={(e) => setOption("ui", "modes_visible", { ...(ui.modes_visible || {}), [id]: e.target.checked })} className="rounded" />
                  <span>{label[id] || id}</span>
                </label>
                <div className="flex items-center gap-1">
                  <button disabled={idx===0} onClick={() => { const arr=[...(ui.modes_order||[])]; const t=arr[idx-1]; arr[idx-1]=arr[idx]; arr[idx]=t; setOption("ui","modes_order",arr); }} className="rounded px-2 py-1 text-xs disabled:opacity-30 hover:bg-surface-container-high">↑</button>
                  <button disabled={idx=== (ui.modes_order||[]).length-1} onClick={() => { const arr=[...(ui.modes_order||[])]; const t=arr[idx+1]; arr[idx+1]=arr[idx]; arr[idx]=t; setOption("ui","modes_order",arr); }} className="rounded px-2 py-1 text-xs disabled:opacity-30 hover:bg-surface-container-high">↓</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <SectionCard title="Window" description="PWA window geometry — browser mapping for desktop width/height/maximized (stored locally, applied via viewport).">
        <NumberControl label="Width" description="Initial window width (desktop parity, PWA uses viewport width)." value={ui.width ?? 800} min={320} max={3840} step={10} onChange={(v) => setOption("ui", "width", v)} />
        <NumberControl label="Height" value={ui.height ?? 600} min={320} max={2160} step={10} onChange={(v) => setOption("ui", "height", v)} />
        <ToggleControl label="Maximized" description="Start maximized (PWA standalone uses full viewport; stored for parity)." checked={ui.maximized ?? true} onChange={(v) => setOption("ui", "maximized", v)} />
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40">
          Browser stores width/height/maximized locally and restores on next load (responsive web uses viewport, not fixed window). Position x/y are desktop-only and kept as -1 (centered).
        </div>
      </SectionCard>
    </SectionCard>
  );
}
