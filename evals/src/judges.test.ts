import { describe, expect, it } from "vitest";
import { judgeOutput, parseScenario, type PlannerOutput } from "./index";
import e6 from "../scenarios/E6.json";

// T15：硬性規則判定器。每個判定器都要能對刻意違規的輸出判定失敗
const scenario = parseScenario(e6);
const COFFEE = "e6000000-0000-4000-8000-000000000004";
const DESSERT = "e6000000-0000-4000-8000-000000000007";
const DINNER = "e6000000-0000-4000-8000-000000000005";
const MEIJI = "e6000000-0000-4000-8000-000000000006";

type Operation = PlannerOutput["proposals"][number]["operations"][number];

const output = (operations: Operation[], changeKind: PlannerOutput["proposals"][number]["changeKind"] = "minor_non_incident"): PlannerOutput => ({
  proposals: [{ changeKind, versionKind: "minor", summary: "調整", operations }],
});

const clearCoffee: Operation = { op: "schedule_item", itemId: COFFEE, date: null, start: null, end: null };

function failed(out: PlannerOutput) {
  return judgeOutput(scenario, out)
    .filter((r) => !r.pass)
    .map((r) => r.judge);
}

describe("判定器", () => {
  it("只調整同一時段的提案全部通過", () => {
    const results = judgeOutput(scenario, output([clearCoffee, { op: "schedule_item", itemId: DESSERT, date: "2026-12-03", start: "16:00", end: "17:00" }]));
    expect(results.every((r) => r.pass)).toBe(true);
    // 隱含的判定（項目都存在）加上場景列出的五個
    expect(results).toHaveLength(6);
  });

  it("改動其他日期的項目時判定失敗", () => {
    const out = output([clearCoffee, { op: "schedule_item", itemId: MEIJI, date: "2026-12-04", start: "13:00", end: "14:30" }]);
    expect(failed(out)).toEqual(expect.arrayContaining(["within_window", "dates_unchanged"]));
  });

  it("把項目移入其他日期時判定失敗", () => {
    const out = output([{ op: "schedule_item", itemId: COFFEE, date: "2026-12-05", start: "16:00", end: "17:00" }]);
    expect(failed(out)).toEqual(expect.arrayContaining(["within_window", "dates_unchanged"]));
  });

  it("新時段超出同一時段時判定失敗", () => {
    const out = output([clearCoffee, { op: "schedule_item", itemId: DESSERT, date: "2026-12-03", start: "15:30", end: "17:00" }]);
    expect(failed(out)).toEqual(["within_window"]);
  });

  it("移動已付款活動時判定失敗", () => {
    const out = output([{ op: "schedule_item", itemId: DINNER, date: "2026-12-03", start: "16:00", end: "17:00" }]);
    expect(failed(out)).toEqual(expect.arrayContaining(["items_preserved", "within_window"]));
  });

  it("標示 At Risk 不算移動已付款活動，但仍受時段限制", () => {
    const out = output([clearCoffee, { op: "set_at_risk", itemId: DINNER, atRisk: true }]);
    expect(failed(out)).toEqual(["within_window"]);
  });

  it("提案的變更種類不需要批准時判定失敗", () => {
    expect(failed(output([clearCoffee], "new_candidate"))).toEqual(["requires_approval"]);
  });

  it("提案數量超出範圍時判定失敗", () => {
    const many: PlannerOutput = { proposals: Array.from({ length: 4 }, () => output([clearCoffee]).proposals[0] as PlannerOutput["proposals"][number]) };
    expect(failed(many)).toEqual(["proposal_count"]);
  });

  it("操作的項目不在行程資料中時判定失敗", () => {
    const out = output([{ op: "set_at_risk", itemId: "e6000000-0000-4000-8000-0000000000ff", atRisk: true }]);
    expect(failed(out)).toContain("known_items");
  });

  it("失敗的判定說明違規的項目", () => {
    const out = output([clearCoffee, { op: "schedule_item", itemId: MEIJI, date: "2026-12-04", start: "13:00", end: "14:30" }]);
    const result = judgeOutput(scenario, out).find((r) => r.judge === "dates_unchanged");
    expect(result?.detail).toContain("明治神宮");
  });

  it("變更種類限制：不在允許清單時判定失敗", () => {
    const major = parseScenario({ ...e6, judges: [{ type: "change_kind", allowed: ["major_version"] }] });
    expect(judgeOutput(major, output([clearCoffee])).find((r) => r.judge === "change_kind")?.pass).toBe(false);
    expect(judgeOutput(major, output([clearCoffee], "major_version")).find((r) => r.judge === "change_kind")?.pass).toBe(true);
  });

  it("只從候選清單選擇：排入未排程且不是候選的項目時判定失敗", () => {
    const base = parseScenario({
      ...e6,
      trip: {
        items: [
          ...e6.trip.items,
          { id: "e6000000-0000-4000-8000-000000000008", name: "未核實地點", status: "rejected", date: null, start: null, end: null },
        ],
      },
      judges: [{ type: "only_candidates" }],
    });
    const bad = output([{ op: "schedule_item", itemId: "e6000000-0000-4000-8000-000000000008", date: "2026-12-03", start: "16:00", end: "17:00" }]);
    const good = output([{ op: "schedule_item", itemId: DESSERT, date: "2026-12-03", start: "16:00", end: "17:00" }]);
    expect(judgeOutput(base, bad).find((r) => r.judge === "only_candidates")?.pass).toBe(false);
    expect(judgeOutput(base, good).find((r) => r.judge === "only_candidates")?.pass).toBe(true);
  });
});
