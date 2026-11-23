# 規則追蹤表

計畫第 9.2 節：第 2 至 7 節每個規則編號對應至少一個自動測試或真機項目。「未驗收」表示尚未有對應測試。

| 狀態 | 意義 |
|---|---|
| 已驗收 | 有自動測試或真機 PASS |
| 部分 | 規則中部分條件已有測試或設定 |
| 未驗收 | 尚未有對應測試 |

## 第 2 節 依賴規則

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| M-01 | T01 | `tooling/dependency-rules.test.ts`：M-01 兩個案例 | 已驗收 |
| M-02 | T01 | `tooling/dependency-rules.test.ts`：M-02 案例 | 已驗收 |
| M-03 | T01、T02 | `pnpm lint` 執行 depcruise；CI job「test、typecheck、lint、build、依賴方向」執行 depcruise（PR #2） | 已驗收 |
| M-04 | T06、T09 | T06：`packages/core/src/ports.ts`、`packages/db/src/repositories.test.ts`；T09：`applyChange` 只經 `ChangeWriter` port 寫入（`packages/core/src/apply-change.test.ts`、`packages/db/src/change-writer.test.ts`） | 已驗收 |
| M-05 | T01 | `tooling/dependency-rules.test.ts`：M-05 五個案例與全庫檢查 | 已驗收 |

## 第 3 節 連接安全

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| C-01 | T13、T19 | 待建立 | 未驗收 |
| C-02 | T12 | 待建立 | 未驗收 |
| C-03 | T13、T19、T22 | 待建立 | 未驗收 |
| C-04 | T12 | 待建立 | 未驗收 |
| C-05 | T12 | 待建立 | 未驗收 |
| C-06 | T12 | 待建立 | 未驗收 |
| C-07 | T13 | 待建立 | 未驗收 |
| C-08 | T14、T38 | 待建立 | 未驗收 |
| C-09 | T03 | `supabase/tests/01_rls_enabled.test.sql`、`02_trip_permissions.test.sql`（anon 無權限）；伺服器端只用 anon key | 部分 |
| C-10 | T33 | 待建立 | 未驗收 |
| C-11 | T03 | `apps/web/lib/server/guard.test.ts`；`supabase/tests/03_rate_limit.test.sql`；`apps/web/e2e/guard.spec.ts` | 已驗收 |
| C-12 | T05、T12、T31 | T05：`apps/web/workflows/spike-long-job.workflow.test.ts` 確認 job 輸入與結果帶發起人編號；解密限制於 T12 | 部分 |

## 第 4 節 程式安全

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| S-01 | T09、T18 | T09：`packages/schemas/src/change.test.ts`（提案 schema）、`supabase/tests/05_apply_change.test.sql`（只有 `atps_change_writer` 可寫入正式行程表）；T18 待建立 | 部分 |
| S-02 | T06、T14 | T06：`packages/schemas/src/schemas.test.ts`（拒絕未知欄位、格式與上下限）；丟棄與記錄於 T14 | 部分 |
| S-03 | T18、T24 | 待建立 | 未驗收 |
| S-04 | T14 | 待建立 | 未驗收 |
| S-05 | T16 | 待建立 | 未驗收 |
| S-06 | T14 | 待建立 | 未驗收 |
| S-07 | T17 | 待建立 | 未驗收 |
| S-08 | T01、T24 | T01：ESLint 禁止 `dangerouslySetInnerHTML`；`apps/web/lib/security-headers.test.ts`（CSP、nonce、HSTS）；`apps/web/e2e/security-headers.spec.ts`（實際回應標頭、腳本 nonce、無 CSP 違規）。T24：Markdown sanitize 與連結限制待建立 | 部分 |
| S-09 | T21 | 待建立 | 未驗收 |
| S-10 | T17 | 待建立 | 未驗收 |
| S-11 | T01 | lockfile 已納入；`.npmrc` `save-exact=true`；`strictDepBuilds: true` | 部分 |
| S-12 | T01、T02 | `.gitignore` 排除 `.env*`；`.env.example`；pre-commit gitleaks 擋下假 secret；CI gitleaks 擋下 PR #3 | 已驗收 |
| S-13 | T04 | `tooling/verify-docker-image.sh`：非 root、無 .env、無 API key | 已驗收 |
| S-14 | T02、T03、T14、T16、T18 | T02：test、typecheck、lint、build、依賴方向、gitleaks、依賴漏洞已啟用（PR #2、#3、#4）；T03：RLS 權限測試已啟用；main 分支保護已啟用（PR #5 為 blocked）；其餘關卡於 T03、T14、T16、T18 | 部分 |
| S-15 | 每個 Task | PR #1、#2 附 `/security-review` 結果 | 部分 |
| S-16 | T19、T24 | 待建立 | 未驗收 |
| S-17 | T19 | 待建立 | 未驗收 |

