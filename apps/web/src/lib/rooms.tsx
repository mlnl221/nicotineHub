"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";
import type { ChatEvent, RoomEvent, UserInfoEvent } from "@/lib/protocol";
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
  const [roomList, setRoomList] = useState<{ name: string; users: number; isPrivate?: boolean }[]>([]);
  const [joinedRooms, setJoinedRooms] = useState<Map<string, JoinedRoom>>(() => new Map());
  const [messages, setMessages] = useState<Map<string, RoomMessage[]>>(() => new Map());
  const [userStats, setUserStats] = useState<Map<string, { files: number; dirs: number }>>(() => new Map());
  const [activeRoom, setActiveRoom] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = (sessionStorage.getItem("nicotineHub.activeRoom") ?? sessionStorage.getItem("nicotine.activeRoom"));
        if (saved) {
          sessionStorage.removeItem("nicotineHub.activeRoom");
          return saved;
        }
      } catch {}
    }
    return null;
  });

  useEffect(() => {
    // Subscribe from mount (not only when connected): the server sends room-list
    // once right after login, before React re-renders on login:result — gating on
    // `connected` systematically drops it and the room list stays empty forever.
    const unsub = subscribe((msg) => {
      if (msg.type === "room:event") {
        const ev = (msg as unknown as { event: RoomEvent }).event;
        switch (ev.type) {
          case "room-list": {
            const data = ev.data as { rooms?: { name: string; users: number }[]; owned?: { name: string; users: number }[]; member?: { name: string; users: number }[] } | undefined;
            if (data?.rooms || (data as unknown as { owned?: unknown })?.owned || (data as unknown as { member?: unknown })?.member) {
              const rooms = ((data as { rooms?: { name: string; users: number }[] })?.rooms || []) as { name: string; users: number }[];
              const owned = ((data as unknown as { owned?: { name: string; users: number }[] }).owned || []) as { name: string; users: number }[];
              const member = ((data as unknown as { member?: { name: string; users: number }[] }).member || []) as { name: string; users: number }[];
              const privateNames = new Set([...owned, ...member].map((r) => r.name.toLowerCase()));
              // Merge public + private, tag private for sorting offset like nicotine-plus PRIVATE_USERS_OFFSET=10M
              const merged = [
                ...rooms.map((r) => ({ ...r, isPrivate: privateNames.has(r.name.toLowerCase()) })),
                ...owned.filter((r) => !rooms.some((x) => x.name.toLowerCase() === r.name.toLowerCase())).map((r) => ({ ...r, isPrivate: true })),
                ...member.filter((r) => !rooms.some((x) => x.name.toLowerCase() === r.name.toLowerCase()) && !owned.some((x) => x.name.toLowerCase() === r.name.toLowerCase())).map((r) => ({ ...r, isPrivate: true })),
              ];
              setRoomList(merged);
            }
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
      } else if ((msg as unknown as { type: string }).type === "userinfo:event") {
        const ev = (msg as unknown as { event: UserInfoEvent }).event;
        if (ev.type === "user-stats" && ev.stats && ev.username) {
          const u = ev.username.toLowerCase();
          setUserStats((prev) => {
            const next = new Map(prev);
            next.set(u, { files: ev.stats!.files, dirs: ev.stats!.dirs });
            return next;
          });
        } else if (ev.type === "watch-user" && ev.watchUser && ev.username) {
          const u = ev.username.toLowerCase();
          if (ev.watchUser.files !== undefined || ev.watchUser.dirs !== undefined) {
            setUserStats((prev) => {
              const next = new Map(prev);
              next.set(u, { files: ev.watchUser!.files ?? prev.get(u)?.files ?? 0, dirs: ev.watchUser!.dirs ?? prev.get(u)?.dirs ?? 0 });
              return next;
            });
          }
        }
      }
    });
    return unsub;
  }, [subscribe, activeRoom, settings.words.censorwords, settings.words.censored, settings.logging.readroomlines]);

  // Fetch UserStats (files count) for users in active room to show shares in right list
  const requestedStats = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (state.status !== "connected" || !activeRoom) return;
    const users = joinedRooms.get(activeRoom)?.users || [];
    for (const u of users.slice(0, 80)) {
      const lower = u.toLowerCase();
      if (userStats.has(lower) || requestedStats.current.has(lower)) continue;
      requestedStats.current.add(lower);
      try { send({ type: "userinfo", action: "watch", username: u } as unknown as never); } catch {}
      setTimeout(() => requestedStats.current.delete(lower), 60000);
    }
  }, [activeRoom, joinedRooms, state.status, send, userStats]);

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

  return { roomList, joinedRooms, messages, activeRoom, setActiveRoom, joinRoom, leaveRoom, say, setTicker, addOperator, removeOperator, cancelMembership, cancelOwnership, closeAll, userStats };
}
