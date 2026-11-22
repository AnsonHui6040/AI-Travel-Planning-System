# AI 旅行規劃系統

多 AI 協作的旅行規劃與旅行現場動態調整。計畫見 `docs/implementation-plan.md`。

## 狀態

| 項目 | 內容 |
|---|---|
| 更新日期 | 2026-11-22 |
| 目前 Phase | Phase 0：基礎建設 |
| 已完成 Task | 無（T01 待 PR merge） |
| 進行中 Task | T01：workspace、工具鏈、依賴方向檢查 |
| 下一個 Task | T02：GitHub Actions CI 關卡 |
| 證據 | `docs/verification/T01.md` |

## 開發

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

環境變數範本見 `.env.example`。
