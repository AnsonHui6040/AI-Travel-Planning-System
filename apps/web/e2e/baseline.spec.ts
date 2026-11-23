import { expect, test, type Page } from "@playwright/test";
import { createTrip, saveBaselineAsAdmin, signInAsNewUser } from "./support/auth";

// T23：旅行基線（第 9.3 節 E5）。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string, width: number) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T23-${name}-${width}.png`, fullPage: true });
}

test("E5：入住 15:00 與另一區已付款活動 15:30 標示矛盾，不可確認；修正後確認 Trip Baseline v1", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  await page.goto(`/trips/${tripId}/baseline`);
  await expect(page.getByRole("heading", { name: "旅行基線" })).toBeVisible();
  await expect(page.getByText("東京五日：基線")).toBeVisible();

  await page.getByLabel("開始日期").fill("2026-12-01");
  await page.getByLabel("結束日期").fill("2026-12-05");

  await page.getByRole("button", { name: "新增住宿" }).click();
  const lodging = page.getByRole("group", { name: "住宿 1" });
  await lodging.getByLabel("名稱").fill("新宿飯店");
  await lodging.getByLabel("地區").fill("新宿");
  await lodging.getByLabel("入住時間（選填）").fill("15:00");

  await page.getByRole("button", { name: "新增固定活動" }).click();
  const activity = page.getByRole("group", { name: "固定活動 1" });
  await activity.getByLabel("名稱").fill("淺草和服體驗");
  await activity.getByLabel("地區").fill("淺草");
  await activity.getByLabel("開始時間").fill("15:30");
  await activity.getByLabel("已付款").check();

  // 輸入時即時標示矛盾
  const conflicts = page.getByRole("list", { name: "矛盾" });
  await expect(conflicts).toContainText("不同地區之間只有 30 分鐘");
  await expect(page.getByRole("list", { name: "Hard Constraint" })).toContainText("已付款固定活動：淺草和服體驗（2026-12-01 15:30）");

  await page.getByRole("button", { name: "儲存草稿" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存基線草稿，有 1 個矛盾需要處理");
  // 儲存後輸入內容維持不變（包括核取方塊）
  await expect(activity.getByLabel("已付款")).toBeChecked();
  await expect(activity.getByLabel("名稱")).toHaveValue("淺草和服體驗");
  const confirm = page.getByRole("button", { name: "確認 Trip Baseline v1" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("處理所有矛盾後才能確認。")).toBeVisible();
  await capture(page, "conflict", page.viewportSize()?.width ?? 0);

  await activity.getByLabel("開始時間").fill("16:30");
  await expect(page.getByText("沒有發現矛盾。")).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.getByRole("button", { name: "儲存草稿" }).click();
  await expect(page.getByRole("status")).toHaveText("已儲存基線草稿");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(/東京五日：規劃中，Trip Baseline v1 已於 .+ 確認/)).toBeVisible();
  await expect(page.getByRole("button", { name: "儲存草稿" })).toHaveCount(0);
  await expect(page.getByText("確認後的修改改為提出變更提案。")).toBeVisible();
  await capture(page, "confirmed", page.viewportSize()?.width ?? 0);

  // 頁面沒有水平捲動
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Viewer 只能檢視基線；非成員看不到", async ({ page, context, baseURL, browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  const viewer = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "大阪三日", [{ userId: viewer.userId, role: "viewer" }]);
  await saveBaselineAsAdmin(tripId, {
    start_date: "2027-01-10",
    end_date: "2027-01-12",
    timezone: "Asia/Tokyo",
    flights: [],
    lodgings: [{ name: "難波旅館", area: "難波", check_in: "2027-01-10", check_out: "2027-01-12", check_in_time: null }],
    companions: 1,
    stamina_note: null,
    budget: null,
    fixed_activities: [],
    paid_items: [],
    must_visit: ["大阪城"],
    excluded: [],
    transport_preferences: ["rail"],
    photography_needs: null,
  });

  await page.goto(`/trips/${tripId}/baseline`);
  await expect(page.getByText("只有 Owner 與 Companion 可以編輯基線。")).toBeVisible();
  await expect(page.getByRole("list", { name: "Strong Preference" })).toContainText("必去地點：大阪城");
  await expect(page.getByRole("button", { name: "儲存草稿" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "確認 Trip Baseline v1" })).toHaveCount(0);

  const outsider = await browser.newContext();
  await signInAsNewUser(outsider, baseURL ?? "");
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto(`/trips/${tripId}/baseline`);
  await expect(outsiderPage.getByText("找不到這個行程，或你不是成員。")).toBeVisible();
  await ownerContext.close();
  await outsider.close();
});
