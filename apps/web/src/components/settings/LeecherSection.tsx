"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { isDemo } from "@/lib/demo";
import type { PluginInfo } from "@/lib/protocol";
import {
  SectionCard,
  SectionSaveButton,
  ToggleControl,
  NumberControl,
  TextFieldControl,
} from "@/components/settings/controls";

const PRIMARY = "leech_detector";
const FALLBACK = "anti_leecher";

type Draft = Record<string, unknown>;

const DEFAULTS: Draft = {
  // Card 1 — Anti-leech (bridge keys in leech_detector.ts settings — source of truth)
  message: "Please consider not being a leecher. Thanks",
  hide_plugin_messages: false,
  open_private_chat: true,
  num_files: 10,
  num_folders: 1,
  send_message_to_leechers: false,
  ban_leechers: true,
  ignore_leechers: true,
  ban_block_ip: false,
  enable_sus_detector: true,
  sus_pattern_500_25: true,
  sus_pattern_1000_50: true,
  sus_pattern_1500_75: true,
  sus_pattern_2000_100: true,
  auto_unban: true,
  detected_leechers: [] as string[],
  // Card 2 — ProveIt challenge (buddies always exempt in bridge)
  enable_proveit: true,
  proveit_first_message:
    'ProveIt: To prove you are a human downloading these files, please type "download" in this chat to be added to my whitelist.',
  proveit_success_message:
    "ProveIt: You are verified. I will now retry your queued downloads automatically. If they do not auto-restart, please retry manually.",
  proveit_captcha_word: "download",
  proveit_cooldown_seconds: 300,
  proveit_auto_retry_uploads: true,
  proveit_require_minimum_shares: true,
  proveit_fail_message:
    "ProveIt: Your share counts do not meet this host's minimum files/folders requirement. You cannot be whitelisted until you share enough.",
  proveit_verifying_shares_message: "",
  proveit_verified_users: [] as string[],
};

const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb);
const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function mergeDefaults(settings: Record<string, unknown> | null | undefined): Draft {
  const out: Draft = { ...DEFAULTS };
  if (settings) for (const k of Object.keys(DEFAULTS)) if (settings[k] !== undefined) out[k] = settings[k];
  return out;
}

