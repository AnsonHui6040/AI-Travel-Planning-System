import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { MorningCheckStoreError, runMorningCheckAction, type MorningCheckDeps } from "./morning-check-core";

// T36：Morning Check 的 Server Action。觀測資料取得失敗時該項為「無資料」，不中斷；寫入經 complete_morning_check

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const baseline: TripBaselineData = {
  start_date: "2026-12-08",
  end_date: "2026-12-12",
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

const rainy = Array.from({ length: 24 }, (_, h) => ({
  time: `2026-12-10T${String(h).padStart(2, "0")}:00`,
  precipitationProbability: h >= 13 && h < 18 ? 90 : 0,
  precipitationMm: h >= 13 && h < 18 ? 5 : 0,
}));

async function context() {
  const ctx = await deps().d.loadContext(TRIP, "2026-12-10");
  if (!ctx) throw new Error("沒有測試資料");
  return ctx;
}

function deps(over: Partial<MorningCheckDeps> = {}) {
  const writes: unknown[][] = [];
  const logs: string[] = [];
  const d: MorningCheckDeps = {
    getUser: async () => ({ id: "me" }),
    checkRateLimit: async () => true,
    loadContext: async () => ({
      canEdit: true,
      dayStatus: "approved",
      timezone: "Asia/Tokyo",
      baseline,
      coords: { lat: 35.71, lng: 139.79 },
      firstLegMinutes: null,
      items: [
        {
          id: "photo",
          name_zh: "隅田川攝影",
          type: "photography",
          zone_id: "asakusa",
          weather_dependency: "high",
          scheduled_start: "13:00",
          scheduled_end: "15:00",
          reservation_requirement: "none",
          availability: [],
          at_risk: false,
        },
      ],
      candidates: [{ id: "indoor", name_zh: "淺草文化觀光中心", zone_id: "asakusa", weather_dependency: "low", verification_status: "verified", standby: false }],
    }),
    fetchWeather: async () => rainy,
    complete: async (...args) => {
      writes.push(args);
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, writes, logs };
}

describe("runMorningCheckAction", () => {
  it("計算後寫入 At Risk、Standby 與結果，該日進入 Day Ready", async () => {
    const { d, writes } = deps();
    const result = await runMorningCheckAction(d, TRIP, "2026-12-10");
    expect(result.message).toBe("Morning Check 完成，已標示 Day Ready。1 個項目標示 At Risk，1 個候選提升為 Standby");
    expect(writes).toHaveLength(1);
    const [tripId, date, saved, atRisk, standby] = writes[0] as [string, string, { checks: Array<{ check: string; status: string }> }, string[], string[]];
    expect([tripId, date, atRisk, standby]).toEqual([TRIP, "2026-12-10", ["photo"], ["indoor"]]);
    expect(saved.checks.find((c) => c.check === "weather")?.status).toBe("attention");
  });

  it("天氣取得失敗或沒有座標時標示無資料，仍完成", async () => {
    const failed = deps({
      fetchWeather: async () => {
        throw new Error("network");
      },
    });
    const result = await runMorningCheckAction(failed.d, TRIP, "2026-12-10");
    expect(result.ok).toBe(true);
    const saved = (failed.writes[0] as [string, string, { checks: Array<{ check: string; status: string }> }])[2];
    expect(saved.checks.find((c) => c.check === "weather")?.status).toBe("no_data");
    expect(failed.logs).toEqual(["Morning Check 天氣資料取得失敗"]);
  });

  it("Viewer、未批准的日期、找不到行程時不寫入", async () => {
    const viewer = deps({ loadContext: async () => ({ ...(await context()), canEdit: false }) });
    expect((await runMorningCheckAction(viewer.d, TRIP, "2026-12-10")).message).toBe("只有 Owner 與 Companion 可以執行 Morning Check");
    const draft = deps({ loadContext: async () => ({ ...(await context()), dayStatus: "draft" }) });
    expect((await runMorningCheckAction(draft.d, TRIP, "2026-12-10")).message).toBe("這天尚未批准，請先批准每日行程");
    expect((await runMorningCheckAction(deps({ loadContext: async () => null }).d, TRIP, "2026-12-10")).message).toBe("找不到這個行程");
    expect(viewer.writes).toEqual([]);
  });

  it("未登入、速率限制、參數不正確時不讀取；寫入失敗只記錄", async () => {
    expect((await runMorningCheckAction(deps({ getUser: async () => null }).d, TRIP, "2026-12-10")).message).toBe("需要登入");
    expect((await runMorningCheckAction(deps({ checkRateLimit: async () => false }).d, TRIP, "2026-12-10")).message).toBe("操作過於頻繁，請稍後再試");
    expect((await runMorningCheckAction(deps().d, "x", "2026-12-10")).message).toBe("參數不正確");
    const broken = deps({
      complete: async () => {
        throw new MorningCheckStoreError("unknown");
      },
    });
    expect((await runMorningCheckAction(broken.d, TRIP, "2026-12-10")).message).toBe("Morning Check 失敗，請稍後再試");
    expect(broken.logs).toEqual(["Morning Check 寫入失敗"]);
  });
});
