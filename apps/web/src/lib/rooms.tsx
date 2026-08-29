"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import type { ChatEvent, RoomEvent } from "@/lib/protocol";

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
}

export function useRooms() {
  const { send, subscribe, state } = useSession();
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
          case "room-tickers":
          case "ticker-added":
          case "ticker-removed": {
            // store tickers if needed
            break;
          }
          default:
            break;
        }
      } else if (msg.type === "chat:event") {
        const ev = (msg as unknown as { event: ChatEvent }).event;
        if (ev.type === "say-chatroom" && ev.room && ev.username && ev.message) {
          const rm: RoomMessage = {
            id: `msg-${Date.now()}-${Math.random()}`,
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
  }, [state.status, subscribe, activeRoom]);

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
      send({ type: "chat:room", action: "say", room, message: message.trim() });
      // optimistic local echo will come back via server as say-chatroom
    },
    [send],
  );

  const closeAll = useCallback(() => {
    joinedRooms.forEach((_, room) => {
      send({ type: "chat:room", action: "leave", room });
    });
    setJoinedRooms(new Map());
    setMessages(new Map());
    setActiveRoom(null);
  }, [joinedRooms, send]);

  return { roomList, joinedRooms, messages, activeRoom, setActiveRoom, joinRoom, leaveRoom, say, closeAll };
}
