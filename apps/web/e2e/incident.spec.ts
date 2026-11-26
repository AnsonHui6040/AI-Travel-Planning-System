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

// T38：Incident Mode（第 2.6、2.9 節）。需本機 Supabase 與 apps/web/.env.local。
// 旅行日在未來，伺服器以當天 00:00 計算；三方案的完整判定在 evals/incident/ 驗證。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T38-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
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

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("大雨：產生替代方案與比較表，批准前不寫入；批准一個後其他失效、行程更新", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京一日");
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  const photo = await createItem(tripId, { name_zh: "隅田川攝影" });
  const museum = await createItem(tripId, { name_zh: "室內博物館" });
  await setItemFieldsAsAdmin(photo, { type: "photography", weather_dependency: "high", suggested_stay_minutes: 120 });
  await scheduleItemAsAdmin(tripId, photo, "2026-12-10", "13:00", "15:00");
  await setItemFieldsAsAdmin(museum, { verification_status: "verified", lifecycle_status: "verified", suggested_stay_minutes: 90 });
  await setDayStatusAsAdmin(tripId, "2026-12-10", "approved");

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.71477, longitude: 139.79666 });
  await page.goto(`/trips/${tripId}/today?date=2026-12-10`);
  await page.getByRole("link", { name: "Incident Mode" }).click();
  await expect(page.getByRole("heading", { name: "Incident Mode" })).toBeVisible();
  await page.getByLabel("發生什麼事").selectOption("heavy_rain");
  await page.getByLabel("預計雨停（可留空）").fill("18:00");
  await page.getByLabel("同行者").selectOption("tired");
  await page.getByRole("button", { name: "取得目前位置" }).click();
  await expect(page.getByText("目前位置：35.715, 139.797")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await capture(page, "entry");
  await page.getByRole("button", { name: "產生替代方案" }).click();

  await expect(page).toHaveURL(/\/incident\/[0-9a-f-]{36}$/);
  await expect(page.getByText("L3")).toBeVisible();
  const snapshot = page.getByRole("region", { name: "Current State Snapshot" });
  await expect(snapshot).toContainText("35.715, 139.797");
  await expect(snapshot).toContainText("疲累");
  await expect(snapshot).toContainText("19:00 晚餐（已付款）");
  await expect(snapshot).toContainText("18:45");
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText([/項目/, /使用另一日候選.*待批准/, /刪減活動.*待批准/]);
  for (const field of ["新活動", "到達時間", "成本", "步行", "轉乘", "行李適合度", "天氣風險", "影響晚餐", "對明日影響", "體驗損失", "推薦度"]) {
    await expect(table.getByRole("rowheader", { name: field })).toBeVisible();
  }
  await expect(table.getByRole("row", { name: /新活動/ })).toContainText("室內博物館");
  const option = page.getByRole("listitem", { name: "使用另一日候選" });
  await expect(option).toContainText("最快");
  await expect(option).toContainText("最便宜");
  await expect(option).toContainText("最舒適");
  expect(await noHorizontalScroll(page)).toBe(true);
  await capture(page, "compare");
  const incidentUrl = page.url();

  // 批准前行程不變
  await page.goto(`/trips/${tripId}/today?date=2026-12-10`);
  await expect(page.getByRole("listitem", { name: "隅田川攝影" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "室內博物館" })).toHaveCount(0);

  await page.goto(incidentUrl);
  await page.getByRole("listitem", { name: "使用另一日候選" }).getByRole("button", { name: "批准" }).click();
  await expect(page.getByRole("listitem", { name: "使用另一日候選" }).getByRole("status")).toContainText("已套用，Change Log 版本");
  await page.reload();
  await expect(table.getByRole("columnheader")).toHaveText([/項目/, /使用另一日候選.*已套用/, /刪減活動.*已失效/]);
  await expect(page.getByText("其他方案已失效")).toBeVisible();

  await page.goto(`/trips/${tripId}/today?date=2026-12-10`);
  await expect(page.getByRole("listitem", { name: "室內博物館" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "隅田川攝影" })).toHaveCount(0);
});

test("Viewer 看得到 Incident Mode 頁，但不能進入", async ({ page, context, browser, baseURL }) => {
  const viewer = await signInAsNewUser(context, baseURL ?? "");
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  await ownerContext.close();
  const tripId = await createTrip(owner.userId, "大阪一日", [{ userId: viewer.userId, role: "viewer" }]);
  await saveBaselineAsAdmin(tripId, baseline);
  const item = await createItem(tripId, { name_zh: "大阪城" });
  await scheduleItemAsAdmin(tripId, item, "2026-12-10", "10:00", "11:00");
  await page.goto(`/trips/${tripId}/incident?date=2026-12-10`);
  await expect(page.getByText("只有 Owner 與 Companion 可以進入 Incident Mode。")).toBeVisible();
  await expect(page.getByRole("button", { name: "產生替代方案" })).toHaveCount(0);
});
