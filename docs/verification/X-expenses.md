# X 記帳與分帳 驗證紀錄

| 項目 | 內容 |
|---|---|
| Task | 決策 0010 第 3 節 X：記帳與分帳 |
| 對應規則 | F-01、F-05；第 6 節權限表（Owner、Companion 可寫，Viewer 唯讀，非成員看不到）；S-01（AI 不接觸花費） |
| 分支 | `feat/expenses` |
| 日期 | 2026-11-28 |

## PASS 標準

| 標準 | 結果 | 證據 |
|---|---|---|
| 一筆花費：金額、幣別、付款人、分攤（預設平均，可自訂金額）、日期、類別、關聯項目、備註 | PASS | pgTAP `supabase/tests/28_expenses.test.sql`：`save_expense` 新增與修改、分攤總和不等於金額、JPY 有小數、分攤成員不是行程成員、關聯項目屬於其他行程、沒有分攤成員都被拒（22023）。Server Action 測試 `apps/web/lib/server/expenses-core.test.ts`。E2E `apps/web/e2e/expenses.spec.ts`：平均分攤 900 TWD 各 450；自訂 600／300 時顯示「分攤總和與金額相差 100 JPY」不寫入，改為 600／400 後儲存 |
| 匯率由使用者輸入，不呼叫外部匯率服務 | PASS | `packages/core/src/expenses.test.ts`：沒有匯率時回傳 null、不計入總額並列出缺少的幣別。E2E：1000 JPY 沒有匯率時總花費維持 900 TWD 並顯示「1 筆 JPY 花費沒有匯率，未計入」；輸入 0.21 後為 1,110 TWD。程式沒有新增對外網域（`packages/security/src/fetch-allowlist.json` 未修改） |
| 總覽：總花費、各類別、與基線預算比較 | PASS | core：`expenseTotals`、`budgetStatus`（剩餘、超出、預算幣別不同時換算、缺匯率）。E2E：預算 3,000 TWD，記帳後「剩餘 1,890 TWD」、交通 210 TWD；Viewer 的行程沒有預算時顯示「基線沒有設定預算」 |
| 結算：誰付給誰（最少筆數），可標記已付款與日期 | PASS | core：`settleUp` 先配對金額相同的應付與應收，其餘由應付最多者付給應收最多者；筆數不超過有餘額人數減一，結算後每人為 0。`expenseBalances` 計入已付款紀錄。E2E：建議「阿明付給小安 534 TWD」，標記已付款後「所有人都已結清。」，已付款清單顯示該筆與日期 |
| 各幣別的四捨五入 | PASS | core：TWD、JPY、KRW 等不用小數，USD、EUR 兩位，BHD 等三位；以最小單位整數計算（1.005 USD → 1.01）；平均分攤的餘數依成員順序多分一個最小單位；外幣分攤先換算總額再以最大餘數法分配，合計等於總額。資料庫 `private.currency_decimals` 與 core 相同 |
| 權限：Owner、Companion 可新增修改，Viewer 唯讀，非成員看不到 | PASS | pgTAP：Viewer 設定主幣別、輸入匯率、新增花費、標記已付款都被拒（42501），刪除不生效；非成員讀不到任何記帳資料；不能以別的行程修改花費。E2E：Viewer 沒有「新增花費」、詳情沒有修改與刪除、結算沒有「標記已付款」，直接開新增頁顯示「只有 Owner 與 Companion 可以記帳；你可以檢視。」；非成員顯示「找不到這個行程，或你不是成員。」 |
| 不送 AI | PASS | pgTAP：anon 與 service_role（伺服器執行 AI 的身分）對五張記帳資料表沒有任何權限，也不能呼叫 `save_expense`。記帳只以使用者本人的 session 讀寫（`apps/web/lib/server/expenses.ts`），沒有任何 AI 角色的輸入讀取這些資料表 |
| 刪除花費以 `window.confirm` 確認 | PASS | `tooling/ui-buttons.test.ts` 把 `expense-forms.tsx` 列入「不可逆操作先確認」；E2E 接受確認後清單少一筆 |
| 一個畫面一件事，390×844 與 1280×800 不用捲動，手機主要按鈕在下方三分之一 | PASS | 見下表 |

## 畫面量測（E2E，production build）

