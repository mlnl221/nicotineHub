"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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

interface RoomsApi {
  roomList: { name: string; users: number; isPrivate?: boolean }[];
  joinedRooms: Map<string, JoinedRoom>;
  messages: Map<string, RoomMessage[]>;
  activeRoom: string | null;
  setActiveRoom: (r: string | null) => void;
  joinRoom: (room: string) => void;
  leaveRoom: (room: string) => void;
  say: (room: string, message: string) => void;
  setTicker: (room: string, msg: string) => void;
  addOperator: (room: string, username: string) => void;
  removeOperator: (room: string, username: string) => void;
  cancelMembership: (room: string) => void;
  cancelOwnership: (room: string) => void;
  closeAll: () => void;
  userStats: Map<string, { files: number; dirs: number }>;
  refreshRoomList: () => void;
}

const RoomsContext = createContext<RoomsApi | null>(null);

const JOINED_KEY = "nicotineHub.rooms.joined";
const ACTIVE_KEY = "nicotineHub.rooms.active";

function loadPersistedJoined(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(JOINED_KEY) ?? localStorage.getItem(JOINED_KEY.replace("nicotineHub.", "nicotine."));
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.filter((x) => typeof x === "string" && x.trim()).slice(0, 20) as string[];
  } catch { return null; }
}
function loadPersistedActive(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = localStorage.getItem(ACTIVE_KEY) ?? sessionStorage.getItem("nicotineHub.activeRoom") ?? sessionStorage.getItem("nicotine.activeRoom");
    if (ls && typeof ls === "string" && (ls as string).trim()) {
      try { sessionStorage.removeItem("nicotineHub.activeRoom"); } catch {}
      return ls as string;
    }
  } catch {}
  return null;
}
function persistJoined(rooms: Map<string, JoinedRoom>) {
  try { localStorage.setItem(JOINED_KEY, JSON.stringify(Array.from(rooms.keys()).slice(0, 20))); } catch {}
}
function persistActive(room: string | null) {
  try {
    if (room) localStorage.setItem(ACTIVE_KEY, room);
    else localStorage.removeItem(ACTIVE_KEY);
    // also keep sessionStorage for legacy
    if (room) try { sessionStorage.setItem("nicotineHub.activeRoom", room); } catch {}
  } catch {}
}

