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
  SearchResultMessage,
} from "@/lib/protocol";

export type SessionStatus = "idle" | "connecting" | "connected" | "failed";

export interface SessionState {
  status: SessionStatus;
  error?: string;
  user?: string;
  searching: boolean;
  results: SearchResultMessage[];
}

interface SessionApi {
  login: (req: Omit<LoginRequest, "type">) => void;
  logout: () => void;
  search: (query: string) => void;
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
  const [state, setState] = useState<SessionState>({
    status: "idle",
    searching: false,
    results: [],
  });
  const socketRef = useRef<WebSocket | null>(null);
  const generation = useRef(0);

  const teardown = useCallback(() => {
    generation.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  const logout = useCallback(() => {
    teardown();
    setState({ status: "idle", searching: false, results: [] });
  }, [teardown]);

  const login = useCallback(
    (req: Omit<LoginRequest, "type">) => {
      const gen = ++generation.current;
      socketRef.current?.close();
      setState({ status: "connecting", searching: false, results: [] });

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
            setState((s) => ({ ...s, status: "failed", error: data.error }));
            break;
          case "search:start":
            setState((s) => ({ ...s, searching: true }));
            break;
          case "search:result":
            setState((s) => ({ ...s, results: [...s.results, data] }));
            break;
          case "search:done":
            setState((s) => ({ ...s, searching: false }));
            break;
        }
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
    [],
  );

  const search = useCallback((query: string) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setState((s) => ({ ...s, searching: true, results: [] }));
    const msg: BridgeInboundMessage = { type: "search", query };
    ws.send(JSON.stringify(msg));
  }, []);

  const api = useMemo<SessionApi>(
    () => ({ login, logout, search, state }),
    [login, logout, search, state],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
