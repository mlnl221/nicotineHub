"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import { SectionCard, ToggleControl, NumberControl, TextFieldControl } from "@/components/settings/controls";

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
        <NumberControl
          label="Rescan hour (0–23)"
          description="Hour of day for daily rescan."
          value={t.rescan_shares_hour}
          min={0}
          max={23}
          onChange={(v) => setOption("transfers", "rescan_shares_hour", v)}
          onReset={() => setOption("transfers", "rescan_shares_hour", defaults.transfers.rescan_shares_hour)}
        />
        <ToggleControl
          label="Reveal buddy shares to everyone (on request)"
          description="If enabled, buddy shares are visible with an indicator and require a message to request access. Not recommended in most cases."
          checked={t.reveal_buddy_shares}
          onChange={(v) => setOption("transfers", "reveal_buddy_shares", v)}
        />
        <ToggleControl
          label="Reveal trusted shares to everyone (on request)"
          checked={t.reveal_trusted_shares}
          onChange={(v) => setOption("transfers", "reveal_trusted_shares", v)}
        />
      </SectionCard>
    </div>
  );
}
