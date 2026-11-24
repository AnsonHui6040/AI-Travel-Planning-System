import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { SCREENING_DIMENSIONS, screenCandidates, type ScreeningItem } from "./index";

// T26：候選篩選。八個維度各 0–5 分（5 = 最適合排入）；每個候選標記 Primary 或 Backup

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-05",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-05", check_in_time: null }],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [{ name: "淺草和服體驗", area: "淺草", date: "2026-12-02", start: "10:00", end: "12:00", paid: true }],
  paid_items: [],
  must_visit: ["淺草寺"],
  excluded: ["東京鐵塔"],
  transport_preferences: [],
  photography_needs: "想拍夜景",
};

const official = { url: "https://www.example.jp/", fetched_at: "2026-11-23T10:00:00+09:00", grade: "facility_official" as const };
const claude = { provider: "anthropic" as const, model: "claude-opus-5-5" };

let n = 0;
const item = (over: Partial<ScreeningItem>): ScreeningItem => ({
  id: `item-${++n}`,
  name_zh: `候選 ${n}`,
  name_local: null,
  area: "上野",
  type: "attraction",
  suggested_stay_minutes: 60,
  research_track: "A",
  fact_claims: [],
  ...over,
});

describe("screenCandidates", () => {
  it("每個候選八個維度均有 0–5 的整數評分，並標記 Primary 或 Backup", () => {
    const items = [item({}), item({ type: "restaurant" }), item({ type: "photography", area: null })];
    const results = screenCandidates(items, { baseline });
    expect(SCREENING_DIMENSIONS).toHaveLength(8);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(Object.keys(r.scores).sort()).toEqual([...SCREENING_DIMENSIONS].sort());
      for (const value of Object.values(r.scores)) {
        expect(Number.isInteger(value) && value >= 0 && value <= 5).toBe(true);
      }
      expect(["primary", "backup"]).toContain(r.candidate_role);
      expect(r.priority).toBeGreaterThanOrEqual(1);
      expect(r.priority).toBeLessThanOrEqual(5);
    }
  });

  it("必去地點：個人價值 5、不可替代，一律 Primary", () => {
    const [r] = screenCandidates([item({ name_zh: "淺草寺", name_local: "浅草寺", area: "淺草" })], { baseline });
    expect(r).toMatchObject({ candidate_role: "primary", scores: { personal_value: 5, substitutability: 5 } });
  });

  it("排除地點：個人價值 0，一律 Backup", () => {
    const [r] = screenCandidates([item({ name_zh: "東京鐵塔", area: "芝公園" })], { baseline });
    expect(r).toMatchObject({ candidate_role: "backup", scores: { personal_value: 0 } });
  });

  it("攝影需求符合攝影類候選時個人價值較高", () => {
    const [photo, plain] = screenCandidates([item({ type: "photography" }), item({ type: "shopping" })], { baseline });
    expect(photo?.scores.personal_value).toBeGreaterThan(plain?.scores.personal_value ?? 5);
  });

  it("地理配合：住宿或固定活動的地區為 5，沒有地區為 1", () => {
    const results = screenCandidates([item({ area: "新宿" }), item({ area: "淺草" }), item({ area: "鎌倉" }), item({ area: null })], { baseline });
    expect(results.map((r) => r.scores.geographic_fit)).toEqual([5, 5, 2, 1]);
  });

  it("時間成本依停留時間：60 分鐘 5 分，240 分鐘 2 分", () => {
    const results = screenCandidates([item({ suggested_stay_minutes: 60 }), item({ suggested_stay_minutes: 240, area: "鎌倉" })], { baseline });
    expect(results.map((r) => r.scores.time_cost)).toEqual([5, 2]);
  });

  it("天氣依賴：攝影類為 1（依賴度高），餐飲為 5", () => {
    const results = screenCandidates([item({ type: "photography" }), item({ type: "restaurant" })], { baseline });
    expect(results.map((r) => [r.scores.weather_dependency, r.weather_dependency])).toEqual([
      [1, "high"],
      [5, "low"],
    ]);
  });

  it("時段依賴：需要預約時 2 分，有營業時間限制 3 分，沒有限制 4 分", () => {
    const results = screenCandidates(
      [
        item({ fact_claims: [{ field: "reservation", value: "需預約", source: official, by: claude }] }),
        item({ fact_claims: [{ field: "opening_hours", value: "09:00–17:00", source: official, by: claude }], area: "鎌倉" }),
        item({ area: "橫濱" }),
      ],
      { baseline },
    );
    expect(results.map((r) => r.scores.time_slot_dependency)).toEqual([2, 3, 4]);
  });

  it("同一地區同類型候選越多，替代性分數越低；每組最多 2 個 Primary，其餘為 Backup", () => {
    const cafes = [1, 2, 3].map((i) => item({ type: "restaurant", area: "清澄白河", name_zh: `咖啡 ${i}`, suggested_stay_minutes: 30 * i }));
    const results = screenCandidates(cafes, { baseline });
    expect(results.every((r) => r.scores.substitutability === 1)).toBe(true);
    expect(results.map((r) => r.candidate_role)).toEqual(["primary", "primary", "backup"]);
  });

  it("D 方向（冷門替代）的獨特性較高", () => {
    const [d, a] = screenCandidates([item({ research_track: "D", area: "谷中" }), item({ research_track: "A", area: "鎌倉" })], { baseline });
    expect(d?.scores.uniqueness).toBeGreaterThan(a?.scores.uniqueness ?? 5);
  });

  it("相同輸入得到相同結果（不依賴輸入順序）", () => {
    const items = [item({ type: "restaurant", area: "銀座" }), item({ type: "restaurant", area: "銀座" }), item({ type: "restaurant", area: "銀座" })];
    const forward = screenCandidates(items, { baseline });
    const backward = screenCandidates([...items].reverse(), { baseline });
    const byId = (rs: typeof forward) => Object.fromEntries(rs.map((r) => [r.item_id, r.candidate_role]));
    expect(byId(backward)).toEqual(byId(forward));
  });
});
