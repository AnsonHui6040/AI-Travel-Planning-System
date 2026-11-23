import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBaselineScenario, renderBaselineReport, runBaselineScenario } from "./index";

// T23：基線矛盾檢查的評估場景（E5）。檢查是確定性規則，不呼叫 AI，所以每個場景執行一次

const dir = join(import.meta.dirname, "..", "baseline");
const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));

describe("基線評估場景", () => {
  it("每個場景檔都符合格式並通過", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toContain("E5.json");
    for (const file of files) {
      const scenario = parseBaselineScenario(read(file));
      expect(`${scenario.id}.json`).toBe(file);
      expect(runBaselineScenario(scenario).passed).toBe(true);
    }
  });

  it("E5：標示入住時間矛盾且不可確認", () => {
    const report = runBaselineScenario(parseBaselineScenario(read("E5.json")));
    expect(report.conflicts).toEqual(["check_in_too_close"]);
    expect(report.confirmable).toBe(false);
  });

  it("預期不符時判定失敗", () => {
    const e5 = read("E5.json") as Record<string, unknown>;
    const report = runBaselineScenario(parseBaselineScenario({ ...e5, expect: { conflicts: [], confirmable: true } }));
    expect(report.passed).toBe(false);
  });

  it("基線資料或欄位不合格式時拒絕", () => {
    const e5 = read("E5.json") as Record<string, unknown>;
    expect(() => parseBaselineScenario({ ...e5, baseline: { start_date: "x" } })).toThrow();
    expect(() => parseBaselineScenario({ ...e5, extra: 1 })).toThrow();
  });

  it("報告列出矛盾與判定", () => {
    const report = runBaselineScenario(parseBaselineScenario(read("E5.json")));
    const md = renderBaselineReport(report, { date: "2026-11-24" });
    expect(md).toContain("# 評估報告：E5 飯店入住 15:00，另一區已付款活動 15:30");
    expect(md).toContain("| 結果 | PASS |");
    expect(md).toContain("check_in_too_close");
  });
});
