# AI 旅行規劃系統

多 AI 協作的旅行規劃與旅行現場動態調整。計畫見 `docs/implementation-plan.md`。

## 狀態

| 項目 | 內容 |
|---|---|
| 更新日期 | 2026-11-28 |
| 目前 Phase | Phase 7：旅後與記憶 |
| 已完成 Task | T01–T41、T10A；決策 0010 的 X 記帳與分帳、E 行程編輯＋S 搜尋加入地點、B 預訂與清單 |
| 進行中 Task | 無 |
| 下一個 Task | 決策 0010 的 I 行程匯入；真機 R1–R8、B-R1 與介面真機檢視（需使用者） |
| 證據 | `docs/verification/T01.md`、`T02.md`、`T03.md`、`T04.md`、`T05.md`、`T06.md`、`T07.md`、`T08.md`、`T09.md`、`T10.md`、`T10A.md`、`T11.md`、`T12.md`、`T13.md`、`T14.md`、`T15.md`、`T16.md`、`T17.md`、`T18.md`、`T19.md`、`T20.md`、`T21.md`、`T22.md`、`T23.md`、`T24.md`、`T25.md`、`T26.md`、`T27.md`、`T28.md`、`T29.md`、`T30.md`、`T31.md`、`T32.md`、`T33.md`、`T34.md`、`T35.md`、`T36.md`、`T37.md`、`T38.md`、`T39.md`、`T40.md`、`T41.md`、`UI-oryzo.md`、`UI-astryx-buttons.md`、`ENTRY.md`、`X-expenses.md`、`E-S.md`、`B-bookings.md`；截圖 `docs/verification/screenshots/`；評估報告 `docs/verification/evals/`；決策 `docs/decisions/0001`–`0009` |

## 開發

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm evals:run
```

環境變數範本見 `.env.example`。

### 在本機試用

1. 啟動資料庫：`supabase start`（需 Docker）
2. 啟動 App：`pnpm --filter @atps/web dev`
3. 開啟 http://localhost:3000/login，輸入電子郵件並寄送登入連結
4. 到本機測試信箱 http://localhost:54324 開啟那封信的連結（本機不會寄出真正的電子郵件）
5. 想先看有內容的行程：`pnpm --filter @atps/web demo:seed 你的電子郵件`，回到首頁重新整理

元件樣板在 http://localhost:3000/styleguide。
