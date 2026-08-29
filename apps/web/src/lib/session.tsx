"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BridgeInboundMessage,
  BridgeOutboundMessage,
  LoginRequest,
} from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { emitRoomList, handleDemoSend } from "@/lib/demo/mock";

export type SessionStatus = "idle" | "connecting" | "connected" | "failed";

export interface SessionState {
  status: SessionStatus;
  error?: string;
  user?: string;
}

interface SessionApi {
  login: (req: Omit<LoginRequest, "type">) => void;
  logout: () => void;
  /** Send a raw message over the open bridge socket. */
  send: (msg: BridgeInboundMessage) => void;
  /** Subscribe to all inbound bridge messages (including search messages). */
  subscribe: (cb: (msg: BridgeOutboundMessage) => void) => () => void;
  state: SessionState;
}

const SessionContext = createContext<SessionApi | null>(null);

function bridgeToken(): string | null {
  if (typeof window === "undefined") return null;
  const ls = window.localStorage.getItem("nicotine.bridgeToken");
  if (ls) return ls;
  const env = process.env.NEXT_PUBLIC_BRIDGE_TOKEN;
  if (env) return env;
  return null;
}

function bridgeUrl(): string {
  if (typeof window === "undefined") return "";
  const override = window.localStorage.getItem("nicotine.bridgeUrl");
  if (override) {
    const tok = bridgeToken();
    if (tok && !override.includes("token=")) return override.includes("?") ? `${override}&token=${encodeURIComponent(tok)}` : `${override}?token=${encodeURIComponent(tok)}`;
    return override;
  }

  const configured = process.env.NEXT_PUBLIC_BRIDGE_URL;
  if (configured) {
    const tok = bridgeToken();
    if (tok && !configured.includes("token=")) return configured.includes("?") ? `${configured}&token=${encodeURIComponent(tok)}` : `${configured}?token=${encodeURIComponent(tok)}`;
    return configured;
  }

  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${scheme}//${window.location.hostname}:8787/ws`;
  const tok = bridgeToken();
  if (tok) return `${base}?token=${encodeURIComponent(tok)}`;
  return base;
}

function bridgeProtocols(): string[] | undefined {
  const tok = bridgeToken();
  if (!tok) return undefined;
  // Also send via Sec-WebSocket-Protocol as fallback for bridge's token check
  // Use "bearer, <token>" pattern expected by server.ts extractToken
  return ["bearer", tok];
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() => {
    if (typeof window !== "undefined") {
      try {
        if (isDemo) {
          const saved = sessionStorage.getItem("__mockLoggedIn");
          if (saved) {
            try {
              const parsed = JSON.parse(saved) as { user?: string };
              if (parsed?.user) return { status: "connected", user: parsed.user };
            } catch {
              if (saved === "1") return { status: "connected", user: "demo" };
            }
          }
        } else if (sessionStorage.getItem("__mockLoggedIn") === "1") return { status: "connected", user: "tester" };
      } catch {}
    }
    return { status: "idle" };
  });
  const socketRef = useRef<WebSocket | null>(null);
  const generation = useRef(0);
  const listeners = useRef<Set<(msg: BridgeOutboundMessage) => void>>(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;

  const teardown = useCallback(() => {
    generation.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  const logout = useCallback(() => {
    try { sessionStorage.removeItem("__mockLoggedIn"); sessionStorage.removeItem("__mockTransfers"); } catch {}
    teardown();
    setState({ status: "idle" });
  }, [teardown]);

  const login = useCallback(
    (req: Omit<LoginRequest, "type">) => {
      // Demo: accept any username/password, no bridge
      if (isDemo) {
        const user = req.username.trim() || "demo";
        if (!req.username.trim() || !req.password) {
          // For demo we still allow empty? Require at least username; password is ignored
          if (!req.username.trim()) {
            setState({ status: "failed", error: "Enter any username to try the demo." });
            return;
          }
        }
        setState({ status: "connecting" });
        setTimeout(() => {
          try {
            sessionStorage.setItem("__mockLoggedIn", JSON.stringify({ user }));
          } catch {}
          setState({ status: "connected", user, error: undefined });
          const result: BridgeOutboundMessage = {
            type: "login:result",
            ok: true,
            data: { success: true, banner: "Welcome to Nicotine Hub (Demo)", ipAddress: "203.0.113.1", checksum: "demo", isSupporter: true },
          };
          listeners.current.forEach((cb) => cb(result));
          // Pre-seed room list for chat page
          emitRoomList(listeners.current);
        }, 420);
        return;
      }

      const gen = ++generation.current;
      socketRef.current?.close();
      setState({ status: "connecting" });

      const protocols = bridgeProtocols();
      const ws = protocols ? new WebSocket(bridgeUrl(), protocols) : new WebSocket(bridgeUrl());
      socketRef.current = ws;

      ws.onopen = () => {
        if (generation.current !== gen) return;
        const msg: LoginRequest = { type: "login", ...req };
        ws.send(JSON.stringify(msg));
      };

      ws.onmessage = (event) => {
        if (generation.current !== gen) return;
        let data: BridgeOutboundMessage;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (data.type) {
          case "login:result":
            if (data.ok) {
              setState((s) => ({ ...s, status: "connected", user: req.username, error: undefined }));
            } else {
              setState((s) => ({ ...s, status: "failed", error: data.error }));
            }
            break;
          case "error":
            // Only treat as a fatal login error if we aren't connected yet.
            if (stateRef.current.status !== "connected") {
              setState((s) => ({ ...s, status: "failed", error: data.error }));
            }
            break;
        }

        // Forward every message to subscribers (e.g. the search provider).
        listeners.current.forEach((cb) => cb(data));
      };

      ws.onerror = () => {
        if (generation.current !== gen) return;
        setState((s) => ({
          ...s,
          status: "failed",
          error: "Could not reach the Nicotine Hub bridge. Is it running?",
        }));
      };

      ws.onclose = () => {
        if (generation.current !== gen) return;
        setState((s) =>
          s.status === "connected"
            ? s
            : { ...s, status: "failed", error: "Connection to the bridge closed." },
        );
      };
    },
    [],
  );

  const send = useCallback((msg: BridgeInboundMessage) => {
    if (isDemo) {
      const handled = handleDemoSend(msg, listeners.current, stateRef.current.user);
      if (handled) return;
      // fallthrough for unknown demo messages -> ignore
      return;
    }
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  const subscribe = useCallback((cb: (msg: BridgeOutboundMessage) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const api = useMemo<SessionApi>(
    () => ({ login, logout, send, subscribe, state }),
    [login, logout, send, subscribe, state],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
