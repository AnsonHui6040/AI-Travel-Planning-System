import { describe, expect, it } from "vitest";
import {
  L1_MIN_BUFFER_MINUTES,
  approvalRule,
  classifyDelay,
  classifyIncident,
  recomputeScope,
  type ScheduledEntry,
} from "./index";

describe("第 2.6 節批准規則", () => {
  it.each([
    ["new_candidate", { apply: "auto", notify: false, log: false, markAtRisk: false, prompt: false }],
    ["candidate_verification_update", { apply: "auto", notify: false, log: false, markAtRisk: false, prompt: false }],
    ["fact_correction", { apply: "auto", notify: false, log: true, markAtRisk: false, prompt: false }],
    ["approved_fact_invalidated", { apply: "auto", notify: true, log: true, markAtRisk: true, prompt: false }],
    ["reschedule_after_invalidation", { apply: "approval", notify: true, log: true, markAtRisk: false, prompt: false }],
    ["incident_L1", { apply: "auto", notify: true, log: true, markAtRisk: false, prompt: false }],
    ["incident_L2", { apply: "approval", notify: true, log: true, markAtRisk: false, prompt: false }],
    ["incident_L3", { apply: "approval", notify: true, log: true, markAtRisk: false, prompt: false }],
    ["incident_L4", { apply: "approval", notify: true, log: true, markAtRisk: false, prompt: false }],
    ["major_version", { apply: "approval", notify: true, log: true, markAtRisk: false, prompt: false }],
    ["minor_non_incident", { apply: "approval", notify: true, log: true, markAtRisk: false, prompt: false }],
    ["add_candidate_to_gap", { apply: "approval", notify: false, log: true, markAtRisk: false, prompt: true }],
  ] as const)("%s", (kind, expected) => {
    expect(approvalRule(kind)).toEqual(expected);
  });

  it("只有 L1 一種 Incident 自動套用（D10）", () => {
    const auto = (["incident_L1", "incident_L2", "incident_L3", "incident_L4"] as const).filter(
      (k) => approvalRule(k).apply === "auto",
    );
    expect(auto).toEqual(["incident_L1"]);
  });
});

describe("延誤分級（決策 0004）", () => {
  const roomy = { bufferAfterCompressionMinutes: 60, hardConstraintMissed: false };

  it.each([
    [0, "none"],
    [9, "none"],
    [10, "L1"],
    [20, "L1"],
    [21, "L2"],
    [60, "L2"],
    [61, "L3"],
  ] as const)("延誤 %i 分鐘為 %s", (minutes, level) => {
    expect(classifyDelay({ delayMinutes: minutes, ...roomy })).toBe(level);
  });

  it("L1 壓縮後緩衝少於 15 分鐘時升為 L2", () => {
    expect(L1_MIN_BUFFER_MINUTES).toBe(15);
    expect(classifyDelay({ delayMinutes: 15, bufferAfterCompressionMinutes: 15, hardConstraintMissed: false })).toBe("L1");
    expect(classifyDelay({ delayMinutes: 15, bufferAfterCompressionMinutes: 14, hardConstraintMissed: false })).toBe("L2");
  });

  it("下一個 Hard Constraint 無法準時，不論分鐘數都是 L3", () => {
    expect(classifyDelay({ delayMinutes: 5, bufferAfterCompressionMinutes: 0, hardConstraintMissed: true })).toBe("L3");
  });

  it("延誤分鐘數不可為負數", () => {
    expect(() => classifyDelay({ delayMinutes: -1, ...roomy })).toThrow();
  });
});

describe("第 2.6 節 Incident 分級表", () => {
  it.each([
    [{ type: "delay", delayMinutes: 15, bufferAfterCompressionMinutes: 60, hardConstraintMissed: false }, "L1"],
    [{ type: "long_queue" }, "L2"],
    [{ type: "attraction_closed" }, "L3"],
    [{ type: "rail_disruption" }, "L3"],
    [{ type: "flight_cancelled" }, "L4"],
    [{ type: "extreme_weather" }, "L4"],
  ] as const)("%j 為 %s", (incident, level) => {
    expect(classifyIncident(incident)).toBe(level);
  });
});

describe("第 2.6 節重算範圍（Smallest Affected Scope）", () => {
  const e = (
    id: string,
    date: string,
    start: string,
    extra: Partial<ScheduledEntry> = {},
  ): ScheduledEntry => ({
    id,
    date,
    start,
    area: "淺草",
    mealSlot: null,
    weatherDependency: "low",
    routes: [],
    touchesLodging: false,
    ...extra,
  });

  const entries: ScheduledEntry[] = [
    e("d1-a", "2026-12-01", "09:00", { touchesLodging: true }),
    e("d1-b", "2026-12-01", "11:00", { weatherDependency: "high", routes: ["ginza-line"] }),
    e("d1-c", "2026-12-01", "12:30", { mealSlot: "lunch" }),
    e("d1-d", "2026-12-01", "13:00", { mealSlot: "lunch", area: "上野" }),
    e("d1-e", "2026-12-01", "15:00", { area: "淺草" }),
    e("d1-f", "2026-12-01", "16:30", { weatherDependency: "medium" }),
    e("d2-a", "2026-12-02", "10:00", { routes: ["ginza-line"], touchesLodging: true }),
    e("d3-a", "2026-12-03", "10:00", { weatherDependency: "high" }),
  ];

  it("景點延誤：之後 1–2 個活動", () => {
    expect(recomputeScope({ type: "attraction_delay", itemId: "d1-b" }, entries)).toEqual(["d1-c", "d1-d"]);
    expect(recomputeScope({ type: "attraction_delay", itemId: "d1-f" }, entries)).toEqual([]);
  });

  it("餐廳額滿：同一餐段", () => {
    expect(recomputeScope({ type: "restaurant_full", itemId: "d1-c" }, entries)).toEqual(["d1-c", "d1-d"]);
  });

  it("一個景點休館：同區域半日", () => {
    expect(recomputeScope({ type: "attraction_closed", itemId: "d1-e" }, entries)).toEqual(["d1-c", "d1-e", "d1-f"]);
  });

  it("下雨：所有天氣敏感活動", () => {
    expect(recomputeScope({ type: "rain" }, entries)).toEqual(["d1-b", "d1-f", "d3-a"]);
    expect(recomputeScope({ type: "rain", date: "2026-12-01" }, entries)).toEqual(["d1-b", "d1-f"]);
  });

  it("鐵路局部停駛：使用該路線的時段", () => {
    expect(recomputeScope({ type: "rail_partial_suspension", routeId: "ginza-line" }, entries)).toEqual(["d1-b", "d2-a"]);
  });

  it("固定活動改日期：原日與新日", () => {
    expect(recomputeScope({ type: "fixed_activity_reschedule", fromDate: "2026-12-02", toDate: "2026-12-03" }, entries)).toEqual(["d2-a", "d3-a"]);
  });

  it("飯店搬區：所有出發與返回動線", () => {
    expect(recomputeScope({ type: "hotel_change" }, entries)).toEqual(["d1-a", "d2-a"]);
  });

  it("航班改一天：整趟旅行", () => {
    expect(recomputeScope({ type: "flight_shift" }, entries)).toHaveLength(entries.length);
  });

  it("同行者受傷或體力受限：剩餘旅程", () => {
    expect(recomputeScope({ type: "companion_limited", fromDate: "2026-12-01", fromTime: "15:00" }, entries)).toEqual([
      "d1-e",
      "d1-f",
      "d2-a",
      "d3-a",
    ]);
  });
});
