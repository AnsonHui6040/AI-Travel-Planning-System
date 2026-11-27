import { expect, test } from "@playwright/test";
import { signInAsNewUser } from "./support/auth";

// access token 過期（預設一小時）後再開頁面：proxy 先更新 session 並寫回 cookie，
// 頁面不可因 Server Component 不能寫 cookie 而回應 500

test("access token 過期後開啟首頁仍正常顯示", async ({ page, context, baseURL }) => {
  await signInAsNewUser(context, baseURL ?? "");

  const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
  expect(cookies.length).toBeGreaterThan(0);
  const base = (cookies[0]?.name ?? "").replace(/\.\d+$/, "");
  const ordered = cookies.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const raw = ordered.map((c) => c.value).join("");
  const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8")) as { expires_at: number };
  session.expires_at = Math.floor(Date.now() / 1000) - 60;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;

  await context.clearCookies();
  const { hostname } = new URL(baseURL ?? "");
  await context.addCookies([{ name: base, value, domain: hostname, path: "/", httpOnly: false, sameSite: "Lax" }]);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "我的行程" })).toBeVisible();

  const refreshed = (await context.cookies()).filter((c) => c.name.startsWith(base));
  const after = refreshed.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })).map((c) => c.value).join("");
  const next = JSON.parse(Buffer.from(after.replace(/^base64-/, ""), "base64url").toString("utf8")) as { expires_at: number };
  expect(next.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
});
