import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCrossCheckScenario, renderCrossCheckReport, runCrossCheckScenario } from "./index";

// T25：交叉核查的評估場景（E4）。依證據順序判定是確定性規則，不呼叫 AI，所以每個場景執行一次

const dir = join(import.meta.dirname, "..", "crosscheck");
const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));

describe("交叉核查評估場景", () => {
  it("每個場景檔都符合格式並通過", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toContain("E4.json");
    for (const file of files) {
      const scenario = parseCrossCheckScenario(read(file));
      expect(`${scenario.id}.json`).toBe(file);
      expect(runCrossCheckScenario(scenario).passed).toBe(true);
    }
  });

  it("E4：可判定時採用官方資訊；無法判定時為 Conflict 且不可進入行程", () => {
    const report = runCrossCheckScenario(parseCrossCheckScenario(read("E4.json")));
    expect(report.cases.map((c) => [c.status, c.adopted.opening_hours ?? null, c.canEnterDraft])).toEqual([
      ["verified", "09:00–17:00", true],
      ["conflict", null, false],
    ]);
  });

  it("預期不符時判定失敗", () => {
    const e4 = read("E4.json") as { cases: Array<Record<string, unknown>> };
    const broken = { ...e4, cases: e4.cases.map((c) => ({ ...c, expect: { status: "verified", adopted: {}, can_enter_draft: true } })) };
    expect(runCrossCheckScenario(parseCrossCheckScenario(broken)).passed).toBe(false);
  });

  it("報告列出每個案例的結果", () => {
    const report = runCrossCheckScenario(parseCrossCheckScenario(read("E4.json")));
    const md = renderCrossCheckReport(report, { date: "2026-11-24" });
    expect(md).toContain("# 評估報告：E4");
    expect(md).toContain("| 結果 | PASS |");
    expect(md).toContain("Conflict");
  });
});
