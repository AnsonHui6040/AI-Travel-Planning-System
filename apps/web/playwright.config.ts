import { defineConfig, devices } from "@playwright/test";

// 平行的 worktree 可用 E2E_PORT 改用其他連接埠，避免共用同一個已啟動的伺服器
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    // 決策 0010：Places 搜尋與匯入的 AI 以合成、錄製回應執行（E2E 不連 Google 與 AI 供應商）
    command: `pnpm build && E2E_PLACES_FIXTURE=1 E2E_AI_FIXTURE=1 pnpm start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
