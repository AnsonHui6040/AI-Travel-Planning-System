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
| C-02 | T12 | `supabase/tests/08_api_keys.test.sql`（Vault 密文、只限 service_role 解密）；`apps/web/lib/server/api-keys-core.test.ts`（只解密 session 本人的 key）；E2E 只顯示末四碼 | 已驗收 |
| C-03 | T12、T13、T19、T22 | T12：儲存前測試呼叫的掛鉤，失敗時不儲存（`packages/core/src/api-keys.test.ts`）；T13：三家 AI 的測試呼叫（`packages/ai/src/providers.contract.test.ts`）；T19：Google Maps 以只取編號的 Text Search 測試，失敗時不儲存（`packages/data-sources/src/google-maps.contract.test.ts`）；T22：ODPT 以東京 Metro 運行資訊測試，失敗時不儲存（`packages/data-sources/src/live-data.contract.test.ts`） | 已驗收 |
| C-04 | T12、T17 | T12：固定錯誤訊息（pgTAP、單元測試）、E2E 頁面不含完整 key、`tooling/scan-client-bundle.cjs`（CI build 後執行）；T17：`createLogger` 寫出前遮罩 key 與敏感欄位（`packages/security/src/logger.test.ts`）；Docker image 於 T04 已驗證不含 `.env` | 已驗收 |
| C-05 | T12 | `08_api_keys.test.sql`：A 沒有 key 時 A 的 job 不借用 B 的；Server Action 忽略表單傳入的擁有者；功能降級於各功能 Task | 已驗收 |
| C-06 | T11、T12 | T12 實作 `api_key`；`plan_oauth` 以 T11 的 `CredentialProvider`（`available: false`）預留 | 已驗收 |
| C-07 | T13 | `packages/ai/src/providers.contract.test.ts`：只連官方 HTTPS 端點、逾時分類、限流後以退避重試成功；T19：Google Maps 只連 `places.googleapis.com`、設逾時、拒絕 redirect，限流時回報錯誤不自動重試；T22：Open-Meteo、ODPT 只連固定官方端點、設逾時、拒絕 redirect、回應上限 2 MB（`packages/data-sources/src/live-data.contract.test.ts`） | 已驗收 |
| C-08 | T14、T38 | T14：`packages/core/src/role-runner.test.ts`（故障時不自動切換，回傳下一順位）；詢問畫面於 T24 起的 job 畫面與 T38 | 部分 |
| C-09 | T03 | `supabase/tests/01_rls_enabled.test.sql`、`02_trip_permissions.test.sql`（anon 無權限）；伺服器端只用 anon key | 部分 |
| C-10 | T33 | 待建立 | 未驗收 |
| C-11 | T03 | `apps/web/lib/server/guard.test.ts`；`supabase/tests/03_rate_limit.test.sql`；`apps/web/e2e/guard.spec.ts` | 已驗收 |
| C-12 | T05、T12、T31 | T05：`apps/web/workflows/spike-long-job.workflow.test.ts` 確認 job 輸入與結果帶發起人編號；T12：`decrypt_job_api_key` 只解密發起人的 key（`supabase/tests/08_api_keys.test.sql`）；排程 job 使用 Owner 的 key 於 T31 | 部分 |

