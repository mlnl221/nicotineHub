"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/lib/session";

export function LoginForm() {
  const { login, logout, state } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [host, setHost] = useState("server.slsknet.org");
  const [port, setPort] = useState("2242");

  const busy = state.status === "connecting";
  const succeeded = state.status === "connected";

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.length > 0 && !busy && !succeeded,
    [username, password, busy, succeeded],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    login({
      username: username.trim(),
      password,
      ...(showServer
        ? { host: host.trim() || undefined, port: Number(port) || undefined }
        : {}),
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
      <div className="space-y-6">
        <div className="space-y-4">
          {state.status === "failed" && state.error ? (
            <div
              role="alert"
              className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container"
            >
              {state.error}
            </div>
          ) : null}

          <Field label="Username" id="username">
            <input
              id="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="soulseek_username"
              className="w-full rounded-xl bg-surface-container-lowest px-4 py-3 font-body text-sm text-on-surface placeholder:text-outline ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Password" id="password">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl bg-surface-container-lowest px-4 py-3 font-body text-sm text-on-surface placeholder:text-outline ghost-border transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

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
          className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-container px-6 py-4 font-label text-sm font-semibold text-on-primary shadow-md shadow-primary/10 transition-all hover:from-primary-container hover:to-primary hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? <Spinner /> : "Log in"}
        </button>

        {/* Security warning */}
        <div className="mt-8 px-4 text-center">
          <p className="font-body text-[11px] leading-relaxed text-on-surface-variant/70">
            Your username and password are sent directly to the Soulseek server using its native
            protocol, which is <span className="font-semibold text-error/80">not encrypted</span>.
            Only use credentials you trust.
          </p>
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
