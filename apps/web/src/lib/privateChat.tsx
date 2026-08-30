"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export function usePrivateChat() {
  const { send, subscribe, state } = useSession();
  const { settings } = useConfig();
  const [conversations, setConversations] = useState<Map<string, PrivateMessage[]>>(() => new Map());
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Map<string, number>>(() => new Map());
  const ctcpThrottle = useRef<Map<string, number>>(new Map());

  const activeUserRef = useRef(activeUser);
  activeUserRef.current = activeUser;

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
  }, [state.status, conversations.size]);

  useEffect(() => {
    if (!isDemo) return;
    if (state.status !== "idle") return;
    setConversations(new Map());
    setActiveUser(null);
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "connected") return;
    const unsub = subscribe((msg) => {
      if (msg.type !== "chat:event") return;
      const ev = (msg as unknown as { event: ChatEvent }).event;
      if (ev.type === "private-message" && ev.username && ev.message) {
        // CTCP TYPING handling
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
        // CTCP VERSION throttle 1s (nicotine CTCP 1s throttle)
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
          // Move user to top by deleting and re-inserting at end then reorder via insertion order? Use Map reinsert
          next.delete(ev.username!);
          next.set(ev.username!, truncateMessages([...arr, pm], settings.logging.readprivatelines || 200));
          return next;
        });
        // Also clear typing
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(ev.username!);
          return next;
        });
      } else if (ev.type === "private-message-acked" && (ev as unknown as { username?: string }).username) {
        const username = (ev as unknown as { username: string }).username;
        // Persist ordering: move acked user to top of privatechat.users
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
      // Offline queue: if not logged in, queue via GetPeerAddress deferred (best-effort)
      if (state.status !== "connected") {
        // store in pending localStorage and will retry on reconnect (like nicotine GetPeerAddress queue)
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
    [send, settings.words, settings.ctcp.enable, settings.privatechat.store, settings.logging.readprivatelines],
  );

  const users = Array.from(conversations.keys());

  const closeConversation = (username: string) => {
    setConversations((prev) => {
      const next = new Map(prev);
      next.delete(username);
      return next;
    });
    if (activeUser === username) setActiveUser(null);
  };

  const closeAll = () => {
    setConversations(new Map());
    setActiveUser(null);
  };

  // Flush offline pending on reconnect
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

  const isTyping = (username: string) => {
    const exp = typingUsers.get(username);
    return exp !== undefined && Date.now() < exp;
  };

  return { conversations, users, activeUser, setActiveUser, sendMessage, sendTyping, isTyping, typingUsers, closeConversation, closeAll };
}
