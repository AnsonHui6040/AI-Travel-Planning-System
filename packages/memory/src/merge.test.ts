import { describe, expect, it } from "vitest";
import {
  CONSTRAINT_CATALOG,
  identityViolation,
  memoryBlockContent,
  mergeMemories,
  postTripMemoryProposals,
  type MemoryEntry,
} from "./merge";

// T41：第 5 節記憶。MEM-07 合併、MEM-08 最保守值（決策 0009）、身分與聯絡資料不寫入、MEM-11 範圍、旅後提案（MEM-04）

const c = (item: string, value: string, unit: string | null = null, layer: MemoryEntry["layer"] = "personal"): MemoryEntry => ({
  layer,
  kind: "constraint",
  item,
  value,
  unit,
});
const p = (item: string, value: string, layer: MemoryEntry["layer"] = "personal"): MemoryEntry => ({ layer, kind: "preference", item, value, unit: null });

describe("CONSTRAINT_CATALOG（決策 0009）", () => {
  it("固定清單的項目、單位與保守方向", () => {
    expect(CONSTRAINT_CATALOG.map((e) => [e.item, e.unit, e.conservative])).toEqual([
      ["每日步行上限", "公里", "min"],
      ["單次連續步行", "分鐘", "min"],
      ["每日活動時數", "小時", "min"],
      ["每日轉乘上限", "次", "min"],
      ["休息間隔", "分鐘", "min"],
      ["每日預算上限", null, "min"],
      ["最早出發", null, "latest"],
      ["最晚回住宿", null, "earliest"],
      ["飲食限制", null, "union"],
    ]);
  });
});

describe("mergeMemories（MEM-07、MEM-08）", () => {
  it("合併所有成員的記憶；數值限制取最保守值並標示衝突", () => {
    const merged = mergeMemories([
      c("每日步行上限", "12", "公里"),
      c("每日步行上限", "8", "公里"),
      c("每日轉乘上限", "3", "次"),
      c("每日轉乘上限", "3", "次"),
    ]);
    expect(merged).toEqual([
      { layer: "personal", kind: "constraint", item: "每日步行上限", value: "8", unit: "公里", conflict: true },
      { layer: "personal", kind: "constraint", item: "每日轉乘上限", value: "3", unit: "次", conflict: false },
    ]);
  });

  it("時間限制：最早出發取最晚、最晚回住宿取最早", () => {
    const merged = mergeMemories([c("最早出發", "08:00"), c("最早出發", "09:30"), c("最晚回住宿", "22:00"), c("最晚回住宿", "20:30")]);
    expect(merged.map((m) => [m.item, m.value, m.conflict])).toEqual([
      ["最早出發", "09:30", true],
      ["最晚回住宿", "20:30", true],
    ]);
  });

  it("預算以相同幣別比較，不同幣別全部保留", () => {
    const merged = mergeMemories([c("每日預算上限", "20000", "JPY"), c("每日預算上限", "15000", "JPY"), c("每日預算上限", "3000", "TWD")]);
    expect(merged.map((m) => [m.value, m.unit, m.conflict])).toEqual([
      ["15000", "JPY", true],
      ["3000", "TWD", false],
    ]);
  });

  it("飲食限制全部保留（相同的只留一個）", () => {
    const merged = mergeMemories([c("飲食限制", "不吃牛肉"), c("飲食限制", "花生過敏"), c("飲食限制", "不吃牛肉")]);
    expect(merged.map((m) => m.value)).toEqual(["不吃牛肉", "花生過敏"]);
    expect(merged.every((m) => !m.conflict)).toBe(true);
  });

  it("清單外的限制與偏好全部保留，不合併", () => {
    const merged = mergeMemories([c("不坐夜間巴士", "是"), c("不坐夜間巴士", "否"), p("喜歡的活動類型", "攝影"), p("喜歡的活動類型", "美術館")]);
    expect(merged.map((m) => [m.item, m.value, m.conflict])).toEqual([
      ["不坐夜間巴士", "是", false],
      ["不坐夜間巴士", "否", false],
      ["喜歡的活動類型", "攝影", false],
      ["喜歡的活動類型", "美術館", false],
    ]);
  });

  it("清單內但數值無法判讀時保留原值，不參與比較", () => {
    const merged = mergeMemories([c("每日步行上限", "8", "公里"), c("每日步行上限", "少走一點", "公里")]);
    expect(merged.map((m) => [m.value, m.conflict])).toEqual([
      ["8", false],
      ["少走一點", false],
    ]);
  });

  it("輸出不含擁有者等來源成員資訊（MEM-08）", () => {
    const merged = mergeMemories([{ ...c("每日步行上限", "8", "公里"), owner_id: "u1" } as MemoryEntry]);
    expect(Object.keys(merged[0] ?? {}).sort()).toEqual(["conflict", "item", "kind", "layer", "unit", "value"]);
  });
});

