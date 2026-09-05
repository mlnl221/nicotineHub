"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionCard } from "@/components/settings/controls";
import { useSession } from "@/lib/session";
import { getWorkerHealth } from "@/lib/worker";

type WorkerAuth = { discogs: boolean; tidal: boolean; qobuz: boolean; media_scan?: boolean };

const FIELDS: { key: string; label: string; description: string; placeholder: string }[] = [
  { key: "discogs_token", label: "Discogs token", description: "From discogs.com/settings/developers. Raises rate limits; enables authenticated search.", placeholder: "Leave blank to keep • empty clears" },
  { key: "tidal_token", label: "Tidal token", description: "Client token for api.tidal.com album lookup.", placeholder: "Leave blank to keep • empty clears" },
  { key: "tidal_country", label: "Tidal country", description: "Country code for Tidal lookups (e.g. US, DE, GB).", placeholder: "US" },
  { key: "qobuz_app_id", label: "Qobuz app ID", description: "Public app ID for api.json album lookup.", placeholder: "Leave blank to keep • empty clears" },
  { key: "qobuz_user_auth_token", label: "Qobuz user auth token", description: "Sent as X-User-Auth-Token for authenticated Qobuz calls.", placeholder: "Leave blank to keep • empty clears" },
];

const MEDIA_FIELDS: { key: string; label: string; description: string; placeholder: string; secret?: boolean }[] = [
  { key: "media_scan_url", label: "Media scan webhook URL", description: "Called by worker on every finished download (Plex/ Navidrome / n8n). Must be http(s), no credentials.", placeholder: "https://plex.example.com/hook or http://navidrome:4533/rest/startScan?u=user&p=pass&v=1.0&c=hub" },
  { key: "media_scan_token", label: "Media scan token (optional)", description: "Sent as Authorization: Bearer <token> to the webhook.", placeholder: "Leave blank to keep • empty clears", secret: true },
];

