# 按鈕改用 Meta Astryx 的邏輯與外觀

| 項目 | 內容 |
|---|---|
| 決定 | 2026-11-27 使用者選定「邏輯加外觀」（參考 github.com/meta/astryx 與 astryx.atmeta.com 的 Button 文件，v0.7.17） |
| 範圍 | 全部 33 個按鈕、行程分頁、輸入欄；色彩維持 ORYZO 工作版 |
| 分支 | `feat/ui-astryx-buttons` |

## 現況（改版前）

| 項目 | 數字 |
|---|---|
| 按鈕 | 33 個、17 個檔案 |
| 有層級的按鈕 | 1 個（其餘外觀相同） |
| 有確認步驟的不可逆操作 | 只有成員移除 |
| 沒有確認的不可逆操作 | 刪除記憶、刪除 API key、否決提案、否決旅後記憶提案、產生 Actual Timeline |

## Astryx 的規則與套用

| Astryx 規則 | 套用 |
|---|---|
| 四種變體：primary、secondary、ghost、destructive | `primary`（實心 `#382416`）、`secondary`（文字色 10% 填色）、`ghost`（無填色）、`danger`（點綴色 8% 填色、點綴色字） |
| 每個畫面只有一個 primary | 執行 Morning Check、產生替代方案、結束今天、確認 Trip Baseline、開始研究、新增記憶等；清單中重複出現的批准改為 secondary |
| destructive 的不可逆操作先確認 | 刪除記憶、刪除 API key、否決提案、否決旅後記憶提案、產生 Actual Timeline 以 `window.confirm` 確認；基線表單的「刪除航班」等只移除尚未儲存的列，不確認 |
| 導覽用連結，不用按鈕 | 行程分頁、Incident Mode、Actual Timeline 維持連結 |
| 長時間動作顯示載入狀態 | 沿用既有的「儲存中…」「產生中…」並停用按鈕 |
| 外觀：10px 圓角、無外框、14px 字重 500、高 32px | 10px 圓角、無外框、字重 500；高度 44px、字級 17px（旅行當天戶外單手操作） |

危險按鈕的填色原為 16%，點綴色字對填色只有 4.13:1，改為 8%（淺色 4.64:1、深色 4.59:1）。

## 驗證

| 指令 | 結果 |
|---|---|
| `tooling/ui-buttons.test.ts` | 每個按鈕都有變體；刪除、否決、移除、撤銷、退出為 danger；5 個會寫入的危險操作有確認 |
| `tooling/ui-tokens.test.ts` | 按鈕文字對按鈕填色至少 4.5:1（兩種模式） |
| `apps/web/e2e/theme.spec.ts` | 當日行程只有一個 primary；按鈕 10px 圓角、無外框、至少 44px |
| E2E 確認訊息 | `timeline.spec.ts`、`memory.spec.ts`、`api-keys.spec.ts` 檢查確認文字並接受 |
| `pnpm test` | 1504＋4 通過 |
| `pnpm test:e2e` | 114 通過 |
| `pnpm typecheck`、`pnpm lint` | 通過 |

截圖：`docs/verification/screenshots/UI-{today,timeline,memories,home}-{light,dark}-{390,1280}.png`（已更新為新樣式）。

真機檢視為 TBD。
