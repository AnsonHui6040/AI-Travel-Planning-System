import { defineConfig } from "vitest/config";

export default defineConfig({
  // apps/web 的 tsconfig 為 jsx: preserve（交給 Next.js）；測試時另外以 automatic runtime 轉換 TSX
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/web/**/*.test.{ts,tsx}", "tooling/**/*.test.ts", "evals/**/*.test.ts"],
    exclude: ["**/node_modules/**", "apps/web/e2e/**", "apps/web/.next/**", "**/*.workflow.test.ts"],
    // tooling 測試會暫時寫入探測檔，避免平行執行互相干擾
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
