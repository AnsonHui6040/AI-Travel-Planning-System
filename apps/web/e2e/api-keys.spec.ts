import { expect, test } from "@playwright/test";
import { signInAsNewUser } from "./support/auth";

// T12：API key 設定頁（C-02、C-04）。需本機 Supabase 與 apps/web/.env.local
const KEY = "sk-test-e2e-not-real-9876";

test("未登入時設定頁要求登入", async ({ page }) => {
  await page.goto("/settings/api-keys");
  await expect(page.getByRole("heading", { name: "API key" })).toBeVisible();
  await expect(page.getByText("請先登入")).toBeVisible();
  await expect(page.getByLabel("OpenAI")).toHaveCount(0);
});

test("儲存後只顯示末四碼，完整 key 不出現在頁面；可刪除", async ({ page, context, baseURL }) => {
  await signInAsNewUser(context, baseURL ?? "");
  await page.goto("/settings/api-keys");

  for (const name of ["Anthropic Claude", "Google Gemini", "OpenAI", "Google Maps Platform", "ODPT"]) {
    await expect(page.getByLabel(name)).toBeVisible();
  }

  const openai = page.getByRole("group", { name: "OpenAI" });
  await openai.getByLabel("OpenAI").fill(KEY);
  await openai.getByRole("button", { name: "儲存" }).click();

  await expect(openai.getByText("••••9876")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("已儲存");
  expect(await page.content()).not.toContain(KEY);
  await expect(openai.getByLabel("OpenAI")).toHaveValue("");

  await page.reload();
  await expect(openai.getByText("••••9876")).toBeVisible();
  expect(await page.content()).not.toContain(KEY);

  await openai.getByRole("button", { name: "刪除" }).click();
  await expect(openai.getByText("尚未設定")).toBeVisible();
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