| 畫面 | 390：文件高度／可視高度 | 390：primary 頂端（2/3 為 563） | 1280：文件高度／可視高度 |
|---|---|---|---|
| 記帳總覽（空） | 844／844 | 724（新增花費） | 800／800 |
| 記帳總覽（兩筆） | 844／844 | 724（新增花費） | 800／800 |
| 記帳總覽（Viewer） | 844／844 | 沒有 primary | 800／800 |
| 新增花費 | 844／844 | 724（儲存） | 800／800 |
| 花費清單 | 844／844 | 沒有 primary | 800／800 |
| 花費詳情 | 844／844 | 沒有 primary（修改、刪除） | 800／800 |
| 結算 | 844／844 | 沒有 primary（每筆「標記已付款」） | 800／800 |
| 幣別與匯率 | 844／844 | 儲存匯率在下方動作列 | 800／800 |

截圖：`docs/verification/screenshots/X-*.png`（`CAPTURE_SCREENSHOTS=1`）。

## 實作

| 項目 | 內容 | 檔案 |
|---|---|---|
| 計算 | 純函式：`currencyDecimals`、`roundMoney`、`splitEqually`、`validateShares`、`convertAmount`、`expenseTotals`、`budgetStatus`、`expenseBalances`、`settleUp` | `packages/core/src/expenses.ts` |
| 資料表 | `expense_settings`（主幣別）、`expense_rates`、`expenses`、`expense_shares`、`expense_settlements`；先撤銷 anon、authenticated、service_role 再授權 | `supabase/migrations/20261128200000_x_expenses.sql` |
| 寫入 | 花費與分攤只經 `save_expense`（擁有者 `atps_expense_writer`）；主幣別、匯率、結算以本人 session 直接寫入（RLS 限 Owner、Companion，更新者必須是本人）；刪除花費時分攤一併刪除 | 同上 |
| row schema | 五張資料表登記在 `tableSchemas` | `packages/schemas/src/expenses.ts` |
| 功能開關 | migration 開啟 `expense_ledger`（F-05：只經 migration 修改）；畫面與「更多」依此顯示 | 同 migration、`supabase/tests/07_feature_flags.test.sql` |
| 畫面 | 「更多」→「記帳」總覽；新增、修改、清單、詳情、結算、幣別與匯率各一個畫面；1024px 以上清單與詳情左右並排 | `apps/web/app/trips/[tripId]/expenses/` |
| Server Action | 登入、速率限制、輸入檢查、分攤以 core 計算 | `apps/web/lib/server/expenses-core.ts`、`apps/web/lib/server/expenses.ts` |

## 預設與限制

| 項目 | 做法 | 原因 |
|---|---|---|
| 主幣別未設定 | 沿用基線預算的幣別，沒有預算時為 TWD | 台灣使用者；不必先設定即可記帳 |
| TWD 小數 | 不用小數 | 台灣日常付款以元為單位 |
| 最少筆數 | 金額相同者先配對，其餘依金額大小配對；筆數不超過有餘額人數減一 | 一般情況的最少筆數；完全最少筆數需窮舉，人數多時不實際 |
| 變更主幣別 | 不自動換算已輸入的匯率，畫面提示重新確認 | 匯率由使用者輸入，系統不猜測 |
| 已離開的成員 | 舊花費與結算仍計入，名稱顯示「已離開的成員」（看不到其名稱時） | 帳目不能因成員離開而消失 |
| 關聯預訂 | 目前只可關聯行程項目 | 預訂（決策 0010 B）尚未實作 |
| 離線 | 記帳需要網路 | 規格沒有要求離線記帳 |

## 自動驗證

| 項目 | 指令 | 結果 |
|---|---|---|
| 單元與工具測試 | `pnpm test` | 111 個測試檔 1619 個測試通過；workflow 測試 4 個通過 |
| 型別檢查 | `pnpm typecheck` | 通過 |
| Lint 與依賴方向 | `pnpm lint` | 通過，沒有依賴違規 |
| Build | `pnpm build` | 通過 |
| 資料庫 | `supabase test db` | 28 個測試檔 580 個測試通過（`28_expenses.test.sql` 33 個） |
| E2E（390×844、1280×800，production build） | `pnpm test:e2e` | 144 個通過（72 個測試 × 2 個寬度），0 失敗；`expenses.spec.ts` 2 個測試 × 2 個寬度。以只含 main 與本分支 migration 的資料庫執行 |

## 真機驗證（待測）

| 編號 | 項目 | 狀態 |
|---|---|---|
| X-R1 | iPhone 單手新增一筆花費（金額欄位出現數字鍵盤、儲存按鈕拇指可及） | TBD |
| X-R2 | 兩位成員各自用手機記帳後，結算的建議轉帳與實際相符 | TBD |
