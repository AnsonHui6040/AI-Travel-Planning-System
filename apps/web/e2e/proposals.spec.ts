import { expect, test, type Page } from "@playwright/test";
import { createItem, createProposalAsAdmin, createTrip, lockItemAsAdmin, setDisplayName, signInAsNewUser } from "./support/auth";

// T34：共同批准（SH-04–SH-06）。需本機 Supabase（含 Realtime）與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T34-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

test("兩個瀏覽器同時批准：先到先得，另一個提案失效，雙方即時收到通知，Change Log 記錄提出者與批准者", async ({ page, context, browser, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  await setDisplayName(owner.userId, "小安");
  const companionContext = await browser.newContext();
  const companionPage = await companionContext.newPage();
  const companion = await signInAsNewUser(companionContext, baseURL ?? "");
  await setDisplayName(companion.userId, "阿明");

  const tripId = await createTrip(owner.userId, "東京五日", [{ userId: companion.userId, role: "companion" }]);
  const itemId = await createItem(tripId, { name_zh: "淺草寺" });
  await lockItemAsAdmin(tripId, itemId, "2026-12-10");
  await createProposalAsAdmin(tripId, companion.userId, itemId, "淺草寺改到 10:00", "10:00", "11:00");
  await createProposalAsAdmin(tripId, owner.userId, itemId, "淺草寺改到 15:00", "15:00", "16:00");

  // 清單每項一行，點進去看影響範圍再批准
  await page.goto(`/trips/${tripId}/proposals`);
  await companionPage.goto(`/trips/${tripId}/proposals`);
  await page.getByRole("link", { name: /淺草寺改到 10:00/ }).click();
  await companionPage.getByRole("link", { name: /淺草寺改到 15:00/ }).click();
  const mine = page.getByRole("article", { name: "淺草寺改到 10:00" });
  const theirs = companionPage.getByRole("article", { name: "淺草寺改到 15:00" });
  await expect(mine.getByRole("region", { name: "影響範圍" })).toContainText("淺草寺改為 12/10 10:00–11:00");
  await expect(mine).toContainText("阿明 提出");
  await expect(theirs).toContainText("小安 提出");
  await capture(page, "pending");

  // 等兩邊的 Realtime 訂閱完成
  await expect(page.locator("[data-realtime]")).toHaveAttribute("data-realtime", "subscribed");
  await expect(companionPage.locator("[data-realtime]")).toHaveAttribute("data-realtime", "subscribed");
  // 兩人同時按下批准（基於同一個版本）
  await Promise.all([mine.getByRole("button", { name: "批准" }).click(), theirs.getByRole("button", { name: "批准" }).click()]);
  await expect(mine.getByRole("status")).toBeVisible();
  await expect(theirs.getByRole("status")).toBeVisible();
  const outcomes = [await mine.getByRole("status").textContent(), await theirs.getByRole("status").textContent()].sort();
  // 小安批准的是阿明提出的 10:00；阿明批准的是小安提出的 15:00
  const winner = (await mine.getByRole("status").textContent())?.startsWith("已套用") ? "小安" : "阿明";
  expect(outcomes).toEqual(["已套用，Change Log 版本 v1.0", "行程已有其他更新，這個提案已失效。請以最新版本重新提出"].sort());

  // SH-06：雙方不用重新整理就收到通知（套用與失效）
  await expect(page.locator(".live-notice")).toHaveText("其他成員剛處理了提案，畫面已更新。");
  await expect(companionPage.locator(".live-notice")).toHaveText("其他成員剛處理了提案，畫面已更新。");

  await page.goto(`/trips/${tripId}/proposals`);
  await expect(page.getByRole("region", { name: "提案" }).getByText("待批准 0 個。", { exact: false })).toBeVisible();
  const statuses = [
    await page.getByRole("listitem", { name: "淺草寺改到 10:00" }).locator(".proposal-status").textContent(),
    await page.getByRole("listitem", { name: "淺草寺改到 15:00" }).locator(".proposal-status").textContent(),
  ].sort();
  expect(statuses).toEqual(["已套用", "已失效"].sort());
  await page.getByRole("navigation", { name: "分類" }).getByRole("link", { name: "Change Log" }).click();
  const log = page.getByRole("region", { name: "Change Log" }).getByRole("listitem", { name: "v1.0" });

  await expect(log).toContainText(winner === "小安" ? "淺草寺改到 10:00" : "淺草寺改到 15:00");
  await expect(log).toContainText(winner === "小安" ? "阿明 提出，小安 批准" : "小安 提出，阿明 批准");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "log");
  await companionContext.close();
});

test("Viewer 看得到提案與 Change Log，但不能批准或否決", async ({ page, context, browser, baseURL }) => {
  const viewer = await signInAsNewUser(context, baseURL ?? "");
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  await ownerContext.close();
  const tripId = await createTrip(owner.userId, "大阪三日", [{ userId: viewer.userId, role: "viewer" }]);
  const itemId = await createItem(tripId, { name_zh: "大阪城" });
  await lockItemAsAdmin(tripId, itemId, "2026-12-10");
  await createProposalAsAdmin(tripId, owner.userId, itemId, "大阪城改到 10:00", "10:00", "11:00");
  await page.goto(`/trips/${tripId}/proposals`);
  await expect(page.getByRole("listitem", { name: "大阪城改到 10:00" })).toBeVisible();
  await page.getByRole("link", { name: /大阪城改到 10:00/ }).click();
  await expect(page.getByText("只有 Owner 與 Companion 可以批准或否決。")).toBeVisible();
  await expect(page.getByRole("button", { name: "批准" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "否決" })).toHaveCount(0);
});
