import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { MORNING_CHECKS, morningCheck, type MorningCandidate, type MorningInput, type MorningItem } from "./index";

// T36：Morning Check（第 2.8 節 Day Ready）。純函式：觀測資料由呼叫端傳入；沒有資料的項目標示「無資料」，不當作通過

const baseline: TripBaselineData = {
  start_date: "2026-12-08",
  end_date: "2026-12-12",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-08", check_out: "2026-12-13", check_in_time: "15:00" }],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [{ name: "晚餐（已付款）", area: "新宿", date: "2026-12-10", start: "19:00", end: "21:00", paid: true }],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: [],
  photography_needs: null,
};

const item = (over: Partial<MorningItem> & { id: string }): MorningItem => ({
  name_zh: over.id,
  type: "attraction",
  zone_id: "asakusa",
  weather_dependency: "low",
  scheduled_start: "10:00",
  scheduled_end: "11:00",
  reservation_requirement: "none",
  availability: [],
  at_risk: false,
  ...over,
});

const candidate = (over: Partial<MorningCandidate> & { id: string }): MorningCandidate => ({
  name_zh: over.id,
  zone_id: "asakusa",
  weather_dependency: "low",
  verification_status: "verified",
  standby: false,
  ...over,
});

// 東京 12/10：午後 13:00 起大雨
const rainyAfternoon = Array.from({ length: 24 }, (_, h) => ({
  time: `2026-12-10T${String(h).padStart(2, "0")}:00`,
  precipitationProbability: h >= 13 && h < 18 ? 90 : 10,
  precipitationMm: h >= 13 && h < 18 ? 6 : 0,
}));

const input = (over: Partial<MorningInput> = {}): MorningInput => ({
  date: "2026-12-10",
  baseline,
  items: [
    item({ id: "museum", name_zh: "江戶東京博物館", scheduled_start: "10:00", scheduled_end: "11:30" }),
    item({ id: "photo", name_zh: "隅田川攝影", type: "photography", weather_dependency: "high", scheduled_start: "13:00", scheduled_end: "15:00" }),
  ],
  candidates: [
    candidate({ id: "indoor-a", name_zh: "淺草文化觀光中心" }),
    candidate({ id: "indoor-b", name_zh: "淺草演藝廳" }),
    candidate({ id: "indoor-c", name_zh: "第三個室內候選" }),
    candidate({ id: "outdoor", name_zh: "隅田公園", weather_dependency: "high" }),
    candidate({ id: "far", name_zh: "新宿御苑溫室", zone_id: "shinjuku" }),
    candidate({ id: "unverified", name_zh: "未核實", verification_status: "unverified" }),
  ],
  weather: rainyAfternoon,
  warnings: { maxLevel: 0, names: [] },
  transit: [{ route: "銀座線", abnormal: false }],
  firstLegMinutes: 35,
  ...over,
});

