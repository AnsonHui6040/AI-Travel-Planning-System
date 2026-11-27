import { expect, test, type Page } from "@playwright/test";
import { createTrip, createUserAsAdmin, saveBaselineAsAdmin, setDisplayName, signInAsNewUser } from "./support/auth";

// 決策 0010 X：記帳與分帳。「更多」→「記帳」為總覽（總花費、預算剩餘、每人餘額）；新增、清單、詳情、結算、幣別與匯率
// 各自一個畫面，在 390×844 與 1280×800 不用捲動，手機上主要按鈕在下方三分之一（docs/verification/ux-logic-2026-11-27.md）。
// Owner、Companion 可新增修改；Viewer 唯讀；非成員看不到。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: `../../docs/verification/screenshots/X-${name}-${page.viewportSize()?.width ?? 0}.png` });
}

async function expectNoScroll(page: Page, name: string) {
  const result = await page.evaluate(() => ({
    doc: { scroll: document.documentElement.scrollHeight, inner: window.innerHeight },
    overflow: [...document.querySelectorAll<HTMLElement>("main, main *")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return (style.overflowY === "auto" || style.overflowY === "scroll" || el.tagName === "MAIN") && el.scrollHeight > el.clientHeight + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  }));
  if (process.env.CAPTURE_SCREENSHOTS === "1") console.log(`量測 ${page.viewportSize()?.width}：${name} 文件 ${result.doc.scroll}／可視 ${result.doc.inner}`);
  expect(result.doc.scroll, `${name}：文件高度`).toBeLessThanOrEqual(result.doc.inner);
  expect(result.overflow, `${name}：區塊內沒有被截掉的內容`).toEqual([]);
}

async function expectPrimaryInThumbZone(page: Page, name: string) {
  const primary = page.locator("main .primary:visible");
  await expect(primary, `${name}：一個主要按鈕`).toHaveCount(1);
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 1024) return;
  const box = await primary.boundingBox();
  if (process.env.CAPTURE_SCREENSHOTS === "1") console.log(`量測 ${viewport.width}：${name} primary 頂端 ${Math.round(box?.y ?? 0)}`);
  expect(box?.y ?? 0, `${name}：主要按鈕位置`).toBeGreaterThanOrEqual((viewport.height * 2) / 3);
}

const baseline = (budget: { amount: number; currency: string } | null) => ({
  start_date: "2027-01-10",
  end_date: "2027-01-12",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [],
  companions: 2,
  stamina_note: null,
  budget,
  fixed_activities: [],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: ["rail"],
  photography_needs: null,
});

test("Owner 記帳、外幣匯率、自訂分攤、結算與刪除；每個畫面不用捲動", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const companion = await createUserAsAdmin();
  await setDisplayName(owner.userId, "小安");
  await setDisplayName(companion.userId, "阿明");
  const tripId = await createTrip(owner.userId, "東京記帳", [{ userId: companion.userId, role: "companion" }]);
  await saveBaselineAsAdmin(tripId, baseline({ amount: 3000, currency: "TWD" }));

  // 「更多」→「記帳」
  await page.goto(`/trips/${tripId}/more`);
  await page.getByRole("link", { name: /^記帳/ }).click();
  await expect(page.getByRole("heading", { name: "記帳", level: 1 })).toBeVisible();
  const total = page.getByRole("region", { name: "總花費" });
  await expect(total).toContainText("0 TWD");
  await expect(page.getByRole("region", { name: "預算" })).toContainText("剩餘 3,000 TWD");
  await expectNoScroll(page, "記帳總覽（空）");
  await expectPrimaryInThumbZone(page, "記帳總覽（空）");

  // 新增花費：平均分攤
  await page.getByRole("link", { name: "新增花費" }).click();
  await expect(page.getByRole("heading", { name: "新增花費", level: 1 })).toBeVisible();
  await page.getByLabel("金額", { exact: true }).fill("900");
  await page.getByLabel("類別").selectOption("food");
  await page.getByLabel("備註").fill("晚餐");
  const split = page.getByRole("group", { name: "分攤" });
  await expect(split.getByRole("listitem")).toHaveText([/小安.*450/, /阿明.*450/]);
  await expectNoScroll(page, "新增花費");
  await expectPrimaryInThumbZone(page, "新增花費");
  await capture(page, "new");
  await page.getByRole("button", { name: "儲存" }).click();

  // 詳情
  await expect(page.getByRole("heading", { name: "晚餐", level: 1 })).toBeVisible();
  const detail = page.getByRole("region", { name: "花費詳情" });
  await expect(detail).toContainText("900 TWD");
  await expect(detail).toContainText("小安付款");
  await expect(detail.getByRole("list", { name: "分攤" })).toContainText("阿明450 TWD");
  await expectNoScroll(page, "花費詳情");
  await capture(page, "detail");

  // 外幣、自訂分攤：1000 JPY，小安 600、阿明 400
  await page.goto(`/trips/${tripId}/expenses/new`);
  await page.getByLabel("金額", { exact: true }).fill("1000");
  await page.getByLabel("幣別").selectOption("JPY");
  await page.getByLabel("類別").selectOption("transport");
  await page.getByLabel("備註").fill("電車");
  await page.getByLabel("自訂金額").check();
  await page.getByLabel("小安 的分攤").fill("600");
  await page.getByLabel("阿明 的分攤").fill("300");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("分攤總和與金額相差 100 JPY");
  await page.getByLabel("阿明 的分攤").fill("400");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("heading", { name: "電車", level: 1 })).toBeVisible();

  // 沒有匯率時不計入，並提示
  await page.goto(`/trips/${tripId}/expenses`);
  await expect(total).toContainText("900 TWD");
  await expect(page.getByText("1 筆 JPY 花費沒有匯率，未計入")).toBeVisible();

  // 幣別與匯率
  await page.getByRole("link", { name: "幣別與匯率" }).click();
  await expect(page.getByRole("heading", { name: "幣別與匯率", level: 1 })).toBeVisible();
  await page.getByLabel("外幣").selectOption("JPY");
  await page.getByLabel("匯率", { exact: true }).fill("0.21");
  await page.getByRole("button", { name: "儲存匯率" }).click();
  await expect(page.getByRole("status")).toHaveText("已儲存 1 JPY = 0.21 TWD");
  await expect(page.getByRole("list", { name: "已輸入的匯率" })).toContainText("1 JPY = 0.21 TWD");
  await expectNoScroll(page, "幣別與匯率");
  await capture(page, "rates");

  // 總覽：900 + 210 = 1,110；小安付 1,110、分攤 450 + 126 = 576，應收 534
  await page.goto(`/trips/${tripId}/expenses`);
  await expect(total).toContainText("1,110 TWD");
  await expect(page.getByRole("region", { name: "預算" })).toContainText("剩餘 1,890 TWD");
  await expect(page.getByRole("list", { name: "各類別" })).toContainText("交通210 TWD");
  const balances = page.getByRole("list", { name: "每人餘額" });
  await expect(balances).toContainText("小安應收 534 TWD");
  await expect(balances).toContainText("阿明應付 534 TWD");
  await expectNoScroll(page, "記帳總覽");
  await expectPrimaryInThumbZone(page, "記帳總覽");
  await capture(page, "overview");

  // 清單
  await page.getByRole("link", { name: /^花費清單/ }).click();
  const list = page.getByRole("list", { name: "花費清單" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expectNoScroll(page, "花費清單");

  // 結算：阿明付給小安 534
  await page.goto(`/trips/${tripId}/expenses/settle`);
  const transfers = page.getByRole("list", { name: "建議轉帳" });
  await expect(transfers.getByRole("listitem")).toHaveCount(1);
  await expect(transfers).toContainText("阿明付給小安534 TWD");
  await expectNoScroll(page, "結算");
  await capture(page, "settle");
  await page.getByRole("button", { name: "標記已付款" }).click();
  await expect(page.getByText("所有人都已結清。")).toBeVisible();
  await expect(page.getByRole("list", { name: "已付款" })).toContainText("阿明付給小安534 TWD");

  // 刪除：先確認
  await page.goto(`/trips/${tripId}/expenses/list`);
  await list.getByRole("link", { name: /晚餐/ }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "刪除" }).click();
  await expect(page.getByRole("heading", { name: "花費清單", level: 1 })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).not.toContainText("晚餐");
});