## 第 4 節 程式安全

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| S-01 | T09、T18 | T09：`packages/schemas/src/change.test.ts`（提案 schema）、`supabase/tests/05_apply_change.test.sql`（只有 `atps_change_writer` 可寫入正式行程表）；T18：`packages/core/src/output-gate.test.ts`（AI 提案只能是需要批准的種類、只能操作已知項目）、回歸測試集 `packages/ai/src/injection/`（21 筆，沒有批准或正式行程寫入） | 已驗收 |
| S-02 | T06、T14 | T06：`packages/schemas/src/schemas.test.ts`（拒絕未知欄位、格式與上下限）；T14：五個角色的 strict 輸出 schema（`packages/schemas/src/roles.test.ts`）、不符即丟棄並記錄、回傳原因與欄位（`packages/core/src/role-runner.test.ts`）；畫面顯示與重試隨各 job 畫面 | 部分 |
| S-03 | T18、T24 | T18：`packages/security/src/untrusted.test.ts`（資料區塊、偽造標記中和）；回歸測試集 `packages/ai/src/injection/`（七類各 3 筆）；網頁與搜尋結果只產生候選並附來源（`researchCandidate` 的 sources 必填）。呈現端 Markdown sanitize 於 T24 | 部分 |
| S-04 | T14 | `packages/ai/src/roles.test.ts`（五個角色的工具）、`packages/core/src/role-runner.test.ts`（只把內建搜尋交給 AI）、T13 adapter 拒絕清單以外的工具 | 已驗收 |
| S-05 | T16 | `packages/security/src/allowlisted-fetch.test.ts`（SSRF 測試集：IP 直連、DNS 解析至私有位址、redirect 至白名單外、https 與連接埠限制、大小、時間與內容類型上限、白名單設定檔格式、連線固定到已驗證位址）；`address.test.ts`（私有與保留位址）；T20：日本 pack 的 12 個官方主機加入設定檔，`packages/data-sources/src/region-allowlist.test.ts` 確認地區白名單與設定檔一致；連線真實網站於旅前 TBD | 已驗收 |
| S-06 | T14 | `packages/core/src/role-runner.test.ts`（步數與 token 超過即停止並記錄）；`supabase/tests/09_ai_settings.test.sql`；E2E 設定頁顯示每個角色的用量 | 已驗收 |
| S-07 | T17 | `supabase/tests/10_sensitive_fields.test.sql`（Vault 加密、沒有明文欄位、AI 用函式只回傳開啟「提供給 AI」的欄位且只授權 service_role）；`packages/security/src/payload.test.ts`（allowlist builder）；`packages/ai/src/outbound-payload.test.ts`（三家 outbound payload 快照：開關關閉時不含欄位值） | 已驗收 |
| S-08 | T01、T24 | T01：ESLint 禁止 `dangerouslySetInnerHTML`；`apps/web/lib/security-headers.test.ts`（CSP、nonce、HSTS）；`apps/web/e2e/security-headers.spec.ts`（實際回應標頭、腳本 nonce、無 CSP 違規）。T24：Markdown sanitize 與連結限制待建立 | 部分 |
| S-09 | T21 | `packages/security/src/image.test.ts`（JPEG、PNG、WebP 移除 EXIF 與中繼資料、限制類型與大小）；`supabase/tests/12_photos.test.sql`（使用者不可直接寫入 Storage）；E2E `apps/web/e2e/photos.spec.ts`（上傳含 GPS 的照片後儲存的檔案沒有 EXIF） | 已驗收 |
| S-10 | T12、T17 | T12：`redactSecrets`；T17：`redactSensitive`、`createLogger`（`packages/security/src/logger.test.ts`），Server Action 失敗時經遮罩 log；AI 請求紀錄（`ai_usage`）只記錄用量，不含內容；資料庫與 repository 的錯誤訊息不含值 | 已驗收 |
| S-11 | T01 | lockfile 已納入；`.npmrc` `save-exact=true`；`strictDepBuilds: true` | 部分 |
| S-12 | T01、T02 | `.gitignore` 排除 `.env*`；`.env.example`；pre-commit gitleaks 擋下假 secret；CI gitleaks 擋下 PR #3 | 已驗收 |
| S-13 | T04 | `tooling/verify-docker-image.sh`：非 root、無 .env、無 API key | 已驗收 |
| S-14 | T02、T03、T14、T16、T18 | T02：test、typecheck、lint、build、依賴方向、gitleaks、依賴漏洞已啟用（PR #2、#3、#4）；T03：RLS 權限測試已啟用；main 分支保護已啟用（PR #5 為 blocked）；T14：AI 輸出 schema 驗證測試包含在 test；T16：SSRF 測試集包含在 test，並另列 CI 步驟；T18：prompt injection 回歸測試集包含在 test，並另列 CI 步驟。第 4 節列出的關卡全部啟用 | 已驗收 |
| S-15 | 每個 Task | PR #1、#2 附 `/security-review` 結果 | 部分 |
| S-16 | T19、T24 | T19：place_id 由伺服器以 Places 搜尋解析並比對名稱與位置，不符時回傳未解析（`google-maps.contract.test.ts`）；照片只依 place_id 取得。AI 輸出含圖片網址被拒、解析失敗的候選標為 Unverified 於 T24 | 部分 |
| S-17 | T17、T19 | T17：payload builder 排除 place_id、地址、座標、當地名稱，三家 outbound 快照驗證；T19：解析只保存 place_id，不寫入 Google 名稱；詳情、評分與照片標示為不可儲存，只即時顯示；座標逾 30 日由排程清除（`supabase/tests/11_google_coordinates.test.sql`） | 已驗收 |

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
| MEM-11 | T11、T41 | T11：`RoleSpec.memoryScope`、core `scopeMemories`（`packages/core/src/extensions.test.ts`）、`SupabaseMemoryReader.read` 依範圍查詢與過濾（`packages/db/src/repositories.test.ts`）；完整版本於 T41 | 部分 |

