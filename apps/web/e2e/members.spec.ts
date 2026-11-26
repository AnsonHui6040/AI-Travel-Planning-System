import { expect, test, type Page } from "@playwright/test";
import { countMemberDataAsAdmin, createTrip, seedMemberDataAsAdmin, setDisplayName, signInAsNewUser } from "./support/auth";

// T32：邀請、角色變更、移除成員（SH-07）。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T32-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

async function inviteLink(page: Page, role: "Companion" | "Viewer"): Promise<string> {
  const invite = page.getByRole("region", { name: "邀請成員" });
  await invite.getByRole("button", { name: `建立 ${role} 邀請連結` }).click();
  const link = await invite.getByRole("textbox", { name: "邀請連結" }).inputValue();
  return new URL(link).pathname;
}

test("邀請、接受、變更角色、移除成員並清除該成員的行程資料", async ({ page, context, browser, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  await setDisplayName(owner.userId, "小安");
  const tripId = await createTrip(owner.userId, "東京五日");

  await page.goto(`/trips/${tripId}/members`);
  await expect(page.getByRole("heading", { name: "成員", level: 1 })).toBeVisible();
  const path = await inviteLink(page, "Viewer");
  expect(path).toMatch(/^\/invite\/[0-9a-f]{64}$/);
  await expect(page.getByRole("region", { name: "邀請成員" }).getByRole("listitem")).toContainText("有效");
  await capture(page, "invite");

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  const guest = await signInAsNewUser(guestContext, baseURL ?? "");
  await setDisplayName(guest.userId, "阿明");
  await guestPage.goto(path);
  await expect(guestPage.getByText("你受邀加入「東京五日」，角色為 Viewer（只能檢視）。")).toBeVisible();
  await guestPage.getByRole("button", { name: "加入行程" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/trips/${tripId}/days$`));
  // 同一個連結只能使用一次
  await guestPage.goto(path);
  await expect(guestPage.getByText("邀請連結無效、已使用、已撤銷或已過期。請向行程的 Owner 索取新的連結。")).toBeVisible();

  await page.reload();
  const member = page.getByRole("listitem", { name: "阿明" });
  await expect(member).toContainText("Viewer");
  await member.getByRole("button", { name: "改為 Companion" }).click();
  await expect(member.getByRole("status")).toHaveText("已變更角色為 Companion");
  await page.reload();
  await expect(page.getByRole("listitem", { name: "阿明" })).toContainText("Companion");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "members");

  // SH-07：移除時刪除其在此行程的記憶與通知
  await seedMemberDataAsAdmin(tripId, guest);
  expect(await countMemberDataAsAdmin(tripId, guest.userId)).toBe(2);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("listitem", { name: "阿明" }).getByRole("button", { name: "移除" }).click();
  await expect(page.getByRole("listitem", { name: "阿明" })).toHaveCount(0);
  expect(await countMemberDataAsAdmin(tripId, guest.userId)).toBe(0);
  await guestPage.goto(`/trips/${tripId}/days`);
  await expect(guestPage.getByText("找不到這個行程，或你不是成員。")).toBeVisible();
  await guestContext.close();
});

test("撤銷的邀請無法使用；Companion 看不到邀請，可自行退出", async ({ page, context, browser, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "大阪三日");
  await page.goto(`/trips/${tripId}/members`);
  const revokedPath = await inviteLink(page, "Viewer");
  await page.reload();
  await page.getByRole("region", { name: "邀請成員" }).getByRole("button", { name: "撤銷" }).click();
  await expect(page.getByRole("region", { name: "邀請成員" }).getByRole("listitem").first()).toContainText("已撤銷");
  const companionPath = await inviteLink(page, "Companion");

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await signInAsNewUser(guestContext, baseURL ?? "");
  await guestPage.goto(revokedPath);
  await expect(guestPage.getByText("邀請連結無效、已使用、已撤銷或已過期。請向行程的 Owner 索取新的連結。")).toBeVisible();
  await guestPage.goto(companionPath);
  await guestPage.getByRole("button", { name: "加入行程" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/trips/${tripId}/days$`));

  await guestPage.goto(`/trips/${tripId}/members`);
  await expect(guestPage.getByRole("region", { name: "邀請成員" })).toHaveCount(0);
  await expect(guestPage.getByRole("button", { name: "移除" })).toHaveCount(0);
  guestPage.once("dialog", (dialog) => void dialog.accept());
  await guestPage.getByRole("button", { name: "退出這個行程" }).click();
  await expect(guestPage).toHaveURL(/\/$/);
  await guestPage.goto(`/trips/${tripId}/members`);
  await expect(guestPage.getByText("找不到這個行程，或你不是成員。")).toBeVisible();
  await guestContext.close();
});

test("未登入時邀請連結不顯示行程", async ({ page }) => {
  await page.goto(`/invite/${"0".repeat(64)}`);
  await expect(page.getByText("請先登入，再開啟這個邀請連結。")).toBeVisible();
});
