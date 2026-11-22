import { workflow } from "@workflow/vitest";
import { defineConfig } from "vitest/config";

// T05：以 @workflow/vitest 在同一個程序內執行 workflow 整合測試（Local World，不需 server）。
// 須於 repo 根目錄執行（pnpm test:workflow）：workflow ID 由測試端與 builder 各自以 repo 根目錄為基準計算，兩者必須一致。
export default defineConfig({
  plugins: [workflow({ rootDir: "apps/web" })],
  test: {
    include: ["apps/web/workflows/**/*.workflow.test.ts"],
    testTimeout: 60_000,
  },
});
