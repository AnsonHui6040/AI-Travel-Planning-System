import { describe, expect, it } from "vitest";
import type { RoleRunDeps } from "@atps/core";
import { buildInput, parseRecording, parseScenario, renderReport, replayInvoker, roleInvoker, runScenario } from "./index";
import e6 from "../scenarios/E6.json";
import e6Recording from "../recordings/E6.json";

// T15 PASS：以錄製回應跑通示範場景；判定器對刻意違規的輸出判定失敗
const scenario = parseScenario(e6);
const recording = parseRecording(e6Recording);
const MEIJI = "e6000000-0000-4000-8000-000000000006";

const violation = {
  proposals: [
    {
      changeKind: "minor_non_incident",
      versionKind: "minor",
      summary: "取消咖啡時段，並把明治神宮改到下午",
      operations: [
        { op: "schedule_item", itemId: "e6000000-0000-4000-8000-000000000004", date: null, start: null, end: null },
        { op: "schedule_item", itemId: MEIJI, date: "2026-12-04", start: "14:00", end: "15:30" },
      ],
    },
  ],
};

describe("runner", () => {
  it("以錄製回應跑通 E6：連續 5 次全部通過", async () => {
    const report = await runScenario(scenario, replayInvoker(recording.responses));
    expect(report.runs).toHaveLength(5);
    expect(report.runs.every((r) => r.status === "completed" && r.passed)).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("其中一次違規即整個場景不通過", async () => {
    const report = await runScenario(scenario, replayInvoker([recording.responses[0], violation]));
    expect(report.passed).toBe(false);
    expect(report.runs.map((r) => r.passed)).toEqual([true, false, true, false, true]);
    const failedJudges = (report.runs[1]?.judges ?? []).filter((j) => !j.pass).map((j) => j.judge);
    expect(failedJudges).toEqual(expect.arrayContaining(["within_window", "dates_unchanged"]));
  });

  it("輸出不符 schema 時該次不通過，不執行判定（S-02）", async () => {
    const bad = { proposals: [{ ...(recording.responses[0] as object), image_url: "https://x/a.jpg" }] };
    const report = await runScenario(scenario, replayInvoker([bad]), { runs: 1 });
    expect(report.passed).toBe(false);
    expect(report.runs[0]).toMatchObject({ status: "output_invalid", passed: false, judges: [] });
    expect(report.runs[0]?.note).toContain("proposals");
  });

  it("供應商故障時該次不通過並記錄原因", async () => {
    const deps: RoleRunDeps = {
      adapterFor: (provider) => ({
        id: provider,
        authMethods: ["api_key"],
        builtInSearch: false,
        generate: async () => {
          throw new Error("timeout");
        },
        classifyError: () => "timeout",
      }),
      credentialFor: async () => ({ kind: "api_key", secret: "test-only" }),
      recordUsage: async () => {},
    };
    const report = await runScenario(scenario, roleInvoker(deps), { runs: 2 });
    expect(report.passed).toBe(false);
    expect(report.runs.map((r) => r.status)).toEqual(["provider_failed", "provider_failed"]);
  });

  it("送給 AI 的輸入含指示與行程資料", () => {
    const input = buildInput(scenario);
    expect(input).toContain(scenario.instruction);
    expect(input).toContain("藏前甜點店");
    expect(input).toContain("e6000000-0000-4000-8000-000000000007");
  });

  it("報告列出結果、每次狀態與失敗原因", async () => {
    const report = await runScenario(scenario, replayInvoker([recording.responses[0], violation]), { runs: 2 });
    const md = renderReport(report, { date: "2026-11-23", mode: "recorded" });
    expect(md).toContain("# 評估報告：E6 取消 Day 3 16:00 的咖啡時段");
    expect(md).toContain("| 結果 | FAIL |");
    expect(md).toContain("| 執行次數 | 2 |");
    expect(md).toContain("| 2 | completed | FAIL |");
    expect(md).toContain("明治神宮");
    expect(md).not.toMatch(/ · /);
  });
});
