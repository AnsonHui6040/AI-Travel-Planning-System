import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseImportScenario, renderImportReport, runImportScenario } from "./index";

// 決策 0010 I：行程匯入的評估場景（E10）。CI 以錄製回應驗證判定器；真 AI 連續 5 次於旅前執行

const read = (): Record<string, unknown> => JSON.parse(readFileSync(join(import.meta.dirname, "..", "import", "E10.json"), "utf8"));

describe("行程匯入評估場景", () => {
  it("E10：個資沒有送出，預訂與地點都正確整理", () => {
    const report = runImportScenario(parseImportScenario(read()));
    expect(report.gate).toBe("ok");
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("錄製回應漏掉預約碼時判定失敗", () => {
    const e10 = read() as { recording: { bookings: Array<Record<string, unknown>> } };
    const changed = { ...e10, recording: { ...e10.recording, bookings: e10.recording.bookings.map((b) => ({ ...b, confirmation_code: null })) } };
    expect(runImportScenario(parseImportScenario(changed)).passed).toBe(false);
  });

  it("貼上的文字沒有移除的個資會判定失敗", () => {
    const e10 = read() as { expect: { not_sent: string[] } };
    const changed = { ...e10, expect: { ...e10.expect, not_sent: [...e10.expect.not_sent, "新宿華盛頓飯店"] } };
    expect(runImportScenario(parseImportScenario(changed)).passed).toBe(false);
  });

  it("錄製回應不符 schema 時判定失敗", () => {
    const report = runImportScenario(parseImportScenario({ ...read(), recording: { bookings: [{ title: "x" }], places: [] } }));
    expect(report.gate).toBe("schema");
    expect(report.passed).toBe(false);
  });

  it("報告列出每項判定，不含預約碼以外的個資", () => {
    const md = renderImportReport(runImportScenario(parseImportScenario(read())), { date: "2026-11-28" });
    expect(md).toContain("# 評估報告：E10");
    expect(md).toContain("| 結果 | PASS |");
    expect(md).not.toContain("meihua.chen@example.com");
  });
});
