import { expect, test } from "@playwright/test";
import { createTrip, setDisplayName, signInAsNewUser } from "./support/auth";

// T17：我的聯絡資料（D18、S-07、第 6 節權限表）。需本機 Supabase 與 apps/web/.env.local

test("未登入時要求登入", async ({ page }) => {
  await page.goto("/trips/a7000000-0000-4000-8000-000000000001/my-info");
  await expect(page.getByRole("heading", { name: "我的聯絡資料" })).toBeVisible();
  await expect(page.getByText("請先登入")).toBeVisible();
});

test("非成員看不到行程", async ({ page, context, baseURL, browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "別人的行程");
  await ownerContext.close();

  await signInAsNewUser(context, baseURL ?? "");
  await page.goto(`/trips/${tripId}/my-info`);
  await expect(page.getByText("找不到這個行程，或你不是成員")).toBeVisible();
});

test("當事人儲存並開放欄位；Companion 只看到開放給成員的欄位，Viewer 只看到開放給 Viewer 的欄位", async ({ page, context, baseURL, browser }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  await setDisplayName(owner.userId, "小明");
  const companionContext = await browser.newContext();
  const companion = await signInAsNewUser(companionContext, baseURL ?? "");
  const viewerContext = await browser.newContext();
  const viewer = await signInAsNewUser(viewerContext, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日", [
    { userId: companion.userId, role: "companion" },
    { userId: viewer.userId, role: "viewer" },
  ]);

  await page.goto(`/trips/${tripId}/my-info`);
  await expect(page.getByText("東京五日")).toBeVisible();

  const phone = page.getByRole("group", { name: "電話" });
  await phone.getByLabel("電話", { exact: true }).fill("+886 912-345-678");
  await expect(phone.getByLabel("提供給其他成員")).not.toBeChecked();
  await phone.getByLabel("提供給其他成員").check();
  await phone.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存電話");

  const email = page.getByRole("group", { name: "電子郵件" });
  await email.getByLabel("電子郵件", { exact: true }).fill("ming@example.test");
  await email.getByLabel("提供給 Viewer 與唯讀連結").check();
  await email.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存電子郵件");

  const name = page.getByRole("group", { name: "全名" });
  await name.getByLabel("全名", { exact: true }).fill("王小明");
  await name.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存全名");

  await page.reload();
  await expect(page.getByRole("group", { name: "電話" }).getByLabel("電話", { exact: true })).toHaveValue("+886 912-345-678");
  await expect(page.getByRole("group", { name: "電話" }).getByLabel("提供給其他成員")).toBeChecked();
  await expect(page.getByRole("group", { name: "全名" }).getByLabel("提供給 AI")).not.toBeChecked();

  const companionPage = await companionContext.newPage();
  await companionPage.goto(`/trips/${tripId}/my-info`);
  const companionTable = companionPage.getByRole("table", { name: "同行成員提供的資料" });
  await expect(companionTable).toContainText("+886 912-345-678");
  await expect(companionTable).toContainText("小明");
  await expect(companionPage.getByRole("main")).not.toContainText("ming@example.test");
  await expect(companionPage.getByRole("main")).not.toContainText("王小明");

  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto(`/trips/${tripId}/my-info`);
  const viewerTable = viewerPage.getByRole("table", { name: "同行成員提供的資料" });
  await expect(viewerTable).toContainText("ming@example.test");
  await expect(viewerPage.getByRole("main")).not.toContainText("+886 912-345-678");
  await expect(viewerPage.getByRole("main")).not.toContainText("王小明");

  await companionContext.close();
  await viewerContext.close();
});

test("格式不正確時不儲存，訊息不含輸入值", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "大阪");
  await page.goto(`/trips/${tripId}/my-info`);
  const email = page.getByRole("group", { name: "電子郵件" });
  await expect(page.getByText("大阪")).toBeVisible();
  // 瀏覽器的 email 驗證接受沒有網域點號的位址，由伺服器端拒絕
  await email.getByLabel("電子郵件", { exact: true }).fill("bad-value@xyz");
  await email.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("電子郵件格式不正確");
  await expect(page.getByRole("status")).not.toContainText("bad-value@xyz");
  await page.reload();
  await expect(page.getByRole("group", { name: "電子郵件" }).getByLabel("電子郵件", { exact: true })).toHaveValue("");
});
