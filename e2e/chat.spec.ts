import { test, expect } from "@playwright/test";

/**
 * Chat E2E — room auto-scroll (stick-to-bottom), jump pill, username menu,
 * system-log size, and private-chat stick behavior.
 *
 * Mocks WebSocket so we don't need a real Soulseek server. Pattern copied
 * from transfers.spec.ts (MockWS with OPEN statics, HMR passthrough).
 */

const BASE = process.env.CHAT_E2E_BASE ?? "http://localhost:3001";

async function mockBridge(page) {
  await page.addInitScript(() => {
    const OriginalWS = window.WebSocket;

    class MockWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 1;
      url: string;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      sent: unknown[] = [];
      _listeners: Record<string, ((e: Event) => void)[]> = {};
      addEventListener(type: string, cb: (e: Event) => void) {
        (this._listeners[type] = this._listeners[type] || []).push(cb);
      }
      removeEventListener(type: string, cb: (e: Event) => void) {
        if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== cb);
      }
      dispatchEvent(event: Event) {
        const arr = this._listeners[event.type] || [];
        for (const cb of arr) cb(event);
        if (event.type === "open") this.onopen?.(event);
        if (event.type === "message") this.onmessage?.(event as MessageEvent);
        if (event.type === "error") this.onerror?.(event);
        if (event.type === "close") this.onclose?.(event as CloseEvent);
        return true;
      }
      constructor(url: string, protocols?: string | string[]) {
        // Don't mock HMR websocket — let Next.js HMR use real WebSocket
        if (url.includes("webpack-hmr") || url.includes("_next")) {
          const real = new (OriginalWS as any)(url, protocols as any);
          return real as any;
        }
        this.url = url;
        (window as any).__mockWS = this;
        queueMicrotask(() => {
          this.dispatchEvent(new Event("open"));
          const w = window as any;
          const isLoggedIn = w.__mockLoggedIn || sessionStorage.getItem("__mockLoggedIn") === "1";
          if (isLoggedIn) {
            setTimeout(() => {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({ type: "session:status", loggedIn: true, username: "tester" }),
                }),
              );
            }, 50);
          }
        });
      }
      send(data: string) {
        const parsed = JSON.parse(data);
        this.sent.push(parsed);
        (window as any).__sent = this.sent;
        if (parsed.type === "session:status") {
          const w2 = window as any;
          const loggedIn = w2.__mockLoggedIn || sessionStorage.getItem("__mockLoggedIn") === "1";
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify(loggedIn
                  ? { type: "session:status", loggedIn: true, username: "tester" }
                  : { type: "session:status", loggedIn: false }),
              }),
            );
          }, 10);
          return;
        }
        if (parsed.type === "login") {
          (window as any).__mockLoggedIn = true;
          try { sessionStorage.setItem("__mockLoggedIn", "1"); } catch {}
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "login:result", ok: true, data: { success: true, banner: "hi", ipAddress: "1.2.3.4", checksum: "x", isSupporter: false } }),
              }),
            );
          }, 50);
        }
      }
      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = MockWS as any;
    (globalThis as any).WebSocket = MockWS as any;
  });
}

async function login(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("nicotineHub.onboardingDone", "1"); } catch {}
  });
  await page.goto(`${BASE}/`);
  await page.getByRole("textbox", { name: "Username" }).fill("tester");
  await page.getByRole("textbox", { name: "Password" }).fill("secret123");
  await page.getByRole("button", { name: /Log in/i }).click();
  await expect(page).toHaveURL(/\/search/);
}

async function spaGoto(page, path: string) {
  // Fresh load replays the real auto-login path: clear the mock "already
  // logged in" flag (which skips WS connect) so stored creds reconnect.
  await page.evaluate(() => {
    (window as any).__mockLoggedIn = false;
    try { sessionStorage.removeItem("__mockLoggedIn"); } catch {}
  });
  await page.goto(`${BASE}${path}`);
  await page.waitForFunction(() => !!(window as any).__mockWS, null, { timeout: 10000 });
  await expect(page.getByRole("button", { name: /logoff/i })).toBeVisible({ timeout: 10000 });
}

async function inject(page, obj: unknown) {
  await page.waitForFunction(() => !!(window as any).__mockWS, null, { timeout: 10000 });
  await page.evaluate((msg) => {
    (window as any).__mockWS.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
  }, obj);
}

async function joinLobby(page, users = ["alice", "bob"]) {
  await inject(page, {
    type: "room:event",
    event: {
      type: "join-room",
      room: "lobby",
      data: { room: "lobby", users: users.map((username) => ({ username })), owner: "alice", operators: [] },
    },
  });
}

