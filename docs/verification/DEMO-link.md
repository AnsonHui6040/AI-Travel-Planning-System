# 本機一鍵登入連結

| 項目 | 內容 |
|---|---|
| 原因 | 使用者要直接開啟測試連結，不經登入頁；原本的 magic link 使用 PKCE，只能在發出請求的同一個瀏覽器開啟 |
| 分支 | `feat/demo-link` |
| 日期 | 2026-11-27 |

## 內容

| 項目 | 說明 |
|---|---|
| `pnpm --filter @atps/web demo:link 電子郵件` | 只可用於本機（Supabase 與 `SITE_URL` 都須為 localhost／127.0.0.1）；使用者不存在時建立；印出只可用一次的連結，有行程時直接進入最新的行程 |
| `/auth/callback` | 除 `code` 外，接受 `token_hash`（type 只限 magiclink、email），由伺服器以 `verifyOtp` 驗證；`next` 仍經 `safeRedirectPath` |

## 驗證

| 項目 | 結果 |
|---|---|
| `e2e/entry.spec.ts` 新測試（390、1280） | 連結在另一個瀏覽器開啟即登入；同一連結第二次使用導向 `auth_error=1` |
| `pnpm test:e2e`（production build） | 140 通過 |
| `pnpm test` | 1554＋4 通過 |
| typecheck、lint | 通過 |

## 安全檢查（S-15）

| 項目 | 結果 |
|---|---|
| 連結 | 一次性、由 Supabase 驗證並有到期時間；只存在本機終端輸出 |
| 腳本 | 拒絕非本機網址；service role key 不輸出 |
| 回呼 | type 只接受 magiclink、email；`next` 只允許站內路徑 |
