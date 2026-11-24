import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeasibilityScenario, renderFeasibilityReport, runFeasibilityScenario } from "./index";

// T30：可行性驗證的評估場景（E3）。確定性規則，不呼叫 AI，所以每個場景執行一次

const dir = join(import.meta.dirname, "..", "feasibility");
const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));

describe("可行性驗證評估場景", () => {
  it("每個場景檔都符合格式並通過", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toContain("E3.json");
    for (const file of files) {
      const scenario = parseFeasibilityScenario(read(file));
      expect(`${scenario.id}.json`).toBe(file);
      expect(runFeasibilityScenario(scenario).passed).toBe(true);
    }
  });

  it("E3：Day 3 公休的咖啡店留在 Candidate List，同區其他候選照常排入", () => {
    const report = runFeasibilityScenario(parseFeasibilityScenario(read("E3.json")));
    expect(report.results.map((r) => [r.key, r.placedOn, r.returnedFor])).toEqual([
      ["kissa", null, ["closed_day"]],
      ["inokashira", "2026-12-03", []],
      ["senso-ji", "2026-12-01", []],
      ["meiji-jingu", "2026-12-02", []],
    ]);
  });

  it("預期不符時判定失敗", () => {
    const e3 = read("E3.json") as { expect: Array<Record<string, unknown>> };
    const broken = { ...e3, expect: [{ key: "kissa", placed_on: "2026-12-03", returned_for: null }] };
    expect(runFeasibilityScenario(parseFeasibilityScenario(broken)).passed).toBe(false);
  });

  it("報告列出每個項目的結果", () => {
    const md = renderFeasibilityReport(runFeasibilityScenario(parseFeasibilityScenario(read("E3.json"))), { date: "2026-11-24" });
    expect(md).toContain("# 評估報告：E3");
    expect(md).toContain("| 結果 | PASS |");
    expect(md).toContain("當天休館或公休");
  });
});
