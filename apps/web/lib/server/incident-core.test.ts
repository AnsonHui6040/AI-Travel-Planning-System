import { describe, expect, it, vi } from "vitest";
import type { IncidentItem } from "@atps/core";
import { IncidentStoreError, startIncidentAction, type IncidentContext, type IncidentDeps } from "./incident-core";

// T38：進入 Incident Mode。伺服器重新計算方案，只建立待批准提案（批准前不改動行程）

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const PHOTO = "9a000000-0000-4000-8000-000000000001";
const MUSEUM = "9a000000-0000-4000-8000-000000000002";
const DINNER = "9a000000-0000-4000-8000-000000000003";

const item = (over: Partial<IncidentItem> & Pick<IncidentItem, "id" | "name_zh">): IncidentItem => ({
  type: "attraction",
  zone_id: "z1",
  scheduled_date: null,
  scheduled_start: null,
  scheduled_end: null,
  hard: false,
  priority: 3,
  weather_dependency: "low",
  suggested_stay_minutes: 60,
  availability: [],
  verification_status: "verified",
  standby: true,
  cost: null,
  order: 0,
  ...over,
});

const context = (over: Partial<IncidentContext> = {}): IncidentContext => ({
  canEdit: true,
  tripStatus: "in_progress",
  timezone: "Asia/Tokyo",
  baseline: {
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
  },
  items: [
    item({ id: PHOTO, name_zh: "隅田川攝影", scheduled_date: "2026-12-10", scheduled_start: "13:00", scheduled_end: "15:00", weather_dependency: "high", standby: false }),
    item({ id: DINNER, name_zh: "晚餐（已付款）", scheduled_date: "2026-12-10", scheduled_start: "19:00", scheduled_end: "21:00", hard: true, standby: false }),
    item({ id: MUSEUM, name_zh: "室內博物館", order: 1 }),
  ],
  segments: new Map(),
  weather: "13:00–18:00 預報有雨",
  ...over,
});

function deps(over: Partial<IncidentDeps> = {}) {
  const start = vi.fn<IncidentDeps["start"]>(async () => ({ incidentId: "inc-1" }));
  const d: IncidentDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => true,
    loadContext: async () => context(),
    start,
    now: () => new Date("2026-12-10T13:00:00+09:00"),
    logError: vi.fn(),
    ...over,
  };
  return { d, start };
}

const rain = { tripId: TRIP, date: "2026-12-10", trigger: "heavy_rain", rainUntil: "18:00", companions: "ok", luggage: "light", lat: "35.7147", lng: "139.7966" };

describe("startIncidentAction", () => {
  it("以伺服器資料計算方案，建立即時分支（待批准提案）", async () => {
    const { d, start } = deps();
    const result = await startIncidentAction(d, rain);
    expect(result).toEqual({ ok: true, message: "已建立 2 個替代方案，批准前行程不會改動", incidentId: "inc-1" });
    const [tripId, level, snapshot, available, alternatives] = start.mock.calls[0] ?? [];
    expect(tripId).toBe(TRIP);
    expect(level).toBe("L3");
    expect(snapshot).toMatchObject({
      trigger: { type: "heavy_rain", until: "18:00" },
      snapshot: { location: { lat: 35.715, lng: 139.797 }, weather: "13:00–18:00 預報有雨", nextFixed: { name: "晚餐（已付款）", start: "19:00" } },
    });
    expect(available).toBe(345);
    expect(alternatives?.map((a) => a.tier)).toEqual(["same_zone", "drop"]);
    expect(alternatives?.every((a) => a.change.changeKind === "incident_L3")).toBe(true);
  });

  it("需要登入、速率限制、Owner 或 Companion、已鎖定的行程", async () => {
    expect((await startIncidentAction(deps({ getUser: async () => null }).d, rain)).message).toBe("需要登入");
    expect((await startIncidentAction(deps({ checkRateLimit: async () => false }).d, rain)).message).toBe("操作過於頻繁，請稍後再試");
    expect((await startIncidentAction(deps({ loadContext: async () => context({ canEdit: false }) }).d, rain)).message).toBe(
      "只有 Owner 與 Companion 可以進入 Incident Mode",
    );
    expect((await startIncidentAction(deps({ loadContext: async () => context({ tripStatus: "planning" }) }).d, rain)).message).toBe("行程尚未鎖定");
    expect((await startIncidentAction(deps({ loadContext: async () => null }).d, rain)).message).toBe("找不到這個行程");
  });

  it("拒絕不正確的輸入與多餘欄位", async () => {
    const { d, start } = deps();
    expect((await startIncidentAction(d, { ...rain, tripId: "x" })).ok).toBe(false);
    expect((await startIncidentAction(d, { ...rain, lat: "200" })).ok).toBe(false);
    expect((await startIncidentAction(d, { ...rain, baseVersion: "1" })).ok).toBe(false);
    expect((await startIncidentAction(d, { ...rain, date: "2026-12-20" })).message).toBe("日期不在行程內");
    expect((await startIncidentAction(d, { ...rain, trigger: "attraction_closed" })).message).toBe("請選擇受影響的項目");
    expect((await startIncidentAction(d, { ...rain, trigger: "attraction_closed", itemId: DINNER })).message).toBe(
      "受影響的項目不在當天行程中，或是 Hard Constraint",
    );
    expect((await startIncidentAction(d, { ...rain, trigger: "delay" })).message).toBe("請輸入延誤分鐘數");
    expect(start).not.toHaveBeenCalled();
  });

  it("沒有需要調整的項目時不建立", async () => {
    const { d, start } = deps({ now: () => new Date("2026-12-10T22:00:00+09:00") });
    expect((await startIncidentAction(d, rain)).ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("資料庫拒絕時顯示原因，不洩漏細節", async () => {
    const forbidden = deps({ start: async () => Promise.reject(new IncidentStoreError("forbidden")) });
    expect((await startIncidentAction(forbidden.d, rain)).message).toBe("只有 Owner 與 Companion 可以進入 Incident Mode");
    const unknown = deps({ start: async () => Promise.reject(new Error("db down: secret")) });
    expect(await startIncidentAction(unknown.d, rain)).toEqual({ ok: false, message: "進入 Incident Mode 失敗，請稍後再試" });
    expect(unknown.d.logError).toHaveBeenCalledWith("Incident Mode 寫入失敗");
  });
});
