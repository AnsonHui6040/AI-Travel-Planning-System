# 自架說明

第一版部署於 Vercel 與 Supabase（D03）。本目錄提供 Docker 自架設定，第一版不部署。

## 建置與執行

於 repo 根目錄執行：

```bash
docker compose -f docker/docker-compose.yml up --build
```

開啟 `http://localhost:3000`，健康檢查為 `http://localhost:3000/api/health`。

## 環境變數

image 不含任何設定值（S-13）。執行時於 repo 根目錄建立 `.env.docker`（已排除於版本控制與 image 之外），欄位見 `.env.example`：

| 變數 | 說明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API 網址 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SITE_URL` | 本站對外網址，用於 Origin 驗證 |

AI 與外部 API key 由使用者於設定頁輸入，存於 Supabase Vault，不放環境變數。

## Supabase

本機使用 `supabase start`。自架 Supabase 請依 Supabase 官方自架文件，並套用 `supabase/migrations/`。

## 驗證

```bash
./tooling/verify-docker-image.sh
```

檢查項目：build 成功、以非 root 執行、image 內沒有 `.env` 與 API key、健康檢查回應 200。

## 容器限制

docker-compose 設定唯讀檔案系統、移除所有 Linux capability、`no-new-privileges`。
