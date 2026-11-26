import { expect, test, type Page } from "@playwright/test";
import { createItem, createTrip, scheduleItemAsAdmin, setDayStatusAsAdmin, setTripFieldsAsAdmin, signInAsNewUser } from "./support/auth";

// T40：旅後狀態標記與 MEM-04 比較報告。需本機 Supabase 與 apps/web/.env.local。
// 以 T39 的畫面記錄並產生最後一日的 Actual Timeline，行程進入已結束後標記旅後狀態。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T40-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

const DATE = "2026-11-20";
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("行程結束後標記旅後狀態並查看比較報告；全部標記後行程封存", async ({ page, context, baseURL }) => {
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

  await page.goto(`/trips/${tripId}/timeline?date=${DATE}`);
  const templeForm = page.getByRole("form", { name: "記錄 淺草寺" });
  await templeForm.getByLabel("到達").fill("09:15");
  await templeForm.getByLabel("離開").fill("10:40");
  await templeForm.getByRole("button", { name: "記錄" }).click();
  await expect(page.locator(".timeline-row").filter({ hasText: "淺草寺" })).toContainText("09:15–10:40");
  const towerForm = page.getByRole("form", { name: "記錄 晴空塔" });
  await towerForm.getByLabel("到達").fill("11:40");
  await towerForm.getByLabel("離開").fill("12:10");
  await towerForm.getByLabel("狀態").selectOption("partial");
  await towerForm.getByRole("button", { name: "記錄" }).click();
  await expect(page.locator(".timeline-row").filter({ hasText: "晴空塔" })).toContainText("部分完成");
  await page.getByRole("button", { name: "結束今天，產生 Actual Timeline" }).click();
  await page.getByRole("link", { name: "旅後回顧" }).click();

  await expect(page.getByRole("heading", { name: "旅後回顧", level: 1 })).toBeVisible();
  await expect(page.locator(".trip-line")).toContainText("已結束");
  const report = page.getByRole("region", { name: "比較報告" });
  for (const heading of ["停留時間差異", "交通估算差異", "實際用上的 Backup", "過密時段", "證實不可靠的建議", "最喜歡的活動類型"]) {
    await expect(report.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(report).toContainText("排定 90 分鐘，實際 85 分鐘，少 5 分鐘");
  await expect(report).toContainText(`${DATE} 11:00–12:30`);
  await expect(report).toContainText("晚到 40 分鐘、部分完成");

  // 實際去過才可標為完成或不推薦；沒有去過不可
  const towerStatus = page.getByRole("form", { name: "旅後狀態 晴空塔" }).getByLabel("旅後狀態");
  await expect(towerStatus.locator("option")).toHaveText(["略過", "取消", "想再去"]);
  const templeStatus = page.getByRole("form", { name: "旅後狀態 淺草寺" }).getByLabel("旅後狀態");
  await expect(templeStatus.locator("option")).toHaveText(["完成", "想再去", "不推薦"]);
  expect(await noHorizontalScroll(page)).toBe(true);
  await capture(page, "ended");

  await templeStatus.selectOption("revisit");
  await page.getByRole("form", { name: "旅後狀態 淺草寺" }).getByRole("button", { name: "儲存" }).click();
  await expect(page.locator(".post-trip-items > li").filter({ hasText: "淺草寺" }).locator(".post-trip-current")).toHaveText("想再去");
  await towerStatus.selectOption("skipped");
  await page.getByRole("form", { name: "旅後狀態 晴空塔" }).getByRole("button", { name: "儲存" }).click();
  await expect(page.locator(".post-trip-items > li").filter({ hasText: "晴空塔" }).locator(".post-trip-current")).toHaveText("略過");
  const parkStatus = page.getByRole("form", { name: "旅後狀態 上野公園" }).getByLabel("旅後狀態");
  await parkStatus.selectOption("cancelled");
  await page.getByRole("form", { name: "旅後狀態 上野公園" }).getByRole("button", { name: "儲存" }).click();

  await expect(page.locator(".trip-line")).toContainText("已封存");
  await expect(page.getByText("所有項目都已標記，行程已封存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "儲存" })).toHaveCount(0);
  await expect(report).toContainText("景點");
  await expect(report).toContainText("2 分，1 個項目");
  expect(await noHorizontalScroll(page)).toBe(true);
  await capture(page, "archived");
});
