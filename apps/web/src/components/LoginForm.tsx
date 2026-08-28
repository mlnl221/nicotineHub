"use client";

import { useMemo, useState } from "react";
import { useLogin } from "@/lib/useLogin";

export function LoginForm() {
  const { login, reset, state } = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [host, setHost] = useState("server.slsknet.org");
  const [port, setPort] = useState("2242");

  const busy = state.status === "connecting";
  const succeeded = state.status === "succeeded";

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.length > 0 && !busy && !succeeded,
    [username, password, busy, succeeded],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    login({
      username: username.trim(),
      password,
      ...(showServer ? { host: host.trim() || undefined, port: Number(port) || undefined } : {}),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-md flex-1 flex-col justify-end gap-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8"
    >
      {succeeded ? (
        <SuccessPanel banner={state.result?.banner} username={username} />
      ) : (
        <FieldsPanel
          username={username}
          setUsername={setUsername}
          password={password}
          setPassword={setPassword}
          showServer={showServer}
          setShowServer={setShowServer}
          host={host}
          setHost={setHost}
          port={port}
          setPort={setPort}
          error={state.status === "failed" ? state.error : undefined}
        />
      )}

      <div className="flex gap-3">
        {succeeded ? (
          <button
            type="button"
            onClick={() => {
              reset();
              setPassword("");
            }}
            className="h-12 flex-1 rounded-xl border border-zinc-700 font-medium text-zinc-200 transition active:scale-[0.98]"
          >
            Sign out
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSubmit}
            className="h-12 flex-1 rounded-xl bg-indigo-500 font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Spinner /> : "Log in"}
          </button>
        )}
      </div>

      <p className="px-2 text-center text-[11px] leading-relaxed text-zinc-500">
        Your username and password are sent directly to the Soulseek server using its native
        protocol, which is <span className="text-zinc-400">not encrypted</span>. Only use
        credentials you trust.
      </p>
    </form>
  );
}

function FieldsPanel(props: {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showServer: boolean;
  setShowServer: (v: boolean) => void;
  host: string;
  setHost: (v: string) => void;
  port: string;
  setPort: (v: string) => void;
  error?: string;
}) {
  const {
    username,
    setUsername,
    password,
    setPassword,
    showServer,
    setShowServer,
    host,
    setHost,
    port,
    setPort,
    error,
  } = props;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-zinc-300">Username</span>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          inputMode="text"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="soulseek_username"
          className="h-12 rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 text-base text-white placeholder-zinc-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-[13px] font-medium text-zinc-300">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="h-12 rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 text-base text-white placeholder-zinc-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        />
      </label>

      <button
        type="button"
        onClick={() => setShowServer(!showServer)}
        className="self-start text-[13px] text-zinc-400 underline-offset-2 hover:underline"
      >
        {showServer ? "Hide" : "Advanced"} server settings
      </button>

      {showServer ? (
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-zinc-300">Host</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="h-11 rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 text-sm text-white outline-none focus:border-indigo-500"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-zinc-300">Port</span>
            <input
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="h-11 rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 text-sm text-white outline-none focus:border-indigo-500"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function SuccessPanel(props: { banner?: string; username: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl">
        <span className="text-emerald-400">✓</span>
      </div>
      <div>
        <h2 className="text-lg font-semibold">Logged in</h2>
        <p className="text-sm text-zinc-400">Signed in as {props.username}</p>
      </div>
      {props.banner ? (
        <p className="rounded-xl bg-zinc-800/60 px-4 py-3 text-sm italic text-zinc-300">
          {props.banner}
        </p>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
  );
}
