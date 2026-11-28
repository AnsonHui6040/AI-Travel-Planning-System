import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addMemberAsAdmin, createUserAsAdmin, setDisplayName, signInAsNewUser } from "./support/auth";

// 決策 0010 B：預訂與清單。「更多」→「預訂」「清單」，「行程」也可到預訂；清單每項一行、詳情另開，
// 每個畫面在 390×844 與 1280×800 不用捲動，手機上主要按鈕在下方三分之一（docs/verification/ux-logic-2026-11-27.md）。
// 當天的預訂在「行程」與「現在」顯示為固定活動；預約碼只有成員看得到，不出現在唯讀連結；清單離線可讀（當日包）。
// 需本機 Supabase 與 apps/web/.env.local。CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

const tokyoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function seedDemo(email: string): string {
  const out = execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../scripts/seed-demo.mjs"), email, "--phase=trip"], { encoding: "utf8" });
  const match = /\/trips\/([0-9a-f-]{36})\/today/.exec(out);
  if (!match?.[1]) throw new Error("示範資料沒有回傳行程");
  return match[1];
}

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: `../../docs/verification/screenshots/B-${name}-${page.viewportSize()?.width ?? 0}.png` });
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

test("Owner 新增、修改、刪除預訂；行程與現在顯示為固定活動；預約碼不出現在唯讀連結；每個畫面不用捲動", async ({ page, context, browser, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(owner.email);
  const today = tokyoToday();

  // 「更多」→「預訂」：示範資料的住宿、晚餐、回程航班
  await page.goto(`/trips/${tripId}/more`);
  await page.getByRole("link", { name: /^預訂/ }).click();
  await expect(page.getByRole("heading", { name: "預訂", level: 1 })).toBeVisible();
  const list = page.getByRole("list", { name: "預訂" });
  await expect(list.getByRole("listitem")).toHaveText([/新宿華盛頓飯店住宿/, /築地早餐餐廳/, /銀座壽司晚餐餐廳/, /回程 BR197航班/]);
  await expect(page.getByRole("navigation", { name: "行程" }).getByRole("link", { name: "行程" })).toHaveAttribute("aria-current", "page");
  await expectNoScroll(page, "預訂清單");
  await expectPrimaryInThumbZone(page, "預訂清單");
  await capture(page, "list");

  // 新增：今天 16:00–17:00 的票券
  await page.getByRole("link", { name: "新增預訂" }).click();
  await expect(page.getByRole("heading", { name: "新增預訂", level: 1 })).toBeVisible();
  await page.getByLabel("類型").selectOption("ticket");
  await page.getByLabel("標題").fill("teamLab 門票");
  await page.getByLabel("開始日期").fill(today);
  await page.getByLabel("開始時間").fill("16:00");
  await page.getByLabel("結束時間").fill("15:00");
  await page.getByLabel("地點").fill("豐洲");
  await page.getByLabel("預約碼").fill("TLB-7781");
  await expectNoScroll(page, "新增預訂");
  await expectPrimaryInThumbZone(page, "新增預訂");
  await capture(page, "new");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("結束不可早於開始");
  await page.getByLabel("結束時間").fill("17:00");
  await page.getByRole("button", { name: "儲存" }).click();

  // 詳情：預約碼只在這裡顯示
  await expect(page.getByRole("heading", { name: "teamLab 門票", level: 1 })).toBeVisible();
  const detail = page.getByRole("region", { name: "預訂詳情" });
  await expect(detail).toContainText("16:00–17:00");
  await expect(detail).toContainText("TLB-7781");
  await expect(detail).toContainText("豐洲");
  await expectNoScroll(page, "預訂詳情");
  await capture(page, "detail");

  // 修改
  await page.getByRole("link", { name: "修改" }).click();
  await expect(page.getByRole("heading", { name: "修改預訂", level: 1 })).toBeVisible();
  await expect(page.getByLabel("預約碼")).toHaveValue("TLB-7781");
  await page.getByLabel("結束時間").fill("17:30");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("region", { name: "預訂詳情" })).toContainText("16:00–17:30");

  // 「行程」：當天的預訂是固定活動，也可由行程到預訂
  await page.getByRole("navigation", { name: "行程" }).getByRole("link", { name: "行程" }).click();
  const day = page.getByRole("list", { name: "項目" });
  await expect(day).toContainText("teamLab 門票");
  await expect(day.getByRole("listitem")).toHaveCount(5);
  await expectNoScroll(page, "行程（含預訂）");
  await page.locator("main").getByRole("link", { name: "預訂", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/bookings$`));

  // 「現在」：今天的時間軸含預訂；當日包含預訂（含預約碼）與清單，離線可讀
  await page.clock.setFixedTime(new Date(`${today}T09:48:00+09:00`));
  await page.goto(`/trips/${tripId}/today`);
  const timeline = page.getByRole("list", { name: "今天" });
  await expect(timeline).toContainText("teamLab 門票");
  await expect(page.locator("[data-offline-ready]")).toHaveAttribute("data-offline-ready", "yes");
  await expectNoScroll(page, "現在（含預訂）");
  const pack = await page.evaluate(
    (id) =>
      new Promise<{ bookings: Array<{ title: string; confirmationCode: string | null }>; lists: Array<{ title: string; items: Array<{ text: string }> }> }>((resolve, reject) => {
        const request = indexedDB.open("atps-offline", 1);
        request.onerror = () => reject(new Error("無法開啟"));
        request.onsuccess = () => {
          const get = request.result.transaction("packs", "readonly").objectStore("packs").get(id);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(new Error("讀取失敗"));
        };
      }),
    tripId,
  );
  expect(pack.bookings.map((b) => `${b.title} ${b.confirmationCode ?? ""}`)).toEqual(["新宿華盛頓飯店 HTL-58213", "teamLab 門票 TLB-7781"]);
  expect(pack.lists.map((l) => `${l.title}：${l.items.map((i) => i.text).join("、")}`)).toEqual(["打包：護照、行動電源、Suica 卡、雨傘"]);

  // 唯讀連結不含預約碼
  await page.goto(`/trips/${tripId}/members`);
  const section = page.getByRole("region", { name: "唯讀連結" });
  await section.getByRole("button", { name: "建立唯讀連結（7 天）" }).click();
  const link = await section.getByRole("textbox", { name: "唯讀連結" }).inputValue();
  const anonymous = await browser.newContext();
  const readonly = await anonymous.newPage();
  await readonly.goto(`${baseURL ?? ""}${new URL(link).pathname}`);
  await expect(readonly.getByText("淺草寺").first()).toBeVisible();
  const text = await readonly.locator("body").innerText();
  for (const code of ["TLB-7781", "HTL-58213", "SUSHI-0412", "6QK2ZP"]) expect(text).not.toContain(code);
  await anonymous.close();

  // 刪除先確認
  await page.goto(`/trips/${tripId}/bookings`);
  await page.getByRole("list", { name: "預訂" }).getByRole("link", { name: /teamLab 門票/ }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "刪除" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/bookings$`));
  await expect(page.getByRole("list", { name: "預訂" })).not.toContainText("teamLab 門票");
});

