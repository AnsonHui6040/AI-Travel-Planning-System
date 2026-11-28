import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { bookedItemIds, bookingFixedActivities, bookingLocal, bookingsOn, withBookings, type BookingConstraint } from "./bookings";
import { checkDay, planFeasibleDays, type FeasibilityItem } from "./feasibility";

// 決策 0010 B：當天的預訂視為固定活動（Hard Constraint）。純函式：時間換算為行程時區；住宿不佔用時段，只標示入住與退房日。

const baseline: TripBaselineData = {
  start_date: "2027-01-10",
  end_date: "2027-01-12",
  timezone: "Asia/Tokyo",
  flights: [{ label: "去程", departs_at: "2027-01-10T08:00:00+08:00", arrives_at: "2027-01-10T12:00:00+09:00" }],
  lodgings: [],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [{ name: "晚餐（已付款）", area: "新宿", date: "2027-01-11", start: "19:00", end: "21:00", paid: true }],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: ["rail"],
  photography_needs: null,
};

const booking = (over: Partial<BookingConstraint> = {}): BookingConstraint => ({
  id: "b1",
  kind: "restaurant",
  title: "壽司晚餐",
  starts_at: "2027-01-10T19:00:00+09:00",
  ends_at: "2027-01-10T20:30:00+09:00",
  timezone: "Asia/Tokyo",
  location: "銀座",
  item_id: null,
  ...over,
});

describe("bookingLocal", () => {
  it("以指定時區換算日期與時間", () => {
    expect(bookingLocal("2027-01-10T19:00:00+09:00", "Asia/Tokyo")).toEqual({ date: "2027-01-10", time: "19:00" });
    expect(bookingLocal("2027-01-10T19:00:00+09:00", "Asia/Taipei")).toEqual({ date: "2027-01-10", time: "18:00" });
    expect(bookingLocal("2027-01-10T23:30:00+08:00", "Asia/Tokyo")).toEqual({ date: "2027-01-11", time: "00:30" });
  });
});

describe("bookingFixedActivities", () => {
  it("同一天的預訂成為已付款的固定活動（行程時區）", () => {
    expect(bookingFixedActivities([booking()], "Asia/Tokyo")).toEqual([
      { name: "壽司晚餐", area: "銀座", date: "2027-01-10", start: "19:00", end: "20:30", paid: true },
    ]);
  });

  it("以行程時區換算：台北時間 18:00 的預訂在東京行程是 19:00", () => {
    const b = booking({ starts_at: "2027-01-10T18:00:00+08:00", ends_at: null, timezone: "Asia/Taipei" });
    expect(bookingFixedActivities([b], "Asia/Tokyo")).toEqual([
      { name: "壽司晚餐", area: "銀座", date: "2027-01-10", start: "19:00", end: "20:00", paid: true },
    ]);
  });

  it("沒有結束時間時以 60 分鐘計算，不超過當天 23:59", () => {
    expect(bookingFixedActivities([booking({ starts_at: "2027-01-10T23:30:00+09:00", ends_at: null })], "Asia/Tokyo")[0]).toMatchObject({
      start: "23:30",
      end: "23:59",
    });
  });

  it("跨日的航班分成出發日與抵達日兩段，中間的日期不佔用", () => {
    const red = booking({ kind: "flight", title: "紅眼航班", starts_at: "2027-01-10T23:00:00+09:00", ends_at: "2027-01-12T06:00:00+09:00", location: null });
    expect(bookingFixedActivities([red], "Asia/Tokyo")).toEqual([
      { name: "紅眼航班", area: null, date: "2027-01-10", start: "23:00", end: "23:59", paid: true },
      { name: "紅眼航班", area: null, date: "2027-01-12", start: "00:00", end: "06:00", paid: true },
    ]);
  });

  it("住宿不佔用時段", () => {
    const hotel = booking({ kind: "lodging", title: "新宿飯店", starts_at: "2027-01-10T15:00:00+09:00", ends_at: "2027-01-12T11:00:00+09:00" });
    expect(bookingFixedActivities([hotel], "Asia/Tokyo")).toEqual([]);
  });

  it("關聯項目已排入同一天時，以項目代表，不重複列出", () => {
    const linked = booking({ item_id: "item-1" });
    expect(bookingFixedActivities([linked], "Asia/Tokyo", (id) => (id === "item-1" ? "2027-01-10" : null))).toEqual([]);
    expect(bookingFixedActivities([linked], "Asia/Tokyo", () => "2027-01-11")).toHaveLength(1);
    expect(bookingFixedActivities([linked], "Asia/Tokyo")).toHaveLength(1);
  });

  it("地點超過 80 字時截短（基線地區欄位上限）", () => {
    expect(bookingFixedActivities([booking({ location: "長".repeat(120) })], "Asia/Tokyo")[0]?.area).toHaveLength(80);
  });
});

