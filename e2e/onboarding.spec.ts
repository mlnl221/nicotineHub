import { test, expect } from "@playwright/test";

// First-run onboarding wizard regression spec.
// Runs against BASE (worktree ports); repo default config targets :3000,
// so this spec uses absolute URLs and its own mocked bridge WS.
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

async function mockBridge(page, opts: { loggedIn?: boolean } = {}) {
  await page.addInitScript(({ loggedIn }: { loggedIn: boolean }) => {
    const OriginalWS = window.WebSocket;
    const sent: unknown[] = [];
    (window as any).__sent = sent;
    // Attached (server-side logged in) starts per opts; explicit login attaches.
    (window as any).__mockAttached = loggedIn;
    const isAttached = () => (window as any).__mockAttached === true;
    const statusMsg = () => ({ type: "session:status", loggedIn: isAttached(), username: isAttached() ? "tester" : undefined });
    class MockWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 1;
      url = "";
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: Event) => void) | null = null;
      _listeners: Record<string, ((e: Event) => void)[]> = {};
      // @ts-ignore
      constructor(url: string, protocols?: string | string[]) {
        if (url.includes("webpack-hmr") || url.includes("_next") || url.includes("turbopack")) {
          // @ts-ignore
          return new OriginalWS(url, protocols);
        }
        this.url = url;
        (window as any).__mockWS = this;
        queueMicrotask(() => {
          this.dispatchEvent(new Event("open"));
          setTimeout(() => {
            this.rx(statusMsg());
            this.rx({ type: "config:state", settings: {} });
          }, 50);
        });
      }
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
      rx(msg: unknown) {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
      }
      send(data: string) {
        const m = JSON.parse(data) as { type: string; section?: string; key?: string; name?: string };
        sent.push(m);
        setTimeout(() => {
          if (m.type === "session:status") this.rx(statusMsg());
          else if (m.type === "config:get") this.rx({ type: "config:state", settings: {} });
          else if (m.type === "config:update") this.rx({ type: "config:updated", section: m.section, key: m.key });
          else if (m.type === "login") {
            (window as any).__mockAttached = true;
            this.rx({ type: "login:result", ok: true, data: { success: true, banner: "hi" } });
            this.rx(statusMsg());
          }
          else if (m.type === "plugin:list")
            this.rx({
              type: "plugin:list",
              plugins: [{ name: "leech_detector", enabled: true, settings: { ban_leechers: true, ignore_leechers: true, enable_proveit: true, proveit_captcha_word: "download" } }],
            });
          else if (m.type === "plugin:toggle") this.rx({ type: "plugin:toggled", name: m.name, enabled: false });
          else if (m.type === "shares:rescan") this.rx({ type: "shares:rescanned", counts: { dirs: 2, files: 42 }, unavailable: [] });
          else if (m.type === "ping") this.rx({ type: "pong" });
        }, 20);
      }
      close() {}
    }
    // @ts-ignore
    window.WebSocket = MockWS;
  }, { loggedIn: opts.loggedIn ?? true });
}

async function freshPage(page) {
  await page.addInitScript(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
  });
}

test.describe("Onboarding wizard", () => {
  test("fresh login lands on wizard, full flow reaches search with flag set", async ({ page }) => {
    await freshPage(page);
    await mockBridge(page, { loggedIn: false });
    await page.goto(`${BASE}/`);
    await page.getByRole("textbox", { name: "Username" }).fill("tester");
    await page.getByRole("textbox", { name: "Password" }).fill("secret123");
    await page.getByRole("button", { name: /Log in/i }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10000 });
    await expect(page.getByText("Build your music library")).toBeVisible({ timeout: 5000 });

    // welcome -> shares
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByText("Share your music")).toBeVisible();

    // shares: add + continue (saves transfers, sends rescan)
    await page.getByPlaceholder("/data/Music").fill("/data/Music");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("/data/Music · public")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Keep leechers out")).toBeVisible({ timeout: 8000 });
    const sentTypes = await page.evaluate(() => ((window as any).__sent as { type: string }[]).map((s) => s.type));
    expect(sentTypes).toContain("shares:rescan");

    // leechers -> captcha
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Prove they're human")).toBeVisible({ timeout: 8000 });

    // captcha -> appearance
    await page.locator("#ob-captcha").fill("melody");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Set the mood")).toBeVisible({ timeout: 8000 });

    // appearance -> keys (dark persists)
    await page.getByRole("button", { name: /late-night digging/i }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Richer record cards")).toBeVisible({ timeout: 8000 });
    expect(await page.evaluate(() => localStorage.getItem("nicotineHub.theme"))).toBe("dark");

    // keys finish -> search + flag
    await page.locator("#ob-discogs_token").fill("dummy-token");
    await page.getByRole("button", { name: "Start searching" }).click();
    await expect(page).toHaveURL(/\/search/, { timeout: 10000 });
    expect(await page.evaluate(() => localStorage.getItem("nicotineHub.onboardingDone"))).toBe("1");
  });

  test("returning user skips wizard", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("nicotineHub.onboardingDone", "1");
        sessionStorage.clear();
      } catch {}
    });
    await mockBridge(page, { loggedIn: false });
    await page.goto(`${BASE}/`);
    await page.getByRole("textbox", { name: "Username" }).fill("tester");
    await page.getByRole("textbox", { name: "Password" }).fill("secret123");
    await page.getByRole("button", { name: /Log in/i }).click();
    await expect(page).toHaveURL(/\/search/, { timeout: 10000 });
  });

  test("skip honors ?next= and sets flag", async ({ page }) => {
    await freshPage(page);
    await mockBridge(page);
    await page.goto(`${BASE}/onboarding?next=%2Fdownloads`);
    await expect(page.getByText("Build your music library")).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: /Skip/ }).click();
    await expect(page).toHaveURL(/\/downloads/, { timeout: 8000 });
    expect(await page.evaluate(() => localStorage.getItem("nicotineHub.onboardingDone"))).toBe("1");
  });
});
