import { expect, test } from "@playwright/test";
import { signInAsNewUser } from "./support/auth";

// T14：AI 角色設定頁（決策 0006、D07、S-06）。需本機 Supabase 與 apps/web/.env.local

test("未登入時要求登入", async ({ page }) => {
  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { name: "AI 角色" })).toBeVisible();
  await expect(page.getByText("請先登入")).toBeVisible();
});

test("顯示五個角色的預設值與用量；Verification 改成與 Research 同一家時出現警告", async ({ page, context, baseURL }) => {
  await signInAsNewUser(context, baseURL ?? "");
  await page.goto("/settings/ai");

  for (const name of ["Research", "Verification", "Transport", "Master Planner", "Live Planner"]) {
    await expect(page.getByRole("group", { name })).toBeVisible();
  }
  const verification = page.getByRole("group", { name: "Verification" });
  await expect(verification.getByLabel("第 1 順位供應商")).toHaveValue("google");
  await expect(verification.getByLabel("步數上限")).toHaveValue("10");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  await expect(page.getByRole("table", { name: "近 30 日用量" })).toBeVisible();

  await verification.getByLabel("第 1 順位供應商").selectOption("anthropic");
  await verification.getByLabel("第 1 順位模型").fill("claude-opus-5-5");
  await verification.getByLabel("第 2 順位供應商").selectOption("google");
  await verification.getByLabel("第 2 順位模型").fill("");
  await verification.getByLabel("第 3 順位供應商").selectOption("openai");
  await verification.getByRole("button", { name: "儲存" }).click();

  await expect(page.getByRole("status")).toContainText("已儲存 Verification 的設定");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("同一家");

  await page.reload();
  await expect(page.getByRole("group", { name: "Verification" }).getByLabel("第 1 順位供應商")).toHaveValue("anthropic");
});

test("步數上限不合格時不儲存", async ({ page, context, baseURL }) => {
  await signInAsNewUser(context, baseURL ?? "");
  await page.goto("/settings/ai");
  const research = page.getByRole("group", { name: "Research" });
  await research.getByLabel("步數上限").fill("0");
  await research.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("步數");
  await page.reload();
  await expect(page.getByRole("group", { name: "Research" }).getByLabel("步數上限")).toHaveValue("6");
});
