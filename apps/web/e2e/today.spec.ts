import { expect, test, type Page } from "@playwright/test";
import { createItem, createTrip, scheduleItemAsAdmin, signInAsNewUser } from "./support/auth";

// T35：PWA 與離線當日包（D11、SH-05）。需本機 Supabase 與 apps/web/.env.local（production build，service worker 才會啟用）。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T35-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

test("離線時從 IndexedDB 閱讀當日行程與最遲離開時間；離線修改排入佇列，恢復網路後同步為提案", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  const senso = await createItem(tripId, { name_zh: "淺草寺", name_local: "浅草寺", address: "台東區淺草 2-3-1" });
  const kami = await createItem(tripId, { name_zh: "雷門" });
  await scheduleItemAsAdmin(tripId, senso, "2026-12-10", "09:00", "10:00");
  await scheduleItemAsAdmin(tripId, kami, "2026-12-10", "11:00", "12:00");

  // 線上開啟「現在」：存入 IndexedDB、service worker 快取離線頁面
  await page.goto(`/trips/${tripId}/today`);
  await expect(page.getByRole("list", { name: "今天" })).toContainText("09:00淺草寺");
  await expect(page.getByRole("list", { name: "今天" })).toContainText("11:00雷門");
  await expect(page.locator("[data-offline-ready]")).toHaveAttribute("data-offline-ready", "yes");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await capture(page, "online");

  // 離線：重新開啟同一頁
  await context.setOffline(true);
  await page.goto(`/trips/${tripId}/today`);
  await expect(page.getByText(/^離線模式：顯示 .* 儲存的當日包$/)).toBeVisible();
  const first = page.getByRole("listitem", { name: "淺草寺" });
  await expect(first).toContainText("09:00–10:00");
  await expect(first).toContainText("浅草寺");
  await expect(first).toContainText("最遲 10:30 離開前往雷門");
  await expect(page.getByRole("listitem", { name: "雷門" })).toContainText("最後一站");
  await expect(page.getByRole("region", { name: "Backup" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "offline");

  // 離線修改：排入佇列
  await first.getByRole("button", { name: "調整時間" }).click();
  await first.getByLabel("新的開始時間").fill("09:30");
  await first.getByRole("button", { name: "送出修改" }).click();
  await expect(page.getByRole("status")).toHaveText("已排入佇列，恢復網路後送出為提案");
  await expect(page.getByText("佇列中有 1 項修改尚未送出")).toBeVisible();

  // 恢復網路：自動同步為待批准提案（SH-05）
  await context.setOffline(false);
  await expect(page.getByRole("status")).toHaveText("已同步 1 項修改為提案，等成員批准後才會套用");
  await expect(page.getByText("佇列中有 1 項修改尚未送出")).toHaveCount(0);
  await page.goto(`/trips/${tripId}/proposals`);
  const proposal = page.getByRole("listitem", { name: "離線修改：淺草寺改為 09:30–10:30" });
  await expect(proposal).toContainText("待批准");
});

test("PWA manifest 以獨立 App 模式開啟", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { display: string; start_url: string; icons: Array<{ sizes: string }> };
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  expect(manifest.icons.map((i) => i.sizes)).toContain("512x512");
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
});

test("沒有離線當日包時說明需先在有網路時開啟", async ({ page, context }) => {
  await context.setOffline(false);
  await page.goto("/offline-today");
  await expect(page.getByText("這台裝置沒有這個行程的離線當日包。請在有網路時開啟一次當日行程。")).toBeVisible();
});
