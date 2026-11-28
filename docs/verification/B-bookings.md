# B 預訂與清單 驗證紀錄

| 項目 | 內容 |
|---|---|
| Task | 決策 0010 第 3 節 B：預訂與清單 |
| 對應規則 | 第 6 節權限表（Owner、Companion 可寫，Viewer 唯讀，非成員看不到）；S-01、S-07（預約碼不送 AI）；C-10、SH-08（唯讀連結）；D11、SH-05（離線當日包）；Hard Constraint（第 2.6 節） |
| 分支 | `feat/bookings-lists` |
| 日期 | 2026-11-28 |

## PASS 標準

| 標準 | 結果 | 證據 |
|---|---|---|
| 預訂類型：航班、住宿、餐廳、票券、交通、其他 | PASS | migration 的 enum `booking_kind` 與 `packages/schemas` 的 `bookingKind` 一致（`tooling/schema-migration-consistency.test.ts`）；pgTAP 寫入第七種類型被拒（22P02） |
| 欄位：標題、開始與結束時間、時區、地點、預約碼、備註、關聯項目（可空） | PASS | `packages/schemas/src/bookings.test.ts`；`apps/web/lib/server/bookings-core.test.ts`（以選擇的時區換算時間、結束只填時間時為同一天、跨日、結束早於開始、超過 60 天、時區不正確、字數上限）；pgTAP：關聯其他行程的項目、不認得的時區（22023）、結束早於開始（23514）都被拒 |
| 權限：Owner、Companion 可新增修改刪除，Viewer 唯讀，非成員看不到 | PASS | pgTAP `supabase/tests/29_bookings_lists.test.sql`：Viewer、非成員新增被拒（42501），Viewer 修改與刪除不生效，非成員讀不到；建立者必須是本人、修改不改變建立者與行程。E2E `apps/web/e2e/bookings.spec.ts`：Viewer 沒有「新增預訂」、「修改」、「刪除」，清單的核取方塊停用、沒有新增項目；非成員顯示「找不到這個行程，或你不是成員。」 |
| 預約碼只有行程成員可見 | PASS | pgTAP：Viewer 可讀預約碼；anon、service_role、`atps_readonly_reader` 對三張資料表沒有任何權限 |
| 預約碼不送 AI | PASS | pgTAP：service_role（伺服器執行 AI 的身分）讀預訂被拒（42501）。`tooling/booking-ai-boundary.test.ts`：所有 AI 入口（`@atps/ai`、`buildAiPayload`、`composeRoleInput`、`handleRoleRun`、`gateRoleOutput`）與其相對 import 不讀取 `bookings`、不出現預約碼欄位；`packages/ai`、payload builder、資料區塊、`packages/core`、`packages/memory` 也不出現。`packages/security/src/payload.test.ts`：項目或行程物件帶有預約碼時 `buildAiPayload` 不輸出。計算用的 `loadBookingConstraints` 不選取預約碼與備註 |
| 預約碼不出現在唯讀連結 | PASS | pgTAP：`readonly_trip` 的結果不含預約碼。`apps/web/lib/server/readonly-boundary.test.ts`：`/r/[token]` 與其 import 不讀取預訂。E2E：Owner 建立唯讀連結後，未登入開啟的頁面不含四個示範預約碼 |
| 當天的預訂出現在「現在」與「行程」，視為固定活動（Hard Constraint） | PASS | `packages/core/src/bookings.test.ts`：`withBookings` 換算為行程時區的固定活動；自動草案不把項目排進預訂的時段。E2E：新增今天 16:00 的票券後，「行程」當天 5 行（3 個項目、基線晚餐、票券），「現在」今天的時間軸含票券 |
| `checkDay`、`planFeasibleDays` | PASS | `bookings.test.ts`：預訂時段由 `planFeasibleDays` 遵守；需要預約的項目有關聯預訂時 `checkDay` 不再提醒。`apps/web/lib/server/day-draft.ts` 以 `withBookings` 的基線計算 |
| `morningCheck` 的預約列 | PASS | `packages/core/src/morning-check.test.ts`：今天的預訂列為「已預訂：10:00 美術館門票、19:00 壽司晚餐」，有關聯預訂的項目不列在「需確認預約」。`apps/web/lib/server/morning-check-core.test.ts`：台北時間 10:00 的預訂在東京行程列為 11:00；關聯項目已排入當天時固定活動不重複 |
| `planIncident` | PASS | `apps/web/lib/server/incident-core.test.ts`：今天 16:00 的票券成為下一個 Hard Constraint，可調整時間為 13:00 到 15:45（165 分鐘）；有關聯預訂的項目選為「景點休館」時回覆「是 Hard Constraint」 |
| 清單：每個行程可有多份（打包、待辦），項目可指定成員、勾選完成 | PASS | pgTAP：指定非成員被拒，勾選者與時間由資料庫記錄，取消勾選時清除，成員被移除時取消指定，刪除清單時項目一併刪除。E2E：勾選後「2/4 完成」且完成的項目排到後面，改指定成員、新增與刪除項目、新增與刪除清單 |
| 清單離線可讀 | PASS | `packages/offline/src/offline.test.ts`：當日包含 `bookings` 與 `lists`（未完成在前，舊的當日包讀取時當作空陣列）。E2E：「現在」存入 IndexedDB 的當日包含今天的住宿與票券（含預約碼）及打包清單四項；離線畫面（`components/today-body.tsx`）列出今天的預訂與清單 |
| 「更多」有預訂、清單入口；「行程」可到預訂 | PASS | E2E 由「更多」進入兩個畫面；「行程」標題列的「預訂」連結；預訂畫面歸在「行程」分頁（`components/trip-nav.tsx`） |
| 刪除以 `window.confirm` 確認 | PASS | `tooling/ui-buttons.test.ts` 把 `booking-forms.tsx`、`list-forms.tsx` 列入「不可逆操作先確認」；E2E 接受確認後才刪除 |
| 一個畫面一件事，390×844 與 1280×800 不用捲動，手機主要按鈕在下方三分之一 | PASS | 見下表 |

