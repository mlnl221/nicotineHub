import { test, expect } from "@playwright/test";

/**
 * ContextMenu keyboard E2E — search result right-click menu.
 *
 * Mocks WebSocket so we don't need a real Soulseek server. Pattern copied
 * from transfers.spec.ts (MockWS with OPEN=1 etc.). Search rows are seeded
 * via sessionStorage (SearchProvider loads nicotineHub.searchTabs on mount),
 * so no search:result protocol is needed.
 */

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
        if (url.includes("webpack-hmr") || url.includes("_next")) {
          const real = new (OriginalWS as any)(url, protocols as any);
          return real as any;
        }
        this.url = url;
        (window as any).__mockWS = this;
        queueMicrotask(() => {
          this.dispatchEvent(new Event("open"));
        });
      }
      send(data: string) {
        const parsed = JSON.parse(data);
        this.sent.push(parsed);
        (window as any).__sent = this.sent;
        if (parsed.type === "login") {
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
  await page.goto("/");
  await page.getByRole("textbox", { name: "Username" }).fill("tester");
  await page.getByRole("textbox", { name: "Password" }).fill("secret123");
  await page.getByRole("button", { name: /Log in/i }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole("heading", { name: "Search" }).first()).toBeVisible({ timeout: 10000 });
}

async function seedSearchAndOpen(page) {
  await page.evaluate(() => {
    const rows = [
      {
        user: "seeduser",
        folder: "C:\\Music\\Seed",
        filename: "seed-track-one.mp3",
        path: "C:\\Music\\Seed\\seed-track-one.mp3",
        size: 8_000_000,
        fileType: "mp3",
        slotFree: true,
        speed: 500_000,
        inQueue: 0,
        quality: 320,
        length: 210,
        private: false,
        attributes: { bitrate: 320, length: 210, vbr: 0 },
      },
      {
        user: "seeduser",
        folder: "C:\\Music\\Seed",
        filename: "seed-track-two.flac",
        path: "C:\\Music\\Seed\\seed-track-two.flac",
        size: 28_000_000,
        fileType: "flac",
        slotFree: false,
        speed: 200_000,
        inQueue: 3,
        quality: 0,
        length: 260,
        private: false,
        attributes: { length: 260, sampleRate: 44100, bitDepth: 16 },
      },
    ];
    const filters = { include: "", exclude: "", fileType: "", size: "", bitrate: "", length: "", country: "", quality: "", freeSlot: false, publicOnly: true };
    const tabs = [{ id: "s1", query: "seed query", mode: "global", status: "ended", reason: "max_results", rows, total: rows.length, filters }];
    try { sessionStorage.setItem("nicotineHub.searchTabs", JSON.stringify({ tabs, activeId: "s1" })); } catch {}
  });
  await page.goto("/search");
}

test.describe("ContextMenu keyboard", () => {
  test("Shift+F10 opens menu, ArrowDown moves focus, Esc closes and refocuses row", async ({ page }) => {
    await mockBridge(page);
    await login(page);
    await seedSearchAndOpen(page);

    const row = page.locator("[data-row-user]").first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.focus();
    await expect(row).toBeFocused();

    await page.keyboard.press("Shift+F10");
    const menu = page.locator('[role="menu"]').first();
    await expect(menu).toBeVisible({ timeout: 5000 });

    const items = page.locator('[role="menuitem"]:not([disabled])');
    await expect(items.first()).toBeFocused({ timeout: 5000 });
    const firstLabel = await items.first().innerText();

    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused({ timeout: 5000 });
    const secondLabel = await items.nth(1).innerText();
    expect(secondLabel).not.toBe(firstLabel);

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0, { timeout: 5000 });
    await expect(row).toBeFocused({ timeout: 5000 });
  });

  test("right-click opens menu, Esc closes and refocuses row", async ({ page }) => {
    await mockBridge(page);
    await login(page);
    await seedSearchAndOpen(page);

    const row = page.locator("[data-row-user]").first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.focus();
    await row.click({ button: "right" });

    const menu = page.locator('[role="menu"]').first();
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[role="menuitem"]:not([disabled])').first()).toBeFocused({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0, { timeout: 5000 });
    await expect(row).toBeFocused({ timeout: 5000 });
  });
});