export function RoomsProvider({ children }: { children: ReactNode }) {
  const { send, subscribe, state } = useSession();
  const { settings } = useConfig();
  const [roomList, setRoomList] = useState<{ name: string; users: number; isPrivate?: boolean }[]>([]);
  const [joinedRooms, setJoinedRooms] = useState<Map<string, JoinedRoom>>(() => {
    const persisted = loadPersistedJoined();
    if (persisted && persisted.length) {
      const m = new Map<string, JoinedRoom>();
      for (const name of persisted) m.set(name, { name, users: [], tickers: [], operators: [] });
      return m;
    }
    return new Map();
  });
  const [messages, setMessages] = useState<Map<string, RoomMessage[]>>(() => new Map());
  const [userStats, setUserStats] = useState<Map<string, { files: number; dirs: number }>>(() => new Map());
  const [activeRoom, setActiveRoomState] = useState<string | null>(() => loadPersistedActive());

  const joinedRoomsRef = useRef(joinedRooms);
  joinedRoomsRef.current = joinedRooms;
  const activeRoomRef = useRef(activeRoom);
  activeRoomRef.current = activeRoom;

  const setActiveRoom = useCallback((r: string | null) => {
    setActiveRoomState(r);
    persistActive(r);
  }, []);

  // persist joined rooms
  useEffect(() => { persistJoined(joinedRooms); }, [joinedRooms]);
  useEffect(() => { persistActive(activeRoom); }, [activeRoom]);

  // clear on logout (both demo and real) — not on initial mount
  const hasConnectedRef = useRef(false);
  useEffect(() => {
    if (state.status === "connected") hasConnectedRef.current = true;
    if (state.status !== "idle") return;
    if (!hasConnectedRef.current) return;
    setJoinedRooms(new Map());
    setMessages(new Map());
    setActiveRoomState(null);
    try { localStorage.removeItem(JOINED_KEY); localStorage.removeItem(ACTIVE_KEY); } catch {}
    try { sessionStorage.removeItem("nicotineHub.activeRoom"); } catch {}
  }, [state.status]);

  // Rejoin persisted rooms on reconnect (like browse tabs)
  const rejoinRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (state.status !== "connected") return;
    const toJoin = Array.from(joinedRoomsRef.current.keys());
    for (const room of toJoin) {
      if (rejoinRef.current.has(room.toLowerCase())) continue;
      rejoinRef.current.add(room.toLowerCase());
      // stagger to avoid burst
      const idx = toJoin.indexOf(room);
      setTimeout(() => {
        try { send({ type: "chat:room", action: "join", room }); } catch {}
        setTimeout(() => rejoinRef.current.delete(room.toLowerCase()), 2000);
      }, idx * 250);
    }
  }, [state.status, send]);

  useEffect(() => {
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
            const roomName = (ev.room || data?.room || activeRoomRef.current || "").toString();
            if (!roomName) break;
            const users = (data as unknown as { users?: Array<{ username: string }> })?.users?.map((u) => u.username) || [];
            const owner = (data as { owner?: string })?.owner;
            const operators = (data as { operators?: string[] })?.operators || [];
            setJoinedRooms((prev) => {
              const next = new Map(prev);
              next.set(roomName, { name: roomName, users, tickers: next.get(roomName)?.tickers || [], owner, isPrivate: (data as { isPrivate?: boolean })?.isPrivate, operators });
              return next;
            });
            if (!activeRoomRef.current) setActiveRoom(roomName);
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
            const room = ev.room || activeRoomRef.current;
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
            const room = ev.room || activeRoomRef.current;
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
  }, [subscribe, settings.words.censorwords, settings.words.censored, settings.logging.readroomlines]);

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
    [send, setActiveRoom],
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
      if (activeRoomRef.current === room) setActiveRoom(null);
    },
    [send, setActiveRoom],
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

  const refreshRoomList = useCallback(() => {
    send({ type: "chat:room", action: "refreshList" });
  }, [send]);

  const listRequested = useRef(false);
  useEffect(() => {
    if (state.status !== "connected" || roomList.length > 0 || listRequested.current) return;
    listRequested.current = true;
    refreshRoomList();
  }, [state.status, roomList.length, refreshRoomList]);

  const addOperator = useCallback((room: string, username: string) => send({ type: "chat:room", action: "addOperator", room, username } as unknown as never), [send]);
  const removeOperator = useCallback((room: string, username: string) => send({ type: "chat:room", action: "removeOperator", room, username } as unknown as never), [send]);
  const cancelMembership = useCallback((room: string) => send({ type: "chat:room", action: "cancelMembership", room } as unknown as never), [send]);
  const cancelOwnership = useCallback((room: string) => send({ type: "chat:room", action: "cancelOwnership", room } as unknown as never), [send]);

  const closeAll = useCallback(() => {
    joinedRoomsRef.current.forEach((_, room) => {
      send({ type: "chat:room", action: "leave", room });
    });
    setJoinedRooms(new Map());
    setMessages(new Map());
    setActiveRoom(null);
  }, [send, setActiveRoom]);

  const value: RoomsApi = { roomList, joinedRooms, messages, activeRoom, setActiveRoom, joinRoom, leaveRoom, say, setTicker, addOperator, removeOperator, cancelMembership, cancelOwnership, closeAll, userStats, refreshRoomList };
  return <RoomsContext.Provider value={value}>{children}</RoomsContext.Provider>;
}

export function useRooms(): RoomsApi {
  const ctx = useContext(RoomsContext);
  if (!ctx) throw new Error("useRooms must be used within RoomsProvider");
  return ctx;
}

// Keep hook name stable for pages; they import useRooms from @/lib/rooms
