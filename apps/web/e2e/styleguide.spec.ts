import { expect, test, type Page } from "@playwright/test";

// 元件樣板頁（/styleguide）：靜態、不需登入；淺色與深色並排，各面板內文字對比至少 4.5:1、控制項觸控範圍至少 44px。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.screenshot({ path: `../../docs/verification/screenshots/UI-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

test("元件樣板頁：四種按鈕、確認、輸入欄、分頁與標示；兩種主題的對比與尺寸", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") requests.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/styleguide");
  await expect(page.getByRole("heading", { name: "元件樣板", level: 1 })).toBeVisible();

  for (const title of ["淺色", "深色"]) {
    const panel = page.getByRole("region", { name: title });
    for (const variant of ["primary", "secondary", "ghost", "danger"]) {
      await expect(panel.locator(`table button.${variant}`)).toHaveCount(3);
    }
    await expect(panel.locator("table button:disabled")).toHaveCount(8);
    await expect(panel.getByRole("navigation", { name: /行程分頁/ }).getByRole("link")).toHaveCount(4);
    await expect(panel.getByRole("group", { name: /確認範例/ })).toContainText("無法復原");
  }

  const result = await page.evaluate(() => {
    const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    return [...document.querySelectorAll<HTMLElement>(".sg-panel")].map((panel) => {
      const bg = getComputedStyle(panel).backgroundColor;
      // 不含停用按鈕（WCAG 不要求停用元件的對比）與按鈕內文字（填色另由 ui-tokens.test.ts 檢查）
      const texts = [...panel.querySelectorAll<HTMLElement>("p, span, dt, dd, th, label, h2, h3, a, strong")]
        .filter((el) => el.innerText.trim() && !el.closest("button") && !el.closest(".sg-tag"))
        .map((el) => {
          // 以最近一層有不透明背景的祖先為底（例如目前分頁的實心底）
          let node: HTMLElement | null = el;
          let under = bg;
          while (node && node !== panel) {
            const c = getComputedStyle(node).backgroundColor;
            if (c !== "rgba(0, 0, 0, 0)" && !c.startsWith("color(") && !/,\s*0\.\d+\)$/.test(c)) {
              under = c;
              break;
            }
            node = node.parentElement;
          }
          return ratio(getComputedStyle(el).color, under);
        });
      const hit = (el: Element) => { const r = el.getBoundingClientRect().height; const a = getComputedStyle(el, "::after"); return a.position === "absolute" ? r + Math.max(0, -parseFloat(a.top)) + Math.max(0, -parseFloat(a.bottom)) : r; };
      const controls = [...panel.querySelectorAll("button, .tabbar a, .chips a, .rows a, .choices label")].map(hit);
      const fields = [...panel.querySelectorAll("input:not([type=checkbox]):not([type=radio]), select")].map((el) => el.getBoundingClientRect().height);
      return { theme: panel.dataset.theme, bg, minText: Math.min(...texts), minControl: Math.min(...controls), minField: Math.min(...fields) };
    });
  });
  expect(result.map((r) => [r.theme, r.bg])).toEqual([
    ["light", "rgb(251, 243, 232)"],
    ["dark", "rgb(16, 9, 4)"],
  ]);
  for (const r of result) {
    expect(r.minText, `${r.theme} 文字對比`).toBeGreaterThanOrEqual(4.5);
    expect(r.minControl, `${r.theme} 控制項觸控範圍`).toBeGreaterThanOrEqual(44);
    expect(r.minField, `${r.theme} 輸入欄高度`).toBeGreaterThanOrEqual(36);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests).toEqual([]);
  await capture(page, "styleguide");
});
