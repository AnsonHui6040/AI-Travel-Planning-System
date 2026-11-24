import { describe, expect, it } from "vitest";
import {
  featureFlagRow,
  hhmm,
  httpsUrl,
  ianaTimezone,
  isoDate,
  itineraryItemRow,
  mobilityEstimate,
  money,
  offsetDateTime,
  sourceRef,
  tripBaselineData,
} from "./index";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

const validItem = {
  id: "11111111-1111-4111-8111-111111111111",
  trip_id: "22222222-2222-4222-8222-222222222222",
  name_zh: "淺草寺",
  name_local: "浅草寺",
  place_id: null,
  type: "attraction",
  address: "東京都台東区浅草2-3-1",
  area: "淺草",
  coord_lat: null,
  coord_lng: null,
  coord_fetched_at: null,
  suggested_stay_minutes: 60,
  availability: [{ weekday: 1, start: "06:00", end: "17:00" }],
  reservation_requirement: "none",
  reservation_note: null,
  constraint_class: "flexible",
  is_fixed: false,
  priority: 3,
  weather_dependency: "medium",
  candidate_role: "primary",
  recommendation_reason: "東京最古老的寺院",
  constraint_note: null,
  score_personal_value: 4,
  score_uniqueness: 5,
  score_geographic_fit: 3,
  score_time_cost: 3,
  score_transport_cost: 4,
  score_weather_dependency: 2,
  score_time_slot_dependency: 2,
  score_substitutability: 1,
  scheduled_date: null,
  scheduled_start: null,
  scheduled_end: null,
  movable_from: null,
  movable_to: null,
  verification_status: "unverified",
  last_verified_at: null,
  sources: [{ url: "https://www.senso-ji.jp/", fetched_at: "2026-11-23T10:00:00+09:00", grade: "facility_official" }],
  generated_by: { provider: "anthropic", model: "claude-opus-5-5" },
  verified_by: null,
  research_track: null,
  research_job_id: null,
  lifecycle_status: "candidate",
  at_risk: false,
  standby: false,
  post_trip_status: null,
  estimated_cost_amount: null,
  estimated_cost_currency: null,
  actual_cost_amount: null,
  actual_cost_currency: null,
  payer_id: null,
  created_at: "2026-11-23T10:00:00+09:00",
};

describe("共用格式（決策 0002）", () => {
  it("日期只接受 YYYY-MM-DD 的有效日期", () => {
    expect(ok(isoDate, "2026-02-28")).toBe(true);
    expect(ok(isoDate, "2026-02-30")).toBe(false);
    expect(ok(isoDate, "2026/02/28")).toBe(false);
  });

  it("時間只接受 HH:mm", () => {
    expect(ok(hhmm, "00:00")).toBe(true);
    expect(ok(hhmm, "23:59")).toBe(true);
    expect(ok(hhmm, "24:00")).toBe(false);
    expect(ok(hhmm, "9:00")).toBe(false);
  });

  it("時區只接受 IANA 名稱", () => {
    expect(ok(ianaTimezone, "Asia/Tokyo")).toBe(true);
    expect(ok(ianaTimezone, "Tokyo")).toBe(false);
    expect(ok(ianaTimezone, "+09:00")).toBe(false);
  });

  it("取得時間必須含時區", () => {
    expect(ok(offsetDateTime, "2026-11-23T10:00:00+09:00")).toBe(true);
    expect(ok(offsetDateTime, "2026-11-23T01:00:00Z")).toBe(true);
    expect(ok(offsetDateTime, "2026-11-23T10:00:00")).toBe(false);
  });

  it("網址只限 https 且不超過 2048 字元", () => {
    expect(ok(httpsUrl, "https://example.jp/a")).toBe(true);
    expect(ok(httpsUrl, "http://example.jp/a")).toBe(false);
    expect(ok(httpsUrl, "javascript:alert(1)")).toBe(false);
    expect(ok(httpsUrl, `https://example.jp/${"a".repeat(2048)}`)).toBe(false);
  });

  it("金額 0–10,000,000，幣別為 ISO 4217 三個大寫字母", () => {
    expect(ok(money, { amount: 0, currency: "JPY" })).toBe(true);
    expect(ok(money, { amount: 10_000_000, currency: "TWD" })).toBe(true);
    expect(ok(money, { amount: 10_000_001, currency: "TWD" })).toBe(false);
    expect(ok(money, { amount: -1, currency: "TWD" })).toBe(false);
    expect(ok(money, { amount: 100, currency: "twd" })).toBe(false);
  });

  it("來源等級只接受四級", () => {
    const base = { url: "https://example.jp", fetched_at: "2026-11-23T10:00:00+09:00" };
    expect(ok(sourceRef, { ...base, grade: "user_reviews" })).toBe(true);
    expect(ok(sourceRef, { ...base, grade: "blog" })).toBe(false);
  });
});