## 畫面量測（E2E，production build）

| 畫面 | 390：文件高度／可視高度 | 390：primary 頂端（2/3 為 563） | 1280：文件高度／可視高度 |
|---|---|---|---|
| 預訂清單 | 844／844 | 724（新增預訂） | 800／800 |
| 新增預訂 | 844／844 | 724（儲存） | 800／800 |
| 預訂詳情 | 844／844 | 沒有 primary（修改、刪除） | 800／800 |
| 預訂詳情（Viewer） | 844／844 | 沒有 primary | 800／800 |
| 行程（含預訂） | 844／844 | 不在本表量測 | 800／800 |
| 現在（含預訂） | 844／844 | 不在本表量測 | 800／800 |
| 清單 | 844／844 | 724（新增清單） | 800／800 |
| 清單內容 | 844／844 | 672（新增） | 800／800 |

截圖：`docs/verification/screenshots/B-*.png`（`CAPTURE_SCREENSHOTS=1`）。

## 預訂與旅行基線的航班、住宿

| 選項 | 做法 | 結果 |
|---|---|---|
| 搬移基線的航班與住宿到預訂 | 需要改寫已確認的基線，且基線沒有預約碼、時區欄位 | 不採用 |
| 基線的航班與住宿在預訂畫面唯讀列出（採用） | 預訂清單把基線的航班與住宿標示「（旅行基線）」，不可點、沒有預約碼；已有同一出發時間的航班預訂、或同一入住日的住宿預訂時不重複列出 | 基線不變；使用者要記預約碼時新增一筆預訂即取代畫面上的基線列 |
| 計算時不重複 | `withBookings` 合併時略過與基線相同出發時間的航班、相同入住與退房日的住宿、相同日期開始時間與名稱的固定活動 | `bookings.test.ts`「與基線相同的航班、住宿、固定活動不重複加入」 |

## 其他做法

| 項目 | 做法 | 原因 |
|---|---|---|
| 住宿 | 不佔用時段；在入住日與退房日列在當日包，並計入搬運行李的日子 | 住宿橫跨多天，佔用時段會擋住整天的排程 |
| 跨日的預訂 | 分成開始日（到 23:59）與結束日（從 00:00）兩段，中間的日期不佔用 | 紅眼航班兩天都受影響；多日票券不應擋住中間的日子 |
| 沒有結束時間 | 以 60 分鐘計算，不超過當天 23:59 | 與 `draftDays` 對沒有結束時間的固定活動相同 |
| 時區 | 輸入與顯示用預訂自己的時區（與確認信相同）；排程換算為行程時區；與行程時區不同時標出，例如「（台北時間）」 | 去程航班的時刻以出發地時間記載 |
| 關聯項目 | 項目排在同一天時以項目代表，不重複列出；自動草案不另外排入關聯項目；`checkDay`、Morning Check 視為已預約；Incident Mode 視為 Hard Constraint | 預訂的時間就是該項目的時間 |
| 寫入 | 以本人 session 直接寫入三張資料表，trigger 檢查時區、關聯項目、指定成員與筆數上限（預訂 300、清單 30、每份清單 300 項） | 與記帳的匯率、結算相同；不需要另一個擁有者角色 |
| 勾選 | 畫面立即反映，伺服器更新後以資料庫的值為準，失敗時還原 | 打包時連續勾選 |
| 示範資料 | `demo:seed` 另建立住宿、第二天早餐（關聯築地場外市場）與晚餐、回程航班四筆預訂與一份打包清單；service_role 沒有權限，這部分以該使用者本人的 session 寫入 | 預約碼不經 service_role |

## 自動驗證

| 項目 | 指令 | 結果 |
|---|---|---|
| 單元與工具測試 | `pnpm test` | 118 個測試檔 1792 個測試通過；workflow 測試 4 個通過 |
| 型別檢查 | `pnpm typecheck` | 通過 |
| Lint 與依賴方向 | `pnpm lint` | 通過，沒有依賴違規 |
| Build | `pnpm build` | 通過（E2E 的 webServer 先執行 build） |
| 資料庫 | `supabase test db` | 30 個測試檔 662 個測試通過（`29_bookings_lists.test.sql` 39 個） |
| E2E（390×844、1280×800，production build） | `pnpm test:e2e` | 158 個通過（79 個測試 × 2 個寬度），0 失敗；`bookings.spec.ts` 3 個測試 × 2 個寬度。另一次在 `supabase db reset` 後立刻執行時，第一個測試 `baseline.spec.ts`（390）的建立行程失敗（PostgREST 重新載入 schema 中），與本 Task 無關；不 reset 再執行全數通過 |

## 真機驗證（待測）

| 編號 | 項目 | 狀態 |
|---|---|---|
| B-R1 | iPhone 開啟一次「現在」後切到飛航模式，離線畫面看得到今天的預約碼與打包清單 | TBD |
| B-R2 | iPhone 單手新增一筆預訂（日期與時間選擇器、儲存按鈕拇指可及） | TBD |
