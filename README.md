# AI 旅行規劃系統

多 AI 協作的旅行規劃與旅行現場動態調整。計畫見 `docs/implementation-plan.md`。

## 狀態

| 項目 | 內容 |
|---|---|
| 更新日期 | 2026-11-23 |
| 目前 Phase | Phase 2：AI 層與安全 |
| 已完成 Task | T01–T13、T10A |
| 進行中 Task | 無 |
| 下一個 Task | T14：五個 RoleSpec、模型與備援設定 |
| 證據 | `docs/verification/T01.md`、`T02.md`、`T03.md`、`T04.md`、`T05.md`、`T06.md`、`T07.md`、`T08.md`、`T09.md`、`T10.md`、`T10A.md`、`T11.md`、`T12.md`、`T13.md`；決策 `docs/decisions/0001`–`0005` |

## 開發

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

環境變數範本見 `.env.example`。
