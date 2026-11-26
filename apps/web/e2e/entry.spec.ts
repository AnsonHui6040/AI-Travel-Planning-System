import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signInAsNewUser } from "./support/auth";

// 進入 App：未登入的首頁導向登入；Email magic link 登入（本機信件由 Supabase 的測試信箱 Mailpit 收取）；
// 建立行程後進入 Trip Baseline；行程出現在首頁清單；登出

const MAILPIT = "http://127.0.0.1:54324";

async function magicLink(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: Array<{ ID: string }> };
    const id = search.messages[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string; HTML: string };
      const link = /https?:\/\/[^\s"'<>]+verify[^\s"'<>]+/.exec(message.Text || message.HTML)?.[0];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("沒有收到登入連結");
}

test("未登入導向登入；magic link 登入、建立行程、登出", async ({ page }) => {
  const email = `entry-${randomUUID()}@example.test`;

  await page.goto("/");
  await page.getByRole("link", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("電子郵件").fill(email);
  await page.getByRole("button", { name: "寄送登入連結" }).click();
  await expect(page.getByRole("status")).toHaveText("已寄出登入連結，請到信箱開啟");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto(await magicLink(email));
  await expect(page.getByRole("heading", { name: "我的行程" })).toBeVisible();
  await expect(page.getByText("還沒有行程。")).toBeVisible();

  const form = page.getByRole("form", { name: "建立行程" });
  await form.getByLabel("行程名稱").fill("京都週末");
  await form.getByLabel("目的地（可留空）").fill("京都");
  await form.getByRole("button", { name: "建立行程" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}\/baseline$/);

  await page.goto("/");
  const list = page.getByRole("list").filter({ hasText: "京都週末" });
  await expect(list).toContainText("基線");
  await list.getByRole("link", { name: "京都週末" }).click();
  await expect(page.getByRole("navigation", { name: "行程" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "登入" })).toBeVisible();
});

test("外部網址的 next 不會被採用", async ({ page }) => {
  await page.goto("/login?next=https://evil.example/");
  await expect(page.locator('input[name="next"]')).toHaveValue("/");
});

test("示範資料腳本：建立的行程可在各頁面檢視", async ({ page, context, baseURL }) => {
  const user = await signInAsNewUser(context, baseURL ?? "");
  const out = execFileSync("node", [path.resolve(import.meta.dirname, "../scripts/seed-demo.mjs"), user.email], { encoding: "utf8" });
  expect(out).toMatch(/已建立示範行程：\/trips\/[0-9a-f-]{36}\/today/);

  await page.goto("/");
  await page.getByRole("link", { name: "東京三日（示範）" }).click();
  await expect(page.getByRole("heading", { name: "當日行程" })).toBeVisible();
  await expect(page.locator("main")).toContainText("淺草寺");
  const nav = page.getByRole("navigation", { name: "行程" });
  await nav.getByRole("link", { name: "候選" }).click();
  await expect(page.locator("main")).toContainText("藏前咖啡廳");
  await nav.getByRole("link", { name: "提案" }).click();
  await expect(page.locator("main")).toContainText("晴空塔延後半小時");
  await nav.getByRole("link", { name: "每日" }).click();
  await expect(page.locator("main")).toContainText("東京國立博物館");
});