function UserListEditor({
  label,
  description,
  users,
  onChange,
  addPlaceholder = "username",
}: {
  label: string;
  description?: string;
  users: string[];
  onChange: (users: string[]) => void;
  addPlaceholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    if (!name || users.includes(name)) return;
    onChange([...users, name]);
    setDraft("");
  };
  return (
    <div className="py-4">
      <div className="mb-1 font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
        {label}
      </div>
      {description ? (
        <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">{description}</div>
      ) : null}
      {users.length === 0 ? (
        <div className="mb-2 rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
          Empty.
        </div>
      ) : (
        <ul className="mb-2 space-y-1">
          {users.map((u) => (
            <li
              key={u}
              className="flex items-center justify-between gap-2 rounded-xl bg-surface-container-lowest px-3 py-2 ghost-border"
            >
              <span className="min-w-0 truncate font-body text-sm">{u}</span>
              <button
                type="button"
                onClick={() => onChange(users.filter((x) => x !== u))}
                aria-label={`Remove ${u}`}
                className="shrink-0 rounded-lg bg-error-container px-3 py-1.5 font-label text-[11px] uppercase tracking-widest text-on-error-container"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={addPlaceholder}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl bg-surface-container-lowest px-4 py-2.5 font-body text-sm ghost-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="shrink-0 rounded-xl bg-primary px-4 py-2.5 font-label text-xs uppercase tracking-widest text-on-primary disabled:opacity-50"
        >
          Add
        </button>
        {users.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 rounded-xl bg-surface-container-high px-4 py-2.5 font-label text-xs uppercase tracking-widest text-on-surface-variant"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function LeecherSection() {
  const { send, subscribe, state } = useSession();
  const [pluginName, setPluginName] = useState<string>(PRIMARY);
  const [found, setFound] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(DEFAULTS);
  const [saved, setSaved] = useState<Draft>(DEFAULTS);

  const set = useCallback(
    <K extends string>(key: K, value: unknown) => setDraft((d) => ({ ...d, [key]: value })),
    [],
  );

  const applyList = useCallback((plugins: PluginInfo[]) => {
    const p = plugins.find((x) => x.name === PRIMARY) ?? plugins.find((x) => x.name === FALLBACK);
    if (!p) {
      setFound(false);
      setLoading(false);
      return;
    }
    setFound(true);
    setPluginName(p.name);
    setEnabled(p.enabled);
    const next = mergeDefaults(p.settings);
    setDraft(next);
    setSaved(next);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => {
    send({ type: "plugin:list" });
  }, [send]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "plugin:list") applyList(msg.plugins);
      else if (msg.type === "plugin:toggled" && (msg.name === PRIMARY || msg.name === FALLBACK)) {
        setPluginName(msg.name);
        setEnabled(msg.enabled);
      }
    });
    refresh();
    return unsub;
  }, [subscribe, refresh, applyList]);

  useEffect(() => {
    if (state.status === "connected") refresh();
  }, [state.status, refresh]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = useCallback(async () => {
    send({ type: "plugin:settings", name: pluginName, settings: draft });
    setSaved(draft);
  }, [send, pluginName, draft]);

  const saveProps = { dirty, onSave: save };

  const leechers = strList(draft.detected_leechers);
  const verified = strList(draft.proveit_verified_users);

  return (
    <div className="flex flex-col gap-6" id="leecher">
      <SectionCard
        title="Anti-leech"
        description="Flag users sharing too few files/folders and message them after upload. Stored on the bridge via the leech_detector plugin."
        actions={<SectionSaveButton {...saveProps} />}
      >
        {isDemo ? (
          <div className="mb-2 rounded-xl bg-tertiary-container/30 px-4 py-3 font-body text-xs text-on-surface-variant dark:text-outline">
            Demo — explore freely, changes reset on reload. Run locally (<span className="font-mono">bun run dev</span>) for a real bridge.
          </div>
        ) : null}
        {loading ? (
          <div className="py-4 text-center font-body text-sm text-on-surface-variant">Loading plugin settings…</div>
        ) : (
          <>
            {!found ? (
              <div className="rounded-xl bg-error-container px-4 py-3 font-body text-xs text-on-error-container">
                Plugin <span className="font-mono">leech_detector</span> (or{" "}
                <span className="font-mono">anti_leecher</span>) not found on the bridge — saving will target{" "}
                <span className="font-mono">{pluginName}</span> anyway.
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <div className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
                  Enable leech detector
                </div>
                <div className="mt-0.5 font-body text-xs text-on-surface-variant dark:text-outline">
                  Flips the plugin on/off immediately via plugin:toggle.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => send({ type: "plugin:toggle", name: pluginName })}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  enabled ? "bg-primary" : "bg-surface-container-highest dark:bg-surface-variant"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface-container-lowest shadow transition-all ${
                    enabled ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            <ToggleControl
              label="Open private chat tabs"
              description="Open chat tabs when messaging leechers."
              checked={bool(draft.open_private_chat, true)}
              onChange={(v) => set("open_private_chat", v)}
            />
            <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
              Buddies are always exempt — never flagged, banned, or challenged.
            </div>
            <ToggleControl
              label="Ban leechers"
              description="Ban users sharing too little."
              checked={bool(draft.ban_leechers, true)}
              onChange={(v) => set("ban_leechers", v)}
            />
            <ToggleControl
              label="Ignore leechers"
              description="Ignore users sharing too little."
              checked={bool(draft.ignore_leechers, true)}
              onChange={(v) => set("ignore_leechers", v)}
            />
            <ToggleControl
              label="Block leecher IP"
              description="Also block the leecher IP, if known."
              checked={bool(draft.ban_block_ip, false)}
              onChange={(v) => set("ban_block_ip", v)}
            />
            <ToggleControl
              label="Message leechers"
              description="Send the leecher message below via private chat."
              checked={bool(draft.send_message_to_leechers, false)}
              onChange={(v) => set("send_message_to_leechers", v)}
            />
            <ToggleControl
              label="Hide plugin messages"
              description="Hide plugin-triggered PM tabs and zap incoming captcha replies (disable if private chats seem missing or empty)."
              checked={bool(draft.hide_plugin_messages, false)}
              onChange={(v) => set("hide_plugin_messages", v)}
            />
            <ToggleControl
              label="Auto-unban"
              description="Automatically unban/unignore users once they share enough."
              checked={bool(draft.auto_unban, true)}
              onChange={(v) => set("auto_unban", v)}
            />
            <NumberControl
              label="Minimum shared files"
              description="Users sharing fewer files than this are flagged."
              value={num(draft.num_files, 1)}
              min={0}
              max={100000}
              sliderMax={1000}
              onChange={(v) => set("num_files", v)}
              onReset={() => set("num_files", DEFAULTS.num_files)}
            />
            <NumberControl
              label="Minimum shared folders"
              description="Users sharing fewer folders than this are flagged."
              value={num(draft.num_folders, 1)}
              min={1}
              max={10000}
              sliderMax={1000}
              onChange={(v) => set("num_folders", v)}
              onReset={() => set("num_folders", DEFAULTS.num_folders)}
            />
            <div className="py-4">
              <div className="mb-1 font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">
                Suspicious share patterns
              </div>
              <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">
                Exact file/folder counts marking fake shares. Checked before the minimum limits above.
              </div>
              <ToggleControl
                label="500 files / 25 folders"
                description="Flag exact 500/25 shares as suspicious."
                checked={bool(draft.sus_pattern_500_25, true)}
                onChange={(v) => set("sus_pattern_500_25", v)}
              />
              <ToggleControl
                label="1000 files / 50 folders"
                description="Flag exact 1000/50 shares as suspicious."
                checked={bool(draft.sus_pattern_1000_50, true)}
                onChange={(v) => set("sus_pattern_1000_50", v)}
              />
              <ToggleControl
                label="1500 files / 75 folders"
                description="Flag exact 1500/75 shares as suspicious."
                checked={bool(draft.sus_pattern_1500_75, true)}
                onChange={(v) => set("sus_pattern_1500_75", v)}
              />
              <ToggleControl
                label="2000 files / 100 folders"
                description="Flag exact 2000/100 shares as suspicious."
                checked={bool(draft.sus_pattern_2000_100, true)}
                onChange={(v) => set("sus_pattern_2000_100", v)}
              />
              <ToggleControl
                label="Enable suspicious detector"
                description="Run the suspicious-pattern check at all."
                checked={bool(draft.enable_sus_detector, true)}
                onChange={(v) => set("enable_sus_detector", v)}
              />
            </div>
            <TextFieldControl
              label="Leecher message"
              description="Private message sent after upload. Each line is a separate message — too many lines may get you temp-banned for spam."
              value={str(draft.message)}
              multiline
              onChange={(v) => set("message", v)}
              onReset={() => set("message", DEFAULTS.message)}
            />
            <UserListEditor
              label={`Detected leechers (${leechers.length})`}
              description="Users flagged so far. Remove one, add manually, or clear all."
              users={leechers}
              onChange={(u) => set("detected_leechers", u)}
            />
          </>
        )}
      </SectionCard>

      <SectionCard
        title="ProveIt challenge"
        description="Ask suspected leechers to reply with a captcha word before their queue continues. Wrong answers keep them waiting; verified users skip future challenges."
        actions={<SectionSaveButton {...saveProps} />}
      >
        <ToggleControl
          label="Enable ProveIt"
          description="Challenge flagged users with the captcha word. Buddies are exempt."
          checked={bool(draft.enable_proveit, true)}
          onChange={(v) => set("enable_proveit", v)}
        />
        <TextFieldControl
          label="Captcha word"
          description="Word the user must type in private chat to verify (case-insensitive)."
          value={str(draft.proveit_captcha_word)}
          placeholder="e.g. download"
          onChange={(v) => set("proveit_captcha_word", v)}
          onReset={() => set("proveit_captcha_word", DEFAULTS.proveit_captcha_word)}
        />
        <NumberControl
          label="Challenge cooldown (seconds)"
          description="Minimum seconds between sending the first-download message to the same user."
          value={num(draft.proveit_cooldown_seconds, 300)}
          min={0}
          max={86400}
          hideSlider
          onChange={(v) => set("proveit_cooldown_seconds", v)}
          onReset={() => set("proveit_cooldown_seconds", DEFAULTS.proveit_cooldown_seconds)}
        />
        <ToggleControl
          label="Auto-retry uploads"
          description="Automatically re-queue denied uploads after captcha verification. If disabled, users must retry manually."
          checked={bool(draft.proveit_auto_retry_uploads, true)}
          onChange={(v) => set("proveit_auto_retry_uploads", v)}
        />
        <ToggleControl
          label="Require minimum shares"
          description="Require the Anti-leech minimum files/folders before whitelisting after captcha. Users below the minimum are banned like other leechers instead."
          checked={bool(draft.proveit_require_minimum_shares, true)}
          onChange={(v) => set("proveit_require_minimum_shares", v)}
        />
        <TextFieldControl
          label="First challenge message"
          description="Sent when a non-verified user queues a download (subject to cooldown). Each line is a separate message."
          value={str(draft.proveit_first_message)}
          multiline
          onChange={(v) => set("proveit_first_message", v)}
          onReset={() => set("proveit_first_message", DEFAULTS.proveit_first_message)}
        />
        <TextFieldControl
          label="Success message"
          description="Sent after the user sends the captcha word. Each line is a separate message."
          value={str(draft.proveit_success_message)}
          multiline
          onChange={(v) => set("proveit_success_message", v)}
          onReset={() => set("proveit_success_message", DEFAULTS.proveit_success_message)}
        />
        <TextFieldControl
          label="Failure message"
          description="Sent when the captcha is correct but share counts are below your minimum."
          value={str(draft.proveit_fail_message)}
          multiline
          onChange={(v) => set("proveit_fail_message", v)}
          onReset={() => set("proveit_fail_message", DEFAULTS.proveit_fail_message)}
        />
        <TextFieldControl
          label="Verifying-shares message"
          description="Optional PM while waiting for share stats after captcha (leave empty to skip)."
          value={str(draft.proveit_verifying_shares_message)}
          multiline
          onChange={(v) => set("proveit_verifying_shares_message", v)}
          onReset={() => set("proveit_verifying_shares_message", DEFAULTS.proveit_verifying_shares_message)}
        />
        <UserListEditor
          label={`Verified users (${verified.length})`}
          description="Users who passed the challenge — skipped automatically next time."
          users={verified}
          onChange={(u) => set("proveit_verified_users", u)}
        />
      </SectionCard>
    </div>
  );
}
