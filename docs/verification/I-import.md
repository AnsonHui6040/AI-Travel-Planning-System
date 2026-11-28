# I 行程匯入 驗證紀錄

| 項目 | 內容 |
|---|---|
| Task | 決策 0010 第 3 節 I：行程匯入 |
| 對應規則 | S-01（AI 不寫入，輸出只是預覽）、S-02（輸出嚴格驗證）、S-03（貼上的文字放在資料區塊）、S-07（全名、電話、電子郵件不送 AI）、S-10（log 不含內容）、S-16（輸出含圖片網址時拒絕）、C-05（只用本人的 key）、C-08（不自動切換供應商）、C-11（速率限制）、D28（不保存 place_id 以外的 Google 內容） |
| 分支 | `feat/import` |
| 日期 | 2026-11-28 |

## PASS 標準

| 標準 | 結果 | 證據 |
|---|---|---|
| 來源：貼上確認信、其他 App 匯出的行程或自己的清單 | PASS | 「匯入」畫面（`apps/web/app/trips/[tripId]/import/`）；E2E `apps/web/e2e/import.spec.ts` 貼上訂房確認、航班確認與地點清單 |
| 以使用者本人的 AI 設定與 key 執行，與其他角色相同的 provider adapter | PASS | `importSpec()`（`packages/ai/src/roles.ts`）以 Master Planner 的模型設定與上限執行、沒有工具；key 只經 `decrypt_api_key` 取請求者本人的（`apps/web/lib/server/import.ts`）。`packages/ai/src/roles.test.ts` |
| 貼上的內容放在資料區塊（S-03） | PASS | 新的資料區塊種類「貼上的文字」（`packages/security/src/untrusted.ts`）；`apps/web/lib/server/import-core.test.ts` 確認 input 帶有本次編號的區塊；回歸案例 I5 偽造的區塊標記被中和 |
| 全名、電話、電子郵件不送 AI（S-07） | PASS | `buildImportPayload`（`packages/security/src/import-payload.ts`）：成員已登錄的全名、電話、電子郵件，電子郵件、`+` 國碼或 0 開頭的電話，以及標示為姓名的行（姓名、預訂者姓名、氏名、代表者、Guest name、Passenger 等）換成標記。`import-payload.test.ts`；`import-core.test.ts` 確認送出的 request 不含姓名、電話、電子郵件與 key；評估場景 E10 |
| 輸出經 schema 與輸出檢查 | PASS | `importOutput`（`packages/schemas/src/import.ts`，strictObject，預訂 20 筆、地點 30 個上限）；`gateImportOutput`（`packages/core/src/import.ts`）與 `gateRoleOutput` 相同的三項檢查：schema、圖片網址、API key 與敏感欄位值；拒絕時 log 只記種類 |
| 輸出內容：預訂（類型、標題、時間、時區、地點、預約碼）與地點（名稱、類型、有寫到的日期與時間、備註） | PASS | `packages/schemas/src/import.test.ts`；`packages/core/src/import.test.ts`（預覽列） |
| AI 不寫入（S-01）：預覽只回到本人的畫面，不保存 | PASS | 預覽是 Server Action 的回傳值，只存在畫面狀態，不寫入資料表、不放網址；匯入的模組不寫入任何資料表（`apps/web/lib/server/import.ts`） |
| 預覽一個畫面列出所有列，可修改、取消勾選、確認 | PASS | E2E：取消勾選築地場外市場、修改晴空塔的日期與時間、開啟預訂查看預約碼與時間，「加入 5 項」 |
| 只有確認的列以本人 session 經既有路徑寫入 | PASS | `import-confirm-core.ts`：預訂經 `saveBookingAction`、地點經 `parseEditForm`＋`submitEdit`。`import-core.test.ts` 確認送出的欄位；E2E 寫入後兩筆預訂出現在預訂畫面，取消勾選的地點沒有加入 |
| 鎖定前直接寫入，鎖定後地點成為待批准提案 | PASS | 沿用行程編輯的 `editMode`；E2E「行程鎖定後：地點成為待批准提案」顯示「已送出 1 個地點的提案，批准後生效」，提案畫面有淺草寺、行程項目沒有增加。預訂與 B 相同直接寫入 |
| 地點的來源為使用者新增、狀態為使用者確認，沒有 place_id | PASS | E2E 以 service role 讀取：三個地點 `origin = user`、`verification_status = user_confirmed`、`place_id` 為空 |
| 沒有 AI key 時提示到設定 | PASS | `import-core.test.ts`；E2E 顯示「尚未設定 Claude 的 API key」與「API key」「AI 設定」連結 |
| 沒有辨識到或無法辨識時清楚說明 | PASS | `import-core.test.ts`（空白輸出、重試後仍不符格式、輸出被拒、AI 服務失敗）；E2E 兩種訊息 |
| 速率限制 | PASS | 預覽 `import.preview` 每 10 分鐘 10 次（與研究相同的量級）；確認 `import.confirm` 每分鐘 20 次，另外沿用預訂與編輯各自的限制。`import-core.test.ts` |
| prompt injection 案例 | PASS | `packages/ai/src/injection/cases.ts` 的 `IMPORT_CASES` 六筆（要求寫出姓名電話、輸出 API key、附圖片網址、標記已批准直接寫入、偽造資料區塊、改變輸出格式），`import-injection.test.ts`：沒有洩漏、只有預覽或被拒 |
| 確定性評估場景（錄製回應） | PASS | `evals/import/E10.json`；`evals/src/import.test.ts`；報告 `docs/verification/evals/2026-11-28-E10.md` |
| 預約碼只回到本人的預覽 | PASS | 預覽不保存、不寫入 log；`tooling/booking-ai-boundary.test.ts` 新增「匯入的例外只限 AI 輸出」：例外的四個檔案不讀取預訂資料表，匯入的 AI input 只有貼上的文字，確認（寫入預訂）的模組不在 AI 模組的 import 範圍 |
| 「行程」與「更多」都可進入 | PASS | 「行程」標題列「預訂」旁的「匯入」；「更多 → 行程資料 → 匯入」；E2E 兩個入口 |
| 兩個畫面分開，每個畫面一個主要按鈕，390×844 與 1280×800 不用捲動 | PASS | 見下表 |

