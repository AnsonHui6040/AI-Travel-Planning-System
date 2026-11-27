import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createItem, signInAsNewUser } from "./support/auth";

// 使用者邏輯重排（docs/verification/ux-logic-2026-11-27.md 第 7 節）：以示範資料（pnpm --filter @atps/web demo:seed）量測
// 一個畫面一件事不用捲動、主要按鈕在拇指區、底部固定四個分頁、返回時保留捲動位置與篩選。
// 需本機 Supabase 與 apps/web/.env.local。CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

type Phase = "trip" | "planning" | "post";

// 示範行程的第一天是今天（東京）
const tokyoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function seedDemo(email: string, phase: Phase): string {
  const out = execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../scripts/seed-demo.mjs"), email, `--phase=${phase}`], { encoding: "utf8" });
  const match = /\/trips\/([0-9a-f-]{36})\/today/.exec(out);
  if (!match?.[1]) throw new Error("示範資料沒有回傳行程");
  return match[1];
}

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: `../../docs/verification/screenshots/UX-${name}-${page.viewportSize()?.width ?? 0}.png` });
}

// 文件與畫面內每個區塊都不需要捲動
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
  expect(result.doc.scroll, `${name}：文件高度`).toBeLessThanOrEqual(result.doc.inner);
  expect(result.overflow, `${name}：區塊內沒有被截掉的內容`).toEqual([]);
}

// 手機上主要按鈕的頂端在畫面高度 2/3 以下，且只有一個
async function expectPrimaryInThumbZone(page: Page, name: string) {
  const primary = page.locator("main .primary:visible");
  await expect(primary, `${name}：一個主要按鈕`).toHaveCount(1);
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 1024) return;
  const box = await primary.boundingBox();
  expect(box?.y ?? 0, `${name}：主要按鈕位置`).toBeGreaterThanOrEqual((viewport.height * 2) / 3);
}

async function expectTabBar(page: Page) {
  const nav = page.getByRole("navigation", { name: "行程" });
  await expect(nav.getByRole("link")).toHaveText([/現在/, /行程/, /提案/, /更多/]);
  const placement = await nav.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { position: getComputedStyle(el).position, top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
  });
  expect(placement.position).toBe("fixed");
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) {
    expect(Math.round(placement.bottom)).toBe(viewport.height);
    expect(placement.width).toBe(viewport.width);
  } else {
    expect(placement.left).toBe(0);
    expect(Math.round(placement.height)).toBe(viewport?.height);
  }
}

test("旅行中的「現在」：下一站、Morning Check 摘要、今天時間軸與出狀況，不用捲動", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(user.email, "trip");
  // 在淺草寺（09:00–10:30），下一站晴空塔 11:00；沒有交通估算時以 30 分鐘計算
  await page.clock.setFixedTime(new Date(`${tokyoToday()}T09:48:00+09:00`));
  await page.goto(`/trips/${tripId}/today`);
  await expect(page.getByRole("heading", { name: "東京三日（示範）", level: 1 })).toBeVisible();
  const next = page.getByRole("region", { name: "下一站" });
  await expect(next).toContainText("11:00晴空塔");
  await expect(next).toContainText("最遲 10:30 離開還有 42 分鐘");
  await expect(next.getByText("離開前檢查")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Morning Check/ })).toHaveAttribute("href", new RegExp(`/trips/${tripId}/today/check`));
  const timeline = page.getByRole("list", { name: "今天" });
  await expect(timeline.getByRole("listitem")).toHaveCount(4);
  await expect(timeline).toContainText("晚餐（已付款）");
  await expect(page.getByRole("link", { name: "出狀況" })).toBeVisible();
  await expect(page.getByRole("link", { name: "開始導航" })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
  await expect(page.locator("[data-offline-ready]")).toHaveAttribute("data-offline-ready", "yes");
  await expectTabBar(page);
  await expectNoScroll(page, "現在（旅行中）");
  await expectPrimaryInThumbZone(page, "現在（旅行中）");
  await capture(page, "now-trip");

  // 完整的 Morning Check 另開畫面
  await page.getByRole("link", { name: /^Morning Check/ }).click();
  await expect(page.getByRole("heading", { name: "Morning Check", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "執行 Morning Check" })).toBeVisible();
});

test("規劃中的「現在」：步驟列與目前步驟的主要按鈕，不用捲動", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(user.email, "planning");
  await page.goto(`/trips/${tripId}/today`);
  const steps = page.getByRole("list", { name: "規劃步驟" });
  await expect(steps.getByRole("listitem")).toHaveText([/基線/, /研究/, /候選/, /每日/, /批准/]);
  await expect(steps.locator('[aria-current="step"]')).toHaveText(/候選/);
  await expect(page.getByRole("region", { name: "第 3 步：選擇候選" })).toContainText("9 個候選，1 個未核實");
  await expect(page.locator("main .primary")).toHaveText("檢視候選");
  await expectTabBar(page);
  await expectNoScroll(page, "現在（規劃中）");
  await expectPrimaryInThumbZone(page, "現在（規劃中）");
  await capture(page, "now-planning");
});

test("旅後的「現在」：一次標記一個項目，不用捲動", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(user.email, "post");
  await page.goto(`/trips/${tripId}/today`);
  const form = page.getByRole("form", { name: "旅後狀態 淺草寺" });
  await expect(form).toBeVisible();
  await expect(page.getByText("第 1 / 6 項")).toBeVisible();
  await expect(form.getByRole("radio")).toHaveCount(3);
  await expectTabBar(page);
  await expectNoScroll(page, "現在（旅後）");
  await expectPrimaryInThumbZone(page, "現在（旅後）");
  await capture(page, "now-post");

  await form.getByRole("radio", { name: "想再去" }).check();
  await form.getByRole("button", { name: "儲存，下一項" }).click();
  await expect(page.getByRole("form", { name: "旅後狀態 晴空塔" })).toBeVisible();
  await expect(page.getByText("第 2 / 6 項")).toBeVisible();
});

