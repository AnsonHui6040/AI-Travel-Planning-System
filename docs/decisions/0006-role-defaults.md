# 0006 角色上限、預設供應商與模型選擇

| 項目 | 內容 |
|---|---|
| 狀態 | 已決定 |
| 日期 | 2026-11-23 |
| 決定者 | 使用者 |
| 相關 | 計畫第 11 節、S-04、S-06、C-08、D06、D07、T14 |

## 步數與 token 上限預設值

一次工作中，「步數」是呼叫 AI 的次數上限，「token」是輸入加輸出的總量上限。超過即停止並記錄（S-06）。使用者可在設定頁調整。

| 角色 | 步數 | token |
|---|---|---|
| Research | 6 | 200,000 |
| Verification | 10 | 200,000 |
| Transport | 6 | 120,000 |
| Master Planner | 4 | 150,000 |
| Live Planner | 3 | 60,000 |

## 預設供應商與備援次序

故障時先詢問使用者才切換（C-08）。

| 角色 | 主要 | 備援次序 |
|---|---|---|
| Research | Claude | Gemini、OpenAI |
| Verification | Gemini | OpenAI、Claude |
| Transport | Claude | Gemini、OpenAI |
| Master Planner | Claude | Gemini、OpenAI |
| Live Planner | Claude | Gemini、OpenAI |

Research 與 Verification 預設不同家，核實結果可達 Verified（D07）。

## 模型

| 供應商 | 預設 |
|---|---|
| Claude | `claude-opus-5-5` |
| Gemini、OpenAI | 空白；設定頁以使用者本人的 key 列出可用模型供選擇，選定前該供應商不可使用 |
