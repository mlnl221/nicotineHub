import { describe, expect, test } from "bun:test";
import { emptyUnread, parseUnreadStored, unreadKeyForMessage, unreadKeyForRoute } from "./unread-dots";

const CTCP_TYPING = "\x01TYPING\x01";

describe("unreadKeyForRoute", () => {
  test("maps tab routes, incl. nested pages", () => {
    expect(unreadKeyForRoute("/private-chat")).toBe("privateChat");
    expect(unreadKeyForRoute("/chat/lobby")).toBe("chat");
    expect(unreadKeyForRoute("/downloads")).toBe("downloads");
    expect(unreadKeyForRoute("/search")).toBe("search");
    expect(unreadKeyForRoute("/browse/someone")).toBe("browse");
    expect(unreadKeyForRoute("/profile/someone")).toBe("profile");
  });
  test("private-chat wins over chat prefix", () => {
    expect(unreadKeyForRoute("/private-chat")).not.toBe("chat");
  });
  test("dot-less routes return null", () => {
    expect(unreadKeyForRoute("/uploads")).toBeNull();
    expect(unreadKeyForRoute("/settings")).toBeNull();
    expect(unreadKeyForRoute("/")).toBeNull();
  });
});

describe("unreadKeyForMessage", () => {
  test("chat arrivals", () => {
    expect(unreadKeyForMessage({ type: "chat:event", event: { type: "private-message", username: "a", message: "hi" } })).toBe("privateChat");
    expect(unreadKeyForMessage({ type: "chat:event", event: { type: "say-chatroom", message: "hi" } })).toBe("chat");
    expect(unreadKeyForMessage({ type: "chat:event", event: { type: "global-room-message", message: "hi" } })).toBe("chat");
  });
  test("CTCP control rows never dot", () => {
    expect(unreadKeyForMessage({ type: "chat:event", event: { type: "private-message", username: "a", message: CTCP_TYPING } })).toBeNull();
  });
  test("acks and empty rows never dot", () => {
    expect(unreadKeyForMessage({ type: "chat:event", event: { type: "private-message-acked", username: "a" } })).toBeNull();
    expect(unreadKeyForMessage({ type: "chat:event", event: { type: "private-message", username: "a" } })).toBeNull();
  });
  test("completion events", () => {
    expect(unreadKeyForMessage({ type: "transfer:finished" })).toBe("downloads");
    expect(unreadKeyForMessage({ type: "search:end", searchId: "abc" })).toBe("search");
    expect(unreadKeyForMessage({ type: "browse:shares" })).toBe("browse");
    expect(unreadKeyForMessage({ type: "browse:folder" })).toBe("browse");
    expect(unreadKeyForMessage({ type: "user-info-response" })).toBe("profile");
    expect(unreadKeyForMessage({ type: "user-info-failed" })).toBe("profile");
  });
  test("wishlist hits excluded", () => {
    expect(unreadKeyForMessage({ type: "search:end", searchId: "wishlist:flac" })).toBeNull();
  });
  test("unrelated traffic ignored", () => {
    expect(unreadKeyForMessage({ type: "transfer:update" })).toBeNull();
    expect(unreadKeyForMessage({ type: "search:result" })).toBeNull();
    expect(unreadKeyForMessage({ type: "transfer:queue" })).toBeNull();
  });
});

describe("parseUnreadStored", () => {
  test("round-trips flags, drops unknown keys", () => {
    const s = parseUnreadStored(JSON.stringify({ chat: true, downloads: 1, bogus: true }));
    expect(s).toEqual({ ...emptyUnread(), chat: true });
  });
  test("garbage returns empty", () => {
    expect(parseUnreadStored("{nope")).toEqual(emptyUnread());
    expect(parseUnreadStored(null)).toEqual(emptyUnread());
  });
});
