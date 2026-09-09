"use client";

// Pure unread-dot logic (provider lives in unread.tsx). Kept UI-free so bun
// can unit-test it without React.

export type UnreadKey = "privateChat" | "chat" | "downloads" | "search" | "browse" | "profile";

export type UnreadState = Record<UnreadKey, boolean>;

export const UNREAD_KEYS: UnreadKey[] = ["privateChat", "chat", "downloads", "search", "browse", "profile"];

export const UNREAD_STORE_KEY = "nicotineHub.unread";

export function emptyUnread(): UnreadState {
  return { privateChat: false, chat: false, downloads: false, search: false, browse: false, profile: false };
}

export function parseUnreadStored(raw: string | null): UnreadState {
  const next = emptyUnread();
  if (!raw) return next;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<UnreadKey, unknown>>;
    for (const k of UNREAD_KEYS) next[k] = parsed?.[k] === true;
  } catch {}
  return next;
}

/** Tab route -> unread key cleared by visiting it. Null for routes with no dot. */
export function unreadKeyForRoute(pathname: string): UnreadKey | null {
  if (pathname.startsWith("/private-chat")) return "privateChat";
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/downloads")) return "downloads";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/browse")) return "browse";
  if (pathname.startsWith("/profile")) return "profile";
  return null;
}

interface InboundMessage {
  type: string;
  event?: { type?: string; username?: string; message?: string };
  searchId?: string;
}

/**
 * Bridge WS message -> unread key to set. Null when no dot.
 * Mirrors the stores: privateChat.tsx (CTCP dropped), rooms.tsx, transfers.tsx
 * (transfer:finished is downloads-only), search.tsx, browse-tabs.tsx,
 * profile-tabs.tsx. Wishlist hits excluded — wishlist has its own notify path.
 */
export function unreadKeyForMessage(msg: InboundMessage): UnreadKey | null {
  switch (msg.type) {
    case "chat:event": {
      const ev = msg.event;
      if (!ev || typeof ev.type !== "string") return null;
      if (ev.type === "private-message" && ev.username && ev.message) {
        if (/^\x01.*\x01$/.test(ev.message)) return null; // CTCP, never chat
        return "privateChat";
      }
      if ((ev.type === "say-chatroom" || ev.type === "global-room-message") && ev.message) return "chat";
      return null;
    }
    case "transfer:finished":
      return "downloads";
    case "search:end":
      if (typeof msg.searchId === "string" && msg.searchId.startsWith("wishlist:")) return null;
      return "search";
    case "browse:shares":
    case "browse:folder":
      return "browse";
    case "user-info-response":
    case "user-info-failed":
      return "profile";
    default:
      return null;
  }
}
