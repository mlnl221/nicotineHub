"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";
import type { ChatEvent } from "@/lib/protocol";
import { isDemo } from "@/lib/demo";
import { mockPrivateConversations } from "@/lib/demo/fixtures";

function applyWordsPrivate(text: string, cfg: { censorwords: boolean; censored: string[]; replacewords: boolean; autoreplaced: Record<string, string> }): string {
  let out = text;
  if (cfg.replacewords && cfg.autoreplaced) {
    for (const [from, to] of Object.entries(cfg.autoreplaced)) out = out.split(from).join(to);
  }
  if (cfg.censorwords && cfg.censored.length) {
    for (const pat of cfg.censored) {
      if (!pat) continue;
      try { const re = new RegExp(pat, "gi"); out = out.replace(re, "*".repeat(pat.length)); } catch { out = out.split(pat).join("*".repeat(pat.length)); }
    }
  }
  return out;
}

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

  // Demo: seed 2 fake private chats (jazzcat + vinyl_hunter) — per-mount seed (hook is per-page)
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
    // default to first conversation
    const first = Object.keys(seeded)[0];
    if (first) setActiveUser(first);
  }, [state.status, conversations.size]);

  // Demo: clear on logout
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
      const filtered = applyWordsPrivate(ev.message, { censorwords: settings.words.censorwords, censored: settings.words.censored, replacewords: false, autoreplaced: {} });
      const display = settings.words.censorwords ? filtered : ev.message;
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
        next.set(ev.username!, [...arr, pm]);
        return next;
      });
    });
    return unsub;
  }, [state.status, subscribe, settings.words.censorwords, settings.words.censored]);

  const sendMessage = useCallback(
    (username: string, message: string) => {
      if (!message.trim()) return;
      let out = message.trim();
      if (out.startsWith("/me ")) out = `* ${out.slice(4)}`;
      // CTCP VERSION spam filter rate 1s simplified: allow if enabled
      if (!settings.ctcp.enable && out.includes("\u0001VERSION")) return;
      out = applyWordsPrivate(out, { censorwords: settings.words.censorwords, censored: settings.words.censored, replacewords: settings.words.replacewords, autoreplaced: settings.words.autoreplaced });
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
        next.set(username, [...arr, pm]);
        return next;
      });
      send({ type: "chat:private", action: "send", username, message: out });
      // Also store if privatechat.store true — persist list
      try {
        if (settings.privatechat.store) {
          const stored = JSON.parse(localStorage.getItem("nicotine.privatechats") || "[]");
          if (!stored.includes(username)) localStorage.setItem("nicotine.privatechats", JSON.stringify([...stored, username].slice(0, 50)));
        }
      } catch {}
    },
    [send, settings.words, settings.ctcp.enable, settings.privatechat.store],
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
