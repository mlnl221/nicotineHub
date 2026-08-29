"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import type { ChatEvent } from "@/lib/protocol";

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
  const [conversations, setConversations] = useState<Map<string, PrivateMessage[]>>(() => new Map());
  const [activeUser, setActiveUser] = useState<string | null>(null);

  const activeUserRef = useRef(activeUser);
  activeUserRef.current = activeUser;

  useEffect(() => {
    if (state.status !== "connected") return;
    const unsub = subscribe((msg) => {
      if (msg.type !== "chat:event") return;
      const ev = (msg as unknown as { event: ChatEvent }).event;
      if (ev.type !== "private-message" || !ev.username || !ev.message) return;
      const pm: PrivateMessage = {
        id: `${ev.msgId ?? Date.now()}-${ev.username}`,
        username: ev.username,
        message: ev.message,
        timestamp: ev.timestamp ? ev.timestamp * 1000 : Date.now(),
        isSelf: false,
        isNew: true,
      };
      setConversations((prev) => {
        const next = new Map(prev);
        const arr = next.get(ev.username!) || [];
        next.set(ev.username!, [...arr, pm]);
        return next;
      });
    });
    return unsub;
  }, [state.status, subscribe]);

  const sendMessage = useCallback(
    (username: string, message: string) => {
      if (!message.trim()) return;
      const pm: PrivateMessage = {
        id: `self-${Date.now()}`,
        username,
        message: message.trim(),
        timestamp: Date.now(),
        isSelf: true,
      };
      setConversations((prev) => {
        const next = new Map(prev);
        const arr = next.get(username) || [];
        next.set(username, [...arr, pm]);
        return next;
      });
      send({ type: "chat:private", action: "send", username, message: message.trim() });
    },
    [send],
  );

  const users = Array.from(conversations.keys());

  return { conversations, users, activeUser, setActiveUser, sendMessage };
}
