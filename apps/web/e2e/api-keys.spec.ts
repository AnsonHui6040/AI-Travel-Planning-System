import { expect, test } from "@playwright/test";
import { saveApiKeyAsAdmin, signInAsNewUser } from "./support/auth";

// T12：API key 設定頁（C-02、C-04）。需本機 Supabase 與 apps/web/.env.local
const KEY = "sk-test-e2e-not-real-9876";

test("未登入時設定頁要求登入", async ({ page }) => {
  await page.goto("/settings/api-keys");
  await expect(page.getByRole("heading", { name: "API key" })).toBeVisible();
  await expect(page.getByText("請先登入")).toBeVisible();
  await expect(page.getByLabel("OpenAI")).toHaveCount(0);
});

test("已儲存的 key 只顯示末四碼，完整 key 不出現在頁面；可刪除", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  await page.goto("/settings/api-keys");

  for (const name of ["Anthropic Claude", "Google Gemini", "OpenAI", "Google Maps Platform", "ODPT"]) {
    await expect(page.getByLabel(name)).toBeVisible();
  }

  // 五家都有儲存前測試呼叫（T13、T19、T22），E2E 不連外部 API，所以由伺服器函式直接存入。
  // 測試呼叫失敗時不儲存的行為由各 adapter 的契約測試與 api-keys-core 單元測試涵蓋
  await saveApiKeyAsAdmin(user.userId, "odpt", KEY);
  await page.reload();
  const odptGroup = page.getByRole("group", { name: "ODPT" });
  await expect(odptGroup.getByText("••••9876")).toBeVisible();
  expect(await page.content()).not.toContain(KEY);
  await expect(odptGroup.getByLabel("ODPT")).toHaveValue("");

  await odptGroup.getByRole("button", { name: "刪除" }).click();
  await expect(odptGroup.getByText("尚未設定")).toBeVisible();
  await page.reload();
  await expect(odptGroup.getByText("尚未設定")).toBeVisible();
});

test("格式錯誤的 key 不儲存，錯誤訊息不含輸入內容", async ({ page, context, baseURL }) => {
  await signInAsNewUser(context, baseURL ?? "");
  await page.goto("/settings/api-keys");
  const odpt = page.getByRole("group", { name: "ODPT" });
  await odpt.getByLabel("ODPT").fill("bad key value");
  await odpt.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("API key 格式不正確");
  await expect(page.getByRole("status")).not.toContainText("bad key value");
  await expect(odpt.getByText("尚未設定")).toBeVisible();
});
