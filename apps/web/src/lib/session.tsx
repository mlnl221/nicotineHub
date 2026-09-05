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
import { useRouter } from "next/navigation";
import { isDemo } from "@/lib/demo";
import { emitRoomList, handleDemoSend } from "@/lib/demo/mock";
import { clearDemoStorage, seedDemoStorage } from "@/lib/demo/seed";
import { getLocal, getSession } from "@/lib/storage";

export type SessionStatus = "idle" | "connecting" | "connected" | "failed";

export interface SessionState {
  status: SessionStatus;
  error?: string;
  user?: string;
  /** True while a background reconnect is in progress — UI stays on `connected` */
  reconnecting?: boolean;
  /**
   * True once first-run resolution completes (stored-cred check done, whether
   * or not creds existed). `initialized && status === "idle"` unambiguously
   * means logged out with nothing pending — safe to bounce to login.
   * Maintained as separate state so existing setState sites need no changes.
   */
  initialized?: boolean;
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
  const ls = getLocal("nicotineHub.bridgeToken");
  if (ls) return ls;
  const env = process.env.NEXT_PUBLIC_BRIDGE_TOKEN;
  if (env) return env;
  return null;
}

function bridgeUrl(): string {
  if (typeof window === "undefined") return "";
  const override = getLocal("nicotineHub.bridgeUrl");
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

  // No override and no build-time URL: same-origin /ws through the web
  // entrypoint (proxy-server.js pipes it to the bridge), so bridge :8787
  // needs no published host port. Remote-bridge setups (Vercel demo, NAS)
  // keep working via localStorage override or NEXT_PUBLIC_BRIDGE_URL above.
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${scheme}//${window.location.host}/ws`;
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

// Homelab: persist creds for auto-login after reconnect/reload.
// Use sessionStorage (ephemeral) + cookie fallback (30d, SameSite Lax) —
// localStorage intentionally not used for password (README security note).
// For homelab convenience we auto-login if any creds are present.
const EPHEMERAL_KEY = "nicotineHub.ephemeralCreds";
const COOKIE_NAME = "nicotineHub_creds";

function saveCreds(req: Omit<LoginRequest, "type">) {
  try {
    const data = JSON.stringify(req);
    sessionStorage.setItem(EPHEMERAL_KEY, data);
    const b64 = btoa(unescape(encodeURIComponent(data)));
    const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
    document.cookie = `${COOKIE_NAME}=${b64}; Path=/; SameSite=Lax; Max-Age=2592000${isSecure ? "; Secure" : ""}`;
  } catch {}
}
function loadCreds(): Omit<LoginRequest, "type"> | null {
  try {
    const raw = getSession(EPHEMERAL_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Omit<LoginRequest, "type">;
        if (parsed?.username && parsed?.password) return parsed;
      } catch {}
    }
    const match = document.cookie
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE_NAME + "=") || s.startsWith("nicotine_creds="));
    if (match) {
      const b64 = match.split("=").slice(1).join("=");
      try {
        const json = decodeURIComponent(escape(atob(b64)));
        const parsed = JSON.parse(json) as Omit<LoginRequest, "type">;
        if (parsed?.username && parsed?.password) {
          // Repopulate sessionStorage for faster next load
          try { sessionStorage.setItem(EPHEMERAL_KEY, JSON.stringify(parsed)); } catch {}
          return parsed;
        }
      } catch {}
    }
  } catch {}
  return null;
}
function clearCreds() {
  try { sessionStorage.removeItem(EPHEMERAL_KEY); sessionStorage.removeItem(EPHEMERAL_KEY.replace("nicotineHub.", "nicotine.")); } catch {}
  try {
    // Mirror saveCreds attributes (Path + SameSite + Secure) so deletion matches the
    // stored cookie on all browsers. Safari in particular requires SameSite/Secure to
    // match for removal. Use both Max-Age=0 and Expires for compatibility.
    const baseAttrs = "Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = `${COOKIE_NAME}=; ${baseAttrs}`;
    document.cookie = `${COOKIE_NAME}=; ${baseAttrs}; Secure`;
    document.cookie = `nicotine_creds=; ${baseAttrs}`;
    document.cookie = `nicotine_creds=; ${baseAttrs}; Secure`;
  } catch {}
  // Also clear any legacy localStorage password if ever set
  try { localStorage.removeItem("nicotineHub.rememberedCreds"); localStorage.removeItem("nicotine.rememberedCreds"); } catch {}
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // Hydration-safe: always start idle on server + first client render.
  // Hydrate from sessionStorage after mount so Sidebar/TopBar don't mismatch
  // (was: conditional initializer read sessionStorage during render → Sidebar badge (2) / user "demo" vs "System Administrator").
  const [state, setState] = useState<SessionState>({ status: "idle" });
  const [initialized, setInitialized] = useState(false);
  const router = useRouter();
  useEffect(() => {
    try {
      if (isDemo) {
        const saved = sessionStorage.getItem("__mockLoggedIn");
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as { user?: string };
            if (parsed?.user) { setState({ status: "connected", user: parsed.user, reconnecting: false }); return; }
          } catch {
            if (saved === "1") { setState({ status: "connected", user: "demo", reconnecting: false }); return; }
          }
        }
      } else if (sessionStorage.getItem("__mockLoggedIn") === "1") setState({ status: "connected", user: "tester", reconnecting: false });
    } catch {}
  }, []);

  // Homelab auto-login ref — actual effect is after login() is defined to avoid TDZ
  const autoLoginAttempted = useRef(false);
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
    const ws = socketRef.current;
    socketRef.current = null;
    // Explicit logoff so the bridge drops the Soulseek server session
    // immediately instead of relying on the WS close handshake.
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "logout" })); } catch {}
    }
    try { ws?.close(); } catch {}
  }, [clearHeartbeat, clearReconnect]);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem("__mockLoggedIn");
      sessionStorage.removeItem("__mockTransfers");
      if (isDemo) clearDemoStorage();
    } catch {}
    clearCreds();
    teardown();
    lastLogin.current = null;
    setState({ status: "idle", reconnecting: false });
    // Protected pages render a spinner on `idle` — route home to the login form.
    router.replace("/");
  }, [teardown, router]);

  const connectSocket = useCallback((loginReq: Omit<LoginRequest, "type">) => {
    const gen = ++generation.current;
    socketRef.current?.close();
    // Background reconnect: keep UI on `connected` with subtle banner, don't flash fullscreen spinner
    if (stateRef.current.status === "connected" || stateRef.current.reconnecting) {
      setState((s) => ({ ...s, reconnecting: true, error: undefined }));
    } else {
      setState({ status: "connecting", reconnecting: false });
    }

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
            setState((s) => ({ ...s, status: "connected", user: loginReq.username, error: undefined, reconnecting: false }));
            clearReconnect();
            reconnectAttempts.current = 0;
            shouldReconnect.current = true;
          } else {
            // auth failures should NOT auto-reconnect (invalid pass etc) — also clear persisted creds so we don't loop with bad password
            // BANNED is silent close per SLSKPROTOCOL.md:124 — server omits response, bridge emits BANNED. Stop retry and show actionable message.
            const errStr = data.error || "";
            const isAuthFailure = /INVALIDPASS|INVALIDUSERNAME|EMPTYPASSWORD|INVALIDVERSION/i.test(errStr);
            const isBanned = /BANNED|banned|Server closed connection without response/i.test(errStr);
            if (isAuthFailure) {
              clearCreds();
              lastLogin.current = null;
            }
            if (isBanned) {
              // Keep creds for manual retry but stop hammering. Show banned UX.
              shouldReconnect.current = false;
              clearReconnect();
              setState((s) => ({ ...s, status: "failed", error: errStr, reconnecting: false }));
              clearHeartbeat();
              // Do NOT scheduleReconnect — user must try different username / wait
              break;
            }
            shouldReconnect.current = !isAuthFailure;
            const isTransientServer = /Unable to connect|ETIMEOUT|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|fetch failed|NetworkError|Connection error|Connection closed before login/i.test(data.error || "");
            const wasConnected = stateRef.current.status === "connected" || !!stateRef.current.reconnecting;
            if (isTransientServer) {
              // Bridge Soulseek TCP is retrying in background via server:reconnect — keep WS open, don't flap WS
              // Don't schedule WS reconnect; rely on server:reconnect banner/delay
              setState((s) => ({ ...s, error: data.error, reconnecting: true }));
              clearHeartbeat();
              break;
            }
            if (!isAuthFailure && wasConnected) {
              // Background transient failure — keep UI interactive, retry silently
              setState((s) => ({ ...s, error: data.error, reconnecting: true }));
              clearHeartbeat();
              if (shouldReconnect.current) scheduleReconnect();
            } else {
              setState((s) => ({ ...s, status: "failed", error: data.error, reconnecting: false }));
              clearHeartbeat();
              if (shouldReconnect.current) scheduleReconnect();
            }
          }
          break;
        case "server:reconnect": {
          // Bridge is reconnecting Soulseek TCP (e.g. after listening port change via portrange)
          // WS stays open — reconnect silently with subtle banner, don't flash fullscreen spinner
          const d = data as unknown as { error?: string; ok?: boolean; listenPort?: number };
          const wasConnected = stateRef.current.status === "connected" || !!stateRef.current.reconnecting;
          if (d.error) {
            const isBanned = /BANNED|banned|Server closed connection without response/i.test(d.error || "");
            if (isBanned) {
              shouldReconnect.current = false;
              clearReconnect();
              clearHeartbeat();
              setState((s) => ({ ...s, status: "failed", error: d.error, reconnecting: false }));
            } else if (wasConnected) {
              // Keep UI interactive, surface error subtly
              setState((s) => ({ ...s, error: d.error, reconnecting: false }));
            } else {
              setState((s) => ({ ...s, status: "failed", error: d.error, reconnecting: false }));
            }
          } else if (d.ok) {
            // Fresh reconnect success (e.g. after port change) – WS never dropped
            setState((s) => ({ ...s, status: "connected", error: undefined, reconnecting: false }));
            clearReconnect();
            reconnectAttempts.current = 0;
            shouldReconnect.current = true;
          } else if (wasConnected) {
            setState((s) => ({ ...s, reconnecting: true }));
          } else if (stateRef.current.status !== "connected") {
            setState((s) => ({ ...s, status: "connecting", reconnecting: false }));
          }
          break;
        }
        case "server:reconnected": {
          // Background reconnect succeeded (e.g. after port change) — restore connected without user re-login
          setState((s) => ({ ...s, status: "connected", user: s.user ?? loginReq.username, error: undefined, reconnecting: false }));
          clearReconnect();
          reconnectAttempts.current = 0;
          shouldReconnect.current = true;
          break;
        }
        case "error":
          if (stateRef.current.status !== "connected" && !stateRef.current.reconnecting) {
            setState((s) => ({ ...s, status: "failed", error: data.error, reconnecting: false }));
          }
          break;
      }

      listeners.current.forEach((cb) => cb(data));
    };

    ws.onerror = () => {
      if (generation.current !== gen) return;
      // let onclose handle reconnect; just surface error if idle/failed (not during background reconnect)
      if (stateRef.current.status !== "connected" && stateRef.current.status !== "connecting" && !stateRef.current.reconnecting) {
        setState((s) => ({ ...s, status: "failed", error: "Could not reach the Nicotine Hub bridge. Is it running?", reconnecting: false }));
      }
    };

    ws.onclose = () => {
      if (generation.current !== gen) return;
      clearHeartbeat();
      // Homelab: restore creds if lastLogin was lost (e.g. reload before WS open)
      if (!lastLogin.current) {
        const creds = loadCreds();
        if (creds?.username && creds?.password) {
          lastLogin.current = creds;
          shouldReconnect.current = true;
        }
      }
      if (shouldReconnect.current && lastLogin.current) {
        const wasConnected = stateRef.current.status === "connected" || !!stateRef.current.reconnecting;
        if (wasConnected) {
          setState((s) => ({ ...s, reconnecting: true }));
        } else {
          setState((s) => ({ ...s, status: "connecting", reconnecting: false }));
        }
        scheduleReconnect();
      } else {
        const wasConnected = stateRef.current.status === "connected" || !!stateRef.current.reconnecting;
        setState((s) =>
          wasConnected
            ? { ...s, reconnecting: false }
            : { ...s, status: "failed", error: "Connection to the bridge closed.", reconnecting: false },
        );
      }
    };
  }, [clearHeartbeat]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) return;
    // Homelab: if lastLogin is null but creds exist (e.g. after reload), restore
    if (!lastLogin.current) {
      const creds = loadCreds();
      if (creds?.username && creds?.password) {
        lastLogin.current = creds;
        shouldReconnect.current = true;
      }
    }
    if (!shouldReconnect.current || !lastLogin.current) return;
    const attempt = reconnectAttempts.current++;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * Math.pow(2, attempt));
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(RECONNECT_MIN_MS, Math.round(base + jitter));
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      if (!lastLogin.current) {
        const creds = loadCreds();
        if (creds?.username && creds?.password) {
          lastLogin.current = creds;
          shouldReconnect.current = true;
        }
      }
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
      // Merge Settings host/port if caller didn't provide them (Settings → Network is authoritative)
      let mergedReq = req;
      if (!isDemo && !req.host && !req.port) {
        try {
          const raw = localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings");
          if (raw) {
            const parsed = JSON.parse(raw) as { server?: { server?: { host?: string; port?: number } } };
            const h = parsed?.server?.server?.host;
            const p = parsed?.server?.server?.port;
            if (h || p) mergedReq = { ...req, host: h || req.host, port: p || req.port };
          }
        } catch {}
      }
      // Persist creds for homelab auto-login (sessionStorage + cookie)
      // Do this before demo check so demo also gets ephemeral creds? No — demo creds are fake, don't persist real pass
      if (!isDemo && mergedReq.username && mergedReq.password) {
        saveCreds(mergedReq);
      }
      // Demo: accept any username/password, no bridge
      if (isDemo) {
        const user = req.username.trim() || "demo";
        if (!req.username.trim() || !req.password) {
          if (!req.username.trim()) {
            setState({ status: "failed", error: "Enter any username to try the demo.", reconnecting: false });
            return;
          }
        }
        setState({ status: "connecting", reconnecting: false });
        setTimeout(() => {
          try {
            sessionStorage.setItem("__mockLoggedIn", JSON.stringify({ user }));
            // Seed demo fixtures on first login — provides 2 chats/shares/profiles/searches/buddies/transfers
            if (isDemo) seedDemoStorage();
          } catch {}
          setState({ status: "connected", user, error: undefined, reconnecting: false });
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

      lastLogin.current = mergedReq;
      shouldReconnect.current = true;
      reconnectAttempts.current = 0;
      clearReconnect();
      connectSocket(mergedReq);
    },
    [connectSocket, clearReconnect],
  );

  // Homelab auto-login: if any creds are present (sessionStorage or cookie), auto-login on mount/reload
  // This handles port-change reconnect that restarts bridge/Docker and page reload, without requiring
  // user to re-enter password. For homelab convenience we auto-login if any creds are present,
  // unless server.auto_connect_startup is explicitly false (nicotine-plus parity).
  useEffect(() => {
    if (isDemo) return;
    if (autoLoginAttempted.current) return;
    autoLoginAttempted.current = true;
    if (stateRef.current.status !== "idle") return;
    try {
      if (sessionStorage.getItem("__mockLoggedIn")) return;
    } catch {}
    // Respect server.auto_connect_startup=false (settings-audit P0)
    try {
      const raw = localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings");
      if (raw) {
        const parsed = JSON.parse(raw) as { server?: { auto_connect_startup?: boolean } };
        if (parsed?.server?.auto_connect_startup === false) return;
      }
    } catch {}
    const creds = loadCreds();
    if (creds?.username && creds?.password) {
      // Optimistic shell: skip the login screen straight to the app (e.g. /search
      // redirects on `connected`). ReconnectBanner covers `reconnecting`. The real
      // login:result below either confirms (reconnecting:false) or bounces to
      // `failed` (auth failure clears creds; guards route back to login).
      // NB: login() first — connectSocket reads the (still idle) stateRef and would
      // overwrite an optimistic setState issued before it. The optimistic update
      // last wins via batching; later async WS callbacks see the updated state.
      login(creds);
      setState({ status: "connected", user: creds.username, error: undefined, reconnecting: true });
    }
  }, [login]);

  // First-run resolution marker — declared after the hydration + auto-login
  // effects so it runs after both in the same commit (all paths synchronous).
  // From here on, `idle` means logged out with nothing pending.
  useEffect(() => {
    setInitialized(true);
  }, []);

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

  // online / visibility handlers for reconnect — homelab: also restore from storage if needed
  useEffect(() => {
    const ensureCreds = () => {
      if (!lastLogin.current) {
        const creds = loadCreds();
        if (creds?.username && creds?.password) {
          lastLogin.current = creds;
          shouldReconnect.current = true;
        }
      }
    };
    const onOnline = () => {
      ensureCreds();
      if (shouldReconnect.current && lastLogin.current && (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN)) {
        clearReconnect();
        reconnectAttempts.current = 0;
        connectSocket(lastLogin.current);
      }
    };
    const onVis = () => {
      ensureCreds();
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
    () => ({ login, logout, send, subscribe, state: { ...state, initialized } }),
    [login, logout, send, subscribe, state, initialized],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
