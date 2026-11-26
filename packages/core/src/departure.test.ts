import { describe, expect, it } from "vitest";
import { departureCheck, type DepartureInput } from "./index";

// T37：離開前檢查。出現偏差時依決策 0004 分級，達到 L1 以上即進入 Incident Mode（T38）

const tokyo = (hhmm: string) => new Date(`2026-12-10T${hhmm}:00+09:00`);

const input = (over: Partial<DepartureInput> = {}): DepartureInput => ({
  date: "2026-12-10",
  timezone: "Asia/Tokyo",
  now: tokyo("10:00"),
  current: { id: "museum", name: "江戶東京博物館", end: "10:00" },
  next: { id: "cafe", name: "咖啡店", start: "11:00", end: "12:00", atRisk: false, closed: false },
  nextFixed: { name: "晚餐（已付款）", start: "19:00" },
  plannedTravelMinutes: 30,
  liveTravelMinutes: null,
  transitAbnormal: null,
  ...over,
});

describe("departureCheck", () => {
  it("準時：顯示最遲離開時間、倒數與預計到達，不進入 Incident Mode", () => {
    expect(departureCheck(input())).toEqual({
      now: "10:00",
      leaveBy: "10:30",
      countdownMinutes: 30,
      eta: "10:30",
      lateMinutes: 0,
      worthGoing: true,
      notes: ["沒有即時交通資料，以估算計算"],
      fixedMarginMinutes: 390,
      incident: null,
    });
  });

  it("延誤 0–9 分鐘只更新預計到達時間", () => {
    const result = departureCheck(input({ now: tokyo("10:35") }));
    expect([result.eta, result.lateMinutes, result.countdownMinutes, result.incident]).toEqual(["11:05", 5, -5, null]);
  });

  it("延誤 10–20 分鐘為 L1；壓縮後距下一個固定活動不足 15 分鐘時升為 L2", () => {
    expect(departureCheck(input({ now: tokyo("10:45") })).incident).toEqual({ type: "delay", level: "L1" });
    // 咖啡店 11:15–12:15，再加 30 分鐘交通到 19:00 的晚餐……把晚餐改到 12:55，緩衝只剩 10 分鐘
    expect(departureCheck(input({ now: tokyo("10:45"), nextFixed: { name: "和服體驗", start: "12:55" } })).incident).toEqual({ type: "delay", level: "L2" });
  });

  it("延誤 21–60 分鐘為 L2，超過 60 分鐘為 L3", () => {
    expect(departureCheck(input({ now: tokyo("11:00") })).incident).toEqual({ type: "delay", level: "L2" });
    expect(departureCheck(input({ now: tokyo("11:45") })).incident).toEqual({ type: "delay", level: "L3" });
  });

  it("使下一個固定活動無法準時，不論延誤分鐘數都是 L3", () => {
    const result = departureCheck(input({ now: tokyo("10:35"), nextFixed: { name: "和服體驗", start: "12:30" } }));
    expect(result.fixedMarginMinutes).toBe(-5);
    expect(result.incident).toEqual({ type: "delay", level: "L3" });
  });

  it("下一站休館為 L3，且不值得前往", () => {
    const result = departureCheck(input({ next: { id: "cafe", name: "咖啡店", start: "11:00", end: "12:00", atRisk: true, closed: true } }));
    expect(result.worthGoing).toBe(false);
    expect(result.notes).toContain("下一站今天休館或暫停營業");
    expect(result.incident).toEqual({ type: "attraction_closed", level: "L3" });
  });

  it("交通運行異常為 L3；即時交通時間優先於估算", () => {
    expect(departureCheck(input({ transitAbnormal: true })).incident).toEqual({ type: "rail_disruption", level: "L3" });
    const live = departureCheck(input({ liveTravelMinutes: 45, transitAbnormal: false }));
    expect([live.eta, live.lateMinutes, live.notes]).toEqual(["10:45", 0, []]);
  });

  it("抵達後停留不到原本一半時不值得前往；下一站標示 At Risk 時提醒", () => {
    const short = departureCheck(input({ now: tokyo("11:10") }));
    expect(short.worthGoing).toBe(false);
    expect(short.notes).toContain("抵達後停留不到原本的一半");
    const risky = departureCheck(input({ next: { id: "cafe", name: "咖啡店", start: "11:00", end: "12:00", atRisk: true, closed: false } }));
    expect(risky.worthGoing).toBe(true);
    expect(risky.notes).toContain("下一站標示 At Risk，出發前再確認");
  });

  it("下一站是固定活動或已是最後一站", () => {
    const toFixed = departureCheck(input({ next: null, nextFixed: { name: "晚餐（已付款）", start: "11:00" } }));
    expect([toFixed.leaveBy, toFixed.eta, toFixed.fixedMarginMinutes, toFixed.incident]).toEqual(["10:15", "10:30", 30, null]);
    const last = departureCheck(input({ next: null, nextFixed: null }));
    expect([last.leaveBy, last.eta, last.incident]).toEqual([null, null, null]);
  });
});
