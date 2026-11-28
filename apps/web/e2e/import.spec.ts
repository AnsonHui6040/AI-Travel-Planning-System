import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { listItemsAsAdmin, saveApiKeyAsAdmin, signInAsNewUser } from "./support/auth";

// 決策 0010 I：行程匯入。「行程」標題列與「更多」→「匯入」；貼上與預覽是兩個畫面，每個畫面一個主要按鈕，
// 390×844 與 1280×800 不用捲動（docs/verification/ux-logic-2026-11-27.md）。AI 以錄製回應執行（E2E_AI_FIXTURE=1，playwright.config.ts）。
// 需本機 Supabase 與 apps/web/.env.local。CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

const tokyoDate = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

function seedDemo(email: string, phase: "planning" | "trip"): string {
  const out = execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../scripts/seed-demo.mjs"), email, `--phase=${phase}`], { encoding: "utf8" });
  const match = /\/trips\/([0-9a-f-]{36})\/today/.exec(out);
  if (!match?.[1]) throw new Error("示範資料沒有回傳行程");
  return match[1];
}

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: `../../docs/verification/screenshots/I-${name}-${page.viewportSize()?.width ?? 0}.png` });
}

async function expectNoScroll(page: Page, name: string) {
  const result = await page.evaluate(() => ({
    doc: { scroll: document.documentElement.scrollHeight, inner: window.innerHeight },
    overflow: [...document.querySelectorAll<HTMLElement>("main, main *")]
      // 貼上的文字比輸入欄長時在輸入欄內捲動（輸入內容，不是畫面版面）
      .filter((el) => el.tagName !== "TEXTAREA")
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

const pasted = (day1: string) => `【訂房確認】新宿華盛頓飯店
預訂者姓名：測試 旅人
Email: traveler@example.test
聯絡電話：+886 912-345-678
入住：${day1} 15:00
訂單編號：HTL-55821

【航班確認】JL802 台北桃園 → 東京成田 ${day1} 08:30
訂位代號：Q7XK2P

想去：淺草寺、晴空塔、築地場外市場、銀座壽司`;

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

test("規劃中：貼上確認信 → 預覽逐項修改、取消勾選 → 預訂與使用者新增的地點以本人 session 寫入；兩個畫面不用捲動", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(owner.email, "planning");
  await saveApiKeyAsAdmin(owner.userId, "anthropic", "test-only-import-key");
  const day1 = tokyoDate(30);
  const day2 = tokyoDate(31);

  // 「行程」標題列 →「匯入」
  await page.goto(`/trips/${tripId}/days`);
  await page.locator("main").getByRole("link", { name: "匯入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "匯入", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "整理" })).toBeDisabled();
  await page.getByLabel("貼上確認信、其他 App 匯出的行程或自己的清單").fill(pasted(day1));
  await expectNoScroll(page, "匯入：貼上");
  await expectPrimaryInThumbZone(page, "匯入：貼上");
  await capture(page, "paste");
  await page.getByRole("button", { name: "整理" }).click();

  // 預覽：兩筆預訂、四個地點；沒有時間的地點放進候選清單
  await expect(page.getByRole("heading", { name: "確認匯入", level: 1 })).toBeVisible();
  const bookings = page.getByRole("list", { name: "預訂" });
  const places = page.getByRole("list", { name: "地點" });
  await expect(bookings.getByRole("listitem")).toHaveText([/新宿華盛頓飯店/, /JL802/]);
  await expect(places.getByRole("listitem")).toHaveText([/淺草寺/, /晴空塔.*候選清單/, /築地場外市場.*候選清單/, /銀座壽司.*沒有時間/]);
  await expect(page.getByRole("button", { name: "加入 6 項" })).toBeVisible();
  await expectNoScroll(page, "匯入：預覽");
  await expectPrimaryInThumbZone(page, "匯入：預覽");
  await capture(page, "preview");

  // 取消勾選一項；修改晴空塔的日期與時間
  await page.getByRole("checkbox", { name: "加入 築地場外市場" }).uncheck();
  await expect(page.getByRole("button", { name: "加入 5 項" })).toBeVisible();
  await places.getByRole("button", { name: /晴空塔/ }).click();
  const detail = page.getByRole("region", { name: "項目詳情" });
  await expect(detail.getByRole("heading", { name: "修改地點" })).toBeVisible();
  await detail.getByLabel("日期").selectOption(day2);
  await detail.getByLabel("開始時間").fill("14:00");
  await expectNoScroll(page, "匯入：修改地點");
  await capture(page, "place");
  if (isMobile(page)) await detail.getByRole("button", { name: "完成" }).click();
  await expect(places.getByRole("listitem").nth(1)).toContainText("14:00");

  // 預訂的預約碼只在本人的預覽顯示
  await bookings.getByRole("button", { name: /新宿華盛頓飯店/ }).click();
  await expect(detail.getByLabel("預約碼")).toHaveValue("HTL-55821");
  await expect(detail.getByLabel("開始時間")).toHaveValue("15:00");
  await expectNoScroll(page, "匯入：修改預訂");
  await capture(page, "booking");
  if (isMobile(page)) await detail.getByRole("button", { name: "完成" }).click();

  await page.getByRole("button", { name: "加入 5 項" }).click();
  await expect(page.getByRole("heading", { name: "匯入完成", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已加入 2 筆預訂、3 個地點");
  await expectNoScroll(page, "匯入：完成");
  await expectPrimaryInThumbZone(page, "匯入：完成");

  // 寫入結果：地點為使用者新增、使用者確認，沒有 place_id；取消勾選的沒有加入
  const added = (await listItemsAsAdmin(tripId)).filter((i) => i.origin === "user");
  expect(added.map((i) => [i.name_zh, i.verification_status, i.place_id, i.scheduled_date ?? null, i.scheduled_start ?? null])).toEqual([
    ["淺草寺", "user_confirmed", null, day2, "09:00:00"],
    ["晴空塔", "user_confirmed", null, day2, "14:00:00"],
    ["銀座壽司", "user_confirmed", null, null, null],
  ]);

  // 預訂畫面：兩筆匯入的預訂；預約碼在詳情
  await page.getByRole("link", { name: "預訂" }).click();
  await expect(page.getByRole("list", { name: "預訂" })).toContainText("新宿華盛頓飯店");
  await expect(page.getByRole("list", { name: "預訂" })).toContainText("JL802");
});

test("行程鎖定後（決策 0011）：Owner 匯入的地點直接套用", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(owner.email, "trip");
  await saveApiKeyAsAdmin(owner.userId, "anthropic", "test-only-import-key");
  const today = tokyoDate(0);

  await page.goto(`/trips/${tripId}/more`);
  await page.getByRole("link", { name: /^匯入/ }).click();
  await page.getByLabel("貼上確認信、其他 App 匯出的行程或自己的清單").fill(pasted(today));
  await page.getByRole("button", { name: "整理" }).click();
  await expect(page.getByText("勾選要加入的項目，點項目可以修改。")).toBeVisible();
  for (const name of ["新宿華盛頓飯店", "JL802 台北桃園 → 東京成田", "晴空塔", "築地場外市場", "銀座壽司"]) {
    await page.getByRole("checkbox", { name: `加入 ${name}` }).uncheck();
  }
  await page.getByRole("button", { name: "加入 1 項" }).click();
  await expect(page.getByRole("status")).toHaveText("已加入 1 個地點");
  expect((await listItemsAsAdmin(tripId)).filter((i) => i.origin === "user").map((i) => i.name_zh)).toEqual(["淺草寺"]);
});

test("沒有 AI key 時提示到設定；沒有辨識到內容或無法辨識時清楚說明", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(owner.email, "planning");
  const box = page.getByLabel("貼上確認信、其他 App 匯出的行程或自己的清單");

  await page.goto(`/trips/${tripId}/import`);
  await box.fill(pasted(tokyoDate(30)));
  await page.getByRole("button", { name: "整理" }).click();
  await expect(page.getByRole("status")).toContainText("尚未設定 Claude 的 API key");
  await expect(page.getByRole("status").getByRole("link", { name: "API key" })).toHaveAttribute("href", "/settings/api-keys");
  await expectNoScroll(page, "匯入：沒有 key");
  await capture(page, "no-key");

  await saveApiKeyAsAdmin(owner.userId, "anthropic", "test-only-import-key");
  await box.fill("E2E-空白 今天天氣很好");
  await page.getByRole("button", { name: "整理" }).click();
  await expect(page.getByRole("status")).toHaveText("沒有辨識到預訂或地點。請貼上確認信、行程或地點清單的文字。");

  await box.fill("E2E-無法辨識 一些文字");
  await page.getByRole("button", { name: "整理" }).click();
  await expect(page.getByRole("status")).toHaveText("無法辨識貼上的內容，請確認是預訂確認信或行程的文字後再試一次。");
  await expect(page.getByRole("heading", { name: "匯入", level: 1 })).toBeVisible();
});
