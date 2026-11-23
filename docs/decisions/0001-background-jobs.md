# 0001 背景 job：採用 Vercel Workflow

| 項目 | 內容 |
|---|---|
| 狀態 | 已決定 |
| 日期 | 2026-11-23 |
| 決定者 | 使用者 |
| 相關 | 計畫第 11 節、T05、C-12、D03 |

## 背景

多個 AI 平行研究（T24）、旅前再核實（T31）、Morning Check（T36）等工作需時數分鐘，必須在背景執行，並支援逾時、重試、取消與進度回報。

## 比較

| 面向 | Vercel Workflow | Supabase Queues（pgmq） |
|---|---|---|
| 重試 | 內建：每個 step 預設最多重試 3 次；`FatalError` 不重試，`RetryableError` 可指定延遲 | 沒有內建重試上限與失敗佇列，須自行以讀取次數實作 |
| 逾時 | 工作拆成 step，各自執行；`sleep` 期間不佔用運算資源；單一操作以 `Promise.race` 加 `sleep` 設逾時 | worker 以 Edge Function 執行，單次上限：免費方案 150 秒、付費方案 400 秒 |
| 取消 | `getRun(runId).cancel()` 於下一個暫停點停止整個 run；`AbortSignal` 可協同取消進行中的操作 | 須自行實作 |
| 進度回報 | `getWritable()` 寫入串流，`run.getReadable()` 讀取 | 須自行以資料表實作 |
| 費用 | Vercel Hobby 每月含 50,000 個 Workflow 事件；run 資料保留 1 天 | 在現有資料庫內 |
| 自架（D03） | SDK 開源；`@workflow/world-postgres` 為官方 Postgres 參考實作 | 本來就在 Supabase 內 |

## 決定

採用 Vercel Workflow（`workflow` 5.7.1）。

## 理由

重試、分步執行、取消、進度串流均為內建，可大幅減少自行實作與測試的程式量；不受 Edge Function 單次 150 秒的限制。

## 後果

| 項目 | 處理 |
|---|---|
| Hobby 只限個人非商業使用 | 與第 8.10 節一致：公開前改用 Pro 方案 |
| run 資料只保留 1 天 | job 的發起人、狀態與用量另存於背景 job 資料表（第 2.11 節，T06） |
| 取消不會中斷進行中的 step | AI 呼叫的 step 接收 `AbortSignal` 並傳給 fetch |
| C-12 | job 輸入一律包含發起人編號，step 只能解密發起人本人的 API key（T12） |
| 自架 | `@workflow/world-postgres` 尚未實測，於自架部署前驗證 |
| proxy | `apps/web/proxy.ts` 的 matcher 排除 `.well-known/workflow/` |
