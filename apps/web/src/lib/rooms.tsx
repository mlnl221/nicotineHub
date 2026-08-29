"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";
import type { ChatEvent, RoomEvent } from "@/lib/protocol";
import { censorText, replaceText, truncateMessages } from "@/lib/chatFormat";

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
  operators: string[];
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
            const data = ev.data as { room?: string; users?: { username?: string }[]; owner?: string; operators?: string[] } | undefined;
            const roomName = (ev.room || data?.room || activeRoom || "").toString();
            if (!roomName) break;
            const users = (data as unknown as { users?: Array<{ username: string }> })?.users?.map((u) => u.username) || [];
            const owner = (data as { owner?: string })?.owner;
            const operators = (data as { operators?: string[] })?.operators || [];
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              next.set(roomName, { name: roomName, users, tickers: next.get(roomName)?.tickers || [], owner, isPrivate: (data as { isPrivate?: boolean })?.isPrivate, operators });
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
            setMessages((prev) => {
              const next = new Map(prev);
              const arr = next.get(ev.room!) || [];
              const capped = truncateMessages([...arr, {
                id: `sys-${Date.now()}-${Math.random()}`,
                room: ev.room!,
                username: "system",
                message: `${ev.username} has ${ev.type === "user-joined-room" ? "joined" : "left"} the room.`,
                timestamp: Date.now(),
              }], settings.logging.readroomlines || 200);
              next.set(ev.room!, capped);
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
              const cur = next.get(room) || { name: room, users: [], tickers: [], operators: [] };
              next.set(room, { ...cur, users: members });
              return next;
            });
            break;
          }
          case "room-member-added": {
            if (!ev.room || !ev.username) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(ev.room!);
              if (!cur) return prev;
              if (cur.users.includes(ev.username!)) return prev;
              next.set(ev.room!, { ...cur, users: [...cur.users, ev.username!] });
              return next;
            });
            break;
          }
          case "room-member-removed": {
            if (!ev.room || !ev.username) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(ev.room!);
              if (!cur) return prev;
              next.set(ev.room!, { ...cur, users: cur.users.filter((u) => u !== ev.username) });
              return next;
            });
            break;
          }
          case "room-operators": {
            const room = ev.room || activeRoom;
            const ops = (ev.data as string[] | undefined) || [];
            if (!room) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(room) || { name: room, users: [], tickers: [], operators: [] };
              next.set(room, { ...cur, operators: ops });
              return next;
            });
            break;
          }
          case "operator-added": {
            if (!ev.room || !ev.username) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(ev.room!);
              if (!cur) return prev;
              if (cur.operators.includes(ev.username!)) return prev;
              next.set(ev.room!, { ...cur, operators: [...cur.operators, ev.username!] });
              return next;
            });
            break;
          }
          case "operator-removed":
          case "operatorship-revoked": {
            if (!ev.room || !ev.username) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(ev.room!);
              if (!cur) return prev;
              next.set(ev.room!, { ...cur, operators: cur.operators.filter((o) => o !== ev.username) });
              return next;
            });
            break;
          }
          case "operatorship-granted": {
            if (!ev.room || !ev.username) break;
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              const cur = next.get(ev.room!);
              if (!cur) return prev;
              if (cur.operators.includes(ev.username!)) return prev;
              next.set(ev.room!, { ...cur, operators: [...cur.operators, ev.username!] });
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
              const cur = next.get(room) || { name: room, users: [], tickers: [], operators: [] };
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
          case "cancel-membership":
          case "cancel-ownership":
          case "membership-granted":
          case "membership-revoked":
            break;
          default:
            break;
        }
      } else if (msg.type === "chat:event") {
        const ev = (msg as unknown as { event: ChatEvent }).event;
        if (ev.type === "say-chatroom" && ev.room && ev.username && ev.message) {
          const displayMsg = settings.words.censorwords ? censorText(ev.message, settings.words.censored) : ev.message;
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
            next.set(ev.room!, truncateMessages([...arr, rm], settings.logging.readroomlines || 200));
            return next;
          });
        } else if (ev.type === "global-room-message" && ev.room && ev.username && ev.message) {
          const displayMsg = settings.words.censorwords ? censorText(ev.message, settings.words.censored) : ev.message;
          const rm: RoomMessage = {
            id: `gmsg-${Date.now()}-${Math.random()}`,
            room: ev.room,
            username: ev.username,
            message: displayMsg,
            timestamp: Date.now(),
          };
          setMessages((prev) => {
            const next = new Map(prev);
            const arr = next.get(ev.room!) || [];
            next.set(ev.room!, truncateMessages([...arr, rm], settings.logging.readroomlines || 200));
            return next;
          });
        }
      }
    });
    return unsub;
  }, [state.status, subscribe, activeRoom, settings.words.censorwords, settings.words.censored, settings.logging.readroomlines]);

  const joinRoom = useCallback(
    (room: string) => {
      send({ type: "chat:room", action: "join", room });
      setActiveRoom(room);
      setJoinedRooms((prev) => {
        if (prev.has(room)) return prev;
        const next = new Map(prev);
        next.set(room, { name: room, users: [], tickers: [], operators: [] });
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
      out = replaceText(out, settings.words.replacewords ? settings.words.autoreplaced : {});
      if (settings.words.censorwords) out = censorText(out, settings.words.censored);
      send({ type: "chat:room", action: "say", room, message: out });
    },
    [send, settings.words],
  );

  const setTicker = useCallback((room: string, msg: string) => {
    send({ type: "chat:room", action: "setTicker", room, message: msg } as unknown as never);
  }, [send]);

  const addOperator = useCallback((room: string, username: string) => send({ type: "chat:room", action: "addOperator", room, username } as unknown as never), [send]);
  const removeOperator = useCallback((room: string, username: string) => send({ type: "chat:room", action: "removeOperator", room, username } as unknown as never), [send]);
  const cancelMembership = useCallback((room: string) => send({ type: "chat:room", action: "cancelMembership", room } as unknown as never), [send]);
  const cancelOwnership = useCallback((room: string) => send({ type: "chat:room", action: "cancelOwnership", room } as unknown as never), [send]);

  const closeAll = useCallback(() => {
    joinedRooms.forEach((_, room) => {
      send({ type: "chat:room", action: "leave", room });
    });
    setJoinedRooms(new Map());
    setMessages(new Map());
    setActiveRoom(null);
  }, [joinedRooms, send]);

  return { roomList, joinedRooms, messages, activeRoom, setActiveRoom, joinRoom, leaveRoom, say, setTicker, addOperator, removeOperator, cancelMembership, cancelOwnership, closeAll };
}