test("清單：勾選、指定成員、新增與刪除項目、新增清單；不用捲動", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  await setDisplayName(owner.userId, "小安");
  const tripId = seedDemo(owner.email);

  await page.goto(`/trips/${tripId}/more`);
  await page.getByRole("link", { name: /^清單/ }).click();
  await expect(page.getByRole("heading", { name: "清單", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "清單" }).getByRole("listitem")).toHaveText([/打包.*1\/4 完成/]);
  await expectNoScroll(page, "清單");
  await expectPrimaryInThumbZone(page, "清單");
  await capture(page, "lists");

  await page.getByRole("list", { name: "清單" }).getByRole("link", { name: /打包/ }).click();
  await expect(page.getByRole("heading", { name: "打包", level: 1 })).toBeVisible();
  const items = page.getByRole("list", { name: "打包 的項目" });
  // 未完成的在前面
  await expect(items.getByRole("listitem")).toHaveText([/護照/, /行動電源/, /Suica 卡/, /雨傘/]);
  await expect(items.getByLabel("護照 的負責成員")).toHaveValue(owner.userId);
  await expectNoScroll(page, "清單內容");
  await expectPrimaryInThumbZone(page, "清單內容");
  await capture(page, "list-detail");

  await items.getByRole("checkbox", { name: "護照" }).check();
  await expect(page.locator("main header")).toContainText("2/4 完成");
  await expect(items.getByRole("listitem")).toHaveText([/行動電源/, /Suica 卡/, /護照/, /雨傘/]);
  await items.getByLabel("行動電源 的負責成員").selectOption(owner.userId);
  await expect(items.getByLabel("行動電源 的負責成員")).toHaveValue(owner.userId);

  await page.getByRole("form", { name: "新增項目" }).getByLabel("項目").fill("轉接頭");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(items.getByRole("listitem")).toHaveCount(5);
  page.once("dialog", (dialog) => void dialog.accept());
  await items.getByRole("button", { name: "刪除 轉接頭" }).click();
  await expect(items.getByRole("listitem")).toHaveCount(4);

  // 新增另一份清單
  await page.goto(`/trips/${tripId}/lists`);
  await page.getByLabel("類型").selectOption("todo");
  await page.getByLabel("名稱").fill("出發前");
  await page.getByRole("button", { name: "新增清單" }).click();
  await expect(page.getByRole("heading", { name: "出發前", level: 1 })).toBeVisible();
  await expect(page.getByText("還沒有項目。")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "刪除清單" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/lists$`));
  await expect(page.getByRole("list", { name: "清單" }).getByRole("listitem")).toHaveCount(1);
});

test("Viewer 可看預訂（含預約碼）與清單但不能修改；非成員看不到", async ({ page, context, browser, baseURL }) => {
  const viewer = await signInAsNewUser(context, baseURL ?? "");
  const owner = await createUserAsAdmin();
  const tripId = seedDemo(owner.email);
  await addMemberAsAdmin(tripId, viewer.userId, "viewer");

  await page.goto(`/trips/${tripId}/bookings`);
  await expect(page.getByRole("list", { name: "預訂" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "新增預訂" })).toHaveCount(0);
  await expect(page.getByText("只有 Owner 與 Companion 可以修改；你可以檢視。")).toBeVisible();
  await page.getByRole("link", { name: /銀座壽司晚餐/ }).click();
  await expect(page.getByRole("region", { name: "預訂詳情" })).toContainText("SUSHI-0412");
  await expect(page.getByRole("link", { name: "修改" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刪除" })).toHaveCount(0);
  await expectNoScroll(page, "預訂詳情（Viewer）");

  await page.goto(`/trips/${tripId}/lists`);
  await page.getByRole("list", { name: "清單" }).getByRole("link", { name: /打包/ }).click();
  await expect(page.getByRole("checkbox", { name: "護照" })).toBeDisabled();
  await expect(page.getByRole("form", { name: "新增項目" })).toHaveCount(0);

  const stranger = await browser.newContext();
  await signInAsNewUser(stranger, baseURL ?? "");
  const other = await stranger.newPage();
  await other.goto(`/trips/${tripId}/bookings`);
  await expect(other.getByText("找不到這個行程，或你不是成員。")).toBeVisible();
  await expect(other.locator("body")).not.toContainText("SUSHI-0412");
  await stranger.close();
});
