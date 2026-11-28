import { expect, test, type Page } from "@playwright/test";
import {
  confirmTripAsAdmin,
  countVersionsAsAdmin,
  createItem,
  createTrip,
  createUserAsAdmin,
  listItemsAsAdmin,
  listProposalsAsAdmin,
  markBaselineConfirmedAsAdmin,
  saveBaselineAsAdmin,
  scheduleItemAsAdmin,
  setDayStatusAsAdmin,
  setItemFieldsAsAdmin,
  setTripFieldsAsAdmin,
  signInAsNewUser,
} from "./support/auth";

// 決策 0011：完整的行程編輯。清單內編輯模式（鍵盤與按鈕排序、時間、刪除、插入、自動順延、不要順延）、
// 鎖定後 Owner 直接套用與 Companion 提案、兩站之間的交通、整天交換、行程設定，以及 390 與 1280 的版面重疊檢查。

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: `../../docs/verification/screenshots/EDIT-full-${name}-${page.viewportSize()?.width ?? 0}.png` });
}

async function expectNoScroll(page: Page, name: string) {
  const result = await page.evaluate(() => ({
    doc: { scroll: document.documentElement.scrollHeight, inner: window.innerHeight },
    overflow: [...document.querySelectorAll<HTMLElement>("main, main *")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return (style.overflowY === "auto" || style.overflowY === "scroll" || el.tagName === "MAIN") && el.scrollHeight > el.clientHeight + 1;
      })
      .filter((el) => !el.classList.contains("scroll-area"))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  }));
  expect(result.doc.scroll, `${name}：文件高度`).toBeLessThanOrEqual(result.doc.inner);
  expect(result.overflow, `${name}：只有清單捲動`).toEqual([]);
}

// 每個看得到的輸入欄與按鈕都在畫面寬度內，且不與其他輸入欄或按鈕重疊
async function expectNoOverlap(page: Page, name: string) {
  const problems = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>("main input:not([type=hidden]), main select, main textarea, main button, main a.primary, main a.secondary")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true });
    });
    const label = (el: HTMLElement) => `${el.tagName.toLowerCase()}[${el.getAttribute("name") ?? el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 12) ?? ""}]`;
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.right > width + 0.5) out.push(`${label(el)} 超出畫面（${Math.round(r.left)}–${Math.round(r.right)} / ${width}）`);
    }
    for (let i = 0; i < els.length; i += 1) {
      for (let j = i + 1; j < els.length; j += 1) {
        const a = els[i] as HTMLElement;
        const b = els[j] as HTMLElement;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (x > 1 && y > 1) out.push(`${label(a)} 與 ${label(b)} 重疊`);
      }
    }
    return out;
  });
  expect(problems, `${name}：輸入欄與按鈕不超出畫面、不重疊`).toEqual([]);
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

async function confirmedTrip(ownerId: string, name: string, members: { userId: string; role: "companion" | "viewer" }[] = []) {
  const tripId = await createTrip(ownerId, name, members);
  await saveBaselineAsAdmin(tripId, baseline);
  await markBaselineConfirmedAsAdmin(tripId);
  await confirmTripAsAdmin(tripId);
  return tripId;
}

// 已鎖定、12/01 有三項（09:00、10:30、13:00）
async function lockedTrip(ownerId: string, name: string, members: { userId: string; role: "companion" | "viewer" }[] = []) {
  const tripId = await confirmedTrip(ownerId, name, members);
  const ids: Record<string, string> = {};
  for (const [n, start, end] of [
    ["淺草寺", "09:00", "10:00"],
    ["晴空塔", "10:30", "11:30"],
    ["上野公園", "13:00", "14:00"],
  ] as const) {
    ids[n] = await createItem(tripId, { name_zh: n });
    await scheduleItemAsAdmin(tripId, ids[n], "2026-12-01", start, end);
  }
  await setDayStatusAsAdmin(tripId, "2026-12-01", "approved");
  await setDayStatusAsAdmin(tripId, "2026-12-02", "approved");
  return { tripId, ids };
}

const rowNames = (page: Page) => page.locator(".edit-rows .edit-name").evaluateAll((els) => els.map((e) => e.firstChild?.textContent?.trim() ?? ""));
const byName = (items: Array<Record<string, unknown>>, name: string) => items.find((i) => i.name_zh === name);

