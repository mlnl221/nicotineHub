"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { useRooms } from "@/lib/rooms";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { chatRoomMenu, userMenu } from "@/lib/context-menu/menus";
import { useConfig } from "@/lib/config/provider";
import { useCompletion } from "@/lib/completion";
import { useBuddies } from "@/lib/buddies";
import { highlightKeywords, usernameHotspotClass } from "@/lib/chatFormat";
import { isDemo } from "@/lib/demo";
import { DEMO_ROOMS } from "@/lib/demo/fixtures";

export default function ChatRoomsPage() {
  const { state } = useSession();
  const { settings } = useConfig();
  const router = useRouter();
  const { roomList, joinedRooms, messages, activeRoom, setActiveRoom, joinRoom, leaveRoom, say, setTicker, closeAll, userStats } = useRooms();
  const { buddies } = useBuddies();
  const [joinInput, setJoinInput] = useState("");
  const [sayInput, setSayInput] = useState("");
  const [filter, setFilter] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [tickerInput, setTickerInput] = useState("");
  const [showWall, setShowWall] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; items: import("@/components/ui/ContextMenu").MenuItem[] } | null>(null);

  const activeMessages = activeRoom ? messages.get(activeRoom) || [] : [];
  const systemMessages = activeMessages.filter((m) => m.username === "system");
  const userMessages = activeMessages.filter((m) => m.username !== "system");
  const sysLogRef = useRef<HTMLDivElement>(null);
  const joinedArray = Array.from(joinedRooms.values());
  const sortedRooms = (() => {
    const list = roomList.length ? roomList : isDemo ? DEMO_ROOMS.map((r) => ({ name: r.name, users: r.users, isPrivate: false })) : [];
    // nicotine-plus PRIVATE_USERS_OFFSET=10M so private rooms sort first
    return [...list].sort((a, b) => (b.users + ((b as unknown as { isPrivate?: boolean }).isPrivate ? 10000000 : 0)) - (a.users + ((a as unknown as { isPrivate?: boolean }).isPrivate ? 10000000 : 0)));
  })();
  const filteredRooms = filter
    ? sortedRooms.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
    : sortedRooms;
  const activeUsers = activeRoom ? joinedRooms.get(activeRoom)?.users || [] : [];
  const activeTickers = activeRoom ? joinedRooms.get(activeRoom)?.tickers || [] : [];
  const CORE_COMMANDS = ["help","plugin","clear","me","now","join","leave","say","pm","close","msg","ctcp","add","rem","browse","whois","ip","ban","unban","ignore","unignore","share","unshare","shares","rescan","search","rsearch","bsearch","usearch","connect","disconnect","away","quit"];
  const completion = useCompletion({
    login: state.status === "connected" ? (state as unknown as { username?: string }).username : undefined,
    roomUsers: activeUsers,
    roomList: roomList.map(r => r.name),
    buddies: buddies.map(b => b.username),
    commands: CORE_COMMANDS,
  });
  const showUserList = (settings as unknown as { chatrooms?: { user_list_visible?: boolean } }).chatrooms?.user_list_visible ?? true;
  const allTickers = Array.from(joinedRooms.values()).flatMap(r => (r.tickers || []).map(t => ({ ...t, room: r.name })));

  useEffect(() => {
    if (state.status === "failed") router.replace("/");
  }, [state.status, router]);

  useEffect(() => {
    sysLogRef.current?.scrollTo({ top: sysLogRef.current.scrollHeight });
  }, [systemMessages.length, activeRoom]);

  if (state.status === "idle" || state.status === "connecting") return <div className="flex h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (state.status !== "connected") return null;

  const handleJoin = () => {
    const r = joinInput.trim();
    if (!r) return;
    const sanitized = r.replace(/[^ -~]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (!sanitized) return;
    // private flag: nicotine shows private rooms with lock; we pass via suffix hint and setTicker path — UI only for now
    joinRoom(sanitized);
    setJoinInput("");
    setIsPrivate(false);
  };

  const handleSay = () => {
    if (!activeRoom || !sayInput.trim()) return;
    say(activeRoom, sayInput);
    setSayInput("");
  };

  return (
    <div className="flex min-h-[100dvh] h-screen max-w-full overflow-hidden bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title={activeRoom || "Chat Rooms"} subtitle={activeRoom ? `${activeUsers.length} users • ${roomList.length} public rooms` : `${joinedArray.length} joined • ${roomList.length} public`} />
      <main className="md:ml-72 flex flex-1 flex-col overflow-hidden min-h-0 bg-surface-dim dark:bg-inverse-surface pt-[calc(56px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0 max-w-full overflow-x-hidden min-w-0">
        <header className="hidden md:flex sticky top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
          <div>
            <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Chat Rooms</h2>
            <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">
              {activeRoom ? `${activeUsers.length} users • ${activeRoom}` : `${joinedArray.length} joined • ${roomList.length} public`}
              <span className="hidden md:inline"> • Monitoring rooms</span>
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {activeRoom ? <span className="hidden md:inline-flex items-center gap-2 rounded-full bg-primary-fixed/20 dark:bg-primary-container/20 px-3 py-1 font-label text-xs font-semibold text-primary dark:text-inverse-primary"><span className="material-symbols-outlined text-[16px]">tag</span> {activeRoom}</span> : null}
            {joinedRooms.size > 0 ? <button onClick={() => { if (confirm("Close all rooms? Leave all joined rooms.")) closeAll(); }} className="hidden md:inline-flex rounded-lg bg-surface-container-high px-3 py-2 font-label text-xs hover:bg-error-container hover:text-on-error-container">Close All</button> : null}
            {activeRoom ? <button onClick={() => leaveRoom(activeRoom)} className="hidden md:inline-flex rounded-lg bg-surface-container-high px-3 py-2 font-label text-xs hover:bg-error-container hover:text-on-error-container">Leave</button> : null}
            <Link href="/settings?tab=chats#chats" className="hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center" aria-label="Chat settings"><span className="material-symbols-outlined">settings</span></Link>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden min-h-0" style={isDemo ? ({ marginTop: "var(--demo-banner-h)" } as React.CSSProperties) : undefined}>
          {/* Left: Rooms */}
          <aside className="hidden w-80 flex-col border-r border-outline-variant/15 bg-surface md:flex">
            <div className="border-b border-outline-variant/15 p-3 space-y-3">
              <div className="flex gap-2">
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  placeholder="Join or create room..."
                  maxLength={24}
                  className="flex-1 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm placeholder:text-outline-variant focus:border-primary outline-none"
                />
                <button
                  onClick={handleJoin}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
                >
                  Join
                </button>
              </div>
              <select
                data-testid="public-room-dropdown"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setJoinInput(v);
                }}
                className="w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest dark:bg-surface-container-low dark:text-inverse-primary px-3 py-2.5 text-sm focus:border-primary outline-none"
              >
                <option value="">Choose a room to join… ({sortedRooms.length})</option>
                {sortedRooms.slice(0, 50).map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.users})
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="rounded" />
                Private room
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-outline">search</span>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter rooms..."
                  className="w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest py-2 pl-8 pr-3 text-sm focus:border-primary outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 p-2 space-y-4">
              {/* Joined */}
              {joinedArray.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between px-3 py-1">
                    <h4 className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                      Joined Rooms
                    </h4>
                    <button
                      onClick={() => {
                        if (confirm("Close all rooms?")) closeAll();
                      }}
                      className="font-label text-[10px] text-error hover:underline"
                    >
                      Close All
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {joinedArray.map((r) => (
                      <li key={r.name}>
                        <button
                          onClick={() => setActiveRoom(r.name)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenuAnchor({
                              x: e.clientX,
                              y: e.clientY,
                              items: [{ id: "leave", label: "Leave Room", icon: "logout", danger: true, action: () => leaveRoom(r.name) }],
                            });
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${activeRoom === r.name ? "bg-primary-fixed/20 text-primary dark:bg-primary-container/20 dark:text-inverse-primary font-semibold" : "hover:bg-surface-container-low dark:hover:bg-surface-container-high text-on-surface-variant dark:text-on-surface"}`}
                        >
                          <span className="flex items-center gap-2 truncate dark:text-inverse-primary">
                            <span className="material-symbols-outlined text-[16px] text-outline dark:text-inverse-primary">tag</span> {r.name}
                          </span>
                          <span className="rounded bg-surface-container-high dark:bg-surface-container-high px-1.5 py-0.5 font-label text-[10px] dark:text-on-surface-variant">{r.users.length}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Public */}
              <div>
                <h4 className="px-3 py-1 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Public Rooms {roomList.length ? `• ${roomList.length}` : ""}
                </h4>
                {filteredRooms.length === 0 ? (
                  <p className="px-3 py-2 font-body text-xs text-outline">No rooms yet. Join one above.</p>
                ) : (
                  <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
                    {filteredRooms.slice(0, 50).map((r) => (
                      <li key={r.name}>
                        <button
                          onClick={() => joinRoom(r.name)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-container-low dark:hover:bg-surface-container-high"
                        >
                          <span className="flex items-center gap-2 truncate text-on-surface dark:text-inverse-primary">
                            <span className="material-symbols-outlined text-[16px] text-outline dark:text-inverse-primary">tag</span> {r.name}
                          </span>
                          <span className="font-label text-xs text-outline dark:text-on-surface-variant">{r.users}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>

          {/* Center: Messages */}
          <section className="flex flex-1 flex-col overflow-hidden min-h-0 bg-surface-container-lowest/30" onContextMenu={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("button, input, textarea, select")) return;
            e.preventDefault();
            setMenuAnchor({
              x: e.clientX,
              y: e.clientY,
              items: chatRoomMenu(activeRoom, activeRoom ? "chat" : "activity", {
                onFind: () => {},
                onCopyAll: () => navigator.clipboard.writeText(userMessages.map((m) => `${m.username}: ${m.message}`).join("\n")),
                onClear: () => {},
                onLeave: () => activeRoom && leaveRoom(activeRoom),
              }),
            });
          }}>
            {/* Mobile room picker */}
            <div className="border-b border-outline-variant/15 bg-surface p-3 md:hidden">
              <select
                value={activeRoom || ""}
                onChange={(e) => setActiveRoom(e.target.value || null)}
                className="w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 min-h-11 text-sm"
              >
                <option value="">Select a room</option>
                {joinedArray.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.users.length})
                  </option>
                ))}
              </select>
              <div className="mt-2 flex gap-2">
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  placeholder="Room name"
                  className="flex-1 min-w-0 rounded-lg border border-outline-variant/30 px-3 py-2.5 min-h-11 text-sm"
                />
                <button onClick={handleJoin} className="shrink-0 rounded-lg bg-primary px-4 py-2.5 min-h-11 text-sm text-on-primary">
                  Join
                </button>
              </div>
              <select
                data-testid="public-room-dropdown"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setJoinInput(v);
                }}
                className="mt-2 w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest dark:bg-surface-container-low dark:text-inverse-primary px-3 py-2.5 text-sm focus:border-primary outline-none"
              >
                <option value="">Choose a room to join… ({sortedRooms.length})</option>
                {sortedRooms.slice(0, 50).map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.users})
                  </option>
                ))}
              </select>
              <label className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> Private
              </label>
            </div>

            {!activeRoom ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <span className="material-symbols-outlined text-5xl text-outline-variant">groups</span>
                  <p className="mt-2 font-headline text-lg font-semibold">No room selected</p>
                  <p className="mt-1 font-body text-sm text-on-surface-variant">Join or create a room from the sidebar.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Room header */}
                <div className="flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-lowest/60 px-4 md:px-6 py-3 backdrop-blur-sm max-w-full overflow-hidden gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <span className="material-symbols-outlined text-primary">tag</span>
                    <h3 className="font-headline font-bold truncate min-w-0 max-w-[40vw]">{activeRoom}</h3>
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-label text-xs">
                      {activeUsers.length} users
                    </span>
                    <button onClick={() => setShowWall((v) => !v)} className="hidden md:inline-flex items-center gap-1 rounded-full bg-tertiary-container px-2 py-0.5 font-label text-xs text-on-tertiary-container">
                      <span className="material-symbols-outlined text-[14px]">wallpaper</span> Room Wall {activeTickers.length ? `• ${activeTickers.length}` : ""}
                    </button>
                  </div>
                  <span className="hidden md:inline font-label text-xs text-on-surface-variant">Room history may be truncated</span>
                </div>
                {/* Ticker strip */}
                {activeTickers.length ? (
                  <div className="flex gap-2 overflow-x-auto bg-tertiary-fixed/10 px-4 py-2 border-b border-outline-variant/10 hide-scrollbar">
                    {activeTickers.map((t) => (
                      <span key={t.username} className="shrink-0 rounded-full bg-surface-container-high px-3 py-1 font-label text-xs">
                        <span className="font-semibold">{t.username}:</span> {t.msg}
                      </span>
                    ))}
                  </div>
                ) : null}
                {showWall ? (
                  <div className="border-b border-outline-variant/15 bg-surface p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-label text-xs uppercase tracking-widest">Room Wall • {activeTickers.length} tickers</h4>
                      <button onClick={() => setShowWall(false)} className="rounded-full p-1 hover:bg-surface-container-high"><span className="material-symbols-outlined text-[18px]">close</span></button>
                    </div>
                    <div className="flex gap-2">
                      <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="Set your ticker…" className="flex-1 rounded-lg bg-surface-container-low px-3 py-2 text-sm" />
                      <button onClick={() => { if (activeRoom && tickerInput.trim()) { setTicker(activeRoom, tickerInput.trim()); setTickerInput(""); } }} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary">Set Ticker</button>
                      <button onClick={() => { if (activeRoom) { setTicker(activeRoom, ""); } }} className="rounded-lg bg-surface-container-high px-3 py-2 text-xs">Clear</button>
                    </div>
                    <ul className="max-h-40 overflow-y-auto space-y-1">
                      {activeTickers.map((t) => (
                        <li key={t.username} className="flex justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-sm">
                          <span><span className="font-semibold">{t.username}</span> — {t.msg}</span>
                        </li>
                      ))}
                      {activeTickers.length === 0 ? <li className="text-xs text-outline">No tickers yet.</li> : null}
                    </ul>
                  </div>
                ) : null}

                <div className="flex flex-1 overflow-hidden min-h-0">
                  <div className="flex flex-1 flex-col overflow-hidden min-h-0">
                    <div ref={sysLogRef} data-testid="system-log" aria-label="System events" className="shrink-0 max-h-[10%] overflow-y-auto overscroll-contain border-b border-outline-variant/15 bg-surface-container-low/60 px-4 md:px-6 py-1">
                      {systemMessages.length === 0 ? (
                        <p className="py-1 text-center font-body text-[11px] italic text-outline">No system events</p>
                      ) : (
                        systemMessages.map((m) => (
                          <div key={m.id} className="flex justify-center py-0.5 max-w-full overflow-hidden">
                            <span className="truncate whitespace-nowrap font-body text-xs italic text-on-surface-variant max-w-full overflow-hidden">
                              {m.message}
                              <span className="ml-2 font-mono text-[10px] text-outline">
                                {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 p-4 md:p-6 space-y-2 max-w-full overflow-x-hidden">
                      {userMessages.length === 0 ? (
                        <div className="py-10 text-center">
                          <p className="font-body text-sm text-outline">No messages yet. Start the conversation.</p>
                        </div>
                      ) : (
                        userMessages.map((m) => {
                          const isSelf = state.user !== undefined && state.user !== null && m.username === (state as unknown as { user?: string }).user;
                          const isIgnored = settings.server.ignorelist.includes(m.username) || !!settings.server.ipignorelist[m.username];
                          if (isSelf) {
                            return (
                              <div key={m.id} className={`group flex justify-end gap-3 px-4 md:px-6 py-1.5 max-w-full overflow-hidden ${isIgnored ? "opacity-40" : ""}`}>
                                <div className="flex max-w-[80%] flex-col items-end">
                                  <p className="font-body text-xs leading-relaxed text-right">
                                    <span className={usernameHotspotClass(settings.ui.usernamehotspots, settings.ui.usernamestyle)}>
                                      {m.username}
                                    </span>
                                    <span className="ml-2 font-mono text-[10px] text-outline">
                                      {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  </p>
                                  <div className="mt-1 rounded-2xl bg-primary-container dark:bg-primary-container px-4 py-2 text-sm text-on-primary-container break-words [overflow-wrap:anywhere] text-right">
                                    {isIgnored ? (
                                      "[ignored]"
                                    ) : (() => {
                                      const hl = highlightKeywords(m.message, settings.words.keywords, settings.words.watch_keywords);
                                      return hl ? <span dangerouslySetInnerHTML={{ __html: hl }} /> : m.message;
                                    })()}
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                          <div key={m.id} className={`group flex gap-3 hover:bg-surface-container-low/40 -mx-4 md:-mx-6 px-4 md:px-6 py-1.5 max-w-full overflow-hidden ${isIgnored ? "opacity-40" : ""}`}>
                            <span
                              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-xs font-bold bg-primary-container text-on-primary-container"
                            >
                              {m.username.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-body text-sm leading-relaxed">
                                <span className={usernameHotspotClass(settings.ui.usernamehotspots, settings.ui.usernamestyle)}>
                                  {m.username}
                                </span>
                                <span className="ml-2 font-mono text-xs text-outline">
                                  {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </p>
                              <p
                                className={`mt-0.5 font-body text-sm leading-relaxed break-words [overflow-wrap:anywhere] text-on-surface`}
                              >
                                {isIgnored ? (
                                  "[ignored]"
                                ) : (() => {
                                  const hl = highlightKeywords(m.message, settings.words.keywords, settings.words.watch_keywords);
                                  return hl ? <span dangerouslySetInnerHTML={{ __html: hl }} /> : m.message;
                                })()}
                              </p>
                            </div>
                          </div>
                          );
                        })
                      )}
                    </div>

                    <div className="border-t border-outline-variant/15 bg-surface p-3 relative">
                      {completion.shouldShow ? (
                        <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl bg-surface-container-lowest shadow-xl ghost-border p-2 max-h-40 overflow-y-auto">
                          {completion.matches.map((m, idx) => (
                            <button key={m} type="button" onClick={() => { setSayInput(completion.apply(sayInput, m)); }} className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${idx === completion.index ? "bg-primary-fixed/20 text-primary" : "hover:bg-surface-container-low"}`}>{m}</button>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex items-end gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-2 focus-within:border-primary">
                        <textarea
                          value={sayInput}
                          spellCheck={settings.ui.spellcheck}
                          onChange={(e) => { setSayInput(e.target.value); completion.onInput(e.target.value); }}
                          onKeyDown={(e) => {
                            if (e.key === "Tab" && settings.words.tab) {
                              e.preventDefault();
                              if (completion.matches.length) {
                                const next = completion.cycle(sayInput, e.shiftKey ? -1 : 1);
                                setSayInput(next);
                              }
                              return;
                            }
                            if (e.key === "ArrowDown" && completion.shouldShow) { e.preventDefault(); completion.setIndex((completion.index + 1) % completion.matches.length); return; }
                            if (e.key === "ArrowUp" && completion.shouldShow) { e.preventDefault(); completion.setIndex((completion.index - 1 + completion.matches.length) % completion.matches.length); return; }
                            if (e.key === "Enter" && completion.shouldShow) { e.preventDefault(); setSayInput(completion.apply(sayInput, completion.matches[completion.index])); return; }
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSay();
                            }
                            if (e.key === "Escape" && completion.shouldShow) { completion.setOpen(false); }
                          }}
                          placeholder={`Message #${activeRoom}...`}
                          rows={1}
                          className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm placeholder:text-outline focus:outline-none"
                        />
                        <button
                          onClick={handleSay}
                          className="rounded-lg bg-primary p-3 min-h-11 min-w-11 flex items-center justify-center text-on-primary hover:bg-primary-container shrink-0"
                        >
                          <span className="material-symbols-outlined text-[20px]">send</span>
                        </button>
                      </div>
                      <p className="mt-2 px-2 font-mono text-[10px] text-outline">Enter to send • Shift+Enter for new line • /me for action</p>
                    </div>
                  </div>

                   {/* Right: user list desktop — respects chatrooms.user_list_visible + buddylistinchatrooms */}
                  {showUserList || settings.ui.buddylistinchatrooms === "always" || settings.ui.buddylistinchatrooms === "chatrooms" ? (
                  <aside className="hidden w-56 flex-col border-l border-outline-variant/15 bg-surface-container-lowest md:flex">
                    {showUserList ? (
                      <>
                        <div className="border-b border-outline-variant/15 px-4 py-3">
                          <h4 className="font-label text-xs uppercase tracking-widest text-on-surface-variant">
                            Users • {activeUsers.length}
                          </h4>
                        </div>
                        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 p-2 space-y-1">
                          {activeUsers.length === 0 ? (
                            <p className="px-3 py-2 font-body text-xs text-outline">No users (room list may be stale).</p>
                          ) : (
                            activeUsers.map((u) => {
                              const isIgnored = settings.server.ignorelist.includes(u) || !!settings.server.ipignorelist[u];
                              const isOperator = (joinedRooms.get(activeRoom!)?.operators || []).includes(u);
                              const isOwner = joinedRooms.get(activeRoom!)?.owner === u;
                              const stats = userStats.get(u.toLowerCase());
                              return (
                              <button
                                key={u}
                                onClick={() => router.push(`/profile/${encodeURIComponent(u)}`)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setMenuAnchor({ x: e.clientX, y: e.clientY, items: userMenu(u, "chatrooms") });
                                }}
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface-container-low dark:hover:bg-surface-container-high ${isIgnored ? "opacity-40" : ""} ${isOwner ? "font-bold underline decoration-primary dark:decoration-inverse-primary" : isOperator ? "font-semibold" : ""}`}
                              >
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold ${isOwner ? "bg-primary text-on-primary dark:bg-inverse-primary dark:text-on-primary-fixed" : "bg-surface-container-high dark:bg-surface-container-high"}`}>
                                  {u.slice(0, 2).toUpperCase()}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-body text-xs font-medium dark:text-inverse-primary">{u}{isOwner ? " ★" : isOperator ? " ◆" : ""}</span>
                                {stats ? <span className="ml-auto shrink-0 text-[11px] font-normal text-outline dark:text-outline/70 tabular-nums">{stats.files.toLocaleString()} shares</span> : null}
                              </button>
                            );})
                          )}
                        </div>
                      </>
                    ) : null}
                    {(settings.ui.buddylistinchatrooms === "chatrooms" || settings.ui.buddylistinchatrooms === "always") && buddies.length > 0 ? (
                      <div className={`${showUserList ? "border-t" : ""} border-outline-variant/15 px-2 py-2`}>
                        <h4 className="px-2 py-1 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Buddies • {buddies.length}</h4>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {buddies.slice(0, 12).map((b) => (
                            <button key={b.username} onClick={() => router.push(`/profile/${encodeURIComponent(b.username)}`)} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-surface-container-low">
                              <span className="flex h-5 w-5 items-center justify-center rounded bg-tertiary-container text-[9px] font-bold text-on-tertiary-container">{b.username.slice(0,2).toUpperCase()}</span>
                              <span className="truncate font-body text-xs">{b.username}</span>
                              <span className={`ml-auto h-2 w-2 rounded-full ${b.status === 2 ? "bg-green-500" : b.status === 1 ? "bg-amber-500" : "bg-outline-variant"}`} title={b.status === 2 ? "Online" : b.status === 1 ? "Away" : "Offline"} />
                            </button>
                          ))}
                        </div>
                        {buddies.length > 12 ? <p className="px-2 pt-1 font-label text-[10px] text-outline">+{buddies.length - 12} more in Buddies tab</p> : null}
                      </div>
                    ) : null}
                  </aside>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
      <BottomNav />
      {/* Global Room Wall — aggregates tickers from all joined rooms (roomwall.py parity) */}
      {showWall && activeRoom ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowWall(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-surface-container-lowest p-6 shadow-xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline text-lg font-bold">Room Wall — All tickers</h3>
              <button onClick={() => setShowWall(false)} className="rounded-full p-2 hover:bg-surface-container-high"><span className="material-symbols-outlined">close</span></button>
            </div>
            <p className="font-body text-xs text-on-surface-variant mb-3">Tickers across {joinedRooms.size} joined rooms. Filter or clear per room.</p>
            <input placeholder="Filter tickers..." className="w-full rounded-lg bg-surface-container-low px-3 py-2 text-sm mb-3" onChange={() => {}} />
            <ul className="space-y-2">
              {allTickers.length === 0 ? <li className="text-sm text-outline">No tickers yet.</li> : allTickers.map(t => (
                <li key={`${t.room}-${t.username}`} className="flex justify-between rounded-lg bg-surface-container-low px-3 py-2 text-sm">
                  <span><span className="font-semibold">{t.room} / {t.username}:</span> {t.msg}</span>
                  <button onClick={() => { if (activeRoom) setTicker(t.room, ""); }} className="text-xs text-error hover:underline ml-2">Clear</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {menuAnchor ? <ContextMenu x={menuAnchor.x} y={menuAnchor.y} items={menuAnchor.items} onClose={() => setMenuAnchor(null)} /> : null}
    </div>
  );
}
