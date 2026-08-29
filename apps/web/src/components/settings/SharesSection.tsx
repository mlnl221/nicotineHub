"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, NumberControl, TextFieldControl, SelectControl } from "@/components/settings/controls";

function hourLabel(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function visibilityValue(buddy: boolean, trusted: boolean): string {
  if (buddy && trusted) return "both";
  if (buddy) return "buddy";
  if (trusted) return "trusted";
  return "none";
}

export function SharesSection() {
  const { settings, setOption } = useConfig();
  const t = settings.transfers;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Shared folders"
        description="Folders you share on the Soulseek network. In the browser, folder access requires the File System Access API (user gesture) and no background serving yet — paths are stored locally as virtual-name → path pairs."
      >
        <div className="py-4">
          <div className="rounded-xl bg-amber-50 px-4 py-3 font-body text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Browser limitation: sharing a local folder is gated by the browser. This is a stub — full P2P serving will be added with the bridge peer listener. Your entries are stored locally.
          </div>
        </div>
        <TextFieldControl
          label="Shared folders (public)"
          description={`${t.shared.length} folder(s) · format: virtualName|/path — full editor in next phase`}
          value={t.shared.map(([v, p]) => `${v}|${p}`).join("\n")}
          multiline
          placeholder="Music|/home/user/Music"
          onChange={(v) => {
            const parsed = v
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [name, ...rest] = l.split("|");
                return [name.trim(), rest.join("|").trim()] as [string, string];
              })
              .filter(([a, b]) => a && b);
            setOption("transfers", "shared", parsed);
          }}
        />
        <TextFieldControl
          label="Buddy shares"
          description={`${t.buddyshared.length} folder(s)`}
          value={t.buddyshared.map(([v, p]) => `${v}|${p}`).join("\n")}
          multiline
          placeholder="Secret|/home/user/Secret"
          onChange={(v) => {
            const parsed = v
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [name, ...rest] = l.split("|");
                return [name.trim(), rest.join("|").trim()] as [string, string];
              })
              .filter(([a, b]) => a && b);
            setOption("transfers", "buddyshared", parsed);
          }}
        />
        <TextFieldControl
          label="Trusted shares"
          description={`${t.trustedshared.length} folder(s)`}
          value={t.trustedshared.map(([v, p]) => `${v}|${p}`).join("\n")}
          multiline
          placeholder="Trusted|/home/user/Trusted"
          onChange={(v) => {
            const parsed = v
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [name, ...rest] = l.split("|");
                return [name.trim(), rest.join("|").trim()] as [string, string];
              })
              .filter(([a, b]) => a && b);
            setOption("transfers", "trustedshared", parsed);
          }}
        />
      </SectionCard>

      <SectionCard title="Share filters" description="Patterns excluded from shares (case-insensitive, * wildcard). Trailing \\ means folder.">
        <TextFieldControl
          label="Filters"
          description="One pattern per line. Defaults include @eaDir\, #recycle\, desktop.ini, Thumbs.db."
          value={t.share_filters.join("\n")}
          multiline
          placeholder="*.tmp&#10;@eaDir\"
          onChange={(v) => setOption("transfers", "share_filters", v.split("\n").map((s) => s.trim()).filter(Boolean))}
          onReset={() => setOption("transfers", "share_filters", defaults.transfers.share_filters)}
        />
      </SectionCard>

      <SectionCard title="Rescan">
        <ToggleControl
          label="Rescan on startup"
          description="Request a share rescan when the app starts (bridge handles it)."
          checked={t.rescanonstartup}
          onChange={(v) => setOption("transfers", "rescanonstartup", v)}
        />
        <ToggleControl
          label="Rescan daily"
          checked={t.rescan_shares_daily}
          onChange={(v) => setOption("transfers", "rescan_shares_daily", v)}
        />
        <SelectControl
          label="Rescan hour"
          description="Hour of day for daily rescan when enabled."
          value={t.rescan_shares_hour}
          onChange={(v) => setOption("transfers", "rescan_shares_hour", v)}
          options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }))}
        />
        <SelectControl
          label="Buddy share visibility"
          description="Who can see buddy/trusted shares without being a buddy. 'On request' entries show an indicator and require a message (pynicotine/shares visibility)."
          value={visibilityValue(t.reveal_buddy_shares, t.reveal_trusted_shares)}
          onChange={(v) => {
            if (v === "none") {
              setOption("transfers", "reveal_buddy_shares", false);
              setOption("transfers", "reveal_trusted_shares", false);
            } else if (v === "buddy") {
              setOption("transfers", "reveal_buddy_shares", true);
              setOption("transfers", "reveal_trusted_shares", false);
            } else if (v === "trusted") {
              setOption("transfers", "reveal_buddy_shares", false);
              setOption("transfers", "reveal_trusted_shares", true);
            } else {
              setOption("transfers", "reveal_buddy_shares", true);
              setOption("transfers", "reveal_trusted_shares", true);
            }
          }}
          options={[
            { value: "none", label: "Only buddies" },
            { value: "buddy", label: "Everyone can view buddy shares (on request)" },
            { value: "trusted", label: "Everyone can view trusted shares (on request)" },
            { value: "both", label: "Everyone can view buddy & trusted (on request)" },
          ]}
        />
      </SectionCard>
    </div>
  );
}
