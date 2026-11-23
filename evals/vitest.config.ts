import { defineConfig } from "vitest/config";

// T15：pnpm evals:run 專用，只執行 evals/run.evals.ts（不納入 pnpm test）
export default defineConfig({
  test: {
    include: ["evals/run.evals.ts"],
    testTimeout: 600_000,
  },
});
