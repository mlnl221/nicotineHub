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
import { clearDemoStorage, seedDemoStorage } from "@/lib/demo/seed";

export type SessionStatus = "idle" | "connecting" | "connected" | "failed";

export interface SessionState {
  status: SessionStatus;
  error?: string;
  user?: string;
}

interface SessionApi {
  login: (req: Omit<LoginRequest, "type">) => void;
  logout: () => void;
  /** Send a raw message over the open bridge socket (queued if not yet open). */
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
  return ["bearer", tok];
}

const HEARTBEAT_MS = 25_000;
const PONG_TIMEOUT_MS = 5_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  // Hydration-safe: always start idle on server + first client render.
  // Hydrate from sessionStorage after mount so Sidebar/TopBar don't mismatch
  // (was: conditional initializer read sessionStorage during render → Sidebar badge (2) / user "demo" vs "System Administrator").
  const [state, setState] = useState<SessionState>({ status: "idle" });
  useEffect(() => {
    try {
      if (isDemo) {
        const saved = sessionStorage.getItem("__mockLoggedIn");
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as { user?: string };
            if (parsed?.user) { setState({ status: "connected", user: parsed.user }); return; }
          } catch {
            if (saved === "1") { setState({ status: "connected", user: "demo" }); return; }
          }
        }
      } else if (sessionStorage.getItem("__mockLoggedIn") === "1") setState({ status: "connected", user: "tester" });
    } catch {}
  }, []);
  const socketRef = useRef<WebSocket | null>(null);
  const generation = useRef(0);
  const listeners = useRef<Set<(msg: BridgeOutboundMessage) => void>>(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;

  const lastLogin = useRef<Omit<LoginRequest, "type"> | null>(null);
  const shouldReconnect = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendQueue = useRef<BridgeInboundMessage[]>([]);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
    if (pongTimer.current) { clearTimeout(pongTimer.current); pongTimer.current = null; }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
  }, []);

  const teardown = useCallback(() => {
    generation.current += 1;
    clearHeartbeat();
    clearReconnect();
    shouldReconnect.current = false;
    reconnectAttempts.current = 0;
    sendQueue.current = [];
    socketRef.current?.close();
    socketRef.current = null;
  }, [clearHeartbeat, clearReconnect]);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem("__mockLoggedIn");
      sessionStorage.removeItem("__mockTransfers");
      if (isDemo) clearDemoStorage();
    } catch {}
    teardown();
    lastLogin.current = null;
    setState({ status: "idle" });
  }, [teardown]);

  const connectSocket = useCallback((loginReq: Omit<LoginRequest, "type">) => {
    const gen = ++generation.current;
    socketRef.current?.close();
    setState({ status: "connecting" });

    const protocols = bridgeProtocols();
    const ws = protocols ? new WebSocket(bridgeUrl(), protocols) : new WebSocket(bridgeUrl());
    socketRef.current = ws;

    ws.onopen = () => {
      if (generation.current !== gen) return;
      reconnectAttempts.current = 0;
      // flush queued sends
      const queued = [...sendQueue.current];
      sendQueue.current = [];
      // send login first
      const msg: LoginRequest = { type: "login", ...loginReq };
      try { ws.send(JSON.stringify(msg)); } catch {}
      for (const q of queued) {
        if ((q as { type: string }).type === "login") continue;
        try { ws.send(JSON.stringify(q)); } catch {}
      }
      // heartbeat 25s
      clearHeartbeat();
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(JSON.stringify({ type: "ping", ts: Date.now() })); } catch {}
        if (pongTimer.current) clearTimeout(pongTimer.current);
        pongTimer.current = setTimeout(() => {
          try { ws.close(); } catch {}
        }, PONG_TIMEOUT_MS);
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (event) => {
      if (generation.current !== gen) return;
      let data: BridgeOutboundMessage;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if ((data as { type: string }).type === "pong") {
        if (pongTimer.current) { clearTimeout(pongTimer.current); pongTimer.current = null; }
        // still forward to listeners in case someone cares
      }

      switch (data.type) {
        case "login:result":
          if (data.ok) {
            setState((s) => ({ ...s, status: "connected", user: loginReq.username, error: undefined }));
            clearReconnect();
            reconnectAttempts.current = 0;
            shouldReconnect.current = true;
          } else {
            // auth failures should NOT auto-reconnect (invalid pass etc)
            const isAuthFailure = /INVALIDPASS|INVALIDUSERNAME|EMPTYPASSWORD|INVALIDVERSION/i.test(data.error || "");
            shouldReconnect.current = !isAuthFailure;
            setState((s) => ({ ...s, status: "failed", error: data.error }));
            clearHeartbeat();
            if (shouldReconnect.current) scheduleReconnect();
          }
          break;
        case "error":
          if (stateRef.current.status !== "connected") {
            setState((s) => ({ ...s, status: "failed", error: data.error }));
          }
          break;
      }

      listeners.current.forEach((cb) => cb(data));
    };

    ws.onerror = () => {
      if (generation.current !== gen) return;
      // let onclose handle reconnect; just surface error if idle
      if (stateRef.current.status !== "connected" && stateRef.current.status !== "connecting") {
        setState((s) => ({ ...s, status: "failed", error: "Could not reach the Nicotine Hub bridge. Is it running?" }));
      }
    };

    ws.onclose = () => {
      if (generation.current !== gen) return;
      clearHeartbeat();
      if (shouldReconnect.current && lastLogin.current) {
        setState((s) => s.status === "connected" ? { ...s, status: "connecting" } : s);
        scheduleReconnect();
      } else {
        setState((s) =>
          s.status === "connected"
            ? s
            : { ...s, status: "failed", error: "Connection to the bridge closed." },
        );
      }
    };
  }, [clearHeartbeat]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) return;
    if (!shouldReconnect.current || !lastLogin.current) return;
    const attempt = reconnectAttempts.current++;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * Math.pow(2, attempt));
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(RECONNECT_MIN_MS, Math.round(base + jitter));
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      if (!shouldReconnect.current || !lastLogin.current) return;
      // respect offline
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        scheduleReconnect();
        return;
      }
      connectSocket(lastLogin.current);
    }, delay);
  }, [connectSocket]);

  const login = useCallback(
    (req: Omit<LoginRequest, "type">) => {
      // Demo: accept any username/password, no bridge
      if (isDemo) {
        const user = req.username.trim() || "demo";
        if (!req.username.trim() || !req.password) {
          if (!req.username.trim()) {
            setState({ status: "failed", error: "Enter any username to try the demo." });
            return;
          }
        }
        setState({ status: "connecting" });
        setTimeout(() => {
          try {
            sessionStorage.setItem("__mockLoggedIn", JSON.stringify({ user }));
            // Seed demo fixtures on first login — provides 2 chats/shares/profiles/searches/buddies/transfers
            if (isDemo) seedDemoStorage();
          } catch {}
          setState({ status: "connected", user, error: undefined });
          const result: BridgeOutboundMessage = {
            type: "login:result",
            ok: true,
            data: { success: true, banner: "Welcome to Nicotine Hub (Demo)", ipAddress: "203.0.113.1", checksum: "demo", isSupporter: true },
          };
          listeners.current.forEach((cb) => cb(result));
          emitRoomList(listeners.current);
        }, 420);
        return;
      }

      lastLogin.current = req;
      shouldReconnect.current = true;
      reconnectAttempts.current = 0;
      clearReconnect();
      connectSocket(req);
    },
    [connectSocket, clearReconnect],
  );

  const send = useCallback((msg: BridgeInboundMessage) => {
    if (isDemo) {
      const handled = handleDemoSend(msg, listeners.current, stateRef.current.user);
      if (handled) return;
      // fallthrough for unknown demo messages -> ignore
      return;
    }
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); } catch {}
    } else {
      // queue (cap 100)
      if (sendQueue.current.length < 100) sendQueue.current.push(msg);
    }
  }, []);

  const subscribe = useCallback((cb: (msg: BridgeOutboundMessage) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  // online / visibility handlers for reconnect
  useEffect(() => {
    const onOnline = () => {
      if (shouldReconnect.current && lastLogin.current && (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN)) {
        clearReconnect();
        reconnectAttempts.current = 0;
        connectSocket(lastLogin.current);
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible" && shouldReconnect.current && lastLogin.current) {
        const ws = socketRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          clearReconnect();
          reconnectAttempts.current = 0;
          connectSocket(lastLogin.current);
        }
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [connectSocket, clearReconnect]);

  useEffect(() => {
    return () => {
      clearHeartbeat();
      clearReconnect();
      socketRef.current?.close();
    };
  }, [clearHeartbeat, clearReconnect]);

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
