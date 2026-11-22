import { expect, test } from "@playwright/test";

test("首頁以台灣繁體中文載入，沒有水平捲動", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("旅行規劃");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant-TW");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
