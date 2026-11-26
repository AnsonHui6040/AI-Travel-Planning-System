import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIncidentScenario, renderIncidentReport, runIncidentScenario } from "./index";

// T38：Incident Mode 的評估場景（E1 後段、E2、E6、E8）。確定性規則，不呼叫 AI 或外部 API

const dir = join(import.meta.dirname, "..", "incident");
const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));

describe("Incident Mode 評估場景", () => {
  it("E1、E2、E6、E8 都符合格式並通過", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(["E1.json", "E2.json", "E6.json", "E8.json"]);
    for (const file of files) {
      const scenario = parseIncidentScenario(read(file));
      expect(`${scenario.id}.json`).toBe(file);
      const report = runIncidentScenario(scenario);
      expect(report.judges.filter((j) => !j.pass)).toEqual([]);
      expect(report.passed).toBe(true);
    }
  });

  it("E1 後段：三個方案依同區域、鄰近區域、另一日候選，推薦同區域的 Standby", () => {
    const { plan } = runIncidentScenario(parseIncidentScenario(read("E1.json")));
    expect(plan.alternatives.map((a) => a.tier)).toEqual(["same_zone", "nearby_zone", "other_day"]);
    expect(plan.alternatives[0]?.comparison).toMatchObject({ newActivity: ["淺草演藝廳", "淺草文化觀光中心"], recommended: true });
    expect(plan.snapshot.nextFixed).toEqual({ name: "晚餐（已付款）", start: "19:00" });
  });

  it("E2：最遲離開時間依新活動到下一站的交通計算", () => {
    const { plan } = runIncidentScenario(parseIncidentScenario(read("E2.json")));
    expect(plan.alternatives[0]?.comparison).toMatchObject({ newActivity: ["墨田水族館"], arrival: "15:55", leaveBy: "17:50" });
  });

  it("E8：取消日期上的已付款活動另外提醒", () => {
    const { plan } = runIncidentScenario(parseIncidentScenario(read("E8.json")));
    expect(plan.warnings).toEqual(["壽司教室（已付款）（2026-12-12）是 Hard Constraint，需另行處理預約或退款"]);
  });

  it("違反判定時失敗：把已付款晚餐列為須保留以外的日期變更", () => {
    const scenario = parseIncidentScenario(read("E1.json"));
    const broken = { ...scenario, judges: [{ type: "dates_unchanged" as const, dates: ["2026-12-10"] }] };
    expect(runIncidentScenario(broken).passed).toBe(false);
  });

  it("報告列出比較表全部欄位", () => {
    const md = renderIncidentReport(runIncidentScenario(parseIncidentScenario(read("E1.json"))), { date: "2026-11-26" });
    expect(md).toContain("| 方案 | 新活動 | 到達 | 最遲離開 | 成本 | 步行 | 轉乘 | 行李 | 天氣風險 | 影響晚餐 | 影響明日 | 體驗損失 | 推薦度 |");
    expect(md).toContain("| 結果 | PASS |");
  });
});
