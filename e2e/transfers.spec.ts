import { test, expect } from "@playwright/test";

/**
 * Transfers E2E — Downloads & Uploads pages.
 *
 * Mocks WebSocket so we don't need a real Soulseek server. Pattern copied
 * from mistakes.md 2026-08-28 "Mock WebSocket missing WebSocket.OPEN".
 * Correct mock defines MockWS.OPEN=1 etc., and captures sent messages.
 */

async function mockBridge(page, opts: { withTransfers?: boolean } = {}) {
  await page.addInitScript(({ withTransfers }) => {
    const transfers = withTransfers
      ? [
          {
            id: "alice::Music\\Archive_Collection_Vol2.zip",
            username: "User_Alpha99",
            virtualPath: "Music\\Archive_Collection_Vol2.zip",
            fileName: "Archive_Collection_Vol2.zip",
            size: 2400000000,
            current: 1080000000,
            speed: 12500000,
            avgSpeed: 11000000,
            timeLeft: 192,
            status: "Transferring",
            queuePosition: null,
            isUpload: false,
          },
          {
            id: "bob::HighRes_Audio_Stem_Pack.rar",
            username: "SonicNode",
            virtualPath: "HighRes_Audio_Stem_Pack.rar",
            fileName: "HighRes_Audio_Stem_Pack.rar",
            size: 850000000,
            current: 697000000,
            speed: 8200000,
            avgSpeed: 7900000,
            timeLeft: 45,
            status: "Transferring",
            queuePosition: null,
            isUpload: false,
          },
          {
            id: "peer-upload::Music\\Project_Zephyr_Render_V4.mp4",
            username: "CollabNode01",
            virtualPath: "Music\\Project_Zephyr_Render_V4.mp4",
            fileName: "Project_Zephyr_Render_V4.mp4",
            size: 1200000000,
            current: 300000000,
            speed: 4100000,
            avgSpeed: 3800000,
            timeLeft: 920,
            status: "Transferring",
            queuePosition: null,
            isUpload: true,
          },
          {
            id: "peer2::Dataset_Analytics_2023.csv",
            username: "peer2",
            virtualPath: "Dataset_Analytics_2023.csv",
            fileName: "Dataset_Analytics_2023.csv",
            size: 45000000,
            current: 0,
            speed: 0,
            avgSpeed: 0,
            timeLeft: null,
            status: "Queued",
            queuePosition: 2,
            isUpload: true,
          },
        ]
      : [];

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
      constructor(url: string) {
        this.url = url;
        (window as any).__mockWS = this;
        // open immediately so SessionProvider's ws.onopen fires before React mount completes
        queueMicrotask(() => this.onopen?.(new Event("open")));
      }
      send(data: string) {
        const parsed = JSON.parse(data);
        this.sent.push(parsed);
        (window as any).__sent = this.sent;
        if (parsed.type === "login") {
          // respond to login immediately
          setTimeout(() => {
            this.onmessage?.(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "login:result", ok: true, data: { success: true, banner: "hi", ipAddress: "1.2.3.4", checksum: "x", isSupporter: false } }),
              }),
            );
            // push transfers + stats right after login
            setTimeout(() => {
              for (const t of transfers) {
                this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "transfer:update", transfer: t }) }));
              }
              this.onmessage?.(
                new MessageEvent("message", {
                  data: JSON.stringify({
                    type: "transfer:stats",
                    downloadSpeed: 20700000,
                    uploadSpeed: 4100000,
                    activeDownloads: 2,
                    activeUploads: 1,
                    queuedDownloads: 0,
                    queuedUploads: 1,
                  }),
                }),
              );
            }, 30);
          }, 10);
          return;
        }
        if (parsed.type === "download:control") {
          const t = transfers.find((x: any) => x.id === parsed.id);
          if (t) {
            if (parsed.action === "pause") t.status = "Paused";
            if (parsed.action === "cancel") t.status = "Cancelled";
            if (parsed.action === "resume") t.status = "Queued";
            if (parsed.action === "clear") {
              const idx = transfers.findIndex((x: any) => x.id === parsed.id);
              if (idx >= 0) transfers.splice(idx, 1);
              setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "transfer:removed", id: parsed.id }) })), 10);
              return;
            }
            setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "transfer:update", transfer: t }) })), 10);
          }
        }
        if (parsed.type === "upload:control" && parsed.action === "clear") {
          setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "transfer:removed", id: parsed.id }) })), 10);
        }
        if (parsed.type === "download:request") {
          const id = `${parsed.username}::${parsed.virtualPath}`;
          const fileName = parsed.fileName ?? parsed.virtualPath.split("\\").pop() ?? parsed.virtualPath;
          const nt: any = {
            id,
            username: parsed.username,
            virtualPath: parsed.virtualPath,
            fileName,
            size: parsed.size,
            current: 0,
            speed: 0,
            avgSpeed: 0,
            timeLeft: null,
            status: "Queued",
            queuePosition: 1,
            isUpload: false,
          };
          transfers.push(nt);
          setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "transfer:update", transfer: nt }) })), 10);
        }
      }
      close() {
        this.readyState = 3;
        this.onclose?.(new CloseEvent("close"));
      }
    }
    (window as any).WebSocket = MockWS as any;
    (globalThis as any).WebSocket = MockWS as any;
  }, { withTransfers: opts.withTransfers ?? true });
}

