import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 介面方向 A（docs/verification/ui-review-2026-11-27.md）：
// 1. 淺色與深色的文字對比都至少 4.5:1（審查問題 U-1：深色模式曾只有 2.91:1）
// 2. 頁面 CSS 不再寫死顏色，只用 globals.css 的變數（U-2、U-3）

const root = path.resolve(import.meta.dirname, "..");
const globals = readFileSync(path.join(root, "apps/web/app/globals.css"), "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)) out[m[1] as string] = (m[2] as string).toLowerCase();
  return out;
}

const darkStart = globals.indexOf("@media (prefers-color-scheme: dark)");
const light = tokens(globals.slice(0, darkStart));
const dark = { ...light, ...tokens(globals.slice(darkStart)) };

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe.each([
  ["淺色", light],
  ["深色", dark],
])("%s的對比", (_name, t) => {
  it.each([
    ["text", "bg"],
    ["text", "surface"],
    ["muted", "bg"],
    ["muted", "surface"],
    ["accent", "bg"],
    ["accent", "surface"],
    ["on-solid", "solid"],
  ])("%s 對 %s 至少 4.5:1", (fg, bg) => {
    expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });

  it("控制項邊框對底色至少 3:1（WCAG 1.4.11）", () => {
    expect(contrast(t["line-strong"] as string, t.bg as string)).toBeGreaterThanOrEqual(3);
  });
});

describe("頁面 CSS", () => {
  const files = globSync("apps/web/{app,components}/**/*.css", { cwd: root }).filter((f) => !f.endsWith("globals.css"));

  it("至少有一個頁面 CSS", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s 不寫死顏色，也不自行處理深色模式", (file) => {
    const css = readFileSync(path.join(root, file), "utf8");
    expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual([]);
    expect(css).not.toContain("prefers-color-scheme");
  });
});
