import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMorningScenario, renderMorningReport, runMorningScenario } from "./index";

// T36：Morning Check 的評估場景（E1 前段）。錄製的預報、確定性規則，不呼叫 AI 或外部 API

const dir = join(import.meta.dirname, "..", "morning");
const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));

describe("Morning Check 評估場景", () => {
  it("每個場景檔都符合格式並通過", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toContain("E1.json");
    for (const file of files) {
      const scenario = parseMorningScenario(read(file));
      expect(`${scenario.id}.json`).toBe(file);
      expect(runMorningScenario(scenario).passed).toBe(true);
    }
  });

  it("E1 前段：只有午後的戶外攝影標示 At Risk，同區室內候選提升為 Standby", () => {
    const report = runMorningScenario(parseMorningScenario(read("E1.json")));
    expect(report.atRisk).toEqual(["photo"]);
    expect(report.standby).toEqual(["engei", "tourist-center"]);
    // 上午的戶外散步不受午後的雨影響；已付款的固定活動保留
    expect(report.checks.find((c) => c.check === "fixed_activities")?.detail).toBe("19:00 晚餐（已付款）");
  });

  it("預期不符時判定失敗", () => {
    const e1 = read("E1.json") as Record<string, unknown>;
    const broken = { ...e1, expect: { at_risk: ["photo", "walk"], standby: [], unaffected: [] } };
    expect(runMorningScenario(parseMorningScenario(broken)).passed).toBe(false);
  });

  it("報告列出 At Risk、Standby 與每個檢查項目", () => {
    const md = renderMorningReport(runMorningScenario(parseMorningScenario(read("E1.json"))), { date: "2026-11-26" });
    expect(md).toContain("# 評估報告：E1");
    expect(md).toContain("| 結果 | PASS |");
    expect(md).toContain("| At Risk | 隅田川攝影 |");
  });
});