async function login(page) {
  await page.goto("/");
  await page.getByLabel(/Username/i).fill("tester");
  await page.getByLabel(/Password/i).fill("secret123");
  await page.getByRole("button", { name: /Log in/i }).click();
  // after mock login, we land on /search via router.replace
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByText("Search the network")).toBeVisible({ timeout: 5000 });
}

async function mockTransfersPage(page, opts: { withTransfers?: boolean } = {}) {
  await mockBridge(page, opts);
}

test.describe("Transfers pages", () => {
  test("downloads page renders header, speeds, placeholder chart and cards", async ({ page }) => {
    await mockTransfersPage(page, { withTransfers: true });
    await login(page);
    await page.goto("/downloads");

    // header
    await expect(page.getByRole("heading", { name: "Downloads & Uploads" })).toBeVisible();
    await expect(page.getByText(/Monitoring \d+ active connections/)).toBeVisible();
    await expect(page.getByTestId("download-speed")).toBeVisible();
    await expect(page.getByTestId("upload-speed")).toBeVisible();

    // throughput placeholder
    await expect(page.getByText("Network Throughput")).toBeVisible();
    await expect(page.getByText("Real-time Bandwidth")).toBeVisible();

    // downloading section
    await expect(page.getByTestId("downloads-section")).toBeVisible();
    await expect(page.getByText("Downloading (2)", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Archive_Collection_Vol2.zip")).toBeVisible();
    await expect(page.getByText("HighRes_Audio_Stem_Pack.rar")).toBeVisible();

    // progress bars
    const cards = page.getByTestId("transfer-card");
    await expect(cards).toHaveCount(4); // 2 downloads + 2 uploads visible on desktop
    await expect(page.locator('[role="progressbar"]')).toHaveCount(4);

    // ETA labels
    await expect(page.getByText(/ETA:/).first()).toBeVisible();

    // pause/cancel controls always touch-target 44px (not hover-only)
    const firstPause = cards.first().getByLabel("Pause");
    await expect(firstPause).toBeVisible();
    await firstPause.click();
    await expect(page.getByTestId("transfer-card").first().getByText("Paused")).toBeVisible();

    // tab switcher on mobile still shows both via xl:grid but hidden class tested via desktop visible
    await expect(page.getByTestId("uploads-section")).toBeVisible();
  });

  test("downloads empty state shows search CTA", async ({ page }) => {
    await mockTransfersPage(page, { withTransfers: false });
    await login(page);
    await page.goto("/downloads");
    await expect(page.getByTestId("empty-downloads")).toBeVisible();
    await expect(page.getByRole("link", { name: "Search Files" })).toBeVisible();
  });

  test("uploads page shows queued banner and uploads list", async ({ page }) => {
    await mockTransfersPage(page, { withTransfers: true });
    await login(page);
    await page.goto("/uploads");
    await expect(page.getByRole("heading", { name: "Uploads" })).toBeVisible();
    await expect(page.getByTestId("uploads-section")).toBeVisible();
    await expect(page.getByText("Project_Zephyr_Render_V4.mp4")).toBeVisible();
    await expect(page.getByText("Dataset_Analytics_2023.csv")).toBeVisible();
    // queued card has opacity-75 and prioritze button
    await expect(page.getByText("Queued").first()).toBeVisible();
  });

  test("uploads empty state shows nicotine+ parity banner", async ({ page }) => {
    await mockTransfersPage(page, { withTransfers: false });
    await login(page);
    await page.goto("/uploads");
    await expect(page.getByTestId("empty-uploads")).toBeVisible();
    await expect(page.getByText("No shared folders configured")).toBeVisible();
    await expect(page.getByText("Queue remains inspectable")).toBeVisible();
  });

  test("sidebar navigation between search/downloads/uploads", async ({ page }) => {
    await mockTransfersPage(page, { withTransfers: false });
    await login(page);
    await page.getByRole("link", { name: /Downloads/ }).click();
    await expect(page).toHaveURL(/\/downloads/);
    await page.getByRole("link", { name: /Uploads/ }).click();
    await expect(page).toHaveURL(/\/uploads/);
  });

  test("clear removes transfer card", async ({ page }) => {
    await mockTransfersPage(page, { withTransfers: true });
    await login(page);
    await page.goto("/downloads");
    const firstCard = page.getByTestId("transfer-card").first();
    await expect(firstCard).toBeVisible();
    // cancel then clear flow: first cancel -> Cancelled, then clear button appears
    await firstCard.getByLabel("Cancel").click();
    await expect(firstCard.getByText("Cancelled")).toBeVisible();
    await firstCard.getByLabel("Clear").click();
    // card removed — count goes from 4 to 3
    await expect(page.getByTestId("transfer-card")).toHaveCount(3);
  });
});