test("Viewer 只能檢視記帳；非成員看不到", async ({ page, context, baseURL, browser }) => {
  const viewer = await signInAsNewUser(context, baseURL ?? "");
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  await setDisplayName(owner.userId, "小安");
  await setDisplayName(viewer.userId, "小美");
  const tripId = await createTrip(owner.userId, "京都記帳", [{ userId: viewer.userId, role: "viewer" }]);
  await saveBaselineAsAdmin(tripId, baseline(null));

  // Owner 新增一筆只由自己分攤的花費
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`/trips/${tripId}/expenses/new`);
  await ownerPage.getByLabel("金額", { exact: true }).fill("500");
  await ownerPage.getByLabel("備註").fill("門票");
  await ownerPage.getByLabel("類別").selectOption("tickets");
  await ownerPage.getByLabel("小美", { exact: true }).uncheck();
  await ownerPage.getByRole("button", { name: "儲存" }).click();
  await expect(ownerPage.getByRole("heading", { name: "門票", level: 1 })).toBeVisible();

  await page.goto(`/trips/${tripId}/expenses`);
  await expect(page.getByRole("region", { name: "總花費" })).toContainText("500 TWD");
  await expect(page.getByRole("region", { name: "預算" })).toContainText("基線沒有設定預算");
  await expect(page.getByRole("link", { name: "新增花費" })).toHaveCount(0);
  await expect(page.getByText("只有 Owner 與 Companion 可以記帳；你可以檢視。")).toBeVisible();
  await expectNoScroll(page, "記帳總覽（Viewer）");

  await page.getByRole("link", { name: /^花費清單/ }).click();
  await page.getByRole("list", { name: "花費清單" }).getByRole("link", { name: /門票/ }).click();
  await expect(page.getByRole("heading", { name: "門票", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "刪除" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "修改" })).toHaveCount(0);

  await page.goto(`/trips/${tripId}/expenses/new`);
  await expect(page.getByText("只有 Owner 與 Companion 可以記帳；你可以檢視。")).toBeVisible();
  await expect(page.getByRole("button", { name: "儲存" })).toHaveCount(0);

  await page.goto(`/trips/${tripId}/expenses/settle`);
  await expect(page.getByRole("button", { name: "標記已付款" })).toHaveCount(0);

  const outsider = await browser.newContext();
  await signInAsNewUser(outsider, baseURL ?? "");
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto(`/trips/${tripId}/expenses`);
  await expect(outsiderPage.getByText("找不到這個行程，或你不是成員。")).toBeVisible();
  await ownerContext.close();
  await outsider.close();
});
