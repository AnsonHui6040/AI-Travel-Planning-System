import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import {
  BLOCKING_CHECKS,
  FEASIBILITY_CHECKS,
  availabilityOn,
  checkDay,
  dayApprovalEntries,
  draftDays,
  isDayBlocked,
  planFeasibleDays,
  type FeasibilityInput,
  type FeasibilityItem,
} from "./index";

// T30：可行性驗證。未通過的項目回到地理分區，留在 Candidate List

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-01",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: [],
  photography_needs: null,
};

let n = 0;
const item = (over: Partial<FeasibilityItem>): FeasibilityItem => ({
  id: `f${++n}`,
  name_zh: `候選 ${n}`,
  type: "attraction",
  suggested_stay_minutes: 60,
  priority: 3,
  candidate_role: "primary",
  verification_status: "verified",
  zone_id: "z1",
  score_time_slot_dependency: 4,
  availability: [],
  reservation_requirement: "none",
  weather_dependency: "low",
  ...over,
});

const input = (items: FeasibilityItem[], over: Partial<FeasibilityInput> = {}): FeasibilityInput => ({
  baseline,
  items,
  segment: () => null,
  ...over,
});

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("沒有草案");
  return value;
};

const checksOf = (issues: ReturnType<typeof checkDay>) => issues.map((i) => i.check);

describe("檢查項目", () => {
  it("涵蓋計畫列出的十一項，營業時間、休館日、交通時間與固定活動緩衝會擋下", () => {
    expect(FEASIBILITY_CHECKS).toEqual([
      "opening_hours",
      "closed_day",
      "reservation",
      "travel_time",
      "first_last_train",
      "meal_time",
      "walking",
      "luggage",
      "stamina",
      "weather",
      "fixed_buffer",
    ]);
    expect([...BLOCKING_CHECKS].sort()).toEqual(["closed_day", "fixed_buffer", "opening_hours", "travel_time"]);
  });
});

describe("availabilityOn", () => {
  it("沒有營業資料時為未知；指定日期優先於星期；沒有適用時段即休館", () => {
    expect(availabilityOn(item({}), "2026-12-01")).toBeNull();
    // 2026-12-01 是星期二（2）
    const weekly = item({ availability: [{ weekday: 2, start: "10:00", end: "17:00" }, { weekday: 3, start: "09:00", end: "18:00" }] });
    expect(availabilityOn(weekly, "2026-12-01")).toEqual([["10:00", "17:00"]]);
    expect(availabilityOn(weekly, "2026-12-03")).toEqual([]);
    const special = item({ availability: [{ weekday: 2, start: "10:00", end: "17:00" }, { date: "2026-12-01", start: "12:00", end: "15:00" }] });
    expect(availabilityOn(special, "2026-12-01")).toEqual([["12:00", "15:00"]]);
  });
});

