# AI 旅行規劃系統：專案守則

計畫與規則的唯一依據是 `docs/implementation-plan.md`。本檔與計畫衝突時以計畫為準。

## 指令

| 用途 | 指令 |
|---|---|
| 安裝 | `pnpm install` |
| 單元與工具測試 | `pnpm test`（含 `pnpm test:workflow`，須在 repo 根目錄執行） |
| 型別檢查 | `pnpm typecheck` |
| Lint 與依賴方向 | `pnpm lint`（含 `pnpm depcruise`） |
| Build | `pnpm build` |
| 資料庫（需 Docker） | `supabase start`；套用 migration `supabase db reset`；pgTAP `supabase test db` |
| E2E（390 與 1280） | `pnpm test:e2e`，首次執行前 `pnpm --filter @atps/web exec playwright install chromium` |
| AI 評估（錄製回應，報告寫入 `docs/verification/evals/`） | `pnpm evals:run`；指定場景 `EVAL_SCENARIOS=E6 pnpm evals:run` |

## 結構與依賴

- 目錄依計畫第 2.1 節；套件名稱為 `@atps/<目錄名>`。
- 依賴表只在 `tooling/package-graph.cjs` 修改，改完執行 `pnpm sync:manifests`。dependency-cruiser 規則由同一份表產生。
- 每個套件只經 `src/index.ts` 對外公開（`exports` 只開放 `.`）。`apps/web` 不得 import 套件內部檔案（M-02）。
- `packages/core` 不得 import 任何外部套件或 Node 內建模組；`packages/schemas` 只可 import zod（M-01）。
- 伺服器對外 fetch 一律經 `@atps/security` 的 `createAllowlistedFetch`；網域只在 `packages/security/src/fetch-allowlist.json` 經 PR 加入（S-05）。地區 pack 的 `officialSiteAllowlist` 必須與設定檔一致（`region-allowlist.test.ts`），新增官方來源前先以瀏覽器確認網址。`@atps/security` 使用 Node 內建模組，只可在伺服器端 import。
- TypeScript 6 的 `types` 預設為空；套件要用 Node 型別時在該套件 `tsconfig.json` 設 `"types": ["node"]`。

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
- pre-commit 以 gitleaks 掃描暫存內容，需先 `brew install gitleaks`；`pnpm install` 會經 `prepare` 啟用 husky。

## CI

- `.github/workflows/ci.yml` 的 job 名稱是分支保護要求的 status check 名稱，改名時同步更新分支保護。
- action 一律以 commit SHA 固定版本，註解標示對應 tag。
- Dependabot 只開 security updates，一般版本更新 PR 關閉（D25）。

## 資料庫