## 畫面量測（E2E，production build）

| 畫面 | 390：文件高度／可視高度 | 390：primary 頂端（2/3 為 563） | 1280：文件高度／可視高度 |
|---|---|---|---|
| 貼上 | 844／844 | 724（整理） | 800／800 |
| 貼上（沒有 key 的提示） | 844／844 | 不在本表量測 | 800／800 |
| 預覽 | 844／844 | 724（加入 6 項） | 800／800 |
| 修改地點 | 844／844 | 手機為詳情畫面，沒有 primary（完成） | 800／800（左預覽、右詳情） |
| 修改預訂 | 844／844 | 同上 | 800／800 |
| 完成 | 844／844 | 724（查看行程） | 800／800 |

貼上的文字比輸入欄長時在輸入欄內捲動，量測時不計入（輸入內容，不是畫面版面）。截圖：`docs/verification/screenshots/I-*.png`（`CAPTURE_SCREENSHOTS=1`）。

## 做法與取捨

| 項目 | 做法 | 原因 |
|---|---|---|
| 執行的角色設定 | Master Planner 的模型與上限（與 T27 地理分區用 Transport 設定的做法相同），不新增第六個角色 | 新增角色要改資料庫的 enum、AI 設定畫面與用量統計；匯入與 Master Planner 同樣只產生需要使用者確認的內容 |
| 輸出檢查 | `gateImportOutput` 與 `gateRoleOutput` 共用 `leaks`、`containsImageUrl` | `gateRoleOutput` 依五個角色的去處（候選、核實、交通、提案）分支；匯入沒有寫入去處 |
| 預約碼送 AI | 貼上的文字含預約碼時照樣送出，由 AI 整理到預覽 | 決策 0010 B 的「預約碼不送 AI」指已保存的預訂；匯入是使用者主動以自己的 key 送出自己貼上的文字。已保存的預訂仍不會被任何 AI 模組讀取（`booking-ai-boundary.test.ts`） |
| 電話的判斷 | `+` 國碼或 0 開頭才當作電話 | 日期（2026-12-20）與時間不能被移除；0 開頭的數字預約碼會被當作電話移除，使用者可在預覽補上 |
| 姓名的判斷 | 成員已登錄的全名，加上標示為姓名的行 | 自由文字沒有欄位可挑選；只移除有標示的姓名，避免把飯店名稱當成人名 |
| 沒有時間的預訂 | 預覽列標示「請補上開始時間」且不預設勾選 | 預訂的開始時間必填 |
| 地點的日期 | 日期不在行程期間內、或有日期沒有時間時放進候選清單並提示 | 新增地點時日期與時間要一起填 |
| place_id | 匯入的地點不帶 place_id | 預覽沒有搜尋；要對應 Google Maps 地點時，到行程編輯以搜尋加入 |
| 寫入失敗 | 失敗的列列出原因，其他列照常寫入；全部失敗時留在預覽 | 一筆時間錯誤不應擋住其他列 |
| E2E 的 AI | `E2E_AI_FIXTURE=1` 時改用 `apps/web/lib/server/import-fixture.ts` 的錄製回應（內容同 E10，日期依貼上文字的第一個日期），Vercel 上一律關閉 | 不連 AI 供應商；示範行程的日期依執行當天而定 |

## 自動驗證

| 項目 | 指令 | 結果 |
|---|---|---|
| 單元與工具測試 | `pnpm test` | 124 個測試檔 1837 個測試通過；workflow 測試 4 個通過 |
| 型別檢查 | `pnpm typecheck` | 通過 |
| Lint 與依賴方向 | `pnpm lint` | 通過，沒有依賴違規 |
| Build | `pnpm build` | 通過（E2E 的 webServer 先執行 build） |
| 資料庫 | `supabase test db` | 30 個測試檔 662 個測試通過（本 Task 沒有 migration） |
| 評估 | `EVAL_SCENARIOS=E10 pnpm evals:run` | E10 PASS |
| E2E（390×844、1280×800，production build） | `pnpm test:e2e` | 164 個通過（82 個測試 × 2 個寬度），0 失敗；`import.spec.ts` 3 個測試 × 2 個寬度。另一次以 `E2E_PORT=3120` 執行時，`entry`、`guard`、`today` 共 8 個因 `.env.local` 的登入轉址與允許來源固定為 3100 而失敗，與本 Task 無關 |

## 真機驗證（待測）

| 編號 | 項目 | 狀態 |
|---|---|---|
| I-R1 | 以本人的 Claude key 貼上一封真實的訂房確認信，預覽的時間、時區與預約碼正確 | TBD |
| I-R2 | iPhone 從郵件 App 複製確認信貼上，預覽單手勾選與修改 | TBD |
| I-R3 | 以真 AI 連續執行 E10 五次全部通過（第 9.1 節） | TBD |
