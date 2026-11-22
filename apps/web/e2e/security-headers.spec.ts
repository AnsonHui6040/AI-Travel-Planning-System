import { expect, test } from "@playwright/test";

test("S-08 回應帶 CSP、HSTS 與 frame-ancestors，Next 腳本使用同一個 nonce", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") violations.push(msg.text());
  });

  const response = await page.goto("/");
  if (!response) throw new Error("首頁沒有回應");
  const headers = response.headers();

  const csp = headers["content-security-policy"] ?? "";
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toContain("max-age=");

  const scriptNonces = await page.locator("script").evaluateAll((nodes) =>
    nodes.map((n) => (n as HTMLScriptElement).nonce),
  );
  expect(scriptNonces.length).toBeGreaterThan(0);
  for (const value of scriptNonces) expect(value).toBe(nonce);

  await page.waitForLoadState("networkidle");
  expect(violations.filter((v) => /Content Security Policy/i.test(v))).toEqual([]);
});

test("每次請求的 nonce 都不同", async ({ request }) => {
  const read = async () => {
    const res = await request.get("/");
    return /'nonce-([A-Za-z0-9+/=]+)'/.exec(res.headers()["content-security-policy"] ?? "")?.[1];
  };
  const first = await read();
  const second = await read();
  expect(first).toBeTruthy();
  expect(first).not.toBe(second);
});