test("鎖定後 Owner：編輯模式以鍵盤與按鈕排序、改時間自動順延、刪除、插入，完成後一次套用並留下一筆 Change Log", async ({ page, context, baseURL }) => {
  const confirms: string[] = [];
  page.on("dialog", (d) => {
    confirms.push(d.message());
    void d.accept();
  });
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const { tripId } = await lockedTrip(owner.userId, "東京編輯");

  await page.goto(`/trips/${tripId}/days?date=2026-12-01`);
  await expectNoScroll(page, "行程");
  await expectNoOverlap(page, "行程");
  await page.getByRole("button", { name: "編輯" }).click();
  await expect(page.getByRole("button", { name: "完成", exact: true })).toBeVisible();
  await expectNoScroll(page, "編輯模式");
  await expectNoOverlap(page, "編輯模式");
  await capture(page, "edit-mode");
  const handle = page.getByRole("button", { name: /拖曳排序：淺草寺/ });
  expect(await handle.evaluate((el) => { const r = el.getBoundingClientRect().height; const a = getComputedStyle(el, "::after"); return a.position === "absolute" ? r + Math.max(0, -parseFloat(a.top)) + Math.max(0, -parseFloat(a.bottom)) : r; })).toBeGreaterThanOrEqual(44);
  expect(await page.getByRole("button", { name: "下移淺草寺" }).evaluate((el) => { const w = el.getBoundingClientRect().width; const a = getComputedStyle(el, "::after"); return a.position === "absolute" ? w + Math.max(0, -parseFloat(a.left)) + Math.max(0, -parseFloat(a.right)) : w; })).toBeGreaterThanOrEqual(44);

  // 鍵盤：淺草寺下移一位（每個位置沿用原本的開始時間）
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  expect(await rowNames(page)).toEqual(["晴空塔", "淺草寺", "上野公園"]);
  // 按鈕：上野公園上移再下移，回到原位
  await page.getByRole("button", { name: "上移上野公園" }).click();
  await page.getByRole("button", { name: "下移上野公園" }).click();
  expect(await rowNames(page)).toEqual(["晴空塔", "淺草寺", "上野公園"]);

  // 淺草寺延長到 13:00：上野公園依停留加交通（預設 30 分鐘）順延到 13:30
  await page.getByLabel("淺草寺 結束").fill("13:00");
  await expect(page.getByLabel("上野公園 開始")).toHaveValue("13:30");
  await expect(page.getByText("已順延：上野公園")).toBeVisible();

  await page.getByRole("button", { name: "刪除晴空塔" }).click();
  expect(confirms).toEqual(["刪除「晴空塔」？按「完成」後才會儲存。"]);
  await page.getByRole("button", { name: "在上野公園後面插入" }).click();
  await page.getByRole("listitem", { name: "插入地點" }).getByLabel("名稱").fill("藏前咖啡");
  await page.getByRole("listitem", { name: "插入地點" }).getByLabel("停留（分鐘）").fill("30");
  await page.getByRole("button", { name: "加入" }).click();
  await expect(page.getByLabel("藏前咖啡 開始")).toHaveValue("15:00");
  await expectNoOverlap(page, "編輯模式（插入後）");

  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已套用" })).toBeVisible();
  const items = await listItemsAsAdmin(tripId);
  expect(byName(items, "淺草寺")).toMatchObject({ scheduled_start: "10:30:00", scheduled_end: "13:00:00" });
  expect(byName(items, "上野公園")).toMatchObject({ scheduled_start: "13:30:00", scheduled_end: "14:30:00" });
  expect(byName(items, "晴空塔")).toMatchObject({ scheduled_date: null, lifecycle_status: "cancelled" });
  expect(byName(items, "藏前咖啡")).toMatchObject({ scheduled_start: "15:00:00", origin: "user", lifecycle_status: "modified" });
  expect(await countVersionsAsAdmin(tripId)).toBe(1);
  expect((await listProposalsAsAdmin(tripId)).map((p) => p.status)).toEqual(["applied"]);
  await expect(page.getByRole("button", { name: "編輯" })).toBeVisible();
});

