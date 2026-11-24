import { changePayload } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { dueReverification, reverifyAtRisk, type ReverifyItem, type ReverifyTrip } from "./index";

// T31：旅前自動再核實（D25、C-12）。時間由呼叫端傳入，以目的地時區判斷 T-7 與 T-1

const trip: ReverifyTrip = { start_date: "2026-12-10", timezone: "Asia/Tokyo", status: "locked", reverify_enabled: true };
// 東京 2026-12-03 09:00 = UTC 00:00
const tokyo = (date: string, hhmm = "09:00") => new Date(`${date}T${hhmm}:00+09:00`);

describe("dueReverification", () => {
  it("Owner 未開啟排程時不執行", () => {
    expect(dueReverification({ ...trip, reverify_enabled: false }, [], tokyo("2026-12-03"))).toBeNull();
    expect(dueReverification({ ...trip, reverify_enabled: false }, [], tokyo("2026-12-09"))).toBeNull();
  });

  it("出發前 7 天執行 T-7，出發前 1 天執行 T-1，各一次", () => {
    expect(dueReverification(trip, [], tokyo("2026-12-02"))).toBeNull();
    expect(dueReverification(trip, [], tokyo("2026-12-03"))).toBe("T-7");
    expect(dueReverification(trip, ["T-7"], tokyo("2026-12-03"))).toBeNull();
    // 錯過 T-7 當天時，到 T-2 前仍會補跑
    expect(dueReverification(trip, [], tokyo("2026-12-08"))).toBe("T-7");
    expect(dueReverification(trip, ["T-7"], tokyo("2026-12-09"))).toBe("T-1");
    expect(dueReverification(trip, ["T-7", "T-1"], tokyo("2026-12-09"))).toBeNull();
    // T-1 才開啟排程時只跑 T-1
    expect(dueReverification(trip, [], tokyo("2026-12-09"))).toBe("T-1");
    expect(dueReverification(trip, [], tokyo("2026-12-10"))).toBeNull();
  });

  it("以目的地時區判斷日期", () => {
    // UTC 2026-12-02 16:00 = 東京 2026-12-03 01:00（T-7）；同一時刻的夏威夷仍是 12-02
    const instant = new Date("2026-12-02T16:00:00Z");
    expect(dueReverification(trip, [], instant)).toBe("T-7");
    expect(dueReverification({ ...trip, timezone: "Pacific/Honolulu" }, [], instant)).toBeNull();
  });

  it("只在規劃中或已鎖定的行程執行", () => {
    expect(dueReverification({ ...trip, status: "planning" }, [], tokyo("2026-12-03"))).toBe("T-7");
    expect(dueReverification({ ...trip, status: "baseline" }, [], tokyo("2026-12-03"))).toBeNull();
    expect(dueReverification({ ...trip, status: "in_progress" }, [], tokyo("2026-12-09"))).toBeNull();
  });
});

describe("reverifyAtRisk", () => {
  const item = (over: Partial<ReverifyItem>): ReverifyItem => ({
    id: "11111111-1111-4111-8111-111111111111",
    scheduled_date: "2026-12-10",
    scheduled_start: "13:00",
    scheduled_end: "14:00",
    at_risk: false,
    ...over,
  });
  // 2026-12-10 是星期四（4）
  const open = [{ weekday: 4, start: "10:00", end: "18:00" }];

  it("核實結果仍符合時不產生提案", () => {
    expect(reverifyAtRisk([item({})], [{ item_id: item({}).id, status: "verified", availability: open }])).toBeNull();
    expect(reverifyAtRisk([item({})], [{ item_id: item({}).id, status: "partially_verified", availability: [] }])).toBeNull();
  });

  it("Conflict、Unverified、當天休館或不在營業時間內的項目標示 At Risk", () => {
    const a = item({ id: "11111111-1111-4111-8111-111111111111" });
    const b = item({ id: "22222222-2222-4222-8222-222222222222" });
    const c = item({ id: "33333333-3333-4333-8333-333333333333" });
    const d = item({ id: "44444444-4444-4444-8444-444444444444" });
    const change = reverifyAtRisk(
      [a, b, c, d],
      [
        { item_id: a.id, status: "conflict", availability: [] },
        { item_id: b.id, status: "unverified", availability: [] },
        { item_id: c.id, status: "verified", availability: [{ weekday: 5, start: "10:00", end: "18:00" }] },
        { item_id: d.id, status: "verified", availability: [{ weekday: 4, start: "14:00", end: "18:00" }] },
      ],
    );
    expect(change?.changeKind).toBe("approved_fact_invalidated");
    expect(change?.operations).toEqual([a, b, c, d].map((i) => ({ op: "set_at_risk", itemId: i.id, atRisk: true })));
    expect(change?.versionKind).toBe("minor");
    expect(change?.summary).toBe("旅前再核實：4 個項目的資料可能已有變動，標示為 At Risk");
    expect(changePayload.safeParse(change).success).toBe(true);
  });

  it("已標示 At Risk 或不在本次核實的項目不重複標示", () => {
    const a = item({ at_risk: true });
    expect(reverifyAtRisk([a], [{ item_id: a.id, status: "conflict", availability: [] }])).toBeNull();
    expect(reverifyAtRisk([], [{ item_id: a.id, status: "conflict", availability: [] }])).toBeNull();
  });

  it("影響兩天以上時為 Major", () => {
    const a = item({});
    const b = item({ id: "22222222-2222-4222-8222-222222222222", scheduled_date: "2026-12-11" });
    const change = reverifyAtRisk(
      [a, b],
      [
        { item_id: a.id, status: "conflict", availability: [] },
        { item_id: b.id, status: "conflict", availability: [] },
      ],
    );
    expect(change?.versionKind).toBe("major");
  });
});
