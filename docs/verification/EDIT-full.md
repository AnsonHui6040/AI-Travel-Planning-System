# EDIT-full 驗證紀錄

| 項目 | 內容 |
|---|---|
| Task | 決策 0011 完整的行程編輯 |
| 對應規則 | 決策 0011；決策 0010 E；S-01、SH-04、D07、D28 |
| 分支 | `feat/full-editing` |
| 日期 | 2026-11-28 |

## PASS 標準

| 標準 | 結果 | 證據 |
|---|---|---|
| 鎖定後 Owner 直接套用：一筆 Change Log、通知其他成員、不通知本人、版本已變更時不套用 | PASS | pgTAP `supabase/tests/30_full_editing.test.sql`；`apps/web/lib/server/item-edit-core.test.ts`；E2E `apps/web/e2e/full-edit.spec.ts`（versions 1 筆、提案為已套用） |
| 鎖定後 Companion 只能提案；同一批次只建立一個提案、行程不變 | PASS | pgTAP（Companion 呼叫 `apply_owner_change` 為 42501）；E2E（提案 1 筆、2 個操作、versions 0 筆） |
| 鎖定前 Owner、Companion 直接寫入，草案不產生版本；整批有一項不合法時全部不寫入 | PASS | pgTAP（`edit_trip_items`）；E2E 規劃中完成後 versions 0 筆 |
| 編輯模式：拖曳把手（鍵盤上下鍵）、44px 上移下移、刪除先確認、開始與結束時間、插入 | PASS | E2E（順序、確認文字、把手與按鈕尺寸、插入後時間） |
| 自動順延：停留加交通（withBuffer）、固定活動不動、不要順延、排不下不能送出 | PASS | `packages/core/src/full-edit.test.ts`；E2E（預設交通 30 分鐘、步行 10 分＋緩衝 10 分） |
| 複製、整天交換 | PASS | `item-edit-core.test.ts`；pgTAP；E2E 整天交換 |
| 兩站之間的交通：成員輸入、估算、未設定；Viewer 與非成員不可寫 | PASS | pgTAP；`apps/web/lib/server/trip-edit-core.test.ts`；E2E |
| 行程設定：只限 Owner、日期同步基線、基線產生新矛盾時不送出、移除日期先確認並移回候選清單、鎖定後新增的日期為已批准 | PASS | pgTAP；`trip-edit-core.test.ts`；E2E |
| 390px 版面：新增地點、編輯項目、預訂、行程設定、編輯模式的輸入欄與按鈕不超出畫面、不重疊；移回候選清單有按鈕背景 | PASS | E2E `expectNoOverlap`（390、1280）；截圖 `docs/verification/screenshots/EDIT-full-*.png` |
| 390×844 與 1280×800 不用捲動，只有清單捲動 | PASS | E2E `expectNoScroll`（行程、編輯模式、編輯項目、行程設定） |

## 指令結果

| 指令 | 結果 |
|---|---|
| `pnpm test` | 126 個檔案 1889 passed＋workflow 4 passed |
| `pnpm typecheck` | 通過 |
| `pnpm lint`（含 depcruise） | 通過 |
| `pnpm build` | 通過 |
| `supabase test db` | 31 個檔案、698 個測試 PASS |
| `pnpm test:e2e`（production build，390 與 1280） | 見下方「完整 E2E」 |

## 設計說明

| 項目 | 說明 |
|---|---|
| Owner 直接套用 | 不另寫一套直接寫入：`apply_owner_change` 以 Owner 名義建立提案後立即 `commit_proposal`，Change Log、通知、SH-04、生命週期 trigger 與 Companion 的提案完全相同 |
| `commit_proposal` 的修正 | 新增項目排入草案日時為已核實（原本規劃中一律為已批准）；排入已批准的日期為已批准；鎖定後為已修改 |
| 草案不產生版本 | 第 2.8 節的版本從批准每日開始（第一版 v1.0）；`versions.major` 的下限為 1，草案日的批次只增加 `current_version` |
| 交通不經提案 | 交通是估算而非行程內容；因交通而順延的時間照決策 0011 第 2 節生效 |
| 拖曳 | Pointer Events 加 pointer capture，滑鼠與觸控相同；把手 `touch-action: none` |
| iOS 時間輸入欄 | 去掉原生外觀、`min-width: 0`、填滿欄寬；格線子項目一律 `min-width: 0` |

## 真機與人工項目

| 編號 | 項目 | 狀態 |
|---|---|---|
| EDIT-R1 | iPhone 上拖曳把手排序、時間輸入（上午／下午格式）不被截斷 | TBD |
| EDIT-R2 | iPhone 上新增地點、修改預訂、編輯項目的版面（原截圖的四個問題） | TBD |
| EDIT-R3 | Owner 與 Companion 兩支手機：Owner 修改後 Companion 收到通知；Companion 的提案由 Owner 批准 | TBD |