- 資料表欄位與 `packages/schemas` 的 row schema 必須一致（`tooling/schema-migration-consistency.test.ts`）；數值上下限見 `docs/decisions/0002-field-validation.md`。
- 新增資料表必須啟用 RLS，policy 依計畫第 6 節權限表，並在 `supabase/tests/` 加 pgTAP 測試。
- 權限判斷用 `private` schema 的 helper（security definer、`search_path = ''`）；`private` 不經 PostgREST 公開。
- E2E 的 `/api/*` 測試需要 `supabase start` 與 `apps/web/.env.local`（範本見 `.env.example`）。需要登入的 E2E 另需本機的 `SUPABASE_SERVICE_ROLE_KEY`（`supabase status -o env` 的 `SERVICE_ROLE_KEY`）。
- API key 只經 `save_api_key`、`decrypt_api_key`、`decrypt_job_api_key` 存取（擁有者 `atps_key_keeper`，只授權 service_role）；service role client 只在 `apps/web/lib/server/supabase.ts` 建立。
- 敏感欄位（全名、電話、電子郵件）只經 `save_sensitive_field`、`set_sensitive_sharing`、`list_trip_sensitive_fields`（session）與 `ai_sensitive_fields`（service_role）存取，擁有者 `atps_pii_keeper`。送往 AI 的 input 一律經 `@atps/security` 的 `buildAiPayload`（S-07）；伺服器 log 一律經 `createLogger`（S-10）。
- 送往 AI 的 input 以 `composeRoleInput` 組成：網頁、搜尋結果、成員自由文字與行程資料放在資料區塊（S-03）。AI 輸出一律經 `handleRoleRun`／`gateRoleOutput` 才寫入，去處只有候選、核實結果、交通估算與待批准提案（S-01）。新增 prompt injection 案例加在 `packages/ai/src/injection/cases.ts`。
- Google Maps 內容只保存 place_id 與 30 日內的座標（D28）；名稱、地址、評分、照片只即時顯示。逾期座標由 pg_cron 每日清除（`private.purge_expired_coordinates`）。導航只用 `directionsUrl`（Maps URLs，不含 key）。
- 照片只經伺服器 `sanitizeImage` 移除 EXIF 後以 service role 寫入 bucket `trip-photos`（使用者沒有 Storage 寫入權）；顯示經同源 `/api/photos/…`（S-09）。
- 即時資料（T22）：天氣用 Open-Meteo（座標只送小數第二位）；氣象廳警報讀 `bosai/warning/data/r8/`（舊的 `data/warning/` 已停止更新）；ODPT 只接 `JAPAN_ODPT_TRAIN_STATUS` 列出的基本ライセンス與 CC 資料集。路線狀態以 core 的 `routeLiveView` 顯示（沒有來源為「無即時資料」），異常營運以 `transitAtRiskChanges` 產生 At Risk 提案；官方運行情報頁的核實結果經 `acceptOfficialTransitReport`。
- 旅行基線（T23）只經 `save_trip_baseline`、`confirm_trip_baseline`（擁有者 `atps_baseline_writer`）寫入；確認前 Server Action 以 core 的 `checkBaseline` 重新檢查，有矛盾不確認。authenticated 沒有 `trips` 的 UPDATE。確定性的評估場景放 `evals/baseline/`。
- 多 AI 研究（T24）：Research A–D 以 `researchTrackInput` 只帶行程與基線，不讀其他方向結論；候選只經 `add_research_candidates`（service_role，擁有者 `atps_candidate_writer`）寫入，一律 Unverified。AI 輸出含圖片網址由 `gateRoleOutput` 拒絕。AI 與網頁內容一律以 `apps/web/components/safe-markdown.tsx` 的 `SafeMarkdown`、`SafeLink` 呈現。
- 交叉核查（T25）：去重用 core 的 `findDuplicateGroups`，合併只經 `merge_duplicate_candidates`；核實結果先經 `crossCheck`（證據順序、Conflict、同一家上限）再經 `apply_verification` 寫入（擁有者 `atps_verification_writer`，資料庫再套一次同一家上限）。事實主張存 `fact_claims`，判定結果存 `facts`。確定性評估場景放 `evals/crosscheck/`。
- 候選篩選（T26，決策 0007 暫定）：core 的 `screenCandidates` 以確定性規則評八個維度與 Primary／Backup，只經 `apply_candidate_scores` 寫入。
- 地理分區（T27，D29）：以 Transport 的模型設定執行 `zoningSpec`；輸入以 core 的 `zoningInput` 組成，不可加入 place_id、座標等 Google Maps 內容；輸出經 `gateZoningOutput` 檢查、`ensureZoneBackups` 補 Backup 後只經 `apply_zoning` 寫入。
- 交通動線（T28，D27、決策 0008）：每個估算經 core 的 `withBuffer` 加固定緩衝（每段 10 分鐘＋每次轉乘 5 分鐘），`comparePlans` 產生四種方案；只經 `apply_mobility_segments` 寫入；Google Maps 連結用 `directionsUrl`（含 origin）。
- workflow 測試（`pnpm test:workflow`）會打包 repo 內所有 workflow；`tooling/workflow-test-loader.mjs` 讓測試 worker 載入工作區套件的 TypeScript 原始碼。
- React 19 在 Server Action 完成後會重設 `<form>`：受控的輸入欄位（尤其核取方塊）不要放在送出用的 form 內。
- 函式擁有者沒有 `auth` schema 權限；security definer 函式取目前使用者用 `private.session_user_id()`（T09）。
