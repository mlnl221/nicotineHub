"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";
import type { ChatEvent, RoomEvent } from "@/lib/protocol";

function applyWords(text: string, cfg: { censorwords: boolean; censored: string[]; replacewords: boolean; autoreplaced: Record<string, string> }): string {
  let out = text;
  if (cfg.replacewords && cfg.autoreplaced) {
    for (const [from, to] of Object.entries(cfg.autoreplaced)) {
      if (!from) continue;
      // Simple replace (nicotine does whole-word aware but we do simple)
      out = out.split(from).join(to);
    }
  }
  if (cfg.censorwords && cfg.censored.length) {
    for (const pat of cfg.censored) {
      if (!pat) continue;
      try {
        const re = new RegExp(pat, "gi");
        out = out.replace(re, "*".repeat(pat.length));
      } catch {
        out = out.split(pat).join("*".repeat(pat.length));
      }
    }
  }
  return out;
}

export interface RoomMessage {
  id: string;
  room: string;
  username: string;
  message: string;
  timestamp: number;
}

export interface JoinedRoom {
  name: string;
  users: string[];
  tickers: { username: string; msg: string }[];
  owner?: string;
  isPrivate?: boolean;
  operators?: string[];
}

export function useRooms() {
  const { send, subscribe, state } = useSession();
  const { settings } = useConfig();
  const [roomList, setRoomList] = useState<{ name: string; users: number }[]>([]);
  const [joinedRooms, setJoinedRooms] = useState<Map<string, JoinedRoom>>(() => new Map());
  const [messages, setMessages] = useState<Map<string, RoomMessage[]>>(() => new Map());
  const [activeRoom, setActiveRoom] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("nicotine.activeRoom");
        if (saved) {
          sessionStorage.removeItem("nicotine.activeRoom");
          return saved;
        }
      } catch {}
    }
    return null;
  });

  useEffect(() => {
    if (state.status !== "connected") return;
    const unsub = subscribe((msg) => {
      if (msg.type === "room:event") {
        const ev = (msg as unknown as { event: RoomEvent }).event;
        switch (ev.type) {
          case "room-list": {
            const data = ev.data as { rooms?: { name: string; users: number }[] } | undefined;
            if (data?.rooms) setRoomList(data.rooms);
            break;
          }
          case "join-room": {
            const data = ev.data as { room?: string; users?: { username?: string }[]; owner?: string } | undefined;
            const roomName = (ev.room || data?.room || activeRoom || "").toString();
            if (!roomName) break;
            const users = (data as unknown as { users?: Array<{ username: string }> })?.users?.map((u) => u.username) || [];
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              next.set(roomName, { name: roomName, users, tickers: next.get(roomName)?.tickers || [] });
              return next;
            });
            if (!activeRoom) setActiveRoom(roomName);
            break;
          }
          case "user-joined-room":
          case "user-left-room": {
            if (!ev.room || !ev.username) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(ev.room!);
              if (!cur) return prev;
              const users = ev.type === "user-joined-room"
                ? [...new Set([...cur.users, ev.username!])]
                : cur.users.filter((u) => u !== ev.username);
              next.set(ev.room!, { ...cur, users });
              return next;
            });
            // also add system message
            setMessages((prev) => {
              const next = new Map(prev);
              const arr = next.get(ev.room!) || [];
              next.set(ev.room!, [
                ...arr,
                {
                  id: `sys-${Date.now()}-${Math.random()}`,
                  room: ev.room!,
                  username: "system",
                  message: `${ev.username} has ${ev.type === "user-joined-room" ? "joined" : "left"} the room.`,
                  timestamp: Date.now(),
                },
              ]);
              return next;
            });
            break;
          }
          case "room-members": {
            const room = ev.room || activeRoom;
            const members = (ev.data as string[] | undefined) || [];
            if (!room) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(room) || { name: room, users: [], tickers: [] };
              next.set(room, { ...cur, users: members });
              return next;
            });
            break;
          }
          case "room-tickers": {
            const data = ev.data as Array<{ username: string; msg: string }> | undefined;
            const room = ev.room;
            if (!room || !Array.isArray(data)) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(room) || { name: room, users: [], tickers: [] };
              next.set(room, { ...cur, tickers: data });
              return next;
            });
            break;
          }
          case "ticker-added": {
            const room = ev.room;
            const username = ev.username;
            const msg = ev.data as string | undefined;
            if (!room || !username || typeof msg !== "string") break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(room);
              if (!cur) return prev;
              const filtered = cur.tickers.filter((t) => t.username !== username);
              next.set(room, { ...cur, tickers: [...filtered, { username, msg }] });
              return next;
            });
            break;
          }
          case "ticker-removed": {
            const room = ev.room;
            const username = ev.username;
            if (!room || !username) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(room);
              if (!cur) return prev;
              next.set(room, { ...cur, tickers: cur.tickers.filter((t) => t.username !== username) });
              return next;
            });
            break;
          }
          default:
            break;
        }
      } else if (msg.type === "chat:event") {
        const ev = (msg as unknown as { event: ChatEvent }).event;
        if (ev.type === "say-chatroom" && ev.room && ev.username && ev.message) {
          // Apply censor filter on display if enabled (mirrors nicotine chatrooms censor)
          const filtered = applyWords(ev.message, { censorwords: settings.words.censorwords, censored: settings.words.censored, replacewords: false, autoreplaced: {} });
          const displayMsg = settings.words.censorwords ? filtered : ev.message;
          const rm: RoomMessage = {
            id: `msg-${Date.now()}-${Math.random()}`,
            room: ev.room,
            username: ev.username,
            message: displayMsg,
            timestamp: Date.now(),
          };
          setMessages((prev) => {
            const next = new Map(prev);
            const arr = next.get(ev.room!) || [];
            next.set(ev.room!, [...arr, rm]);
            return next;
          });
        } else if (ev.type === "global-room-message" && ev.room && ev.username && ev.message) {
          const rm: RoomMessage = {
            id: `gmsg-${Date.now()}-${Math.random()}`,
            room: ev.room,
            username: ev.username,
            message: ev.message,
            timestamp: Date.now(),
          };
          setMessages((prev) => {
            const next = new Map(prev);
            const arr = next.get(ev.room!) || [];
            next.set(ev.room!, [...arr, rm]);
            return next;
          });
        }
      }
    });
    return unsub;
  }, [state.status, subscribe, activeRoom, settings.words.censorwords, settings.words.censored]);

  const joinRoom = useCallback(
    (room: string) => {
      send({ type: "chat:room", action: "join", room });
      setActiveRoom(room);
      // optimistic joined
      setJoinedRooms((prev) => {
        if (prev.has(room)) return prev;
        const next = new Map(prev);
        next.set(room, { name: room, users: [], tickers: [] });
        return next;
      });
    },
    [send],
  );

  const leaveRoom = useCallback(
    (room: string) => {
      send({ type: "chat:room", action: "leave", room });
      setJoinedRooms((prev) => {
        const next = new Map(prev);
        next.delete(room);
        return next;
      });
      setMessages((prev) => {
        const next = new Map(prev);
        next.delete(room);
        return next;
      });
      if (activeRoom === room) setActiveRoom(null);
    },
    [send, activeRoom],
  );

  const say = useCallback(
    (room: string, message: string) => {
      if (!message.trim()) return;
      let out = message.trim();
      if (out.startsWith("/me ")) out = `* ${out.slice(4)}`;
      out = applyWords(out, { censorwords: settings.words.censorwords, censored: settings.words.censored, replacewords: settings.words.replacewords, autoreplaced: settings.words.autoreplaced });
      send({ type: "chat:room", action: "say", room, message: out });
    },
    [send, settings.words],
  );

  const setTicker = useCallback((room: string, msg: string) => {
    send({ type: "chat:room", action: "setTicker", room, message: msg } as unknown as never);
  }, [send]);

  const closeAll = useCallback(() => {
    joinedRooms.forEach((_, room) => {
      send({ type: "chat:room", action: "leave", room });
    });
    setJoinedRooms(new Map());
    setMessages(new Map());
    setActiveRoom(null);
  }, [joinedRooms, send]);

  return { roomList, joinedRooms, messages, activeRoom, setActiveRoom, joinRoom, leaveRoom, say, setTicker, closeAll };
}
