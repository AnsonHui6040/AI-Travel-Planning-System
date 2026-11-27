import { expect, test, type Page } from "@playwright/test";
import {
  createItem,
  createTrip,
  markBaselineConfirmedAsAdmin,
  saveBaselineAsAdmin,
  scheduleItemAsAdmin,
  setDayStatusAsAdmin,
  setItemFieldsAsAdmin,
  signInAsNewUser,
} from "./support/auth";

// T36：Morning Check（第 2.8 節 Day Ready）。需本機 Supabase 與 apps/web/.env.local。
// 項目沒有座標，所以不呼叫外部天氣 API（天氣為「無資料」）；E1 的降雨判定以錄製的預報在 evals/morning/E1.json 驗證。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T36-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

const baseline = {
  start_date: "2026-12-10",
  end_date: "2026-12-10",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [],
  companions: 2,
  stamina_note: null,
  budget: null,
  fixed_activities: [{ name: "晚餐（已付款）", area: "新宿", date: "2026-12-10", start: "19:00", end: "21:00", paid: true }],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: [],
  photography_needs: null,
};

test("Owner 執行 Morning Check：休館的項目標示 At Risk，該日進入 Day Ready，當日包更新", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京一日");
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  const museum = await createItem(tripId, { name_zh: "江戶東京博物館" });
  const cafe = await createItem(tripId, { name_zh: "週四公休的咖啡店" });
  // 2026-12-10 是星期四；咖啡店只在星期五營業
  await setItemFieldsAsAdmin(cafe, { availability: [{ weekday: 5, start: "09:00", end: "18:00" }], zone_id: null });
  await scheduleItemAsAdmin(tripId, museum, "2026-12-10", "10:00", "11:30");
  await scheduleItemAsAdmin(tripId, cafe, "2026-12-10", "13:00", "14:00");
  await setDayStatusAsAdmin(tripId, "2026-12-10", "approved");

  // 「現在」的一行摘要開啟完整的 Morning Check
  await page.goto(`/trips/${tripId}/today`);
  await page.getByRole("link", { name: "Morning Check 尚未執行" }).click();
  await expect(page.getByRole("heading", { name: "Morning Check", level: 1 })).toBeVisible();
  await expect(page.locator(".screen-head")).toContainText("已批准");
  const section = page.getByRole("region", { name: "Morning Check" });
  await expect(section).toContainText("今天還沒有執行 Morning Check");
  await page.getByRole("button", { name: "執行 Morning Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Morning Check 完成，已標示 Day Ready。1 個項目標示 At Risk，0 個候選提升為 Standby");

  await expect(page.locator(".screen-head")).toContainText("Day Ready");
  const rows = section.getByRole("listitem");
  await expect(rows).toHaveCount(10);
  await expect(rows.filter({ hasText: "天氣" })).toContainText("無資料");
  await expect(rows.filter({ hasText: "營業" })).toContainText("當天休館或不在營業時間內：週四公休的咖啡店");
  await expect(rows.filter({ hasText: "固定活動" })).toContainText("19:00 晚餐（已付款）");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "check");

  // 回到「現在」：摘要與今天的時間軸更新
  await page.getByRole("link", { name: "返回現在" }).click();
  await expect(page.getByRole("link", { name: /^Morning Check/ })).toHaveText(/^Morning Check \d+ 正常 \d+ 留意 \d+ 無資料$/);
  const today = page.getByRole("list", { name: "今天" });
  await expect(today.getByRole("listitem").filter({ hasText: "週四公休的咖啡店" })).toContainText("At Risk");
  await expect(today.getByRole("listitem").filter({ hasText: "江戶東京博物館" })).not.toContainText("At Risk");
  // 當日包以 Day Ready 後的資料重新儲存
  await expect(page.locator("[data-offline-ready]")).toHaveAttribute("data-offline-ready", "yes");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "done");

  // Change Log 記錄 At Risk 的提出者
  await page.goto(`/trips/${tripId}/proposals`);
  await expect(page.getByRole("listitem", { name: "Morning Check：1 個項目標示為 At Risk" })).toContainText("已套用");
});

test("Viewer 看得到 Morning Check 區塊，但不能執行", async ({ page, context, browser, baseURL }) => {
  const viewer = await signInAsNewUser(context, baseURL ?? "");
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  await ownerContext.close();
  const tripId = await createTrip(owner.userId, "大阪一日", [{ userId: viewer.userId, role: "viewer" }]);
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  const item = await createItem(tripId, { name_zh: "大阪城" });
  await scheduleItemAsAdmin(tripId, item, "2026-12-10", "10:00", "11:00");
  await setDayStatusAsAdmin(tripId, "2026-12-10", "approved");
  await page.goto(`/trips/${tripId}/today/check`);
  await expect(page.getByRole("region", { name: "Morning Check" })).toBeVisible();
  await expect(page.getByRole("button", { name: "執行 Morning Check" })).toHaveCount(0);
});