test("提案清單與詳情分開；詳情含影響範圍與批准，不用捲動", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(user.email, "trip");
  await page.goto(`/trips/${tripId}/today`);
  const nav = page.getByRole("navigation", { name: "行程" });
  await expect(nav.getByRole("link", { name: /提案/ })).toContainText("1");
  await nav.getByRole("link", { name: /提案/ }).click();
  await page.getByRole("link", { name: /晴空塔延後半小時，避開排隊/ }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/proposals/[0-9a-f-]{36}`));
  const impact = page.getByRole("region", { name: "影響範圍" });
  await expect(impact).toContainText("晴空塔");
  await expect(impact).toContainText("11:30–13:00");
  await expect(page.locator("main .primary")).toHaveText("批准");
  await expect(page.getByRole("button", { name: "否決" })).toBeVisible();
  await expectNoScroll(page, "提案詳情");
  await expectPrimaryInThumbZone(page, "提案詳情");
  await capture(page, "proposal-detail");
});

test("候選清單每項一行、篩選；詳情另開，含八項評分，不用捲動", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(user.email, "trip");
  await page.goto(`/trips/${tripId}/more`);
  await page.getByRole("link", { name: "候選" }).click();
  const filters = page.getByRole("navigation", { name: "篩選" });
  await expect(filters.getByRole("link")).toHaveText(["全部", "未核實", "已核實", "Backup"]);
  const list = page.getByRole("list", { name: "候選" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await filters.getByRole("link", { name: "Backup" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await list.getByRole("link", { name: /藏前咖啡廳/ }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/candidates/[0-9a-f-]{36}\\?filter=backup$`));
  const detail = page.getByRole("article", { name: "藏前咖啡廳" });
  await expect(detail.locator("dl.scores dt")).toHaveCount(8);
  await expect(detail).toContainText("Backup");
  await expectNoScroll(page, "候選詳情");
  await capture(page, "candidate-detail");
});

test("從詳情返回清單時保留捲動位置與篩選", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(user.email, "trip");
  for (let i = 1; i <= 24; i++) await createItem(tripId, { name_zh: `候選地點 ${String(i).padStart(2, "0")}` });
  await page.goto(`/trips/${tripId}/candidates?filter=unverified`);
  const scroller = page.locator("[data-scroll-key]");
  await scroller.evaluate((el) => el.scrollTo(0, 600));
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  // 點擊前先讓目標完全顯示（Playwright 點擊時會自動捲動），再記下位置
  const target = page.getByRole("list", { name: "候選" }).getByRole("link", { name: /候選地點 20/ });
  await target.scrollIntoViewIfNeeded();
  const before = await scroller.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(500);
  await target.click();
  await expect(page.getByRole("article", { name: "候選地點 20" })).toBeVisible();

  // 畫面上的返回（手機）或瀏覽器的上一頁
  const back = page.getByRole("link", { name: "返回候選清單" });
  if (await back.isVisible()) await back.click();
  else await page.goBack();
  await expect(page).toHaveURL(/\/candidates\?filter=unverified$/);
  await expect(page.getByRole("navigation", { name: "篩選" }).getByRole("link", { name: "未核實" })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.locator("[data-scroll-key]").evaluate((el) => el.scrollTop)).toBe(before);

  // 瀏覽器的上一頁也一樣
  await page.getByRole("list", { name: "候選" }).getByRole("link", { name: /候選地點 20/ }).click();
  await expect(page.getByRole("article", { name: "候選地點 20" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/candidates\?filter=unverified$/);
  await expect.poll(() => page.locator("[data-scroll-key]").evaluate((el) => el.scrollTop)).toBe(before);
});

test("「更多」列出其餘頁面，每個頁面由分頁兩次點擊內可到", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const tripId = seedDemo(user.email, "trip");
  await page.goto(`/trips/${tripId}/today`);
  await page.getByRole("navigation", { name: "行程" }).getByRole("link", { name: "更多" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/more$`));
  const hrefs = await page.locator("main a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  for (const target of [
    `/trips/${tripId}/baseline`,
    `/trips/${tripId}/candidates`,
    `/trips/${tripId}/members`,
    `/trips/${tripId}/my-info`,
    `/trips/${tripId}/memories`,
    `/trips/${tripId}/timeline`,
    `/trips/${tripId}/post-trip`,
    `/trips/${tripId}/incident`,
    `/trips/${tripId}/today/check`,
    "/settings/ai",
    "/settings/api-keys",
    "/settings/memories",
    "/",
  ]) {
    expect(hrefs, target).toContain(target);
  }
  await expectTabBar(page);
  await expect(page.getByRole("navigation", { name: "行程" }).getByRole("link", { name: "更多" })).toHaveAttribute("aria-current", "page");

  // 行程分頁：日期切換，每項一行，點進去才看詳情
  await page.getByRole("navigation", { name: "行程" }).getByRole("link", { name: "行程" }).click();
  await expect(page.getByRole("navigation", { name: "日期" }).getByRole("link")).toHaveCount(3);
  const day = page.getByRole("list", { name: "項目" });
  await expect(day.getByRole("listitem")).toHaveCount(4);
  await day.getByRole("link", { name: /晴空塔/ }).click();
  await expect(page.getByRole("heading", { name: "晴空塔", level: 1 })).toBeVisible();
  await expectNoScroll(page, "項目詳情");
});