describe("morningCheck", () => {
  it("核查十個項目", () => {
    expect(MORNING_CHECKS).toEqual(["weather", "warnings", "transit", "fixed_activities", "reservation", "opening", "first_leg", "luggage", "companions", "backups"]);
    expect(morningCheck(input()).checks.map((c) => c.check)).toEqual([...MORNING_CHECKS]);
  });

  it("E1 前段：午後大雨時戶外攝影標示 At Risk，同區室內候選提升為 Standby（最多 2 個）", () => {
    const result = morningCheck(input());
    expect(result.atRisk).toEqual([{ itemId: "photo", reason: "rain" }]);
    expect(result.standby).toEqual(["indoor-b", "indoor-a"].sort());
    expect(result.checks.find((c) => c.check === "weather")).toEqual({ check: "weather", status: "attention", detail: "13:00–18:00 預報有雨" });
  });

  it("室內項目與上午的行程不受影響；已標示 At Risk 的不重複標示", () => {
    const result = morningCheck(input({ items: [item({ id: "photo", weather_dependency: "high", scheduled_start: "13:00", scheduled_end: "15:00", at_risk: true })] }));
    expect(result.atRisk).toEqual([]);
    const sunny = morningCheck(input({ weather: rainyAfternoon.map((h) => ({ ...h, precipitationMm: 0, precipitationProbability: 0 })) }));
    expect(sunny.atRisk).toEqual([]);
    expect(sunny.standby).toEqual([]);
    expect(sunny.checks.find((c) => c.check === "weather")?.status).toBe("ok");
  });

  it("沒有天氣、警報或交通資料時標示無資料，不當作通過", () => {
    const result = morningCheck(input({ weather: null, warnings: null, transit: null, firstLegMinutes: null }));
    const status = Object.fromEntries(result.checks.map((c) => [c.check, c.status]));
    expect([status.weather, status.warnings, status.transit, status.first_leg]).toEqual(["no_data", "no_data", "no_data", "no_data"]);
    expect(result.atRisk).toEqual([]);
  });

  it("氣象警報（等級 30 以上）時戶外項目標示 At Risk；注意報只提醒", () => {
    const dry = rainyAfternoon.map((h) => ({ ...h, precipitationMm: 0, precipitationProbability: 0 }));
    expect(morningCheck(input({ weather: dry, warnings: { maxLevel: 30, names: ["大雨警報"] } })).atRisk).toEqual([{ itemId: "photo", reason: "warning" }]);
    const advisory = morningCheck(input({ weather: dry, warnings: { maxLevel: 20, names: ["強風注意報"] } }));
    expect(advisory.atRisk).toEqual([]);
    expect(advisory.checks.find((c) => c.check === "warnings")).toEqual({ check: "warnings", status: "attention", detail: "強風注意報" });
  });

  it("當天休館或不在營業時間內的項目標示 At Risk（不提升 Standby）", () => {
    // 2026-12-10 是星期四（4）
    const closed = item({ id: "closed", availability: [{ weekday: 5, start: "09:00", end: "17:00" }] });
    const result = morningCheck(input({ items: [closed], weather: null }));
    expect(result.atRisk).toEqual([{ itemId: "closed", reason: "closed" }]);
    expect(result.standby).toEqual([]);
    expect(result.checks.find((c) => c.check === "opening")?.status).toBe("attention");
  });

  it("完全沒有候選時 Backup 標示留意（即使項目沒有分區）", () => {
    const result = morningCheck(input({ items: [item({ id: "a", zone_id: null })], candidates: [] }));
    expect(result.checks.find((c) => c.check === "backups")).toEqual({ check: "backups", status: "attention", detail: "沒有 Backup" });
  });

  it("交通異常、需預約、搬行李、體力備註、固定活動、第一段交通與 Backup 的提醒", () => {
    const moving = { ...baseline, lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-08", check_out: "2026-12-10", check_in_time: "15:00" }], stamina_note: "長輩同行" };
    const result = morningCheck(
      input({
        baseline: moving,
        transit: [{ route: "銀座線", abnormal: true }],
        items: [item({ id: "reserve", reservation_requirement: "required", zone_id: "ueno" })],
        candidates: [candidate({ id: "elsewhere", zone_id: "asakusa" })],
      }),
    );
    const byCheck = Object.fromEntries(result.checks.map((c) => [c.check, c]));
    expect(byCheck.transit).toMatchObject({ status: "attention", detail: "銀座線運行異常" });
    expect(byCheck.reservation).toMatchObject({ status: "attention", detail: "需確認預約：reserve" });
    expect(byCheck.luggage).toMatchObject({ status: "attention" });
    expect(byCheck.companions).toMatchObject({ status: "attention", detail: "長輩同行" });
    expect(byCheck.fixed_activities).toMatchObject({ status: "ok", detail: "19:00 晚餐（已付款）" });
    expect(byCheck.first_leg).toMatchObject({ status: "ok", detail: "第一站 10:00，約需 35 分鐘，09:25 前出發" });
    expect(byCheck.backups).toMatchObject({ status: "attention", detail: "沒有 Backup 的區域：ueno" });
  });
});
