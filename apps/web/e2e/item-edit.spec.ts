import { expect, test, type Page } from "@playwright/test";
import {
  confirmTripAsAdmin,
  createItem,
  createUserAsAdmin,
  createTrip,
  listItemsAsAdmin,
  markBaselineConfirmedAsAdmin,
  saveApiKeyAsAdmin,
  saveBaselineAsAdmin,
  scheduleItemAsAdmin,
  setDayStatusAsAdmin,
  setItemFieldsAsAdmin,
  signInAsNewUser,
} from "./support/auth";

// 決策 0010 E、S：行程編輯與搜尋加入地點。需本機 Supabase 與 apps/web/.env.local；
// Places 文字搜尋以 E2E_PLACES_FIXTURE=1 的合成回應執行（playwright.config.ts）。390 與 1280 兩個專案都執行

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: `../../docs/verification/screenshots/E-S-${name}-${page.viewportSize()?.width ?? 0}.png` });
}

// 文件與畫面內每個區塊都不需要捲動（搜尋結果清單除外，由 CSS 限高）
async function expectNoScroll(page: Page, name: string) {
  const result = await page.evaluate(() => ({
    doc: { scroll: document.documentElement.scrollHeight, inner: window.innerHeight },
    overflow: [...document.querySelectorAll<HTMLElement>("main, main *")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return (style.overflowY === "auto" || style.overflowY === "scroll" || el.tagName === "MAIN") && el.scrollHeight > el.clientHeight + 1;
      })
      .filter((el) => !el.classList.contains("place-results"))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  }));
  expect(result.doc.scroll, `${name}：文件高度`).toBeLessThanOrEqual(result.doc.inner);
  expect(result.overflow, `${name}：區塊內沒有被截掉的內容`).toEqual([]);
}

async function expectPrimaryInThumbZone(page: Page, name: string) {
  const primary = page.locator("main .primary:visible");
  await expect(primary, `${name}：一個主要按鈕`).toHaveCount(1);
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 1024) return;
  const box = await primary.boundingBox();
  expect(box?.y ?? 0, `${name}：主要按鈕位置`).toBeGreaterThanOrEqual((viewport.height * 2) / 3);
}

