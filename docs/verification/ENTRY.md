# 進入 App：登入、建立行程、示範資料

| 項目 | 內容 |
|---|---|
| 原因 | 使用者要在瀏覽器實際進入測試；原本只有 `/auth/callback`，沒有登入頁與建立行程的畫面，所有測試都以資料庫直接建立帳號與行程 |
| 分支 | `feat/login-entry` |
| 日期 | 2026-11-27 |

## 內容

| 項目 | 說明 |
|---|---|
| `/login` | Email magic link（D05）。回呼固定為站內 `/auth/callback`，`next` 只允許站內路徑；已登入時直接導向。本機的信件在 Supabase 的測試信箱 Mailpit（http://localhost:54324） |
| 首頁 | 未登入顯示「登入」；登入後顯示「我的行程」（本人是成員的行程）、建立行程、未讀通知、At Risk、設定連結與登出 |
| 建立行程 | 以本人 session 寫入（RLS：只能以本人為 Owner）；編號由伺服器產生（Owner 成員由 trigger 加入，insert 讀不回新列），建立後進入 Trip Baseline |
| 示範資料 | `pnpm --filter @atps/web demo:seed 電子郵件`：為已登入過的使用者建立「東京三日（示範）」（今天起三天、6 個排定項目、2 個 Backup、1 個未核實候選、1 個待批准提案）。只可寫入本機 Supabase |

## 驗證

| 項目 | 結果 |
|---|---|
| `apps/web/lib/server/entry-core.test.ts` | 7 通過：寄送與站內導向、外部 `next` 改為首頁、格式錯誤不寄送、失敗不外洩；建立行程的欄位與登入、速率限制 |
| `apps/web/e2e/entry.spec.ts`（390、1280） | 未登入導向登入、從 Mailpit 取得連結登入、建立行程進入基線、首頁清單、分頁、登出；外部 `next` 不採用；示範資料腳本建立的行程在當日行程、候選、提案、每日可見 |
| `pnpm test` | 1522＋4 通過 |
| `pnpm test:e2e` | 122 通過 |
| typecheck、lint | 通過 |

## 安全檢查（S-15）

| 項目 | 結果 |
|---|---|
| 開放式重新導向 | `next` 經 `safeRedirectPath`，外部網址改為 `/`（單元測試與 E2E） |
| 帳號列舉 | 不論電子郵件是否存在都回應相同訊息 |
| 寄送頻率 | 由 Supabase Auth 的 email 限制控管 |
| 示範腳本 | 只在本機執行，網址不是 localhost／127.0.0.1 時拒絕；使用 service role，但不寫入記憶（T41 撤銷了寫入權） |

## 未完成

| 項目 | 狀態 |
|---|---|
| Google 登入按鈕 | 需要 Google OAuth 設定（使用者提供 client secret），未加入 |
| 手機經區域網路登入 | 登入連結指向 `SITE_URL`（localhost），在 iPhone 上無法開啟；先在 Mac 測試 |
