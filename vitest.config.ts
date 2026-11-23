import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/web/**/*.test.{ts,tsx}", "tooling/**/*.test.ts", "evals/**/*.test.ts"],
    exclude: ["**/node_modules/**", "apps/web/e2e/**", "apps/web/.next/**", "**/*.workflow.test.ts"],
    // tooling 測試會暫時寫入探測檔，避免平行執行互相干擾
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
