import { expect, test, type Page } from "@playwright/test";
import {
  createItem,
  createTrip,
  createUserAsAdmin,
  insertOwnMemory,
  scheduleItemAsAdmin,
  setDayStatusAsAdmin,
  setTripFieldsAsAdmin,
  signInAsNewUser,
} from "./support/auth";

// T41：第 5 節記憶。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T41-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

const DATE = "2026-11-20";
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("手動記憶、共同行程合併取最保守值且不顯示來源成員、刪除後不再使用；旅後提案經本人批准才寫入", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const companion = await createUserAsAdmin();
  const tripId = await createTrip(owner.userId, "東京一日", [{ userId: companion.userId, role: "companion" }]);
  await insertOwnMemory(companion, { layer: "personal", kind: "constraint", item: "每日步行上限", value: "8", unit: "公里" });

  // 手動新增（MEM-03）；身分與聯絡資料不寫入（MEM-07）
  await page.goto("/settings/memories");
  const add = page.getByRole("form", { name: "新增記憶" });
  await add.getByLabel("項目").fill("每日步行上限");
  await add.getByLabel("內容").fill("12");
  await add.getByRole("button", { name: "新增" }).click();
  await expect(add.getByRole("status")).toHaveText("已儲存");
  const personal = page.getByRole("region", { name: "個人偏好" });
  await expect(personal.getByRole("form", { name: "修改 每日步行上限" }).getByLabel("單位")).toHaveValue("公里");
  await add.getByLabel("類型").selectOption("preference");
  await add.getByLabel("項目").fill("聯絡方式");
  await add.getByLabel("內容").fill("me@example.com");
  await add.getByRole("button", { name: "新增" }).click();
  await expect(add.getByRole("status")).toHaveText("身分與聯絡資料不寫入記憶");
  expect(await noHorizontalScroll(page)).toBe(true);

  // 共同行程合併（MEM-07、MEM-08）
  await page.goto(`/trips/${tripId}/memories`);
  const limits = page.getByRole("region", { name: "合併後的限制" });
  await expect(limits).toContainText("每日步行上限");
  await expect(limits).toContainText("8 公里");
  await expect(limits).not.toContainText("12 公里");
  await expect(limits.locator(".memory-conflict")).toHaveText("成員間有不同設定，已取最保守值");
  await expect(page.locator("main")).not.toContainText(companion.email);
  expect(await noHorizontalScroll(page)).toBe(true);
  await capture(page, "trip");

  // 刪除後不再使用（MEM-06）
  await page.goto("/settings/memories");
  await page.getByRole("form", { name: "刪除 每日步行上限" }).getByRole("button", { name: "刪除" }).click();
  await expect(page.getByRole("region", { name: "個人偏好" })).toContainText("沒有記憶。");
  await page.goto(`/trips/${tripId}/memories`);
  await expect(page.getByRole("region", { name: "合併後的限制" }).locator(".memory-conflict")).toHaveCount(0);

  // 旅後提案（MEM-03、MEM-04）：產生後在「記憶」由本人批准才寫入
  const temple = await createItem(tripId, { name_zh: "淺草寺" });
  await scheduleItemAsAdmin(tripId, temple, DATE, "09:00", "10:30");
  await setTripFieldsAsAdmin(tripId, { start_date: DATE, end_date: DATE, status: "in_progress" });
  await setDayStatusAsAdmin(tripId, DATE, "day_ready");
  await page.goto(`/trips/${tripId}/timeline?date=${DATE}`);
  const record = page.getByRole("form", { name: "記錄 淺草寺" });
  await record.getByLabel("到達").fill("09:00");
  await record.getByLabel("離開").fill("11:00");
  await record.getByRole("button", { name: "記錄" }).click();
  await expect(page.locator(".timeline-row").filter({ hasText: "淺草寺" })).toContainText("09:00–11:00");
  await page.getByRole("button", { name: "結束今天，產生 Actual Timeline" }).click();
  await page.getByRole("link", { name: "旅後回顧" }).click();
  await page.getByRole("button", { name: "產生旅後記憶提案" }).click();
  await expect(page.getByRole("status").filter({ hasText: "旅後記憶提案" })).toContainText("已建立 1 個旅後記憶提案");

  await page.goto("/settings/memories");
  const proposals = page.getByRole("region", { name: "旅後記憶提案" });
  await expect(proposals).toContainText("停留時間調整");
  await expect(proposals).toContainText("30 分鐘");
  await expect(page.getByRole("region", { name: "Planning Rules" })).toContainText("沒有記憶。");
  await capture(page, "proposals");
  await proposals.getByRole("button", { name: "批准" }).click();
  const rules = page.getByRole("region", { name: "Planning Rules" });
  await expect(rules).toContainText("停留時間調整");
  await expect(rules).toContainText("旅後提案");
  await expect(page.getByRole("region", { name: "旅後記憶提案" })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});