function SecretField({ label, description, placeholder, value, onChange }: {
  label: string; description: string; placeholder?: string; value: string; onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">{label}</span>
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="font-label text-[11px] uppercase tracking-widest text-tertiary hover:underline dark:text-tertiary-fixed"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">{description}</div>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-xl bg-surface-container-lowest px-4 py-3 font-mono text-sm text-on-surface placeholder:font-body placeholder:text-outline ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

export function WorkerSection() {
  const { send, subscribe, state } = useSession();
  const [values, setValues] = useState<Record<string, string>>({});
  const [auth, setAuth] = useState<WorkerAuth | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;

  const refresh = useCallback(async () => {
    const h = await getWorkerHealth();
    setReachable(!!h?.ok);
    setAuth((h?.auth as WorkerAuth | undefined) ?? null);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const allKeys = [...FIELDS, ...MEDIA_FIELDS];
  const dirty = allKeys.some((f) => (values[f.key] ?? "") !== "");
  const connected = state.status === "connected";
  const save = () => {
    if (!connected) {
      setSaveStatus("error");
      setSaveError("Bridge not connected — log in first, then save.");
      return;
    }
    const keys = allKeys.map((f) => f.key).filter((k) => (values[k] ?? "") !== "");
    if (!keys.length) return;
    setSaveStatus("saving");
    setSaveError(null);
    let done = 0;
    const timer = setTimeout(() => {
      setSaveStatus((s) => {
        if (s === "saving") {
          setSaveError("No confirmation from bridge — is it connected?");
          return "error";
        }
        return s;
      });
    }, 5000);
    const unsub = subscribe((msg) => {
      const t = (msg as { type?: string }).type;
      if (t === "config:updated" && (msg as { section?: string }).section === "worker") {
        done += 1;
        if (done >= keys.length) {
          clearTimeout(timer);
          unsub();
          setValues({});
          setSaveStatus("success");
          setTimeout(() => { setSaveStatus("idle"); refresh(); }, 1200);
        }
      } else if (t === "error" && saveStatusRef.current === "saving") {
        clearTimeout(timer);
        unsub();
        setSaveStatus("error");
        setSaveError((msg as { error?: string }).error || "Save failed");
      }
    });
    saveStatusRef.current = "saving";
    try {
      for (const k of keys) send({ type: "config:update", section: "worker", key: k, value: values[k] } as unknown as never);
    } catch (e) {
      clearTimeout(timer);
      unsub();
      setSaveStatus("error");
      setSaveError(e instanceof Error ? e.message : "Save failed");
    }
  };
  const clear = (key: string) => {
    if (!connected) {
      setSaveStatus("error");
      setSaveError("Bridge not connected — log in first, then clear.");
      return;
    }
    send({ type: "config:update", section: "worker", key, value: "" } as unknown as never);
    setTimeout(() => refresh(), 500);
  };

  const badge = (ok: boolean | undefined) =>
    ok == null ? <span className="text-outline">…</span>
    : ok ? <span className="font-semibold text-green-600 dark:text-green-400">configured ✓</span>
    : <span className="text-outline">not set</span>;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Worker"
        description="Metadata tokens for the worker service (paste-link scrape). Stored write-only in CONFIG_DIR/worker.json (0600) on the bridge host — values are never shown back. Service env vars win when set. Without tokens, Discogs/MusicBrainz/Bandcamp/Apple/Deezer still work anonymously; Qobuz/Tidal need theirs."
      >
        <div className="py-4 font-body text-xs text-on-surface-variant dark:text-outline">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Worker: {reachable == null ? "…" : reachable ? <span className="font-semibold text-green-600 dark:text-green-400">reachable ✓</span> : <span className="font-semibold text-error">unreachable</span>}</span>
            <span>Discogs {badge(auth?.discogs)}</span>
            <span>Tidal {badge(auth?.tidal)}</span>
            <span>Qobuz {badge(auth?.qobuz)}</span>
            <span>Media scan {badge(auth?.media_scan)}</span>
            <button type="button" onClick={refresh} className="font-label text-[11px] uppercase tracking-widest text-tertiary hover:underline dark:text-tertiary-fixed">
              Refresh
            </button>
          </div>
        </div>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <SecretField
              label={f.label}
              description={f.description}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
            />
            <div className="-mt-2 mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => clear(f.key)}
                className="font-label text-[11px] uppercase tracking-widest text-error/80 hover:underline"
              >
                Clear stored
              </button>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 py-4">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saveStatus === "saving"}
            className="rounded-xl bg-primary px-5 py-2.5 font-label text-sm font-medium text-on-primary transition-opacity disabled:opacity-40"
          >
            {saveStatus === "saving" ? "Saving…" : saveStatus === "success" ? "Saved ✓" : "Save tokens"}
          </button>
          {saveStatus === "error" && saveError ? <span className="font-body text-xs text-error">{saveError}</span> : null}
          {!connected ? <span className="font-body text-xs text-outline">Log in to save (bridge connection required).</span> : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Media automation"
        description="Finished-download webhook — when a download finishes, the worker POSTs JSON to your URL (Plex/ Navidrome / n8n / Sonarr-style). Stored write-only in CONFIG_DIR/worker.json (0600). Fires only while the tab is open (PWA) — see bridge SLSK-only note. URL must be http(s), no credentials, ≤2048 chars."
      >
        <div className="py-4 font-body text-xs text-on-surface-variant dark:text-outline">
          Worker {reachable == null ? "…" : reachable ? <span className="font-semibold text-green-600 dark:text-green-400">reachable ✓</span> : <span className="font-semibold text-error">unreachable</span>} · Media scan {badge(auth?.media_scan)}
        </div>
        {MEDIA_FIELDS.map((f) => (
          <div key={f.key}>
            {f.secret ? (
              <SecretField
                label={f.label}
                description={f.description}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
              />
            ) : (
              <div className="py-4">
                <div className="mb-2 font-label text-sm font-medium text-on-surface dark:text-inverse-on-surface">{f.label}</div>
                <div className="mb-2 font-body text-xs text-on-surface-variant dark:text-outline">{f.description}</div>
                <input
                  type="text"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="url"
                  className="w-full rounded-xl bg-surface-container-lowest px-4 py-3 font-mono text-sm text-on-surface placeholder:font-body placeholder:text-outline ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}
            <div className="-mt-2 mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => clear(f.key)}
                className="font-label text-[11px] uppercase tracking-widest text-error/80 hover:underline"
              >
                Clear stored
              </button>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 py-4">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saveStatus === "saving"}
            className="rounded-xl bg-primary px-5 py-2.5 font-label text-sm font-medium text-on-primary transition-opacity disabled:opacity-40"
          >
            {saveStatus === "saving" ? "Saving…" : saveStatus === "success" ? "Saved ✓" : "Save"}
          </button>
          {saveStatus === "error" && saveError ? <span className="font-body text-xs text-error">{saveError}</span> : null}
        </div>
      </SectionCard>
    </div>
  );
}
