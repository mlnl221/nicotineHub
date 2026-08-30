"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "@/lib/session";
import type { PluginInfo } from "@/lib/protocol";
import { SectionCard, ToggleControl } from "@/components/settings/controls";
import { useConfig } from "@/lib/config/provider";
import { isDemo } from "@/lib/demo";

type MetaSetting = {
  description: string;
  group?: string;
  type: string;
  minimum?: number;
  maximum?: number;
  stepsize?: number;
  options?: string[];
  chooser?: string;
};

export function PluginsSection() {
  const { send, subscribe } = useSession();
  const { settings, setOption } = useConfig();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [urlInstall, setUrlInstall] = useState("");
  const [githubTsUrl, setGithubTsUrl] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSettings, setExpandedSettings] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    if (isDemo) return;
    send({ type: "plugin:list" });
  }, [send]);

  useEffect(() => {
    if (isDemo) { setLoading(false); return; }
    const unsub = subscribe((msg) => {
      if (msg.type === "plugin:list") {
        setPlugins(msg.plugins);
        setLoading(false);
      } else if (msg.type === "plugin:installed" || msg.type === "plugin:toggled" || msg.type === "plugin:reloaded" || msg.type === "plugin:uninstalled") {
        // list will be pushed separately, but also refresh
        refresh();
      } else if (msg.type === "error") {
        setError(msg.error);
        setInstalling(false);
      } else if (msg.type === "plugin:output") {
        // could show toast, for now ignore
      }
    });
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { unsub(); clearInterval(id); };
  }, [subscribe, refresh]);

  if (isDemo) {
    return (
      <div className="flex flex-col gap-6">
        <SectionCard title="Plugins" description="Demo mode — bridge plugin runtime disabled.">
          <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
            Plugins require a running bridge (DATA_DIR/plugins). In the Vercel demo, all logins are mocked and transfers disabled, so plugin install/toggle is not available. Run locally (<span className="font-mono">bun run dev</span> or <span className="font-mono">docker compose up</span>) to manage plugins.
          </div>
          <ToggleControl label="Enable plugins (demo placeholder)" description="Stored locally only in demo." checked={settings.plugins.enable} onChange={(v) => setOption("plugins", "enable", v)} />
        </SectionCard>
      </div>
    );
  }

  const handleToggle = (name: string) => {
    send({ type: "plugin:toggle", name });
  };
  const handleReload = (name: string) => send({ type: "plugin:reload", name });
  const handleUninstall = (name: string) => {
    if (!confirm(`Uninstall plugin ${name}?`)) return;
    send({ type: "plugin:uninstall", name });
  };
  const handleFile = async (f: File) => {
    if (!f.name.endsWith(".zip")) { setError("Please upload a .zip file"); return; }
    setInstalling(true); setError(null);
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    send({ type: "plugin:install", fileName: f.name, data: b64 });
    setTimeout(() => setInstalling(false), 2000);
  };
  const handleUrlInstall = () => {
    if (!urlInstall.trim()) return;
    setInstalling(true); setError(null);
    send({ type: "plugin:installUrl", url: urlInstall.trim() });
    setTimeout(() => setInstalling(false), 4000);
  };
  const handleGithubTsInstall = () => {
    const url = githubTsUrl.trim();
    if (!url) return;
    const lower = url.toLowerCase();
    const isTsJs = lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".mts") || lower.endsWith(".mjs");
    if (!isTsJs) {
      setError("Only TypeScript/JavaScript allowed (.ts/.js/.mts/.mjs) — Python (.py) and other languages are blocked. URL must end with .ts or .js");
      return;
    }
    setInstalling(true); setError(null);
    send({ type: "plugin:installGithubTs", url });
    setTimeout(() => setInstalling(false), 4000);
  };

  const openSettings = (p: PluginInfo) => {
    if (expandedSettings === p.name) { setExpandedSettings(null); return; }
    setExpandedSettings(p.name);
    setEditValues({ ...(p.settings ?? {}) });
  };
  const saveSettings = (name: string) => {
    send({ type: "plugin:settings", name, settings: editValues });
    setExpandedSettings(null);
  };
  const resetSettings = (name: string) => {
    send({ type: "plugin:resetSettings", name });
    setExpandedSettings(null);
  };

  const renderField = (key: string, meta: MetaSetting, value: unknown) => {
    const onChange = (v: unknown) => setEditValues((s) => ({ ...s, [key]: v }));
    const type = meta.type;
    if (type === "bool") {
      return <ToggleControl key={key} label={meta.description || key} description={`Group: ${meta.group ?? "General"}`} checked={Boolean(value)} onChange={(b) => onChange(b)} />;
    }
    if (type === "integer" || type === "int" || type === "float") {
      return (
        <div key={key} className="py-3">
          <label className="font-label text-xs font-medium text-on-surface">{meta.description || key}</label>
          {meta.group ? <div className="font-body text-[11px] text-on-surface-variant">{meta.group}</div> : null}
          <input
            type="number"
            value={String(value ?? "")}
            min={meta.minimum}
            max={meta.maximum}
            step={meta.stepsize ?? (type === "float" ? 0.1 : 1)}
            onChange={(e) => onChange(type === "float" ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
            className="mt-1 w-full rounded-xl bg-surface-container-lowest px-3 py-2 font-body text-sm ghost-border"
          />
        </div>
      );
    }
    if (type === "dropdown" || type === "radio") {
      const opts = meta.options ?? [];
      return (
        <div key={key} className="py-3">
          <label className="font-label text-xs font-medium">{meta.description || key}</label>
          <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-xl bg-surface-container-lowest px-3 py-2 text-sm ghost-border">
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    if (type === "textview") {
      return (
        <div key={key} className="py-3">
          <label className="font-label text-xs font-medium">{meta.description || key}</label>
          <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={3} className="mt-1 w-full rounded-xl bg-surface-container-lowest px-3 py-2 font-body text-sm ghost-border" />
        </div>
      );
    }
    if (type === "list string") {
      const arr = Array.isArray(value) ? value as string[] : [];
      return (
        <div key={key} className="py-3">
          <label className="font-label text-xs font-medium">{meta.description || key}</label>
          <div className="mt-1 space-y-1">
            {arr.map((item, idx) => (
              <div key={idx} className="flex gap-2">
                <input value={item} onChange={(e) => { const copy = [...arr]; copy[idx] = e.target.value; onChange(copy); }} className="flex-1 rounded-lg bg-surface-container-lowest px-3 py-1.5 text-sm ghost-border" />
                <button onClick={() => { const copy = arr.filter((_, i) => i !== idx); onChange(copy); }} className="rounded-lg bg-error px-2 py-1 text-xs text-on-error">x</button>
              </div>
            ))}
            <button onClick={() => onChange([...arr, ""])} className="rounded-lg bg-primary px-3 py-1 text-xs text-on-primary">+ Add</button>
          </div>
        </div>
      );
    }
    // file or string fallback
    return (
      <div key={key} className="py-3">
        <label className="font-label text-xs font-medium">{meta.description || key}</label>
        <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-xl bg-surface-container-lowest px-3 py-2 font-body text-sm ghost-border" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Plugins"
        description="TS/JS-only plugins (parity with nicotine-plus pynicotine/pluginsystem.py — Python .py is blocked). Plugins run on the bridge with full Node access — only install trusted code. Settings persist in DATA_DIR/plugins.json."
      >
        <div className="rounded-xl bg-amber-500/10 px-4 py-3 font-body text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <span className="font-semibold">Security:</span> Plugins have unrestricted filesystem &amp; network access on the bridge (same as nicotine-plus desktop). Only <span className="font-mono">.ts</span>/<span className="font-mono">.js</span> plugins are allowed — Python (<span className="font-mono">.py</span>) and other languages are blocked (both zip and GitHub). Review source before installing — you assume full risk. GitHub installs are restricted to <span className="font-mono">github.com</span> / <span className="font-mono">githubusercontent.com</span> (10 s, 20 MB zip / 200 KB single file) and validated (zip-slip, path-traversal, 1 GiB, <span className="font-mono">export class Plugin extends BasePlugin</span> + <span className="font-mono">types.js</span> import, TS syntax). Built-ins <span className="font-mono">core_commands</span> / <span className="font-mono">spamfilter</span> are try/catch-only, no VM isolation.
        </div>
        <div className="py-2 flex items-center justify-between">
          <span className="font-label text-sm font-medium">Enable plugins (master)</span>
          <ToggleControl label="" checked={settings.plugins.enable} onChange={(v) => setOption("plugins", "enable", v)} />
        </div>
        <div className="py-2 text-xs text-on-surface-variant">Master switch stored locally; bridge reads DATA_DIR/plugins.json. Disable to prevent user plugins loading (core_commands still loads).</div>
      </SectionCard>

      <SectionCard
        title="Install plugin"
        description="Upload a .zip (folder with plugin.json/PLUGININFO + index.ts/.js) or install from GitHub (.ts/.js single file or zip). Only TypeScript/JavaScript — Python (.py) and other languages are blocked."
      >
        <div className="flex flex-col gap-4 py-4">
          <div>
            <div className="font-label text-xs font-medium mb-2">From .zip</div>
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <button onClick={() => fileInputRef.current?.click()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary" disabled={installing}>Choose .zip</button>
              <span className="font-body text-xs text-on-surface-variant self-center">{installing ? "Installing…" : "Zips like nicotine-plus (1 GiB, only .ts/.js)"}</span>
            </div>
            <div className="mt-2 font-body text-xs text-on-surface-variant">Zip must contain <span className="font-mono">plugin.json</span> (or inline <span className="font-mono">export const manifest</span>) + <span className="font-mono">index.ts</span>/<span className="font-mono">index.js</span> with <span className="font-mono">export class Plugin extends BasePlugin</span>. Only <span className="font-mono">.ts</span>/<span className="font-mono">.js</span> code is allowed — <span className="font-mono">.py</span> is blocked.</div>
          </div>
          <div className="border-t border-surface-container-high dark:border-surface-container-highest/40 pt-4">
            <div className="font-label text-xs font-medium mb-2">Add from GitHub — single file (.ts/.js) <span className="rounded-full bg-primary-container px-2 py-0.5 font-mono text-[10px]">NEW</span></div>
            <div className="flex gap-2">
              <input value={githubTsUrl} onChange={(e) => setGithubTsUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/user/repo/main/plugins/myplugin/index.ts or https://github.com/.../blob/.../index.ts" className="flex-1 rounded-xl bg-surface-container-lowest px-3 py-2 text-sm ghost-border" />
              <button onClick={handleGithubTsInstall} disabled={!githubTsUrl.trim() || installing} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Add</button>
            </div>
            <div className="mt-2 font-body text-xs text-on-surface-variant">Only <span className="font-mono">.ts</span>/<span className="font-mono">.js</span> (<span className="font-mono">.mts</span>/<span className="font-mono">.mjs</span> too) — Python (<span className="font-mono">.py</span>) and other languages are blocked. Must be raw GitHub URL (<span className="font-mono">raw.githubusercontent.com</span> or <span className="font-mono">github.com/.../blob/...</span> auto-normalized), 200 KB, 10 s. Requires <span className="font-mono">export class Plugin extends BasePlugin</span> + <span className="font-mono">from &quot;../types.js&quot;</span>. Mirrors nicotine-plus <span className="font-mono">PLUGININFO</span> + <span className="font-mono">__init__.py</span> but for TS/JS. <span className="font-mono">plugin.json</span> is fetched as sibling if present, otherwise inline <span className="font-mono">export const manifest</span> is used.</div>
          </div>
          <div className="border-t border-surface-container-high dark:border-surface-container-highest/40 pt-4">
            <div className="font-label text-xs font-medium mb-2">From URL — GitHub zip (legacy)</div>
            <div className="flex gap-2">
              <input value={urlInstall} onChange={(e) => setUrlInstall(e.target.value)} placeholder="https://github.com/user/repo/archive/main.zip or https://raw.githubusercontent.com/.../plugin.zip" className="flex-1 rounded-xl bg-surface-container-lowest px-3 py-2 text-sm ghost-border" />
              <button onClick={handleUrlInstall} disabled={!urlInstall.trim() || installing} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Install</button>
            </div>
            <div className="mt-2 font-body text-xs text-on-surface-variant">Only <span className="font-mono">https://github.com</span> / <span className="font-mono">*.githubusercontent.com</span> allowed (10 s timeout, 20 MB zip, 1 GiB uncompressed). Zip is validated same as above (only <span className="font-mono">.ts</span>/<span className="font-mono">.js</span>, no <span className="font-mono">.py</span>). You are responsible for code you install.</div>
          </div>
          {error ? <div className="rounded-xl bg-error-container px-3 py-2 text-xs text-on-error-container">{error}</div> : null}
        </div>
      </SectionCard>

      <SectionCard title="Installed plugins" description={loading ? "Loading…" : `${plugins.length} plugin${plugins.length !== 1 ? "s" : ""} — toggle, reload, uninstall, or configure via metasettings.`}>
        {loading ? (
          <div className="py-4 text-center text-sm text-on-surface-variant">Loading plugins…</div>
        ) : plugins.length === 0 ? (
          <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs text-on-surface-variant dark:bg-surface-container-highest/40">
            No plugins. Built-ins (<span className="font-mono">core_commands</span>, <span className="font-mono">spamfilter</span> disabled by default) and any zips you install will appear here. Enable a plugin to load it. <span className="font-mono">spamfilter</span> demonstrates <span className="font-mono">returncode.zap</span> blocking.
          </div>
        ) : (
          <div className="divide-y divide-surface-container-high dark:divide-surface-container-highest/40">
            {plugins.map((p) => {
              const metas = p.metasettings as Record<string, MetaSetting> | null;
              const hasSettings = metas && Object.keys(metas).length > 0;
              return (
                <div key={p.name} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-label text-sm font-medium flex items-center gap-2">
                        {p.humanName}
                        <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-mono text-[10px] leading-none text-on-surface-variant">{p.name}</span>
                        {p.isInternal ? <span className="rounded-full bg-tertiary-container px-2 py-0.5 text-[10px] text-on-tertiary-container">built-in</span> : null}
                      </div>
                      <div className="font-body text-xs text-on-surface-variant line-clamp-2">{String(p.info.Description ?? p.info.description ?? "")}</div>
                      <div className="font-mono text-[11px] text-outline">v{String(p.info.Version ?? p.info.version ?? "?")} · {((p.info.Authors ?? p.info.authors) as string[] | undefined)?.join(", ") ?? ""}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <ToggleControl label="" checked={p.enabled} onChange={() => handleToggle(p.name)} />
                      <div className="flex gap-1">
                        <button onClick={() => handleReload(p.name)} className="rounded-lg bg-surface-container-high px-2 py-1 font-label text-[10px] uppercase">Reload</button>
                        {!p.isInternal ? <button onClick={() => handleUninstall(p.name)} className="rounded-lg bg-error-container px-2 py-1 font-label text-[10px] uppercase text-on-error-container">Uninstall</button> : null}
                      </div>
                    </div>
                  </div>
                  {hasSettings ? (
                    <div className="mt-3">
                      <button onClick={() => openSettings(p)} className="font-label text-xs text-primary underline">{expandedSettings === p.name ? "Hide settings" : "Settings…"}</button>
                      {expandedSettings === p.name ? (
                        <div className="mt-3 rounded-xl bg-surface-container-lowest p-4 ghost-border">
                          {(() => {
                            const grouped = new Map<string, Array<[string, MetaSetting]>>();
                            for (const [k, meta] of Object.entries(metas as Record<string, MetaSetting>)) {
                              const g = meta.group || "General";
                              if (!grouped.has(g)) grouped.set(g, []);
                              grouped.get(g)!.push([k, meta]);
                            }
                            return Array.from(grouped.entries()).map(([group, fields]) => (
                              <div key={group} className="mb-4 rounded-lg bg-surface-container-low p-3">
                                <h4 className="font-label text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-2">{group}</h4>
                                {fields.map(([k, meta]) => renderField(k, meta, editValues[k]))}
                              </div>
                            ));
                          })()}
                          <div className="mt-4 flex gap-2">
                            <button onClick={() => saveSettings(p.name)} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary">Save</button>
                            <button onClick={() => resetSettings(p.name)} className="rounded-xl bg-surface-container-high px-4 py-2 text-sm">Reset</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Authoring" description="Write a TS/JS plugin in apps/bridge/src/plugins/builtin/ or as a user plugin (zip/GitHub .ts/.js). Only .ts/.js — Python is blocked.">
        <div className="rounded-xl bg-surface-container-high px-4 py-3 font-body text-xs leading-relaxed text-on-surface-variant dark:bg-surface-container-highest/40 font-mono whitespace-pre-wrap">
{`// myplugin/plugin.json  — required (mirrors nicotine-plus PLUGININFO + __init__.py but for TS/JS)
{"Name":"My Plugin","Version":"1.0","Description":"Demo","entry":"index.ts"}
// OR inline: export const manifest = {Name:"My Plugin",Version:"1.0",Description:"Demo"} in index.ts
 // myplugin/index.ts  (or index.js) — only .ts/.js allowed, .py blocked
import { BasePlugin, returncode } from "../types.js"; // must import from ../types.js
export const manifest = { Name: "My Plugin", Version: "1.0", Description: "Demo" }; // optional if plugin.json present
export class Plugin extends BasePlugin {
  init() { this.settings = {greet:"hi"}; this.metasettings={greet:{description:"Greet",type:"string"}} }
  incoming_public_chat_event(room,user,line){
    if(line.includes("spam")) return returncode.zap; // block
  }
  // commands: this.commands = { hello:{description:"Say hi", callback:(args)=> this.output("hi")} }
}`}
        </div>
      </SectionCard>
    </div>
  );
}