## 第 6 節 分享

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| SH-01 | T03 | `supabase/tests/02_trip_permissions.test.sql`（Owner、Companion、Viewer；唯讀連結於 T33） | 部分 |
| SH-02 | T03、T17、T32 | `supabase/tests/02_trip_permissions.test.sql`：trips 與 trip_members 相關各格；T17：「檢視他人敏感欄位：依當事人開關」的 Owner、Companion、Viewer 三格（`10_sensitive_fields.test.sql`），唯讀連結格於 T33；其餘資料表於建立時補 | 部分 |
| SH-03 | T32 | 待建立 | 未驗收 |
| SH-04 | T07、T09、T10A、T34 | T07：`packages/core/src/states.test.ts`；T09：`supabase/tests/05_apply_change.test.sql`（同一 base version 的第二個提案批准時失效）；T10A：`supabase/tests/06_restore_version.test.sql`（base version 不符時復原失敗、復原前的提案批准時失效）；T34 兩個瀏覽器 E2E、真機 R6 待建立 | 部分 |
| SH-05 | T34、T35 | 待建立；真機 R3 | 未驗收 |
| SH-06 | T09、T34 | T09：`supabase/tests/05_apply_change.test.sql`（批准、否決、失效通知成員，未讀可依成員查詢，通知表經 Realtime 推送）、`packages/db/src/change-writer.test.ts`；T34 E2E、真機 R6 待建立 | 部分 |
| SH-07 | T17、T32 | T17：移除成員時刪除其在該行程的敏感欄位與 Vault secret（`10_sensitive_fields.test.sql`）；撤銷存取權與記憶合併於 T32、T41 | 部分 |
| SH-08 | T17、T33 | T17：「提供給 Viewer 與唯讀連結」開關與 Viewer 查詢結果（pgTAP、E2E）；唯讀連結的查詢於 T33 | 部分 |

## 第 7 節 日後新增功能

| 規則 | 負責 Task | 對應測試或項目 | 狀態 |
|---|---|---|---|
| F-01 | T06、T11 | T06：行程項目的預估費用、實際費用、付款人欄位（schema 與 migration）；T11：`ExpenseLedger` 介面與 feature flag `expense_ledger`（`docs/verification/T11.md`） | 已驗收 |
| F-02 | T11 | `Exporter` 介面（`packages/core/src/ports.ts`）與 feature flag `calendar_export` | 已驗收 |
| F-03 | T11 | `Notifier`（站內）、`LocationEvent`、`LocationSource` 介面與 feature flag `push_notifications`、`location_reminders` | 已驗收 |
| F-04 | T11 | `Importer` 介面，`ImportedBooking.constraintClass` 固定為 `hard_constraint`；feature flag `booking_import` | 已驗收 |
| F-05 | T11 | `supabase/tests/07_feature_flags.test.sql`（預設關閉、只讀）；`isFeatureEnabled` 與 `SupabaseFeatureFlagReader` 測試 | 已驗收 |

## 第 9.3 節 AI 評估場景

runner 與判定器：T15（`evals/`）。CI 以錄製回應驗證判定器；第 9.1 節的合格條件是以真 AI 連續執行 5 次全部通過。

| 場景 | 場景檔 | 錄製回應 | 真 AI 5 次 | 狀態 |
|---|---|---|---|---|
| E1 | 待建立 | 無 | TBD | 未驗收 |
| E2 | 待建立 | 無 | TBD | 未驗收 |
| E3 | 待建立 | 無 | TBD | 未驗收 |
| E4 | 待建立 | 無 | TBD | 未驗收 |
| E5 | 待建立 | 無 | TBD | 未驗收 |
| E6 | `evals/scenarios/E6.json` | PASS（`docs/verification/evals/2026-11-23-E6.md`） | TBD | 部分 |
| E7 | 待建立 | 無 | TBD | 未驗收 |
| E8 | 待建立 | 無 | TBD | 未驗收 |
| E9 | 待建立 | 無 | TBD | 未驗收 |

## 沒有負責 Task 的規則

無。C-11 於 2026-11-22 分配至 T03；S-08 的安全標頭分配至 T01，Markdown sanitize 與連結限制分配至 T24。
