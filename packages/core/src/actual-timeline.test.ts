import { describe, expect, it } from "vitest";
import { actualTimeline, type TimelineEntry, type TimelinePlanned } from "./actual-timeline";

// T39：Actual Timeline（第 2.8、2.9 節）。每日結束產生 Planned vs Actual，只記錄實際發生的事。

const TZ = "Asia/Tokyo";
const DATE = "2026-12-10";
const A = "a0000000-0000-0000-0000-000000000001";
const B = "a0000000-0000-0000-0000-000000000002";
const C = "a0000000-0000-0000-0000-000000000003";
const X = "a0000000-0000-0000-0000-000000000009";
const U1 = "00000000-0000-0000-0000-0000000000c1";
const U2 = "00000000-0000-0000-0000-0000000000c2";

const planned: TimelinePlanned[] = [
  { id: A, name_zh: "淺草寺", scheduled_start: "09:00", scheduled_end: "10:30" },
  { id: B, name_zh: "晴空塔", scheduled_start: "11:00", scheduled_end: "12:30" },
  { id: C, name_zh: "上野公園", scheduled_start: "14:00", scheduled_end: "15:30" },
];

const entry = (over: Partial<TimelineEntry> & Pick<TimelineEntry, "item_id">): TimelineEntry => ({
  arrived_at: null,
  departed_at: null,
  completion: "completed",
  recorded_by: U1,
  created_at: "2026-12-10T06:00:00Z",
  ...over,
});

const run = (entries: TimelineEntry[], extra: Array<{ id: string; name_zh: string }> = []) =>
  actualTimeline({ date: DATE, timezone: TZ, planned, unplanned: extra, entries });

describe("actualTimeline", () => {
  it("沒有紀錄的排定項目為「未記錄」，不標為已去過", () => {
    const t = run([]);
    expect(t.rows.map((r) => [r.itemId, r.outcome, r.visited])).toEqual([
      [A, "not_recorded", false],
      [B, "not_recorded", false],
      [C, "not_recorded", false],
    ]);
    expect(t.visitedItemIds).toEqual([]);
  });

  it("只有完成的項目標為已去過；部分完成與略過不算", () => {
    const t = run([
      entry({ item_id: A, completion: "completed", arrived_at: "2026-12-10T00:05:00Z", departed_at: "2026-12-10T01:40:00Z" }),
      entry({ item_id: B, completion: "partial", arrived_at: "2026-12-10T02:20:00Z", departed_at: "2026-12-10T02:50:00Z" }),
      entry({ item_id: C, completion: "skipped" }),
    ]);
    expect(t.rows.map((r) => [r.itemId, r.outcome, r.visited])).toEqual([
      [A, "completed", true],
      [B, "partial", false],
      [C, "skipped", false],
    ]);
    expect(t.visitedItemIds).toEqual([A]);
    expect(t.summary).toEqual({ planned: 3, completed: 1, partial: 1, skipped: 1, notRecorded: 0, unplanned: 0 });
  });

  it("以目的地時區顯示實際時間，並計算與排定開始的差距", () => {
    const t = run([entry({ item_id: A, arrived_at: "2026-12-10T00:20:00Z", departed_at: "2026-12-10T01:50:00Z" })]);
    const row = t.rows.find((r) => r.itemId === A);
    expect(row?.planned).toEqual({ start: "09:00", end: "10:30" });
    expect(row?.actual).toEqual({ arrived: "09:20", departed: "10:50" });
    expect(row?.arrivalDeltaMinutes).toBe(20);
  });

  it("同一項目有多筆紀錄時以最後一筆為準", () => {
    const t = run([
      entry({ item_id: A, completion: "completed", created_at: "2026-12-10T01:00:00Z", recorded_by: U1 }),
      entry({ item_id: A, completion: "skipped", created_at: "2026-12-10T02:00:00Z", recorded_by: U2 }),
    ]);
    const row = t.rows.find((r) => r.itemId === A);
    expect(row?.outcome).toBe("skipped");
    expect(row?.visited).toBe(false);
    expect(row?.recordedBy).toBe(U2);
  });

  it("沒有排定、但當天實際去過的項目列為計畫外", () => {
    const t = run(
      [entry({ item_id: X, arrived_at: "2026-12-10T05:00:00Z", departed_at: "2026-12-10T05:40:00Z" })],
      [{ id: X, name_zh: "備案咖啡廳" }],
    );
    const row = t.rows.find((r) => r.itemId === X);
    expect(row).toMatchObject({ name_zh: "備案咖啡廳", planned: null, outcome: "completed", visited: true, unplanned: true });
    expect(row?.actual).toEqual({ arrived: "14:00", departed: "14:40" });
    expect(t.summary.unplanned).toBe(1);
    expect(t.visitedItemIds).toEqual([X]);
  });

  it("計畫外的項目若實際時間不在當天（目的地時區）則不列入", () => {
    const t = run(
      [entry({ item_id: X, arrived_at: "2026-12-10T16:00:00Z" })],
      [{ id: X, name_zh: "隔天的店" }],
    );
    expect(t.rows.some((r) => r.itemId === X)).toBe(false);
  });

  it("計畫外的項目沒有實際時間、或沒有完成，不列為已去過", () => {
    const t = run([entry({ item_id: X, completion: "skipped", arrived_at: "2026-12-10T05:00:00Z" })], [{ id: X, name_zh: "略過的店" }]);
    expect(t.rows.find((r) => r.itemId === X)?.visited).toBe(false);
    expect(t.visitedItemIds).toEqual([]);
  });

  it("依時間排序：排定項目按排定開始，計畫外按實際到達", () => {
    const t = run(
      [entry({ item_id: X, arrived_at: "2026-12-10T03:30:00Z" })],
      [{ id: X, name_zh: "午餐" }],
    );
    expect(t.rows.map((r) => r.itemId)).toEqual([A, B, X, C]);
  });

  it("輸出不含紀錄者以外的個人資料", () => {
    const t = run([entry({ item_id: A })]);
    expect(Object.keys(t.rows[0] ?? {}).sort()).toEqual(
      ["actual", "arrivalDeltaMinutes", "itemId", "name_zh", "outcome", "planned", "recordedBy", "unplanned", "visited"].sort(),
    );
  });
});
