import { expect, test, type Page } from "@playwright/test";
import { createItem, createTrip, lockItemAsAdmin, setDisplayName, signInAsNewUser } from "./support/auth";

// T33：唯讀連結（C-10、SH-08）。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T33-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

test("Owner 建立唯讀連結；不登入即可檢視，只顯示開放的敏感欄位，不送出外部請求；撤銷後無法存取", async ({ page, context, browser, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  await setDisplayName(owner.userId, "小安");
  const tripId = await createTrip(owner.userId, "東京五日");
  const itemId = await createItem(tripId, { name_zh: "淺草寺", name_local: "浅草寺" });
  await lockItemAsAdmin(tripId, itemId, "2026-12-10");

  // 電子郵件提供給唯讀連結，電話只提供給其他成員
  await page.goto(`/trips/${tripId}/my-info`);
  const phone = page.getByRole("group", { name: "電話" });
  await phone.getByLabel("電話", { exact: true }).fill("+886 912-345-678");
  await phone.getByLabel("提供給其他成員").check();
  await phone.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存電話");
  const email = page.getByRole("group", { name: "電子郵件" });
  await email.getByLabel("電子郵件", { exact: true }).fill("an@example.test");
  await email.getByLabel("提供給 Viewer 與唯讀連結").check();
  await email.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存電子郵件");

  await page.goto(`/trips/${tripId}/members`);
  const section = page.getByRole("region", { name: "唯讀連結" });
  await section.getByRole("button", { name: "建立唯讀連結（7 天）" }).click();
  const link = await section.getByRole("textbox", { name: "唯讀連結" }).inputValue();
  const path = new URL(link).pathname;
  expect(path).toMatch(/^\/r\/[0-9a-f]{64}$/);
  await capture(page, "owner");

  // 不登入的瀏覽器
  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  const external: string[] = [];
  guest.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL ?? "").origin) external.push(request.url());
  });
  await guest.goto(path);
  await expect(guest.getByRole("heading", { name: "東京五日", level: 1 })).toBeVisible();
  const day = guest.getByRole("region", { name: "2026-12-10" });
  await expect(day.getByRole("listitem", { name: "淺草寺" })).toContainText("13:00–14:00");
  await expect(guest.getByText("電子郵件：an@example.test")).toBeVisible();
  await expect(guest.getByText("+886 912-345-678")).toHaveCount(0);
  // 沒有任何表單或按鈕（不能修改、不能觸發 AI）
  await expect(guest.locator("form, button")).toHaveCount(0);
  expect(external).toEqual([]);
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(guest, "view");

  await page.reload();
  await page.getByRole("region", { name: "唯讀連結" }).getByRole("button", { name: "撤銷" }).click();
  await expect(page.getByRole("region", { name: "唯讀連結" }).getByRole("listitem").first()).toContainText("已撤銷");
  await guest.reload();
  await expect(guest.getByText("連結無效、已撤銷或已過期。")).toBeVisible();
  await expect(guest.getByText("淺草寺")).toHaveCount(0);
  await anonymous.close();
});

test("錯誤的唯讀連結不顯示任何行程", async ({ page }) => {
  await page.goto(`/r/${"0".repeat(64)}`);
  await expect(page.getByText("連結無效、已撤銷或已過期。")).toBeVisible();
  await page.goto("/r/not-a-token");
  await expect(page.getByText("連結無效、已撤銷或已過期。")).toBeVisible();
});

test("Companion 看不到唯讀連結的設定", async ({ page, context, browser, baseURL }) => {
  const companion = await signInAsNewUser(context, baseURL ?? "");
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  await ownerContext.close();
  const tripId = await createTrip(owner.userId, "大阪三日", [{ userId: companion.userId, role: "companion" }]);
  await page.goto(`/trips/${tripId}/members`);
  await expect(page.getByRole("heading", { name: "成員", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "唯讀連結" })).toHaveCount(0);
});
