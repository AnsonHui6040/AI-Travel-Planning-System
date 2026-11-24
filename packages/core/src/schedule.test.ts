import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { categorizeForSchedule, draftDays, type DraftItem } from "./index";

// T29：每日時段草案。排程順序：固定活動、時段敏感活動、高優先景點、餐飲、彈性活動、Backup

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-01",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [{ name: "和服體驗", area: "淺草", date: "2026-12-01", start: "13:00", end: "15:00", paid: true }],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: [],
  photography_needs: null,
};

let n = 0;
const item = (over: Partial<DraftItem>): DraftItem => ({
  id: `i${++n}`,
  name_zh: `候選 ${n}`,
  type: "attraction",
  suggested_stay_minutes: 60,
  priority: 3,
  candidate_role: "primary",
  verification_status: "verified",
  zone_id: "z1",
  score_time_slot_dependency: 4,
  ...over,
});

const noTravel = () => 0;

describe("categorizeForSchedule", () => {
  it("依時段依賴、優先度、類型與候選角色分類", () => {
    expect(categorizeForSchedule(item({ score_time_slot_dependency: 2 }))).toBe("time_sensitive");
    expect(categorizeForSchedule(item({ type: "photography" }))).toBe("time_sensitive");
    expect(categorizeForSchedule(item({ priority: 4 }))).toBe("high_priority");
    expect(categorizeForSchedule(item({ type: "restaurant" }))).toBe("meal");
    expect(categorizeForSchedule(item({}))).toBe("flexible");
    expect(categorizeForSchedule(item({ candidate_role: "backup", priority: 5 }))).toBe("backup");
  });
});

describe("draftDays", () => {
  it("固定活動先佔用時段，其餘依排程順序放入，不與固定活動重疊", () => {
    const flexible = item({ name_zh: "彈性景點" });
    const high = item({ name_zh: "高優先景點", priority: 5 });
    const sensitive = item({ name_zh: "預約展覽", score_time_slot_dependency: 2 });
    const [day] = draftDays({ baseline, items: [flexible, high, sensitive], travelMinutes: noTravel });
    const timeline = day?.entries.map((e) => (e.kind === "fixed" ? `固定:${e.name}@${e.start}` : `${e.category}@${e.start}`));
    expect(timeline).toEqual([
      "time_sensitive@09:00",
      "high_priority@10:00",
      "flexible@11:00",
      "固定:和服體驗@13:00",
    ]);
  });

  it("餐飲優先放在午餐或晚餐時段", () => {
    const meal = item({ type: "restaurant", name_zh: "咖啡店" });
    const [day] = draftDays({ baseline, items: [meal, item({ priority: 4 })], travelMinutes: noTravel });
    const placed = day?.entries.find((e) => e.kind === "item" && e.item_id === meal.id);
    expect(placed?.start).toBe("11:30");
  });

  it("Unverified 與 Conflict 不排入；Backup 列在當天的 Backup 清單，不排入時段", () => {
    const unverified = item({ verification_status: "unverified" });
    const conflict = item({ verification_status: "conflict" });
    const backup = item({ candidate_role: "backup" });
    const partial = item({ verification_status: "partially_verified" });
    const [day] = draftDays({ baseline, items: [unverified, conflict, backup, partial], travelMinutes: noTravel });
    const placedIds = day?.entries.flatMap((e) => (e.kind === "item" ? [e.item_id] : []));
    expect(placedIds).toEqual([partial.id]);
    expect(day?.backups).toEqual([backup.id]);
  });

  it("加入兩地之間的交通時間；有交通估算時採用估算", () => {
    const a = item({ name_zh: "甲", priority: 5 });
    const b = item({ name_zh: "乙", priority: 4 });
    const travel = (from: string, to: string) => (from === a.id && to === b.id ? 25 : null);
    const [day] = draftDays({ baseline, items: [a, b], travelMinutes: travel });
    const entries = day?.entries.filter((e) => e.kind === "item");
    expect(entries?.map((e) => (e.kind === "item" ? [e.start, e.end, e.travel_minutes_before] : []))).toEqual([
      ["09:00", "10:00", 0],
      ["10:25", "11:25", 25],
    ]);
  });

  it("可移動範圍：最晚開始時間扣掉到下一站的交通", () => {
    const a = item({ priority: 5 });
    const b = item({ priority: 4 });
    const travel = (from: string, to: string) => (from === a.id && to === b.id ? 15 : 0);
    const [day] = draftDays({ baseline, items: [a, b], travelMinutes: travel });
    const first = day?.entries.find((e) => e.kind === "item" && e.item_id === a.id);
    expect(first?.kind === "item" && [first.start, first.movable_to]).toEqual(["09:00", "09:00"]);
  });

  it("可移動範圍：前一個項目結束（加交通）到下一個項目開始前", () => {
    const a = item({ priority: 5 });
    const [day] = draftDays({ baseline, items: [a], travelMinutes: noTravel });
    const entry = day?.entries.find((e) => e.kind === "item");
    expect(entry?.kind === "item" && [entry.movable_from, entry.movable_to]).toEqual(["09:00", "12:00"]);
  });

  it("放不下的項目列為未排入", () => {
    const long = Array.from({ length: 6 }, () => item({ suggested_stay_minutes: 180 }));
    const [day] = draftDays({ baseline, items: long, travelMinutes: noTravel });
    expect(day?.entries.filter((e) => e.kind === "item")).toHaveLength(3);
    expect(day?.unplaced).toHaveLength(3);
  });

  it("多天時每個分區排在同一天", () => {
    const twoDays = { ...baseline, end_date: "2026-12-02", fixed_activities: [] };
    const items = [item({ zone_id: "east" }), item({ zone_id: "west" }), item({ zone_id: "east" })];
    const days = draftDays({ baseline: twoDays, items, travelMinutes: noTravel });
    expect(days.map((d) => d.date)).toEqual(["2026-12-01", "2026-12-02"]);
    expect(days[0]?.zone_ids).toEqual(["east"]);
    expect(days[1]?.zone_ids).toEqual(["west"]);
  });
});

describe("draftDays 固定活動緩衝（T30）", () => {
  it("固定活動之後另加緩衝才排入下一個項目", () => {
    const fixedDay = { ...baseline, fixed_activities: [{ name: "和服體驗", area: null, date: "2026-12-01", start: "09:00", end: "10:00", paid: true }] };
    const [day] = draftDays({ baseline: fixedDay, items: [item({})], travelMinutes: () => 20, fixedBuffer: 15 });
    expect(day?.entries.find((e) => e.kind === "item")?.start).toBe("10:35");
  });
});

describe("draftDays 到下一站的交通（T30）", () => {
  it("項目結束後須留下到下一個時段的交通", () => {
    const fixedDay = { ...baseline, fixed_activities: [{ name: "和服體驗", area: null, date: "2026-12-01", start: "10:20", end: "12:00", paid: true }] };
    // 09:00–10:00 之後到固定活動需要 30 分鐘，所以改排到固定活動之後
    const [day] = draftDays({ baseline: fixedDay, items: [item({})], travelMinutes: () => null });
    expect(day?.entries.find((e) => e.kind === "item")?.start).toBe("12:30");
  });
});