describe("identityViolation（MEM-07：身分與聯絡資料不寫入記憶）", () => {
  it.each([
    ["電子郵件", "a@example.com"],
    ["聯絡方式", "someone@example.test"],
    ["電話", "0912-345-678"],
    ["緊急聯絡", "+81 90 1234 5678"],
    ["姓名", "王小明"],
    ["護照號碼", "A12345678"],
    ["住址", "台中市"],
  ])("拒絕 %s：%s", (item, value) => {
    expect(identityViolation(item, value)).not.toBeNull();
  });

  it.each([
    ["每日步行上限", "8"],
    ["最早出發", "09:30"],
    ["每日預算上限", "20000"],
    ["飲食限制", "不吃牛肉"],
  ])("允許 %s：%s", (item, value) => {
    expect(identityViolation(item, value)).toBeNull();
  });
});

describe("memoryBlockContent（MEM-11）", () => {
  const merged = mergeMemories([c("每日步行上限", "12", "公里"), c("每日步行上限", "8", "公里"), p("喜歡的活動類型", "攝影", "planning_rules")]);

  it("只包含角色記憶範圍內的層級與類型", () => {
    const text = memoryBlockContent(merged, { layers: ["personal"], kinds: ["constraint"] });
    expect(text).toContain("每日步行上限：8 公里（成員間有不同設定，已取最保守值）");
    expect(text).not.toContain("攝影");
  });

  it("範圍為空時沒有內容", () => {
    expect(memoryBlockContent(merged, { layers: [], kinds: [] })).toBe("");
  });
});

describe("postTripMemoryProposals（MEM-03、MEM-04）", () => {
  it("依比較報告產生待批准的 Planning Rules 提案", () => {
    const proposals = postTripMemoryProposals({
      stayDifferences: [
        { date: "2026-11-20", itemId: "a", name_zh: "淺草寺", plannedMinutes: 90, actualMinutes: 120, diffMinutes: 30 },
        { date: "2026-11-20", itemId: "b", name_zh: "晴空塔", plannedMinutes: 90, actualMinutes: 110, diffMinutes: 20 },
      ],
      transportDifferences: [
        { date: "2026-11-20", fromItemId: "a", toItemId: "b", fromName: "淺草寺", toName: "晴空塔", estimatedMinutes: 20, actualMinutes: 35, diffMinutes: 15 },
      ],
      backupsUsed: [{ date: "2026-11-20", itemId: "c", name_zh: "備案咖啡廳", backup: true }],
      crowdedSlots: [{ date: "2026-11-20", from: "11:00", until: "12:30", itemIds: ["b"], reasons: ["部分完成"] }],
      unreliableRecommendations: [{ itemId: "b", name_zh: "晴空塔", provider: "openai", model: "gpt-x", reason: "旅後標示不推薦" }],
      favoriteActivityTypes: [{ type: "restaurant", score: 3, count: 2 }],
    });
    expect(proposals.map((x) => [x.layer, x.kind, x.item, x.value, x.unit])).toEqual([
      ["planning_rules", "preference", "停留時間調整", "25", "分鐘"],
      ["planning_rules", "preference", "交通估算額外緩衝", "15", "分鐘"],
      ["planning_rules", "preference", "Backup 實際使用", "1", "次"],
      ["planning_rules", "preference", "每日安排密度", "減少", null],
      ["planning_rules", "preference", "不可靠的建議來源", "OpenAI（gpt-x）：晴空塔", null],
      ["planning_rules", "preference", "喜歡的活動類型", "餐飲", null],
    ]);
    for (const x of proposals) {
      expect(x.reason.length).toBeGreaterThan(0);
      expect(identityViolation(x.item, x.value)).toBeNull();
    }
  });

  it("差異小於門檻時不提出", () => {
    expect(
      postTripMemoryProposals({
        stayDifferences: [{ date: "d", itemId: "a", name_zh: "a", plannedMinutes: 60, actualMinutes: 65, diffMinutes: 5 }],
        transportDifferences: [{ date: "d", fromItemId: "a", toItemId: "b", fromName: "a", toName: "b", estimatedMinutes: 20, actualMinutes: 25, diffMinutes: 5 }],
        backupsUsed: [],
        crowdedSlots: [],
        unreliableRecommendations: [],
        favoriteActivityTypes: [],
      }),
    ).toEqual([]);
  });
});
