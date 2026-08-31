"use client";

/**
 * Helper to derive HTTP base URL for bridge REST APIs from the WS URL logic
 * used in session.tsx (localStorage.nicotineHub.bridgeUrl > NEXT_PUBLIC_BRIDGE_URL > hostname:8787).
 * Also handles BRIDGE_TOKEN via query param or Authorization header.
 */

function getBridgeToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = (window.localStorage.getItem("nicotineHub.bridgeToken") ?? window.localStorage.getItem("nicotine.bridgeToken"));
    if (ls) return ls;
  } catch {}
  const env = process.env.NEXT_PUBLIC_BRIDGE_TOKEN;
  if (env) return env;
  return null;
}

function getRawBridgeWsUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    const override = (window.localStorage.getItem("nicotineHub.bridgeUrl") ?? window.localStorage.getItem("nicotine.bridgeUrl"));
    if (override) return override;
  } catch {}
  const configured = process.env.NEXT_PUBLIC_BRIDGE_URL;
  if (configured) return configured;
  const scheme = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  // Support worktree port helpers (8788/8789) — mirror session fallback not exhaustive
  const port = typeof window !== "undefined" && (window.location.port === "3001" ? "8788" : window.location.port === "3002" ? "8789" : "8787");
  return `${scheme}//${host}:${port}/ws`;
}

export function getBridgeHttpBase(): string {
  const raw = getRawBridgeWsUrl();
  if (!raw) return "";
  try {
    // Handle ws://host:port/ws?token=...  -> http://host:port
    const u = new URL(raw);
    const scheme = u.protocol === "wss:" ? "https:" : "http:";
    const port = u.port || "8787";
    return `${scheme}//${u.hostname}:${port}`;
  } catch {
    // Fallback simple replace
    return raw.replace(/^ws/, "http").replace(/\/ws.*$/, "");
  }
}

export function bridgeFetchHeaders(): Record<string, string> {
  const tok = getBridgeToken();
  if (!tok) return {};
  return { Authorization: `Bearer ${tok}` };
}

export function bridgeFetchUrl(pathWithQuery: string): string {
  const base = getBridgeHttpBase();
  const url = `${base}${pathWithQuery}`;
  const tok = getBridgeToken();
  if (tok) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${encodeURIComponent(tok)}`;
  }
  return url;
}

export type BridgeFileEntry = {
  name: string;
  type: "directory" | "file" | "symlink";
  size: number;
  mtime: number;
  path: string;
};

export type BridgeFilesResponse = {
  path: string;
  parent: string | null;
  entries: BridgeFileEntry[];
};
