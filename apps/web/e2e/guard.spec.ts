import { expect, test } from "@playwright/test";

// C-11：需本機 Supabase（supabase start）與 apps/web/.env.local
test("未登入的請求被拒，回應 401", async ({ request, baseURL }) => {
  const res = await request.get("/api/me", { headers: { origin: baseURL ?? "" } });
  expect(res.status()).toBe(401);
});

test("Origin 不符的請求被拒，回應 403", async ({ request }) => {
  const res = await request.get("/api/me", { headers: { origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
});
