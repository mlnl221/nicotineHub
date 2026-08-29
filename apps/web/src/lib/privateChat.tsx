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
      if (ev.type !== "private-message" || !ev.username || !ev.message) return;
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
        next.set(ev.username!, truncateMessages([...arr, pm], settings.logging.readprivatelines || 200));
        return next;
      });
    });
    return unsub;
  }, [state.status, subscribe, settings.words.censorwords, settings.words.censored, settings.logging.readprivatelines]);

  const sendMessage = useCallback(
    (username: string, message: string) => {
      if (!message.trim()) return;
      let out = message.trim();
      if (out.startsWith("/me ")) out = `* ${out.slice(4)}`;
      if (!settings.ctcp.enable && out.includes("\u0001VERSION")) return;
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
          const stored = JSON.parse(localStorage.getItem("nicotine.privatechats") || "[]");
          if (!stored.includes(username)) localStorage.setItem("nicotine.privatechats", JSON.stringify([...stored, username].slice(0, 50)));
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

  return { conversations, users, activeUser, setActiveUser, sendMessage, closeConversation, closeAll };
}
