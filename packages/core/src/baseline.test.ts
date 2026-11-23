import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { canConfirmBaseline, checkBaseline, classifyBaseline } from "./baseline";

// T23：旅行基線的三類限制分類與矛盾檢查（第 2.4 節限制類別、第 9.3 節 E5）

function baseline(overrides: Partial<TripBaselineData> = {}): TripBaselineData {
  return {
    start_date: "2026-12-01",
    end_date: "2026-12-05",
    timezone: "Asia/Tokyo",
    flights: [
      { label: "去程 BR198", departs_at: "2026-12-01T08:50:00+08:00", arrives_at: "2026-12-01T13:15:00+09:00" },
      { label: "回程 BR197", departs_at: "2026-12-05T14:25:00+09:00", arrives_at: "2026-12-05T17:20:00+08:00" },
    ],
    lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-05", check_in_time: "15:00" }],
    companions: 1,
    stamina_note: "每天步行不超過 15,000 步",
    budget: { amount: 60000, currency: "TWD" },
    fixed_activities: [{ name: "teamLab 預約", area: "豐洲", date: "2026-12-03", start: "19:00", end: "21:00", paid: true }],
    paid_items: ["JR Pass"],
    must_visit: ["淺草寺"],
    excluded: ["迪士尼"],
    transport_preferences: ["rail", "walk"],
    photography_needs: "晴空塔夜景",
    ...overrides,
  };
}

const codes = (data: TripBaselineData) => checkBaseline(data).map((i) => `${i.severity}:${i.code}`);

describe("三類限制分類", () => {
  it("日期、航班、住宿、已付款活動與項目、排除地點為 Hard Constraint", () => {
    const hard = classifyBaseline(baseline()).filter((c) => c.category === "hard").map((c) => c.label);
    expect(hard).toEqual([
      "旅行日期 2026-12-01 至 2026-12-05",
      "航班：去程 BR198",
      "航班：回程 BR197",
      "住宿：新宿飯店（2026-12-01 至 2026-12-05）",
      "已付款固定活動：teamLab 預約（2026-12-03 19:00）",
      "已付款項目：JR Pass",
      "排除地點：迪士尼",
    ]);
  });

  it("未付款固定活動、必去地點、體力限制、預算為 Strong Preference", () => {
    const data = baseline({ fixed_activities: [{ name: "築地早餐", area: "築地", date: "2026-12-02", start: "08:00", end: null, paid: false }] });
    const strong = classifyBaseline(data).filter((c) => c.category === "strong_preference").map((c) => c.label);
    expect(strong).toEqual(["固定活動：築地早餐（2026-12-02 08:00）", "必去地點：淺草寺", "體力限制：每天步行不超過 15,000 步", "預算：60000 TWD"]);
  });

  it("交通偏好與攝影需求為 Flexible", () => {
    const flexible = classifyBaseline(baseline()).filter((c) => c.category === "flexible").map((c) => c.label);
    expect(flexible).toEqual(["交通偏好：鐵路、步行", "攝影需求：晴空塔夜景"]);
  });

  it("沒有填寫的項目不列入", () => {
    const data = baseline({ stamina_note: null, budget: null, photography_needs: null, transport_preferences: [], paid_items: [], must_visit: [], excluded: [] });
    const kinds = classifyBaseline(data).map((c) => c.kind);
    expect(kinds).not.toContain("stamina");
    expect(kinds).not.toContain("budget");
    expect(kinds).not.toContain("photography");
    expect(kinds).not.toContain("transport");
  });
});

