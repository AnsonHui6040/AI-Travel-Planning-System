import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseZoningScenario, renderZoningReport, runZoningScenario } from "./index";

// T27：地理分區的評估場景（E9）。CI 以錄製回應驗證判定器；真 AI 連續 5 次於旅前執行

const read = (file: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "..", "zoning", file), "utf8"));

describe("地理分區評估場景", () => {
  it("E9：乙地與出發地同區、甲地不同區，並標示轉乘次數", () => {
    const report = runZoningScenario(parseZoningScenario(read("E9.json")));
    expect(report.gate).toBe("ok");
    expect(report.checks.every((c) => c.passed)).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("錄製回應把甲地放進出發地分區時判定失敗", () => {
    const e9 = read("E9.json") as { recording: { zones: Array<{ items: Array<{ item_id: string }> }> } };
    const [first, second] = e9.recording.zones;
    const swapped = {
      ...e9,
      recording: { zones: [{ ...first, items: [...(first?.items ?? []), ...(second?.items ?? [])] }] },
    };
    expect(runZoningScenario(parseZoningScenario(swapped)).passed).toBe(false);
  });

  it("錄製回應不符 schema 時判定失敗", () => {
    const e9 = read("E9.json") as Record<string, unknown>;
    const report = runZoningScenario(parseZoningScenario({ ...e9, recording: { zones: [{ name: "x" }] } }));
    expect(report.gate).toBe("schema");
    expect(report.passed).toBe(false);
  });

  it("報告列出每項判定", () => {
    const md = renderZoningReport(runZoningScenario(parseZoningScenario(read("E9.json"))), { date: "2026-11-24" });
    expect(md).toContain("# 評估報告：E9");
    expect(md).toContain("| 結果 | PASS |");
    expect(md).toContain("轉乘");
  });
});
