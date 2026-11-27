import { expect, test, type Page } from "@playwright/test";
import { createItem, createTrip, scheduleItemAsAdmin, setDayStatusAsAdmin, setTripFieldsAsAdmin, signInAsNewUser } from "./support/auth";

// T39：Actual Timeline（第 2.8、2.9 節）。需本機 Supabase 與 apps/web/.env.local。
// 旅行日在過去（實際時間不可晚於現在）。CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T39-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

const DATE = "2026-11-20";
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("記錄實際時間與完成狀態，產生 Planned vs Actual：未完成的景點不會標為已去過", async ({ page, context, baseURL }) => {
  // 不可逆操作先確認（Astryx）：記錄確認訊息並接受
  const confirms: string[] = [];
  page.on("dialog", (d) => {
    confirms.push(d.message());
    void d.accept();
  });
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京一日");
  const temple = await createItem(tripId, { name_zh: "淺草寺" });
  const tower = await createItem(tripId, { name_zh: "晴空塔" });
  const park = await createItem(tripId, { name_zh: "上野公園" });
  await scheduleItemAsAdmin(tripId, temple, DATE, "09:00", "10:30");
  await scheduleItemAsAdmin(tripId, tower, DATE, "11:00", "12:30");
  await scheduleItemAsAdmin(tripId, park, DATE, "14:00", "15:30");
  await setTripFieldsAsAdmin(tripId, { start_date: DATE, end_date: DATE, status: "in_progress" });
  await setDayStatusAsAdmin(tripId, DATE, "day_ready");

  // Actual Timeline 在「更多」
  await page.goto(`/trips/${tripId}/more`);
  await page.getByRole("link", { name: /Actual Timeline/ }).click();
  await expect(page.getByRole("heading", { name: "Actual Timeline" })).toBeVisible();
  await expect(page.getByText("尚未產生")).toBeVisible();

  const templeForm = page.getByRole("form", { name: "記錄 淺草寺" });
  await templeForm.getByLabel("到達").fill("09:15");
  await templeForm.getByLabel("離開").fill("10:40");
  await templeForm.getByRole("button", { name: "記錄" }).click();
  await expect(page.locator(".timeline-row").filter({ hasText: "淺草寺" })).toContainText("09:15–10:40");

  const towerForm = page.getByRole("form", { name: "記錄 晴空塔" });
  await towerForm.getByLabel("到達").fill("11:30");
  await towerForm.getByLabel("狀態").selectOption("partial");
  await towerForm.getByRole("button", { name: "記錄" }).click();
  await expect(page.locator(".timeline-row").filter({ hasText: "晴空塔" })).toContainText("部分完成");

  const preview = page.getByRole("region", { name: "Planned vs Actual" });
  await expect(preview).toContainText("排定 3 項，完成 1 項，部分完成 1 項，略過 0 項，沒有紀錄 1 項");
  await expect(page.locator(".timeline-row").filter({ hasText: "淺草寺" })).toContainText("晚 15 分鐘");
  // 產生前只是預覽，不標示已去過
  await expect(page.locator(".timeline-visited")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await capture(page, "preview");

  await page.getByRole("button", { name: "結束今天，產生 Actual Timeline" }).click();
  await expect(page.getByText("已產生，內容不再變動。")).toBeVisible();
  expect(confirms).toEqual(["結束今天並產生 Actual Timeline？產生後這天不能再記錄。"]);

  const rows = page.locator(".timeline-row");
  await expect(rows.filter({ hasText: "淺草寺" })).toContainText("已去過");
  await expect(rows.filter({ hasText: "晴空塔" })).not.toContainText("已去過");
  await expect(rows.filter({ hasText: "上野公園" })).toContainText("沒有紀錄");
  await expect(rows.filter({ hasText: "上野公園" })).not.toContainText("已去過");
  await expect(page.getByRole("button", { name: "記錄" })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await capture(page, "produced");
});
