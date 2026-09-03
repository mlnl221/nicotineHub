"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";
import type { ChatEvent } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { mockPrivateConversations } from "@/lib/demo/fixtures";
import { censorText, replaceText, truncateMessages } from "@/lib/chatFormat";

export interface PrivateMessage {
  id: string;
  username: string;
  message: string;
  timestamp: number;
  isSelf: boolean;
  isNew?: boolean;
}

interface PrivateChatApi {
  conversations: Map<string, PrivateMessage[]>;
  users: string[];
  activeUser: string | null;
  setActiveUser: (u: string | null) => void;
  sendMessage: (username: string, message: string) => void;
  sendTyping: (username: string) => void;
  isTyping: (username: string) => boolean;
  typingUsers: Map<string, number>;
  closeConversation: (username: string) => void;
  closeAll: () => void;
}

const PrivateChatContext = createContext<PrivateChatApi | null>(null);

const ACTIVE_KEY = "nicotineHub.private.active";
const PRIVATECHATS_KEY = "nicotineHub.privatechats";

function loadPersistedUsers(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PRIVATECHATS_KEY) ?? localStorage.getItem(PRIVATECHATS_KEY.replace("nicotineHub.", "nicotine."));
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.filter((x: unknown) => typeof x === "string" && (x as string).trim()).slice(0, 50) as string[];
  } catch { return null; }
}
function loadPersistedActive(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(ACTIVE_KEY);
    if (v && v.trim()) return v.trim();
    // fallback to query param handling already in page
  } catch {}
  return null;
}
function persistActive(u: string | null) {
  try {
    if (u) localStorage.setItem(ACTIVE_KEY, u);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

export function PrivateChatProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, state } = useSession();
  const { settings } = useConfig();
  const [conversations, setConversations] = useState<Map<string, PrivateMessage[]>>(() => {
    const users = loadPersistedUsers();
    if (users && users.length) {
      const m = new Map<string, PrivateMessage[]>();
      for (const u of users) m.set(u, []);
      return m;
    }
    return new Map();
  });
  const [activeUser, setActiveUserState] = useState<string | null>(() => loadPersistedActive());
  const [typingUsers, setTypingUsers] = useState<Map<string, number>>(() => new Map());
  const ctcpThrottle = useRef<Map<string, number>>(new Map());

  const activeUserRef = useRef(activeUser);
  activeUserRef.current = activeUser;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const setActiveUser = useCallback((u: string | null) => {
    setActiveUserState(u);
    persistActive(u);
  }, []);

  useEffect(() => { persistActive(activeUser); }, [activeUser]);
  // persist users ordering whenever conversations keys change (mirrors existing logic)
  useEffect(() => {
    try {
      const keys = Array.from(conversations.keys()).slice(0, 50);
      if (keys.length) localStorage.setItem(PRIVATECHATS_KEY, JSON.stringify(keys));
    } catch {}
  }, [conversations]);

  // clear on logout — not on initial mount
  const hasConnectedRef = useRef(false);
  useEffect(() => {
    if (state.status === "connected") hasConnectedRef.current = true;
    if (state.status !== "idle") return;
    if (!hasConnectedRef.current) return;
    setConversations(new Map());
    setActiveUserState(null);
    try { localStorage.removeItem(ACTIVE_KEY); } catch {}
    if (isDemo) try { localStorage.removeItem(PRIVATECHATS_KEY); } catch {}
  }, [state.status]);

  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "connected") return;
    if (conversations.size !== 0) return;
    const seeded = mockPrivateConversations();
    const next = new Map<string, PrivateMessage[]>();
    for (const [username, msgs] of Object.entries(seeded)) {
      next.set(username, msgs.map((m) => ({ ...m })));
    }
    setConversations(next);
    const first = Object.keys(seeded)[0];
    if (first) setActiveUser(first);
  }, [state.status, conversations.size, setActiveUser]);

  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "idle") return;
    setConversations(new Map());
    setActiveUser(null);
  }, [state.status, setActiveUser]);

  useEffect(() => {
    if (state.status !== "connected") return;
    const unsub = subscribe((msg) => {
      if (msg.type !== "chat:event") return;
      const ev = (msg as unknown as { event: ChatEvent }).event;
      if (ev.type === "private-message" && ev.username && ev.message) {
        if (ev.message.includes("\u0001TYPING")) {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.set(ev.username!, Date.now() + 3000);
            return next;
          });
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Map(prev);
              const exp = next.get(ev.username!);
              if (exp && Date.now() >= exp) next.delete(ev.username!);
              return next;
            });
          }, 3100);
          return;
        }
        if (ev.message.includes("\u0001VERSION")) {
          const last = ctcpThrottle.current.get(ev.username!) || 0;
          if (Date.now() - last < 1000) return;
          ctcpThrottle.current.set(ev.username!, Date.now());
          if (!settings.ctcp.enable) return;
        }
        const display = settings.words.censorwords ? censorText(ev.message, settings.words.censored) : ev.message;
        const pm: PrivateMessage = {
          id: `${ev.msgId ?? Date.now()}-${ev.username}`,
          username: ev.username,
          message: display,
          timestamp: ev.timestamp ? ev.timestamp * 1000 : Date.now(),
          isSelf: false,
          isNew: true,
        };
        setConversations((prev) => {
          const next = new Map(prev);
          const arr = next.get(ev.username!) || [];
          next.delete(ev.username!);
          next.set(ev.username!, truncateMessages([...arr, pm], settings.logging.readprivatelines || 200));
          return next;
        });
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(ev.username!);
          return next;
        });
      } else if (ev.type === "private-message-acked" && (ev as unknown as { username?: string }).username) {
        const username = (ev as unknown as { username: string }).username;
        setConversations((prev) => {
          if (!prev.has(username)) return prev;
          const next = new Map(prev);
          const arr = next.get(username)!;
          next.delete(username);
          next.set(username, arr);
          try {
            const stored = JSON.parse((localStorage.getItem("nicotineHub.privatechats") ?? localStorage.getItem("nicotine.privatechats")) || "[]");
            const nextOrder = [username, ...stored.filter((u: string) => u !== username)].slice(0, 50);
            localStorage.setItem("nicotineHub.privatechats", JSON.stringify(nextOrder));
          } catch {}
          return next;
        });
      }
    });
    return unsub;
  }, [state.status, subscribe, settings.words.censorwords, settings.words.censored, settings.logging.readprivatelines, settings.ctcp.enable]);

  const sendTyping = useCallback((username: string) => {
    if (!settings.ctcp.enable) return;
    const last = ctcpThrottle.current.get(`typing:${username}`) || 0;
    if (Date.now() - last < 2000) return;
    ctcpThrottle.current.set(`typing:${username}`, Date.now());
    send({ type: "chat:private", action: "send", username, message: "\u0001TYPING\u0001" });
  }, [send, settings.ctcp.enable]);

  const sendMessage = useCallback(
    (username: string, message: string) => {
      if (!message.trim()) return;
      let out = message.trim();
      if (out.startsWith("/me ")) out = `* ${out.slice(4)}`;
      if (!settings.ctcp.enable && out.includes("\u0001VERSION")) return;
      if (state.status !== "connected") {
        try {
          const pending = JSON.parse((localStorage.getItem("nicotineHub.pendingPrivate") ?? localStorage.getItem("nicotine.pendingPrivate")) || "[]");
          pending.push({ username, message: out, ts: Date.now() });
          localStorage.setItem("nicotineHub.pendingPrivate", JSON.stringify(pending.slice(-50)));
        } catch {}
        return;
      }
      if (settings.words.replacewords) out = replaceText(out, settings.words.autoreplaced);
      if (settings.words.censorwords) out = censorText(out, settings.words.censored);
      const pm: PrivateMessage = {
        id: `self-${Date.now()}`,
        username,
        message: out,
        timestamp: Date.now(),
        isSelf: true,
      };
      setConversations((prev) => {
        const next = new Map(prev);
        const arr = next.get(username) || [];
        // move to top on send too? keep insertion order
        if (next.has(username)) next.delete(username);
        next.set(username, truncateMessages([...arr, pm], settings.logging.readprivatelines || 200));
        return next;
      });
      send({ type: "chat:private", action: "send", username, message: out });
      try {
        if (settings.privatechat.store) {
          const stored = JSON.parse((localStorage.getItem("nicotineHub.privatechats") ?? localStorage.getItem("nicotine.privatechats")) || "[]");
          if (!stored.includes(username)) localStorage.setItem("nicotineHub.privatechats", JSON.stringify([...stored, username].slice(0, 50)));
        }
      } catch {}
    },
    [send, settings.words, settings.ctcp.enable, settings.privatechat.store, settings.logging.readprivatelines, state.status],
  );

  const users = Array.from(conversations.keys());

  const closeConversation = useCallback((username: string) => {
    const usersList = Array.from(conversationsRef.current.keys());
    const idx = usersList.indexOf(username);
    setConversations((prev) => {
      const next = new Map(prev);
      next.delete(username);
      return next;
    });
    if (activeUserRef.current === username) {
      const nextUsers = usersList.filter((u) => u !== username);
      if (nextUsers.length === 0) { setActiveUser(null); return; }
      let preferPrev = true;
      try {
        const raw = localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings");
        if (raw) {
          const parsed = JSON.parse(raw) as { ui?: { tab_select_previous?: boolean } };
          if (typeof parsed?.ui?.tab_select_previous === "boolean") preferPrev = parsed.ui.tab_select_previous;
        }
      } catch {}
      if (preferPrev && idx > 0) setActiveUser(usersList[idx - 1] ?? nextUsers[nextUsers.length - 1] ?? null);
      else if (!preferPrev && idx < usersList.length - 1) setActiveUser(usersList[idx + 1] ?? nextUsers[nextUsers.length - 1] ?? null);
      else setActiveUser(nextUsers[nextUsers.length - 1] ?? null);
    }
    // also remove from persisted privatechats
    try {
      const stored = JSON.parse((localStorage.getItem("nicotineHub.privatechats") ?? localStorage.getItem("nicotine.privatechats")) || "[]");
      const next = stored.filter((u: string) => u !== username);
      localStorage.setItem("nicotineHub.privatechats", JSON.stringify(next));
    } catch {}
  }, [setActiveUser]);

  const closeAll = useCallback(() => {
    setConversations(new Map());
    setActiveUser(null);
    try { localStorage.removeItem(PRIVATECHATS_KEY); localStorage.removeItem(ACTIVE_KEY); } catch {}
  }, [setActiveUser]);

  useEffect(() => {
    if (state.status !== "connected") return;
    try {
      const pending = JSON.parse((localStorage.getItem("nicotineHub.pendingPrivate") ?? localStorage.getItem("nicotine.pendingPrivate")) || "[]") as Array<{ username: string; message: string }>;
      if (pending.length) {
        for (const p of pending) send({ type: "chat:private", action: "send", username: p.username, message: p.message });
        localStorage.removeItem("nicotineHub.pendingPrivate");
      }
    } catch {}
  }, [state.status, send]);

  const isTyping = useCallback((username: string) => {
    const exp = typingUsers.get(username);
    return exp !== undefined && Date.now() < exp;
  }, [typingUsers]);

  const value: PrivateChatApi = { conversations, users, activeUser, setActiveUser, sendMessage, sendTyping, isTyping, typingUsers, closeConversation, closeAll };
  return <PrivateChatContext.Provider value={value}>{children}</PrivateChatContext.Provider>;
}

export function usePrivateChat(): PrivateChatApi {
  const ctx = useContext(PrivateChatContext);
  if (!ctx) throw new Error("usePrivateChat must be used within PrivateChatProvider");
  return ctx;
}
