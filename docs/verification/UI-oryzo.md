# 介面改版驗證紀錄（ORYZO 工作版）

| 項目 | 內容 |
|---|---|
| Task | 介面改為 ORYZO 風格 |
| 決定 | 2026-11-27 使用者選定方向 A（審查與方向見 `docs/verification/ui-review-2026-11-27.md`） |
| 分支 | `feat/ui-oryzo` |
| 日期 | 2026-11-27 |

## 審查問題的處理

| 問題 | 處理 | 證據 |
|---|---|---|
| U-1 深色模式對比 2.91:1 | 全域 `apps/web/app/globals.css` 設定深淺兩組 token 與 `body` 背景 | `tooling/ui-tokens.test.ts`：兩種模式的文字、次要文字、點綴對底色與表面色都至少 4.5:1；E2E `apps/web/e2e/theme.spec.ts` 以瀏覽器實際算出的顏色檢查 4 個頁面所有文字至少 4.5:1 |
| U-2 只有 3 個 CSS 有深色 | 頁面 CSS 不再處理深色，一律使用 token | `ui-tokens.test.ts`：13 個頁面 CSS 不含寫死的顏色與 `prefers-color-scheme` |
| U-3 18 個顏色、11 個字級 | 顏色 9 個 token（每種模式）、字級 5 個 token（15、17、17、20、28px）、圓角 3 種（膠囊、12px、輸入欄 0） | `globals.css` |
| U-4 沒有導覽 | 行程內加膠囊分頁（今天、每日、候選、提案、記憶、旅後），手機寬度為一列六等分；當日行程頁移除「行程記憶」連結 | E2E 檢查分頁文字與目前頁 |
| U-5 按鈕 40px | 按鈕、分頁與輸入欄最小 44px | E2E 檢查所有按鈕與分頁至少 44px |
| U-6 次要文字 12.8px | 次要文字 15px、正文 17px | `globals.css` |
| U-7 首頁沒有字型與背景 | 全域設定字型、背景與文字色 | 截圖 `UI-home-*.png` |

## 樣式

| 項目 | 淺色 | 深色 |
|---|---|---|
| 底色 | `#fbf3e8` | `#100904` |
| 表面 | `#f3e6d4` | `#1c120a` |
| 文字 | `#100904` | `#ffedd7` |
| 次要文字 | `#5c4f42` | `#a8988a` |
| 分隔線（1px 虛線） | `#d9c8b3` | `#40372e` |
| 點綴（At Risk、衝突、晚到、錯誤） | `#b34100` | `#dc5000` |
| 實心（目前分頁、主要動作） | `#382416` 配 `#ffedd7` | 同左 |

- 英文標題全大寫、字距 0.04em（MORNING CHECK、PLANNED VS ACTUAL）；中文以字重 500 表現。
- 字型使用系統字型（iPhone 為 SF Pro，接近 ORYZO 的 Inter 替代），不下載網路字型，符合 CSP `font-src 'self'`。
- 原本的綠色完成標示改為文字色；整個介面只保留一個點綴色。
- `themeColor` 與 manifest 改為暖黑與暖紙色。

## 驗證結果

| 指令 | 結果 |
|---|---|
| `pnpm test` | 1452＋4 通過（新增 `ui-tokens.test.ts` 30） |
| `pnpm test:e2e` | 114 通過（新增 `theme.spec.ts`：淺色、深色 × 390、1280） |
| `pnpm typecheck`、`pnpm lint`（含 depcruise）、`pnpm build` | 通過（build 由 E2E 的 webServer 執行） |

截圖：`docs/verification/screenshots/UI-{today,timeline,memories,home}-{light,dark}-{390,1280}.png`。

## 未完成

| 項目 | 狀態 |
|---|---|
| 真機檢視（戶外陽光下淺色、夜間深色） | TBD：需使用者以 iPhone 確認 |
| 其他頁面的個別調整 | 全部頁面已改用 token 與新控制項；版面維持原結構，若真機發現個別頁面需要調整再處理 |
