"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { usePrivateChat } from "@/lib/privateChat";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { privateChatMenu, userMenu } from "@/lib/context-menu/menus";

function PrivateChatInner() {
  const { state } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const initialUser = params.get("user") || "";
  const { conversations, users, activeUser, setActiveUser, sendMessage, closeAll, closeConversation } = usePrivateChat();
  const [input, setInput] = useState("");
  const [newChatUser, setNewChatUser] = useState(initialUser);
  const [filter, setFilter] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; items: import("@/components/ui/ContextMenu").MenuItem[] } | null>(null);

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  useEffect(() => {
    if (initialUser && !users.includes(initialUser)) {
      setActiveUser(initialUser);
    } else if (initialUser) {
      setActiveUser(initialUser);
    }
  }, [initialUser]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, activeUser]);

  if (state.status !== "connected") return null;

  const activeMessages = activeUser ? conversations.get(activeUser) || [] : [];
  const filteredUsers = filter ? users.filter((u) => u.toLowerCase().includes(filter.toLowerCase())) : users;

  const handleSend = () => {
    if (!activeUser || !input.trim()) return;
    sendMessage(activeUser, input);
    setInput("");
  };

  const startNewChat = () => {
    const u = newChatUser.trim();
    if (!u) return;
    setActiveUser(u);
    setNewChatUser("");
  };

  const topBarTitle = activeUser ? activeUser : "Private Chat";
  const topBarSubtitle = activeUser ? "Private message" : `${users.length} conversations`;

  return (
    <div className="flex min-h-[100dvh] h-screen max-w-[100vw] overflow-x-hidden bg-surface-container-lowest font-body text-on-surface">
      <Sidebar />
      <TopBar title={topBarTitle} subtitle={topBarSubtitle} />
      <main className="md:ml-72 flex flex-1 flex-col overflow-hidden pt-[calc(56px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0 max-w-full overflow-x-hidden min-w-0">
        <header className="sticky top-[calc(56px+env(safe-area-inset-top,0px))] md:top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
          <div>
            <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Private Chat</h2>
            <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">
              {users.length} conversations
              {activeUser ? <span className="hidden md:inline"> • {activeUser}</span> : null}
              <span className="md:hidden font-label text-xs"> • {activeUser || `${users.length} chats`}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {activeUser ? (
              <>
                <span className="hidden md:inline-flex items-center gap-2 rounded-full bg-primary-fixed/20 px-3 py-1 font-label text-xs font-semibold text-primary">
                  <span className="h-2 w-2 rounded-full bg-green-500" /> {activeUser}
                </span>
                <button onClick={() => (window.location.href = `/profile/${encodeURIComponent(activeUser)}`)} className="hidden md:flex rounded-lg bg-surface-container-high px-4 py-2 font-label text-xs font-semibold hover:bg-surface-variant">Profile</button>
                <button onClick={() => (window.location.href = `/browse/${encodeURIComponent(activeUser)}`)} className="hidden md:flex rounded-lg bg-surface-container-high px-4 py-2 font-label text-xs font-semibold hover:bg-surface-variant">Browse</button>
              </>
            ) : null}
            {users.length > 1 ? (
              <button onClick={() => { if (confirm("Close all chats?")) closeAll(); }} className="hidden md:inline-flex rounded-lg bg-surface-container-high px-3 py-2 font-label text-xs hover:bg-error-container hover:text-on-error-container">Close All</button>
            ) : null}
            <a href="/settings?tab=chats#chats" className="hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center" aria-label="Chat settings">
              <span className="material-symbols-outlined">settings</span>
            </a>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Active Conversations */}
          <aside className="hidden w-80 flex-col border-r border-outline-variant/15 bg-surface md:flex">
            <div className="border-b border-outline-variant/15 p-3 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newChatUser}
                  onChange={(e) => setNewChatUser(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && startNewChat()}
                  placeholder="Username"
                  className="flex-1 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                />
                <button
                  onClick={startNewChat}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
                >
                  Chat
                </button>
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">search</span>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter conversations..."
                  className="w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest py-2 pl-9 pr-3 text-sm focus:border-primary outline-none"
                />
              </div>
            </div>
            {users.length > 0 ? (
              <div className="flex justify-between items-center px-2 py-1">
                <span className="font-label text-[10px] uppercase tracking-widest text-outline">{users.length} chats</span>
                <button
                  onClick={() => {
                    if (confirm("Close all chats?")) closeAll();
                  }}
                  className="font-label text-[10px] uppercase tracking-widest text-error hover:underline"
                >
                  Close All
                </button>
              </div>
            ) : null}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredUsers.length === 0 ? (
                <p className="p-4 text-center font-body text-sm text-outline">
                  No conversations yet.<br />Start a new chat above.
                </p>
              ) : (
                filteredUsers.map((u) => {
                  const msgs = conversations.get(u) || [];
                  const last = msgs[msgs.length - 1];
                  const isActive = activeUser === u;
                  return (
                    <button
                      key={u}
                      onClick={() => setActiveUser(u)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuAnchor({ x: e.clientX, y: e.clientY, items: userMenu(u, "privatechat") });
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${isActive ? "bg-primary-fixed/20 text-primary border border-primary/20" : "hover:bg-surface-container-low"}`}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-high text-sm font-bold">
                        {u.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-sm font-semibold">{u}</p>
                        <p className="truncate font-body text-xs text-on-surface-variant">
                          {last ? (last.isSelf ? `You: ${last.message}` : last.message) : "No messages"}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeConversation(u);
                        }}
                        className="ml-2 rounded-full p-1 text-outline hover:bg-surface-container-high hover:text-error"
                        title="Close"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Center: Messages + Mobile picker */}
          <section className="flex flex-1 flex-col overflow-hidden" onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("button, input, textarea, select")) return;
            e.preventDefault();
            setMenuAnchor({
              x: e.clientX,
              y: e.clientY,
              items: privateChatMenu(activeUser, activeMessages as unknown as { username: string; message: string }[], {
                onFind: () => {},
                onCopyAll: () => {
                  const text = activeMessages.map((m) => `${m.username}: ${m.message}`).join("\n");
                  navigator.clipboard.writeText(text);
                },
                onClear: () => {},
              }),
            });
          }}>
            {/* Mobile user picker */}
            <div className="border-b border-outline-variant/15 bg-surface-container-lowest p-3 md:hidden">
              <select
                value={activeUser || ""}
                onChange={(e) => setActiveUser(e.target.value || null)}
                className="w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2.5 min-h-11 text-sm"
              >
                <option value="">Select a conversation</option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex gap-2">
                <input
                  value={newChatUser}
                  onChange={(e) => setNewChatUser(e.target.value)}
                  placeholder="New chat username"
                  className="flex-1 min-w-0 rounded-lg border border-outline-variant/30 px-3 py-2.5 min-h-11 text-sm"
                />
                <button onClick={startNewChat} className="shrink-0 rounded-lg bg-primary px-4 py-2.5 min-h-11 text-sm text-on-primary">
                  Start
                </button>
              </div>
            </div>

            {!activeUser ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <span className="material-symbols-outlined text-5xl text-outline-variant">forum</span>
                  <p className="mt-2 font-headline text-lg font-semibold">Select a conversation</p>
                  <p className="mt-1 font-body text-sm text-on-surface-variant">Choose a peer from the list or start a new chat.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {activeMessages.length === 0 ? (
                    <div className="flex justify-center">
                      <span className="rounded-full bg-surface-container-high px-4 py-2 font-label text-xs text-on-surface-variant">
                        No messages yet. Say hello to {activeUser}.
                      </span>
                    </div>
                  ) : (
                    activeMessages.map((m) => (
                      <div key={m.id} className={`flex gap-3 max-w-[78%] min-w-0 ${m.isSelf ? "self-end flex-row-reverse" : ""}`}>
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-xs font-bold">
                          {m.isSelf ? "You" : m.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div
                          className={`rounded-2xl px-4 py-3 shadow-sm max-w-full overflow-hidden min-w-0 ${m.isSelf ? "rounded-br-sm bg-primary-container/20 border border-primary/20" : "rounded-bl-sm bg-surface-container-low border border-outline-variant/20"}`}
                        >
                          <p className="font-body text-sm leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-wrap">{m.message}</p>
                          <p className="mt-1 font-label text-[10px] text-outline">
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={endRef} />
                </div>

                <footer className="border-t border-outline-variant/15 bg-surface-container-lowest p-4">
                  <div className="flex items-end gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-low p-2 focus-within:border-primary">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder={`Message ${activeUser}...`}
                      rows={1}
                      className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 font-body text-sm placeholder:text-outline focus:outline-none"
                    />
                    <button
                      onClick={handleSend}
                      className="rounded-lg bg-primary p-3 min-h-11 min-w-11 flex items-center justify-center text-on-primary hover:bg-primary-container shrink-0"
                    >
                      <span className="material-symbols-outlined text-[20px]">send</span>
                    </button>
                  </div>
                  <p className="mt-2 px-2 font-mono text-[10px] text-outline">Enter to send • Shift+Enter for new line • /me for action</p>
                </footer>
              </>
            )}
          </section>
        </div>
      </main>
      <BottomNav />
      {menuAnchor ? <ContextMenu x={menuAnchor.x} y={menuAnchor.y} items={menuAnchor.items} onClose={() => setMenuAnchor(null)} /> : null}
    </div>
  );
}

export default function PrivateChatPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center font-body text-sm text-on-surface-variant">Loading…</div>}>
      <PrivateChatInner />
    </Suspense>
  );
}
