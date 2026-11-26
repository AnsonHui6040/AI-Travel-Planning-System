import { expect, test, type Page } from "@playwright/test";
import { createItem, createTrip, scheduleItemAsAdmin, setDayStatusAsAdmin, setTripFieldsAsAdmin, signInAsNewUser } from "./support/auth";

// 介面方向 A（docs/verification/ui-review-2026-11-27.md）：深淺色跟隨系統，實際畫面的對比與觸控尺寸。
// U-1：深色模式曾是白底配淺灰字（2.91:1）。CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

const DATE = "2026-11-20";

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/UI-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

// 瀏覽器實際算出的顏色對比
async function measure(page: Page) {
  return page.evaluate(() => {
    const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    const bg = getComputedStyle(document.body).backgroundColor;
    const texts = [...document.querySelectorAll("main p, main span, main h1, main h2, main h3, main a, main label, main dt, main dd")]
      .filter((el) => (el as HTMLElement).innerText?.trim())
      .map((el) => ratio(getComputedStyle(el).color, bg));
    const buttons = [...document.querySelectorAll("main button, .trip-nav a")].map((el) => el.getBoundingClientRect().height).filter((h) => h > 0);
    return {
      bg,
      minText: Math.min(...texts),
      minControl: buttons.length ? Math.min(...buttons) : null,
      scrollOk: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "淺色" : "深色"}：文字對比至少 4.5:1、控制項至少 44px、行程內有分頁`, async ({ page, context, baseURL }) => {
    const owner = await signInAsNewUser(context, baseURL ?? "");
    const tripId = await createTrip(owner.userId, "東京一日");
    const item = await createItem(tripId, { name_zh: "淺草寺" });
    await scheduleItemAsAdmin(tripId, item, DATE, "09:00", "10:30");
    await setTripFieldsAsAdmin(tripId, { start_date: DATE, end_date: DATE, status: "in_progress" });
    await setDayStatusAsAdmin(tripId, DATE, "day_ready");
    await page.emulateMedia({ colorScheme: scheme });

    for (const [name, url] of [
      ["today", `/trips/${tripId}/today?date=${DATE}`],
      ["timeline", `/trips/${tripId}/timeline?date=${DATE}`],
      ["memories", `/trips/${tripId}/memories`],
      ["home", "/"],
    ] as const) {
      await page.goto(url);
      const m = await measure(page);
      expect(m.bg, `${name} 背景`).toBe(scheme === "light" ? "rgb(251, 243, 232)" : "rgb(16, 9, 4)");
      expect(m.minText, `${name} 文字對比`).toBeGreaterThanOrEqual(4.5);
      if (m.minControl !== null) expect(m.minControl, `${name} 控制項高度`).toBeGreaterThanOrEqual(44);
      expect(m.scrollOk, `${name} 沒有水平捲動`).toBe(true);
      if (name !== "home") {
        const nav = page.getByRole("navigation", { name: "行程" });
        await expect(nav.getByRole("link")).toHaveText(["今天", "每日", "候選", "提案", "記憶", "旅後"]);
      }
      await capture(page, `${name}-${scheme}`);
    }
    await page.goto(`/trips/${tripId}/today?date=${DATE}`);
    await expect(page.getByRole("navigation", { name: "行程" }).getByRole("link", { name: "今天" })).toHaveAttribute("aria-current", "page");
  });
}
