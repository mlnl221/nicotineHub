"use client";

import {
  createContext,
  useCallback,
  useContext,
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

function bridgeUrl(): string {
  if (typeof window === "undefined") return "";
  const override = window.localStorage.getItem("nicotine.bridgeUrl");
  if (override) return override;

  const configured = process.env.NEXT_PUBLIC_BRIDGE_URL;
  if (configured) return configured;

  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.hostname}:8787/ws`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() => {
    if (typeof window !== "undefined") {
      try {
        if (sessionStorage.getItem("__mockLoggedIn") === "1") return { status: "connected", user: "tester" };
      } catch {}
    }
    return { status: "idle" };
  });
  const socketRef = useRef<WebSocket | null>(null);
  const generation = useRef(0);
  const listeners = useRef<Set<(msg: BridgeOutboundMessage) => void>>(new Set());

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
      const gen = ++generation.current;
      socketRef.current?.close();
      setState({ status: "connecting" });

      const ws = new WebSocket(bridgeUrl());
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
            if (state.status !== "connected") {
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
          error: "Could not reach the Nicotine bridge. Is it running?",
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
    [state.status],
  );

  const send = useCallback((msg: BridgeInboundMessage) => {
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
