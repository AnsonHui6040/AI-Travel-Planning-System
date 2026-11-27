# E＋S 驗證紀錄

| 項目 | 內容 |
|---|---|
| Task | 決策 0010 的 E 行程編輯與 S 搜尋加入地點 |
| 對應規則 | 決策 0010；S-01、S-05、D07、D28、C-02、C-05 |
| 分支 | `feat/edit-search` |
| 日期 | 2026-11-28 |

## PASS 標準

| 標準 | 結果 | 證據 |
|---|---|---|
| 手動新增：來源為使用者新增、核實狀態為使用者確認，可排入草案與批准 | PASS | pgTAP `supabase/tests/28_item_editing.test.sql`；`packages/core/src/states.test.ts`；E2E `apps/web/e2e/item-edit.spec.ts`（行程列標示「使用者確認」） |
| AI 核實不改寫使用者確認 | PASS | check constraint `itinerary_items_user_confirmed`：成員項目改為其他狀態、AI 項目標為使用者確認都被拒（23514） |
| 修改、刪除（先確認）、上移下移（44px）、移到另一天、移回候選清單、備註 | PASS | `packages/core/src/item-edit.test.ts`；`apps/web/lib/server/item-edit-core.test.ts`；pgTAP；E2E（確認視窗文字、按鈕高度、資料庫結果） |
| 鎖定前直接寫入，只限 Owner、Companion | PASS | pgTAP：Viewer、非成員、直接寫入資料表、service_role 都被拒；四個函式的擁有者為 `atps_item_editor` |
| 鎖定後（或該日已批准）同一畫面送出提案，批准規則不變 | PASS | pgTAP：批准 add_item、update_item、remove_item 提案；AI 提出的新增提案被拒（42501）。`versions.test.ts`、`item-edit.test.ts`（Minor 為 minor_non_incident、跨日為 major_version）。E2E：鎖定後修改停留只建立提案，行程不變 |
| 每次修改後以 checkDay 提示、不阻擋 | PASS | `item-edit-core.test.ts`：直接寫入後回傳該日提醒；手動排程的草案日以 `checkDay` 檢查（`day-draft.ts`），批准時照舊阻擋 |
| 搜尋：伺服器以 Vault 的 Maps key 經白名單 fetch 呼叫 Places 文字搜尋 | PASS | `google-maps.contract.test.ts`（key 只在標頭、最多 5 筆、錯誤不含 key）；`allowlisted-fetch.test.ts`（POST、標頭、不跟隨 redirect）；`places-core.test.ts` |
| 只保存 place_id，名稱預設為搜尋字（D28） | PASS | E2E：保存後名稱為「一蘭」、地址為空、place_id 為選定的地點；頁面不含 key |
| 沒有 Maps key 只手動新增，提示到設定輸入 | PASS | `places-core.test.ts`；E2E |
| 390×844 與 1280×800 不用捲動，手機主要按鈕在下方三分之一、每畫面一個 | PASS | E2E `expectNoScroll`、`expectPrimaryInThumbZone`（新增地點兩種狀態、編輯項目）；截圖 `docs/verification/screenshots/E-S-*.png` |

## 白名單網址確認（S-05）

| 項目 | 內容 |
|---|---|
| 文件 | Google for Developers「Text Search (New)」頁面列出 `https://places.googleapis.com/v1/places:searchText` |
| 實際連線 | 2026-11-28 以瀏覽器開啟該網址，回應 403 JSON（沒有 key），服務名稱為 places.googleapis.com |
| 設定 | 加入 `packages/security/src/fetch-allowlist.json` 的 `apiHosts`，與讀取官方網頁的 `hosts` 分開：Verification 依 AI 輸出讀取網頁時不會連到這個主機 |

## 指令結果

| 指令 | 結果 |
|---|---|
| `pnpm test` | 1661＋4 passed |
| `pnpm typecheck` | 通過 |
| `pnpm lint`（含 depcruise） | 通過，沒有依賴方向違規 |
| `supabase test db`（只有本分支的 migration） | 28 個檔案、590 個測試 PASS |
| `pnpm test:e2e`（production build，390 與 1280） | 148 passed |

## 設計說明

| 項目 | 說明 |
|---|---|
| 自動草案與手動排程 | 每日草案原本每次即時計算、不寫入。第一次手動排程（排入、移動、排序、移回候選清單）時，把畫面上的自動草案一併寫入並設 `trips.manual_schedule`；之後草案日只顯示資料庫中的排程，新核實的候選留在候選清單，由成員排入 |
| 生效方式 | 行程鎖定前且影響的日期都是草案：直接寫入。鎖定後，或規劃中但影響已批准的日期：提案。旅後不可編輯 |
| 刪除 | 鎖定前刪除資料列；鎖定後的刪除提案對排入過的項目改為已取消並保留紀錄，未排入過的候選直接刪除 |
| 鎖定後移回候選清單 | AI 的項目照 T38 修正回到待核實；使用者確認的項目回到已核實，不需重新核實 |
| E2E 的 Places | `E2E_PLACES_FIXTURE=1` 時改用合成回應（Vercel 上一律關閉），仍經 Vault 取 key 與同一個 client |

## 真機與人工項目

| 項目 | 狀態 |
|---|---|
| 以使用者本人的 Maps key 實際搜尋（真實 Places 回應、費用） | TBD |
| iPhone 上新增、編輯與刪除確認視窗 | TBD |

## 已知限制

| 項目 | 說明 |
|---|---|
| 復原舊版本 | `restore_version` 只復原排程；已取消或新增的項目不會因復原而改回 |
| 照片檔案 | 鎖定前刪除項目時照片資料列一併刪除，Storage 內的檔案未清除 |
| 拖曳排序 | 決策 0010 列為加分項，本次只做上移、下移 |
