import { expect, test, type Page } from "@playwright/test";
import {
  confirmTripAsAdmin,
  createItem,
  createTrip,
  lockItemAsAdmin,
  markBaselineConfirmedAsAdmin,
  saveBaselineAsAdmin,
  signInAsNewUser,
  simulateReverifyAsAdmin,
} from "./support/auth";

// T31：旅前自動再核實。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T31-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

const baseline = {
  start_date: "2026-12-10",
  end_date: "2026-12-10",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: [],
  photography_needs: null,
};

test("Owner 開啟排程後，問題項目標示 At Risk，開啟 App 時顯示未讀通知", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京一日");
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  await confirmTripAsAdmin(tripId);
  const itemId = await createItem(tripId, { name_zh: "純喫茶" });
  await lockItemAsAdmin(tripId, itemId, "2026-12-10");

  // 未開啟排程時不建立 job
  expect(await simulateReverifyAsAdmin(tripId, itemId)).toBe(false);

  await page.goto(`/trips/${tripId}/days`);
  const section = page.getByRole("region", { name: "旅前自動再核實" });
  await expect(section.getByRole("heading")).toHaveText("旅前自動再核實：未開啟");
  await section.getByRole("button", { name: "開啟旅前自動再核實" }).click();
  await expect(section.getByRole("status")).toHaveText("已開啟旅前自動再核實");
  await expect(section.getByRole("heading")).toHaveText("旅前自動再核實：已開啟");
  await capture(page, "toggle");

  expect(await simulateReverifyAsAdmin(tripId, itemId)).toBe(true);

  await page.goto("/");
  const unread = page.getByRole("region", { name: "未讀通知" });
  await expect(unread.getByRole("listitem")).toHaveCount(1);
  await expect(unread.getByRole("listitem")).toContainText("東京一日");
  await expect(unread.getByRole("listitem")).toContainText("行程已更新");
  const risk = page.getByRole("region", { name: "At Risk 項目" });
  await expect(risk.getByRole("listitem")).toContainText("純喫茶");
  await expect(risk.getByRole("listitem")).toContainText("2026-12-10");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "inbox");

  await unread.getByRole("button", { name: "全部標為已讀" }).click();
  await expect(unread.getByText("沒有未讀通知。")).toBeVisible();
  // At Risk 項目在處理前持續顯示
  await expect(risk.getByRole("listitem")).toContainText("純喫茶");

  // 關閉後不再執行
  await page.goto(`/trips/${tripId}/days`);
  await page.getByRole("button", { name: "關閉旅前自動再核實" }).click();
  await expect(page.getByRole("region", { name: "旅前自動再核實" }).getByRole("heading")).toHaveText("旅前自動再核實：未開啟");
});

test("Companion 看不到排程開關", async ({ page, context, browser, baseURL }) => {
  const companion = await signInAsNewUser(context, baseURL ?? "");
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  await ownerContext.close();
  const tripId = await createTrip(owner.userId, "大阪一日", [{ userId: companion.userId, role: "companion" }]);
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  await confirmTripAsAdmin(tripId);
  await page.goto(`/trips/${tripId}/days`);
  await expect(page.getByRole("heading", { name: "每日時段草案", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "旅前自動再核實" })).toHaveCount(0);
});

test("排程端點沒有 CRON_SECRET 時拒絕", async ({ request }) => {
  const response = await request.get("/api/cron/reverify");
  expect(response.status()).toBe(401);
  const wrong = await request.get("/api/cron/reverify", { headers: { authorization: "Bearer wrong-secret-value-123456" } });
  expect(wrong.status()).toBe(401);
});