test("鎖定後 Companion：同一個批次成為一個待批准提案，行程不直接改動", async ({ page, context, baseURL }) => {
  const companion = await signInAsNewUser(context, baseURL ?? "");
  const owner = await createUserAsAdmin();
  const { tripId } = await lockedTrip(owner.userId, "東京提案", [{ userId: companion.userId, role: "companion" }]);

  await page.goto(`/trips/${tripId}/days?date=2026-12-01`);
  await page.getByRole("button", { name: "編輯" }).click();
  await page.getByRole("button", { name: "下移淺草寺" }).click();
  await page.getByRole("button", { name: "完成並提出" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已送出提案" })).toBeVisible();
  expect(byName(await listItemsAsAdmin(tripId), "淺草寺")).toMatchObject({ scheduled_start: "09:00:00" });
  const proposals = await listProposalsAsAdmin(tripId);
  expect(proposals.map((p) => p.status)).toEqual(["pending"]);
  expect(proposals[0]?.change.operations).toHaveLength(2);
  expect(await countVersionsAsAdmin(tripId)).toBe(0);
});

test("規劃中：交通設定後用於自動順延；不要順延時重疊不送出；完成後直接寫入", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await confirmedTrip(owner.userId, "東京規劃");
  const a = await createItem(tripId, { name_zh: "築地場外市場" });
  const b = await createItem(tripId, { name_zh: "銀座" });
  await setItemFieldsAsAdmin(a, { verification_status: "verified", lifecycle_status: "verified", scheduled_date: "2026-12-01", scheduled_start: "09:00", scheduled_end: "10:00" });
  await setItemFieldsAsAdmin(b, { verification_status: "verified", lifecycle_status: "verified", scheduled_date: "2026-12-01", scheduled_start: "10:30", scheduled_end: "11:30" });
  await setTripFieldsAsAdmin(tripId, { manual_schedule: true });

  await page.goto(`/trips/${tripId}/days?date=2026-12-01`);
  await expect(page.getByText("交通未設定")).toBeVisible();
  await page.locator(".travel-set").click();
  await page.getByLabel("交通方式").selectOption("walk");
  await page.getByLabel("分鐘").fill("10");
  await expectNoOverlap(page, "交通設定");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByText("步行 10 分鐘")).toBeVisible();
  await expectNoOverlap(page, "行程（交通）");
  await capture(page, "travel");

  await page.getByRole("button", { name: "編輯" }).click();
  await expect(page.getByText("修改會")).toHaveCount(0);
  // 築地延長到 10:40：銀座順延到 10:40＋步行 10 分＋緩衝 10 分＝11:00
  await page.getByLabel("築地場外市場 結束").fill("10:40");
  await expect(page.getByLabel("銀座 開始")).toHaveValue("11:00");
  await page.getByLabel("不要順延").check();
  await expect(page.getByLabel("銀座 開始")).toHaveValue("10:30");
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("status").filter({ hasText: "時段重疊" })).toBeVisible();
  await page.getByLabel("不要順延").uncheck();
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已儲存" })).toBeVisible();
  const items = await listItemsAsAdmin(tripId);
  expect(byName(items, "築地場外市場")).toMatchObject({ scheduled_end: "10:40:00" });
  expect(byName(items, "銀座")).toMatchObject({ scheduled_start: "11:00:00", scheduled_end: "12:00:00", lifecycle_status: "verified" });
  expect(await countVersionsAsAdmin(tripId)).toBe(0);
});

test("整天交換與行程設定：Owner 交換兩天、延長與縮短日期（縮短先確認，項目移回候選清單）", async ({ page, context, baseURL }) => {
  const confirms: string[] = [];
  page.on("dialog", (d) => {
    confirms.push(d.message());
    void d.accept();
  });
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const { tripId } = await lockedTrip(owner.userId, "東京交換");

  await page.goto(`/trips/${tripId}/days?date=2026-12-01`);
  await page.getByRole("button", { name: "編輯" }).click();
  await page.getByRole("button", { name: "整天交換" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已套用" })).toBeVisible();
  expect(confirms[0]).toContain("整天交換");
  expect((await listItemsAsAdmin(tripId)).map((i) => i.scheduled_date)).toEqual(["2026-12-02", "2026-12-02", "2026-12-02"]);

  await page.goto(`/trips/${tripId}/days`);
  await page.getByRole("link", { name: "設定" }).click();
  await expect(page.getByRole("heading", { name: "行程設定" })).toBeVisible();
  await expectNoScroll(page, "行程設定");
  await expectNoOverlap(page, "行程設定");
  await capture(page, "settings");
  await page.getByLabel("行程名稱").fill("東京三日");
  await page.getByLabel("結束日期").fill("2026-12-03");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("已儲存");
  await page.goto(`/trips/${tripId}/days?date=2026-12-03`);
  await expect(page.getByText("東京三日")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "日期" }).getByRole("link")).toHaveCount(3);

  await page.goto(`/trips/${tripId}/settings`);
  await page.getByLabel("結束日期").fill("2026-12-01");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toContainText("3 個項目移回候選清單");
  expect(confirms.at(-1)).toBe("移除 2 天？排在這些日期的項目會移回候選清單。");
  expect((await listItemsAsAdmin(tripId)).every((i) => i.scheduled_date === null)).toBe(true);
});

test("版面：新增地點、編輯項目、預訂、行程設定的輸入欄與按鈕不超出畫面、不重疊", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const { tripId, ids } = await lockedTrip(owner.userId, "東京版面");
  for (const [path, name, file] of [
    [`/trips/${tripId}/items/new`, "新增地點", "add-item"],
    [`/trips/${tripId}/items/${String(ids["淺草寺"])}/edit`, "編輯項目", "edit-item"],
    [`/trips/${tripId}/bookings/new`, "新增預訂", "booking"],
    [`/trips/${tripId}/settings`, "行程設定", "settings-page"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expectNoOverlap(page, name);
    await capture(page, file);
  }
  await page.goto(`/trips/${tripId}/items/${String(ids["淺草寺"])}/edit`);
  await expectNoScroll(page, "編輯項目");
  const back = page.getByRole("button", { name: "移回候選清單" });
  const background = await back.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background, "移回候選清單有按鈕背景").not.toBe("rgba(0, 0, 0, 0)");
});
