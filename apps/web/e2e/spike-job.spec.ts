import { expect, test } from "@playwright/test";

// T05：示範 job 端點預設關閉
test("未設定 ENABLE_SPIKE_JOBS 時，示範 job 端點回應 404", async ({ request, baseURL }) => {
  const res = await request.post("/api/jobs/spike", { headers: { origin: baseURL ?? "" } });
  expect(res.status()).toBe(404);
});