describe("checkDay", () => {
  const dayOf = (items: FeasibilityItem[], over: Partial<FeasibilityInput> = {}) => {
    const i = input(items, over);
    // 草案與檢查使用同一份交通時間
    const [day] = draftDays({ baseline: i.baseline, items, travelMinutes: (f, t) => i.segment(f, t)?.minutes ?? null });
    if (!day) throw new Error("沒有草案");
    return checkDay(day, i);
  };

  it("營業時間外與休館日會擋下", () => {
    const outside = item({ availability: [{ weekday: 2, start: "13:00", end: "17:00" }] });
    const closed = item({ priority: 2, availability: [{ weekday: 5, start: "09:00", end: "17:00" }] });
    const issues = dayOf([outside, closed]);
    expect(issues.find((i) => i.item_id === outside.id)?.check).toBe("opening_hours");
    expect(issues.find((i) => i.item_id === closed.id)?.check).toBe("closed_day");
    expect(issues.every((i) => i.blocking)).toBe(true);
  });

  it("相鄰項目之間的時間不足交通時間會擋下", () => {
    const a = item({ priority: 5 });
    const b = item({ priority: 4 });
    const i = input([a, b], { segment: (from, to) => (from === a.id && to === b.id ? { minutes: 25, walk_minutes: 5, luggage: "medium" } : null) });
    // 草案以 0 分鐘排入，實際需要 25 分鐘
    const [day] = draftDays({ baseline, items: [a, b], travelMinutes: () => 0 });
    expect(checkDay(must(day), i)).toContainEqual({ check: "travel_time", date: "2026-12-01", item_id: b.id, blocking: true });
  });

  it("固定活動前後須保留交通加緩衝", () => {
    const fixedDay = { ...baseline, fixed_activities: [{ name: "和服體驗", area: null, date: "2026-12-01", start: "10:30", end: "12:00", paid: true }] };
    const a = item({ priority: 5 });
    const i = input([a], { baseline: fixedDay });
    const [day] = draftDays({ baseline: fixedDay, items: [a], travelMinutes: () => 0 });
    // 09:00–10:00 之後只剩 30 分鐘，需要 30 分鐘交通加 15 分鐘緩衝
    expect(checkDay(must(day), i)).toContainEqual({ check: "fixed_buffer", date: "2026-12-01", item_id: a.id, blocking: true });
  });

  it("需預約、餐飲時段、天氣依賴只提醒，不擋下", () => {
    const reserve = item({ priority: 5, reservation_requirement: "required" });
    const rainy = item({ priority: 4, weather_dependency: "high" });
    const issues = dayOf([reserve, rainy]);
    expect(checksOf(issues).sort()).toEqual(["reservation", "weather"]);
    expect(issues.every((i) => !i.blocking)).toBe(true);
  });

  it("餐飲不在午餐或晚餐時段時提醒", () => {
    const meal = item({ type: "restaurant", availability: [{ weekday: 2, start: "14:00", end: "16:00" }] });
    const [day] = draftDays({ baseline, items: [meal], travelMinutes: () => 0, openWindows: (_id, date) => availabilityOn(meal, date) });
    expect(checksOf(checkDay(must(day), input([meal])))).toEqual(["meal_time"]);
  });

  it("步行量與體力超過上限時提醒；有體力備註時上限較低", () => {
    const long = [item({ priority: 5, suggested_stay_minutes: 200 }), item({ priority: 4, suggested_stay_minutes: 200 })];
    const walking = () => ({ minutes: 0, walk_minutes: 100, luggage: "high" as const });
    expect(checksOf(dayOf(long, { segment: walking }))).toEqual(["walking"]);
    const tired = { ...baseline, stamina_note: "長輩同行，不宜久走" };
    expect(checksOf(dayOf(long, { baseline: tired, segment: () => null })).sort()).toEqual(["stamina"]);
  });

  it("搬運行李的日子，行李不便的路段提醒", () => {
    const moving = { ...baseline, lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-02", check_in_time: "15:00" }] };
    const a = item({ priority: 5 });
    const b = item({ priority: 4 });
    const seg = () => ({ minutes: 0, walk_minutes: 0, luggage: "low" as const });
    expect(checksOf(dayOf([a, b], { baseline: moving, segment: seg }))).toEqual(["luggage"]);
  });

  it("固定活動太晚結束時提醒回程的末班車", () => {
    const late = { ...baseline, fixed_activities: [{ name: "夜景晚餐", area: null, date: "2026-12-01", start: "21:30", end: "23:15", paid: true }] };
    const [day] = draftDays({ baseline: late, items: [], travelMinutes: () => 0 });
    expect(checkDay(must(day), input([], { baseline: late }))).toEqual([{ check: "first_last_train", date: "2026-12-01", item_id: null, blocking: false }]);
  });
});

describe("planFeasibleDays", () => {
  it("依營業時間排入開門後的時段", () => {
    const museum = item({ availability: [{ weekday: 2, start: "11:00", end: "17:00" }] });
    const { days, returned } = planFeasibleDays(input([museum]));
    expect(days[0]?.entries[0]?.start).toBe("11:00");
    expect(returned).toEqual([]);
  });

  it("排入時遵守固定活動前後的交通加緩衝；放不下的項目回到地理分區", () => {
    const fixedDay = { ...baseline, fixed_activities: [{ name: "和服體驗", area: null, date: "2026-12-01", start: "11:00", end: "12:00", paid: true }] };
    const a = item({ priority: 5, suggested_stay_minutes: 90 });
    const b = item({ priority: 4 });
    const huge = item({ priority: 1, suggested_stay_minutes: 600 });
    // a 排在固定活動前會不足 30 分鐘交通加 15 分鐘緩衝，所以排在 12:45；b 排在 09:00
    const result = planFeasibleDays(input([a, b, huge], { baseline: fixedDay }));
    const placed = result.days[0]?.entries.flatMap((e) => (e.kind === "item" ? [[e.item_id, e.start]] : []));
    expect(placed).toEqual([
      [b.id, "09:00"],
      [a.id, "12:45"],
    ]);
    expect(result.issues.filter((i) => i.blocking)).toEqual([]);
    expect(result.returned).toEqual([{ item_id: huge.id, date: "2026-12-01", checks: [] }]);
  });

  it("營業時段都比停留時間短時標示營業時間", () => {
    const short = item({ suggested_stay_minutes: 120, availability: [{ weekday: 2, start: "10:00", end: "11:00" }] });
    expect(planFeasibleDays(input([short])).returned).toEqual([{ item_id: short.id, date: "2026-12-01", checks: ["opening_hours"] }]);
  });

  it("isDayBlocked：該日仍有會擋下的問題時不可批准", () => {
    const issue = { check: "travel_time" as const, date: "2026-12-01", item_id: "x", blocking: true };
    expect(isDayBlocked([issue], "2026-12-01")).toBe(true);
    expect(isDayBlocked([issue], "2026-12-02")).toBe(false);
    expect(isDayBlocked([{ ...issue, blocking: false }], "2026-12-01")).toBe(false);
  });

  it("E3：休館那天不排入，留在 Candidate List", () => {
    const threeDays = { ...baseline, end_date: "2026-12-03" };
    const cafe = item({ name_zh: "咖啡店", type: "restaurant", zone_id: "c", availability: [0, 1, 2, 3, 5, 6].map((weekday) => ({ weekday, start: "08:00", end: "20:00" })) });
    const items = [item({ zone_id: "a" }), item({ zone_id: "a" }), item({ zone_id: "a" }), item({ zone_id: "b" }), item({ zone_id: "b" }), cafe];
    const { days, returned } = planFeasibleDays(input(items, { baseline: threeDays }));
    expect(days[2]?.zone_ids).toEqual(["c"]);
    expect(days[2]?.entries.some((e) => e.kind === "item" && e.item_id === cafe.id)).toBe(false);
    expect(returned).toEqual([{ item_id: cafe.id, date: "2026-12-03", checks: ["closed_day"] }]);
  });

  it("只排指定日期（已批准的日期不重排）", () => {
    const twoDays = { ...baseline, end_date: "2026-12-02" };
    const result = planFeasibleDays(input([item({ zone_id: "a" }), item({ zone_id: "b" })], { baseline: twoDays, dates: ["2026-12-02"] }));
    expect(result.days.map((d) => d.date)).toEqual(["2026-12-02"]);
    expect(result.days[0]?.zone_ids.sort()).toEqual(["a", "b"]);
  });
});

describe("dayApprovalEntries", () => {
  it("只送出排入的項目、時間與可移動範圍", () => {
    const fixedDay = { ...baseline, fixed_activities: [{ name: "和服體驗", area: null, date: "2026-12-01", start: "13:00", end: "15:00", paid: true }] };
    const a = item({ priority: 5 });
    const [day] = planFeasibleDays(input([a], { baseline: fixedDay })).days;
    expect(dayApprovalEntries(must(day))).toEqual([{ item_id: a.id, start: "09:00", end: "10:00", movable_from: "09:00", movable_to: "11:15" }]);
  });
});
