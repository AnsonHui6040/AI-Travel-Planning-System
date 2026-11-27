# 修正：登入一小時後頁面回應 500

| 項目 | 內容 |
|---|---|
| 現象 | 登入超過一小時（access token 到期）再開首頁或任何需要登入的頁面，回應 500 |
| 原因 | Server Component 讀 session 時 Supabase 自動更新 token 並寫 cookie，Next.js 只允許在 Server Action 或 Route Handler 寫 cookie |
| 分支 | `fix/session-refresh` |
| 日期 | 2026-11-27 |

## 修正

| 檔案 | 說明 |
|---|---|
| `apps/web/proxy.ts` | 每次頁面請求先以 `auth.getUser()` 更新 session；新 cookie 同時寫入轉給頁面的請求與回應 |
| `apps/web/lib/server/supabase.ts` | Server Component 寫 cookie 失敗時略過（session 已由 proxy 更新）；Server Action、Route Handler 照常寫入 |

## 驗證

| 項目 | 結果 |
|---|---|
| `apps/web/e2e/session-refresh.spec.ts`（390、1280） | 修正前失敗（回應 500）；修正後通過：把 session 的到期時間改為過去，首頁回應 200，cookie 更新為新的到期時間 |
| `pnpm test:e2e`（production build） | 124 通過 |
| `pnpm test` | 1522＋4 通過 |
| typecheck、lint | 通過 |

## 安全檢查（S-15）

| 項目 | 結果 |
|---|---|
| 驗證方式 | proxy 用 `getUser()`（向 Supabase Auth 驗證 token），不信任 cookie 內容 |
| 金鑰 | proxy 只用 anon key，沒有 service role |
| CSP | nonce 與 CSP 標頭在重建回應後照常設定（`security-headers.spec.ts` 通過） |
