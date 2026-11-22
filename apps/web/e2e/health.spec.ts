import { expect, test } from "@playwright/test";

// T04：容器健康檢查端點，不需登入、不連外部服務
test("健康檢查回應 200", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  expect(res.headers()["cache-control"]).toContain("no-store");
});