describe("行程項目", () => {
  it("完整的有效資料通過", () => {
    const result = itineraryItemRow.safeParse(validItem);
    expect(result.error?.issues).toBeUndefined();
  });

  it("拒絕未知欄位", () => {
    expect(ok(itineraryItemRow, { ...validItem, image_url: "https://x.jp/a.png" })).toBe(false);
  });

  it("缺少必填欄位時拒絕", () => {
    const rest: Partial<typeof validItem> = { ...validItem };
    delete rest.name_zh;
    expect(ok(itineraryItemRow, rest)).toBe(false);
  });

  it.each([
    ["name_zh", "", false],
    ["name_zh", "字".repeat(80), true],
    ["name_zh", "字".repeat(81), false],
    ["name_local", "字".repeat(120), true],
    ["name_local", "字".repeat(121), false],
    ["address", "字".repeat(200), true],
    ["address", "字".repeat(201), false],
    ["recommendation_reason", "字".repeat(300), true],
    ["recommendation_reason", "字".repeat(301), false],
    ["constraint_note", "字".repeat(301), false],
    ["suggested_stay_minutes", 4, false],
    ["suggested_stay_minutes", 5, true],
    ["suggested_stay_minutes", 600, true],
    ["suggested_stay_minutes", 601, false],
    ["priority", 0, false],
    ["priority", 5, true],
    ["priority", 6, false],
    ["score_uniqueness", 6, false],
    ["score_uniqueness", 2.5, false],
    ["type", "museum", false],
    ["weather_dependency", "extreme", false],
    ["reservation_requirement", "required", true],
    ["reservation_requirement", "maybe", false],
    ["constraint_class", "hard_constraint", true],
    ["verification_status", "conflict", true],
    ["verification_status", "unknown", false],
  ])("%s = %j 時，通過為 %s", (field, value, expected) => {
    expect(ok(itineraryItemRow, { ...validItem, [field]: value })).toBe(expected);
  });
});

describe("交通估算", () => {
  const estimate = {
    mode: "rail",
    door_to_door_minutes: 30,
    price: { amount: 200, currency: "JPY" },
    walk_minutes: 10,
    transfers: 1,
    luggage_friendliness: "medium",
    comfort: "medium",
    delay_risk: "low",
  };

  it.each([
    ["door_to_door_minutes", 0, false],
    ["door_to_door_minutes", 1, true],
    ["door_to_door_minutes", 1440, true],
    ["door_to_door_minutes", 1441, false],
    ["walk_minutes", 600, true],
    ["walk_minutes", 601, false],
    ["transfers", 10, true],
    ["transfers", 11, false],
    ["mode", "helicopter", false],
  ])("%s = %j 時，通過為 %s", (field, value, expected) => {
    expect(ok(mobilityEstimate, { ...estimate, [field]: value })).toBe(expected);
  });
});

describe("旅行基線", () => {
  it("時區、日期、金額沿用共用格式", () => {
    const baseline = {
      start_date: "2026-12-01",
      end_date: "2026-12-05",
      timezone: "Asia/Tokyo",
      flights: [],
      lodgings: [],
      companions: 2,
      stamina_note: null,
      budget: { amount: 100000, currency: "TWD" },
      fixed_activities: [],
      paid_items: [],
      must_visit: [],
      excluded: [],
      transport_preferences: [],
      photography_needs: null,
    };
    expect(tripBaselineData.safeParse(baseline).error?.issues).toBeUndefined();
    expect(ok(tripBaselineData, { ...baseline, timezone: "JST" })).toBe(false);
    expect(ok(tripBaselineData, { ...baseline, end_date: "2026-11-30" })).toBe(false);
  });
});

describe("feature flag（F-05）", () => {
  const flag = {
    key: "expense_ledger",
    enabled: false,
    description: "預算與記帳",
    updated_at: "2026-11-23T08:00:00+00:00",
  };

  it("key 為小寫英文、數字與底線", () => {
    expect(featureFlagRow.safeParse(flag).error?.issues).toBeUndefined();
    expect(ok(featureFlagRow, { ...flag, key: "Expense Ledger" })).toBe(false);
    expect(ok(featureFlagRow, { ...flag, key: "" })).toBe(false);
  });

  it("enabled 只接受布林值", () => {
    expect(ok(featureFlagRow, { ...flag, enabled: "true" })).toBe(false);
  });
});