const baseline = {
  start_date: "2026-12-01",
  end_date: "2026-12-02",
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

async function planningTrip(userId: string, name: string): Promise<string> {
  const tripId = await createTrip(userId, name);
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  await confirmTripAsAdmin(tripId);
  return tripId;
}

test("規劃中：手動新增並排入某天，畫面標示使用者確認；沒有 Maps key 時提示到設定輸入", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await planningTrip(owner.userId, "大阪兩日");

  await page.goto(`/trips/${tripId}/days?date=2026-12-01`);
  await page.getByRole("link", { name: "新增地點" }).click();
  await expect(page.getByRole("heading", { name: "新增地點" })).toBeVisible();
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expectNoScroll(page, "新增地點（沒有 key）");
  await expectPrimaryInThumbZone(page, "新增地點（沒有 key）");
  await capture(page, "add-manual");

  await page.getByLabel("名稱").fill("黑門市場");
  await page.getByLabel("類型").selectOption("shopping");
  await page.getByLabel("停留（分鐘）").fill("90");
  await page.getByLabel("日期").selectOption("2026-12-01");
  await page.getByLabel("開始").fill("10:00");
  await page.getByText("地址與備註").click();
  await page.getByLabel("備註").fill("早上人少");
  await page.getByRole("button", { name: "新增" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存");

  const [item] = await listItemsAsAdmin(tripId);
  expect(item).toMatchObject({
    name_zh: "黑門市場",
    origin: "user",
    verification_status: "user_confirmed",
    scheduled_date: "2026-12-01",
    scheduled_start: "10:00:00",
    scheduled_end: "11:30:00",
    note: "早上人少",
    place_id: null,
  });

  await page.goto(`/trips/${tripId}/days?date=2026-12-01`);
  const row = page.getByRole("list", { name: "項目" }).getByRole("link", { name: /黑門市場/ });
  await expect(row).toContainText("10:00");
  await expect(row).toContainText("使用者確認");
});

test("搜尋加入地點：只保存 place_id，名稱預設為輸入的搜尋字，Google 的名稱與地址只即時顯示（D28）", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  await saveApiKeyAsAdmin(owner.userId, "google_maps", "e2e-maps-key-not-real-0001");
  const tripId = await planningTrip(owner.userId, "大阪拉麵");

  await page.goto(`/trips/${tripId}/items/new`);
  await page.getByRole("searchbox", { name: "搜尋地點" }).fill("一蘭");
  await page.getByRole("button", { name: "搜尋" }).click();
  const results = page.getByRole("list", { name: "搜尋結果" });
  await expect(results.getByRole("link")).toHaveCount(2);
  await expect(page.getByText("資料來源：Google Maps")).toBeVisible();
  await results.getByRole("link", { name: /道頓堀店/ }).click();
  await expect(page.getByText("已選：一蘭 道頓堀店（合成）")).toBeVisible();
  await expect(page.getByLabel("名稱")).toHaveValue("一蘭");
  await expectNoScroll(page, "新增地點（搜尋結果）");
  await expectPrimaryInThumbZone(page, "新增地點（搜尋結果）");
  await capture(page, "add-search");
  expect(await page.content()).not.toContain("e2e-maps-key-not-real-0001");

  await page.getByLabel("類型").selectOption("restaurant");
  await page.getByRole("button", { name: "新增" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存");
  const [item] = await listItemsAsAdmin(tripId);
  expect(item).toMatchObject({ name_zh: "一蘭", place_id: "ChIJe2e-synthetic-place-0001", address: null, scheduled_date: null });
});

test("編輯：修改停留、上移下移、移到另一天、移回候選清單、刪除（先確認）", async ({ page, context, baseURL }) => {
  const confirms: string[] = [];
  page.on("dialog", (d) => {
    confirms.push(d.message());
    void d.accept();
  });
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await planningTrip(owner.userId, "大阪編輯");
  // AI 研究的已核實候選：自動草案會排入第一天
  const ai = await createItem(tripId, { name_zh: "大阪城" });
  await setItemFieldsAsAdmin(ai, { verification_status: "verified", lifecycle_status: "verified" });

  await page.goto(`/trips/${tripId}/items/new`);
  await page.getByLabel("名稱").fill("通天閣");
  await page.getByLabel("日期").selectOption("2026-12-01");
  await page.getByLabel("開始").fill("15:00");
  await page.getByRole("button", { name: "新增" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存");
  const user = (await listItemsAsAdmin(tripId)).find((i) => i.name_zh === "通天閣");
  // 第一次手動排程時自動草案一併寫入
  expect((await listItemsAsAdmin(tripId)).find((i) => i.name_zh === "大阪城")).toMatchObject({ scheduled_date: "2026-12-01", scheduled_start: "09:00:00" });

  await page.goto(`/trips/${tripId}/items/${String(user?.id)}`);
  await page.getByRole("link", { name: "編輯" }).click();
  await expect(page.getByRole("heading", { name: "編輯項目" })).toBeVisible();
  await expectNoScroll(page, "編輯項目");
  await expectPrimaryInThumbZone(page, "編輯項目");
  await capture(page, "edit");
  const up = page.getByRole("button", { name: "上移" });
  await expect(up).toBeEnabled();
  expect(await up.evaluate((el) => { const r = el.getBoundingClientRect().height; const a = getComputedStyle(el, "::after"); return a.position === "absolute" ? r + Math.max(0, -parseFloat(a.top)) + Math.max(0, -parseFloat(a.bottom)) : r; })).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("button", { name: "下移" })).toBeDisabled();

  await page.getByLabel("停留（分鐘）").fill("30");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status").first()).toContainText("已儲存");
  expect((await listItemsAsAdmin(tripId)).find((i) => i.name_zh === "通天閣")).toMatchObject({ suggested_stay_minutes: 30, scheduled_end: "15:30:00" });

  await page.reload();
  await page.getByRole("button", { name: "上移" }).click();
  await expect(page.getByRole("status").first()).toContainText("已儲存");
  const swapped = await listItemsAsAdmin(tripId);
  expect(swapped.find((i) => i.name_zh === "通天閣")).toMatchObject({ scheduled_start: "09:00:00" });
  expect(swapped.find((i) => i.name_zh === "大阪城")?.scheduled_start).not.toBe("09:00:00");

  await page.reload();
  await page.getByRole("combobox", { name: /^日期/ }).selectOption("2026-12-02");
  await page.getByLabel("開始", { exact: true }).first().fill("11:00");
  await page.getByLabel("結束", { exact: true }).first().fill("");
  await page.getByRole("button", { name: "改時間" }).click();
  await expect(page.getByRole("status").first()).toContainText("已儲存");
  expect((await listItemsAsAdmin(tripId)).find((i) => i.name_zh === "通天閣")).toMatchObject({ scheduled_date: "2026-12-02", scheduled_start: "11:00:00" });

  await page.reload();
  await page.getByRole("button", { name: "移回候選清單" }).click();
  await expect(page.getByRole("status").first()).toContainText("已儲存");
  expect((await listItemsAsAdmin(tripId)).find((i) => i.name_zh === "通天閣")).toMatchObject({ scheduled_date: null });

  await page.reload();
  await page.getByRole("button", { name: "刪除" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/days$`));
  expect(confirms).toEqual(["刪除「通天閣」？刪除後無法復原。"]);
  expect((await listItemsAsAdmin(tripId)).map((i) => i.name_zh)).toEqual(["大阪城"]);
});

test("鎖定後（決策 0011）：Companion 的修改成為待批准提案，行程不直接改動", async ({ page, context, baseURL }) => {
  const companion = await signInAsNewUser(context, baseURL ?? "");
  const owner = await createUserAsAdmin();
  const tripId = await createTrip(owner.userId, "大阪鎖定", [{ userId: companion.userId, role: "companion" }]);
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  await confirmTripAsAdmin(tripId);
  const item = await createItem(tripId, { name_zh: "海遊館" });
  await scheduleItemAsAdmin(tripId, item, "2026-12-01", "10:00", "11:00");
  await setDayStatusAsAdmin(tripId, "2026-12-01", "approved");
  await setDayStatusAsAdmin(tripId, "2026-12-02", "approved");

  await page.goto(`/trips/${tripId}/items/${item}/edit`);
  await expect(page.getByRole("button", { name: "提出修改" })).toBeVisible();
  await page.getByLabel("停留（分鐘）").fill("120");
  await page.getByRole("button", { name: "提出修改" }).click();
  await expect(page.getByRole("status").first()).toContainText("已送出提案");
  expect((await listItemsAsAdmin(tripId))[0]).toMatchObject({ suggested_stay_minutes: 60 });

  await page.goto(`/trips/${tripId}/proposals`);
  await expect(page.getByText("修改海遊館").first()).toBeVisible();
});