describe("矛盾檢查", () => {
  it("合理的基線沒有矛盾，可以確認", () => {
    expect(checkBaseline(baseline())).toEqual([]);
    expect(canConfirmBaseline(baseline())).toBe(true);
  });

  it("E5：飯店入住 15:00，另一區已付款活動 15:30，標示矛盾且不可確認", () => {
    const data = baseline({
      fixed_activities: [{ name: "淺草和服體驗", area: "淺草", date: "2026-12-01", start: "15:30", end: "17:00", paid: true }],
    });
    const issues = checkBaseline(data);
    expect(issues).toEqual([
      {
        severity: "conflict",
        code: "check_in_too_close",
        message: "2026-12-01 15:00 在新宿入住新宿飯店，15:30 要在淺草參加淺草和服體驗，不同地區之間只有 30 分鐘",
      },
    ]);
    expect(canConfirmBaseline(data)).toBe(false);
  });

  it("入住後同地區的活動或間隔足夠時不標示；地區未填時只提醒", () => {
    const sameArea = baseline({ fixed_activities: [{ name: "新宿晚餐", area: "新宿", date: "2026-12-01", start: "15:30", end: null, paid: true }] });
    expect(checkBaseline(sameArea)).toEqual([]);
    const enoughGap = baseline({ fixed_activities: [{ name: "淺草和服體驗", area: "淺草", date: "2026-12-01", start: "16:00", end: null, paid: true }] });
    expect(checkBaseline(enoughGap)).toEqual([]);
    const unknown = baseline({ fixed_activities: [{ name: "和服體驗", area: null, date: "2026-12-01", start: "15:30", end: null, paid: true }] });
    expect(codes(unknown)).toEqual(["warning:check_in_area_unknown"]);
    expect(canConfirmBaseline(unknown)).toBe(true);
  });

  it("固定活動與航班時間重疊", () => {
    const data = baseline({ fixed_activities: [{ name: "午餐預約", area: "新宿", date: "2026-12-01", start: "12:00", end: "13:00", paid: true }] });
    expect(codes(data)).toEqual(["conflict:activity_during_flight"]);
    const after = baseline({ fixed_activities: [{ name: "機場出發前晚餐", area: "新宿", date: "2026-12-05", start: "15:00", end: null, paid: false }] });
    expect(codes(after)).toEqual(["conflict:activity_during_flight"]);
  });

  it("固定活動彼此重疊；結束時間早於開始時間", () => {
    const overlap = baseline({
      fixed_activities: [
        { name: "A", area: "澀谷", date: "2026-12-02", start: "10:00", end: "12:00", paid: true },
        { name: "B", area: "澀谷", date: "2026-12-02", start: "11:30", end: "13:00", paid: false },
      ],
    });
    expect(codes(overlap)).toEqual(["conflict:activities_overlap"]);
    const reversed = baseline({ fixed_activities: [{ name: "A", area: "澀谷", date: "2026-12-02", start: "12:00", end: "11:00", paid: true }] });
    expect(codes(reversed)).toEqual(["conflict:activity_end_before_start"]);
  });

  it("沒有結束時間的活動以 60 分鐘計算重疊", () => {
    const data = baseline({
      fixed_activities: [
        { name: "A", area: "澀谷", date: "2026-12-02", start: "10:00", end: null, paid: true },
        { name: "B", area: "澀谷", date: "2026-12-02", start: "10:45", end: null, paid: true },
      ],
    });
    expect(codes(data)).toEqual(["conflict:activities_overlap"]);
  });

  it("活動、住宿超出旅行日期", () => {
    const activity = baseline({ fixed_activities: [{ name: "A", area: "澀谷", date: "2026-12-06", start: "10:00", end: null, paid: true }] });
    expect(codes(activity)).toEqual(["conflict:activity_outside_trip"]);
    const lodging = baseline({ lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-11-30", check_out: "2026-12-05", check_in_time: null }] });
    expect(codes(lodging)).toEqual(["conflict:lodging_outside_trip"]);
  });

  it("住宿退房不晚於入住；住宿夜晚重疊；有夜晚沒有住宿時提醒", () => {
    const reversed = baseline({ lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-03", check_out: "2026-12-03", check_in_time: null }] });
    expect(codes(reversed)).toContain("conflict:lodging_dates_invalid");
    const overlap = baseline({
      lodgings: [
        { name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-04", check_in_time: null },
        { name: "淺草旅館", area: "淺草", check_in: "2026-12-03", check_out: "2026-12-05", check_in_time: null },
      ],
    });
    expect(codes(overlap)).toEqual(["conflict:lodgings_overlap"]);
    const gap = baseline({ lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-03", check_in_time: null }] });
    expect(checkBaseline(gap)).toEqual([{ severity: "warning", code: "night_without_lodging", message: "2026-12-03、2026-12-04 晚上沒有住宿" }]);
  });

  it("航班抵達早於出發；航班日期離旅行日期太遠時提醒", () => {
    const invalid = baseline({ flights: [{ label: "X", departs_at: "2026-12-01T13:00:00+09:00", arrives_at: "2026-12-01T12:00:00+09:00" }] });
    expect(codes(invalid)).toEqual(["conflict:flight_times_invalid"]);
    const far = baseline({ flights: [{ label: "X", departs_at: "2026-11-20T08:00:00+08:00", arrives_at: "2026-11-20T12:00:00+09:00" }] });
    expect(codes(far)).toEqual(["warning:flight_outside_trip"]);
  });

  it("同一地點同時列為必去與排除", () => {
    const data = baseline({ must_visit: ["淺草寺", " 迪士尼 "], excluded: ["迪士尼"] });
    expect(checkBaseline(data)).toEqual([{ severity: "conflict", code: "must_visit_excluded", message: "迪士尼同時列為必去與排除" }]);
  });
});