async function sayRoom(page, username: string, message: string, room = "lobby") {
  await inject(page, { type: "chat:event", event: { type: "say-chatroom", room, username, message } });
}

async function isStuck(page, testId: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
  }, testId);
}

async function scrollable(page, testId: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return !!el && el.scrollHeight > el.clientHeight + 50;
  }, testId);
}

test.describe("Room chat scroll + user menu", () => {
  test("auto-scrolls to latest, pauses when scrolled up, pill jumps back", async ({ page }) => {
    await mockBridge(page);
    await login(page);
    // SPA-navigate: a full reload would skip WS connect while the mock
    // logged-in flag is set (session.tsx auto-login guard).
    await spaGoto(page, "/chat");
    await joinLobby(page);
    await expect(page.getByTestId("room-messages")).toBeVisible();
    // settle layout (icon font) so late shifts don't move the bottom edge
    await page.evaluate(() => document.fonts?.ready);

    for (let i = 1; i <= 30; i++) {
      await sayRoom(page, i % 2 ? "alice" : "bob", `message number ${i} with enough text to wrap a little`);
    }
    await expect.poll(() => scrollable(page, "room-messages")).toBe(true);
    // stuck to bottom after burst while at bottom
    await expect.poll(() => isStuck(page, "room-messages")).toBe(true);

    // scroll up -> pill appears
    await page.evaluate(() => {
      document.querySelector('[data-testid="room-messages"]')?.scrollTo({ top: 0 });
    });
    await expect(page.getByRole("button", { name: /Latest messages/ })).toBeVisible();

    // new message while scrolled up must NOT yank
    await sayRoom(page, "alice", "you should not be yanked down");
    await page.waitForTimeout(300);
    await expect(await isStuck(page, "room-messages")).toBe(false);
    await expect(page.getByRole("button", { name: /Latest messages/ })).toBeVisible();

    // pill jumps back to bottom
    await page.getByRole("button", { name: /Latest messages/ }).click();
    await expect.poll(() => isStuck(page, "room-messages")).toBe(true);
    await expect(page.getByRole("button", { name: /Latest messages/ })).toBeHidden();
  });

  test("right-click username opens Browse Shares / Profile / Private Chat", async ({ page }) => {
    await mockBridge(page);
    await login(page);
    await spaGoto(page, "/chat");
    await joinLobby(page);
    await sayRoom(page, "alice", "hello room");
    const name = page.getByTitle("alice — open user menu").last();
    await expect(name).toBeVisible();

    await name.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Browse Shares" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "View User Profile" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Send Message" })).toBeVisible();

    await page.getByRole("menuitem", { name: "Browse Shares" }).click();
    await expect(page).toHaveURL(/\/browse\/alice/);
  });

  test("system log capped at 5%", async ({ page }) => {
    await mockBridge(page);
    await login(page);
    await spaGoto(page, "/chat");
    await joinLobby(page);
    await inject(page, { type: "room:event", event: { type: "user-joined-room", room: "lobby", username: "carol" } });
    const sysLog = page.getByTestId("system-log");
    await expect(sysLog).toBeVisible();
    await expect(sysLog).toContainText("carol has joined the room");
    const cls = await sysLog.getAttribute("class");
    expect(cls).toContain("max-h-[5%]");
  });
});

test.describe("Private chat scroll + peer menu", () => {
  test("auto-scrolls, pill works, peer avatar menu opens", async ({ page }) => {
    await mockBridge(page);
    await login(page);
    await spaGoto(page, "/private-chat?user=alice");
    await expect(page.getByTestId("pm-messages")).toBeVisible();
    await page.evaluate(() => document.fonts?.ready);

    for (let i = 1; i <= 30; i++) {
      await inject(page, { type: "chat:event", event: { type: "private-message", username: "alice", message: `pm number ${i}` } });
    }
    await expect.poll(() => scrollable(page, "pm-messages")).toBe(true);
    await expect.poll(() => isStuck(page, "pm-messages")).toBe(true);

    await page.evaluate(() => {
      document.querySelector('[data-testid="pm-messages"]')?.scrollTo({ top: 0 });
    });
    await expect(page.getByRole("button", { name: /Latest messages/ })).toBeVisible();
    await page.getByRole("button", { name: /Latest messages/ }).click();
    await expect.poll(() => isStuck(page, "pm-messages")).toBe(true);

    const avatar = page.getByTitle("alice — open user menu").last();
    await expect(avatar).toBeVisible();
    await avatar.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Browse Shares" })).toBeVisible();
  });
});
