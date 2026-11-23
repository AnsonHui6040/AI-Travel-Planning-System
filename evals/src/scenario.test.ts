import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRecording, parseScenario } from "./index";
import e6 from "../scenarios/E6.json";

const root = join(import.meta.dirname, "..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("場景格式", () => {
  it("每個場景檔都符合格式，且有對應的錄製回應", () => {
    const files = readdirSync(join(root, "scenarios")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const scenario = parseScenario(read(join(root, "scenarios", file)));
      expect(`${scenario.id}.json`).toBe(file);
      const recording = parseRecording(read(join(root, "recordings", file)));
      expect(recording.scenario).toBe(scenario.id);
    }
  });

  it("預設連續執行 5 次（第 9.1 節）", () => {
    const rest = Object.fromEntries(Object.entries(e6).filter(([key]) => key !== "runs"));
    expect(parseScenario(rest).runs).toBe(5);
  });

  it("判定器引用行程中沒有的項目時拒絕", () => {
    expect(() =>
      parseScenario({ ...e6, judges: [{ type: "items_preserved", itemIds: ["e6000000-0000-4000-8000-0000000000ff"] }] }),
    ).toThrow();
  });

  it("未知的判定器或欄位時拒絕", () => {
    expect(() => parseScenario({ ...e6, judges: [{ type: "looks_good" }] })).toThrow();
    expect(() => parseScenario({ ...e6, extra: 1 })).toThrow();
  });

  it("時段的結束早於開始時拒絕", () => {
    expect(() =>
      parseScenario({ ...e6, judges: [{ type: "within_window", date: "2026-12-03", from: "17:00", to: "16:00" }] }),
    ).toThrow();
  });

  it("沒有錄製回應時拒絕", () => {
    expect(() => parseRecording({ scenario: "E6", note: "x", responses: [] })).toThrow();
  });
});
