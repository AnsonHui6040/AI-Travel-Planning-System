import { workflow } from "@workflow/vitest";
import { defineConfig } from "vitest/config";

// T05：以 @workflow/vitest 在同一個程序內執行 workflow 整合測試（Local World，不需 server）。
// 須於 repo 根目錄執行（pnpm test:workflow）：workflow ID 由測試端與 builder 各自以 repo 根目錄為基準計算，兩者必須一致。
export default defineConfig({
  plugins: [workflow({ rootDir: "apps/web" })],
  test: {
    // T24：builder 會打包所有 workflow（含使用工作區套件的 research-job），由 Node 直接載入；
    // 測試 worker 先註冊模組 hook，讓 Node 能載入 TypeScript 原始碼（說明見 tooling/workflow-test-loader.mjs）
    setupFiles: ["tooling/workflow-test-register.mjs"],
    include: ["apps/web/workflows/**/*.workflow.test.ts"],
    testTimeout: 60_000,
  },
});
