# AI 旅行規劃系統

多 AI 協作的旅行規劃與旅行現場動態調整。計畫見 `docs/implementation-plan.md`。

## 狀態

| 項目 | 內容 |
|---|---|
| 更新日期 | 2026-11-23 |
| 目前 Phase | Phase 2：AI 層與安全 |
| 已完成 Task | T01–T20、T10A |
| 進行中 Task | 無 |
| 下一個 Task | T21：照片（使用者上傳、Wikimedia Commons） |
| 證據 | `docs/verification/T01.md`、`T02.md`、`T03.md`、`T04.md`、`T05.md`、`T06.md`、`T07.md`、`T08.md`、`T09.md`、`T10.md`、`T10A.md`、`T11.md`、`T12.md`、`T13.md`、`T14.md`、`T15.md`、`T16.md`、`T17.md`、`T18.md`、`T19.md`、`T20.md`；評估報告 `docs/verification/evals/`；決策 `docs/decisions/0001`–`0006` |

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