## 第 5 節 記憶

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| MEM-01 | T41 | 待建立 | 未驗收 |
| MEM-02 | T41 | 待建立 | 未驗收 |
| MEM-03 | T41 | 待建立 | 未驗收 |
| MEM-04 | T40 | 待建立 | 未驗收 |
| MEM-05 | T41 | 待建立 | 未驗收 |
| MEM-06 | T06、T41 | T06：`supabase/tests/04_entity_permissions.test.sql`（記憶只限本人存取）；payload 排除於 T41 | 部分 |
| MEM-07 | T41 | 待建立 | 未驗收 |
| MEM-08 | T41 | 待建立 | 未驗收 |
| MEM-09 | T41 | 待建立 | 未驗收 |
| MEM-10 | T41 | 待建立 | 未驗收 |
| MEM-11 | T11、T41 | 待建立 | 未驗收 |

## 第 6 節 分享

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| SH-01 | T03 | `supabase/tests/02_trip_permissions.test.sql`（Owner、Companion、Viewer；唯讀連結於 T33） | 部分 |
| SH-02 | T03、T32 | `supabase/tests/02_trip_permissions.test.sql`：trips 與 trip_members 相關各格；其餘資料表於建立時補 | 部分 |
| SH-03 | T32 | 待建立 | 未驗收 |
| SH-04 | T07、T09、T10A、T34 | T07：`packages/core/src/states.test.ts`；T09：`supabase/tests/05_apply_change.test.sql`（同一 base version 的第二個提案批准時失效）；T10A：`supabase/tests/06_restore_version.test.sql`（base version 不符時復原失敗、復原前的提案批准時失效）；T34 兩個瀏覽器 E2E、真機 R6 待建立 | 部分 |
| SH-05 | T34、T35 | 待建立；真機 R3 | 未驗收 |
| SH-06 | T09、T34 | T09：`supabase/tests/05_apply_change.test.sql`（批准、否決、失效通知成員，未讀可依成員查詢，通知表經 Realtime 推送）、`packages/db/src/change-writer.test.ts`；T34 E2E、真機 R6 待建立 | 部分 |
| SH-07 | T32 | 待建立 | 未驗收 |
| SH-08 | T33 | 待建立 | 未驗收 |

## 第 7 節 日後新增功能

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| F-01 | T06、T11 | T06：行程項目的預估費用、實際費用、付款人欄位（schema 與 migration）；`ExpenseLedger` 介面於 T11 | 部分 |
| F-02 | T11 | 待建立 | 未驗收 |
| F-03 | T11 | 待建立 | 未驗收 |
| F-04 | T11 | 待建立 | 未驗收 |
| F-05 | T11 | 待建立 | 未驗收 |

## 沒有負責 Task 的規則

無。C-11 於 2026-11-22 分配至 T03；S-08 的安全標頭分配至 T01，Markdown sanitize 與連結限制分配至 T24。
