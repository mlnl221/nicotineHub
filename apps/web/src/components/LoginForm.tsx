"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from "@/lib/config/defaults";
import { isDemo } from "@/lib/demo";

export function LoginForm() {
  const { login, logout, state } = useSession();
  const { settings, setOption } = useConfig();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [host, setHost] = useState(settings.server.server.host);
  const [port, setPort] = useState(String(settings.server.server.port));

  // Keep host/port in sync when Settings → Network changes them (settings-audit P0)
  useEffect(() => {
    setHost(settings.server.server.host);
    setPort(String(settings.server.server.port));
  }, [settings.server.server.host, settings.server.server.port]);

  const busy = state.status === "connecting";
  const succeeded = state.status === "connected";

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.length > 0 && !busy && !succeeded,
    [username, password, busy, succeeded],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const hostValue = host.trim() || DEFAULT_SERVER_HOST;
    const portValue = Number(port) || DEFAULT_SERVER_PORT;
    setOption("server", "server", { host: hostValue, port: portValue });
    // Settings → Network host/port is authoritative: always send it (nicotine-plus server tuple parity).
    // Keep showServer toggle for UI disclosure, but login always respects Settings.
    login({
      username: username.trim(),
      password,
      host: hostValue,
      port: portValue,
    });
  };

  if (succeeded) {
    return (
      <div className="w-full space-y-6">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tertiary-container text-on-tertiary-container">
            <span className="material-symbols-outlined text-3xl">check</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-on-surface">Logged in</h2>
            <p className="text-sm text-on-surface-variant">Signed in as {username}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => logout()}
          className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest py-3 font-label text-sm font-semibold text-on-surface transition-all active:scale-[0.98] hover:bg-surface-container"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="space-y-5">
        <div className="space-y-4">
          {state.status === "failed" && state.error ? (
            <div
              role="alert"
              className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container"
            >
              {state.error}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline-variant pl-1" htmlFor="username">
              Username
            </label>
            <div className="relative flex items-center bg-surface-container-lowest dark:bg-surface-dim rounded-lg ghost-border transition-colors focus-within:border-primary dark:focus-within:border-primary-fixed-dim">
              <span className="material-symbols-outlined absolute left-3 text-on-surface-variant/60 dark:text-outline-variant/60 text-[20px]">person</span>
              <input
                id="username"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full bg-transparent border-none py-3 pl-10 pr-4 font-body text-sm text-on-surface dark:text-inverse-on-surface placeholder:text-outline-variant/50 focus:ring-0 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline-variant pl-1" htmlFor="password">
              Password
            </label>
            <div className="relative flex items-center bg-surface-container-lowest dark:bg-surface-dim rounded-lg ghost-border transition-colors focus-within:border-primary dark:focus-within:border-primary-fixed-dim">
              <span className="material-symbols-outlined absolute left-3 text-on-surface-variant/60 dark:text-outline-variant/60 text-[20px]">lock</span>
              <input
                id="password"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-transparent border-none py-3 pl-10 pr-10 font-body text-sm text-on-surface dark:text-inverse-on-surface placeholder:text-outline-variant/50 focus:ring-0 focus:outline-none"
              />
              <button type="button" onClick={() => setShowPass(!showPass)} aria-label="Toggle password visibility" className="absolute right-3 text-on-surface-variant/60 hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[18px]">{showPass ? "visibility_off" : "visibility"}</span>
              </button>
            </div>
          </div>

          {showServer ? (
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 flex flex-col gap-1.5">
                <span className="font-label text-xs tracking-wide text-on-surface-variant">Host</span>
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full rounded-xl bg-surface-container-lowest px-3 py-3 font-body text-sm text-on-surface ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-label text-xs tracking-wide text-on-surface-variant">Port</span>
                <input
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full rounded-xl bg-surface-container-lowest px-3 py-3 font-body text-sm text-on-surface ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
            </div>
          ) : null}
        </div>

        {/* Advanced settings link */}
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setShowServer(!showServer)}
            className="group flex items-center gap-1 font-label text-xs text-on-surface-variant transition-colors hover:text-primary"
          >
            <span>Advanced server settings</span>
            <span className="material-symbols-outlined text-[14px] transition-transform group-hover:translate-y-px">
              expand_more
            </span>
          </button>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg bg-gradient-to-r from-primary to-primary-container px-6 py-4 font-label text-sm font-bold uppercase tracking-widest text-on-primary btn-glow transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Spinner /> : <>Log in <span className="material-symbols-outlined text-sm">arrow_forward</span></>}
        </button>


        {/* Security warning */}
        <div className="mt-6 px-2 text-center">
          {isDemo ? (
            <p className="font-body text-[11px] leading-relaxed text-on-surface-variant/60">
              Demo mode — no server connection. Enter any username/password to explore mocked data. No credentials are sent anywhere.
            </p>
          ) : (
            <p className="font-body text-[11px] leading-relaxed text-on-surface-variant/60">
              Your username and password are sent directly to the Soulseek server using its native
              protocol, which is <span className="font-semibold text-error/70">not encrypted</span>.
              Only use credentials you trust. We do not store your password.
            </p>
          )}
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-label text-xs tracking-wide text-on-surface-variant" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary" />
  );
}
