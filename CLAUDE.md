# AI 旅行規劃系統：專案守則

計畫與規則的唯一依據是 `docs/implementation-plan.md`。本檔與計畫衝突時以計畫為準。

## 指令

| 用途 | 指令 |
|---|---|
| 安裝 | `pnpm install` |
| 單元與工具測試 | `pnpm test` |
| 型別檢查 | `pnpm typecheck` |
| Lint 與依賴方向 | `pnpm lint`（含 `pnpm depcruise`） |
| Build | `pnpm build` |
| E2E（390 與 1280） | `pnpm test:e2e`，首次執行前 `pnpm --filter @atps/web exec playwright install chromium` |

## 結構與依賴

- 目錄依計畫第 2.1 節；套件名稱為 `@atps/<目錄名>`。
- 依賴表只在 `tooling/package-graph.cjs` 修改，改完執行 `pnpm sync:manifests`。dependency-cruiser 規則由同一份表產生。
- 每個套件只經 `src/index.ts` 對外公開（`exports` 只開放 `.`）。`apps/web` 不得 import 套件內部檔案（M-02）。
- `packages/core` 不得 import 任何外部套件或 Node 內建模組；`packages/schemas` 只可 import zod（M-01）。

## 工作流程

- 一個 Task 一個 worktree、一條 branch、一個 Draft PR；PR 由使用者 merge。
- 先寫失敗測試，再實作。完成定義見計畫第 8.1 節。
- 證據寫入 `docs/verification/<Task 編號>.md`；新增或修改規則時更新 `docs/verification/traceability.md`。
- 完成一個 Task 即停止回報。

## 套件安裝

- `.npmrc` 設 `save-exact=true`，依賴版本固定（S-11）。
- `pnpm-workspace.yaml` 設 `strictDepBuilds: true`；需要執行安裝腳本的套件須明列於 `onlyBuiltDependencies`。
- TypeScript 固定 6.0.x：typescript-eslint 8.73 只支援 `<6.1.0`。

## 機密

- `.env` 與 `.env.*` 不納入版本控制，只提交 `.env.example`（S-12）。
- AI 與外部 API key 由使用者在設定頁輸入並存入 Vault，不放環境變數（C-02、D15）。