describe("withBookings", () => {
  it("把預訂併入固定活動、航班與住宿，基線原有的資料保留", () => {
    const hotel = booking({ id: "b2", kind: "lodging", title: "新宿飯店", starts_at: "2027-01-10T15:00:00+09:00", ends_at: "2027-01-12T11:00:00+09:00", location: "新宿" });
    const flight = booking({ id: "b3", kind: "flight", title: "回程 BR197", starts_at: "2027-01-12T14:00:00+09:00", ends_at: "2027-01-12T17:00:00+08:00", location: null });
    const merged = withBookings(baseline, [booking(), hotel, flight]);
    expect(merged.fixed_activities.map((a) => `${a.date} ${a.start} ${a.name}`)).toEqual([
      "2027-01-10 19:00 壽司晚餐",
      "2027-01-11 19:00 晚餐（已付款）",
      "2027-01-12 14:00 回程 BR197",
    ]);
    expect(merged.lodgings).toEqual([{ name: "新宿飯店", area: "新宿", check_in: "2027-01-10", check_out: "2027-01-12", check_in_time: "15:00" }]);
    expect(merged.flights.map((f) => f.label)).toEqual(["去程", "回程 BR197"]);
    // 不改動傳入的基線
    expect(baseline.fixed_activities).toHaveLength(1);
  });

  it("與基線相同的航班、住宿、固定活動不重複加入", () => {
    const sameFlight = booking({ kind: "flight", title: "去程 BR198", starts_at: "2027-01-10T08:00:00+08:00", ends_at: "2027-01-10T12:00:00+09:00" });
    const sameDinner = booking({ title: "晚餐（已付款）", starts_at: "2027-01-11T19:00:00+09:00", ends_at: "2027-01-11T21:00:00+09:00" });
    const merged = withBookings(baseline, [sameFlight, sameDinner]);
    expect(merged.flights).toHaveLength(1);
    expect(merged.fixed_activities.filter((a) => a.date === "2027-01-11")).toHaveLength(1);
  });

  it("沒有預訂時回傳原本的基線", () => {
    expect(withBookings(baseline, [])).toBe(baseline);
  });
});

describe("bookingsOn 與 bookedItemIds", () => {
  it("當天的預訂依開始時間排序；住宿在入住日與退房日都列出", () => {
    const hotel = booking({ id: "h", kind: "lodging", title: "新宿飯店", starts_at: "2027-01-10T15:00:00+09:00", ends_at: "2027-01-12T11:00:00+09:00" });
    const lunch = booking({ id: "l", title: "午餐", starts_at: "2027-01-10T12:00:00+09:00", ends_at: null });
    expect(bookingsOn([booking(), hotel, lunch], "2027-01-10", "Asia/Tokyo").map((b) => b.id)).toEqual(["l", "h", "b1"]);
    expect(bookingsOn([booking(), hotel, lunch], "2027-01-11", "Asia/Tokyo").map((b) => b.id)).toEqual([]);
    expect(bookingsOn([booking(), hotel, lunch], "2027-01-12", "Asia/Tokyo").map((b) => b.id)).toEqual(["h"]);
  });

  it("有關聯項目的預訂", () => {
    expect([...bookedItemIds([booking({ item_id: "i1" }), booking({ item_id: null })])]).toEqual(["i1"]);
  });
});

describe("可行性：預訂是固定活動", () => {
  const item = (over: Partial<FeasibilityItem> = {}): FeasibilityItem => ({
    id: "sushi",
    name_zh: "壽司店",
    type: "restaurant",
    suggested_stay_minutes: 90,
    priority: 3,
    candidate_role: "primary",
    verification_status: "verified",
    zone_id: "z1",
    score_time_slot_dependency: 0,
    availability: [],
    reservation_requirement: "required",
    weather_dependency: "low",
    ...over,
  });

  it("草案不會把項目排進預訂的時段", () => {
    const merged = withBookings(baseline, [booking({ starts_at: "2027-01-10T09:00:00+09:00", ends_at: "2027-01-10T18:00:00+09:00", title: "一日遊" })]);
    const plan = planFeasibleDays({ baseline: merged, items: [item({ id: "a", type: "attraction", reservation_requirement: "none", suggested_stay_minutes: 60 })], segment: () => null, dates: ["2027-01-10"] });
    const day = plan.days[0];
    expect(day?.entries.find((e) => e.kind === "fixed")).toMatchObject({ name: "一日遊", start: "09:00", end: "18:00" });
    const placed = day?.entries.find((e) => e.kind === "item");
    if (placed) expect(placed.start >= "18:45" || placed.end <= "08:15").toBe(true);
  });

  it("需要預約的項目已有關聯預訂時，不再提醒確認預約", () => {
    const day = { date: "2027-01-10", zone_ids: [], backups: [], unplaced: [], entries: [
      { kind: "item" as const, item_id: "sushi", category: "meal" as const, start: "12:00", end: "13:30", travel_minutes_before: 0, movable_from: "12:00", movable_to: "12:00" },
    ] };
    const input = { baseline, items: [item()], segment: () => null };
    expect(checkDay(day, input).map((i) => i.check)).toContain("reservation");
    expect(checkDay(day, { ...input, bookedItemIds: new Set(["sushi"]) }).map((i) => i.check)).not.toContain("reservation");
  });
});
