import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { BaselineStoreError, confirmBaselineAction, saveBaselineAction, type BaselineDeps } from "./baseline-core";

// T23：旅行基線的 Server Action 邏輯（C-11、第 6 節權限表）

const TRIP = "b2000000-0000-4000-8000-000000000001";

const valid: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-05",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-05", check_in_time: "15:00" }],
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
const e5: TripBaselineData = {
  ...valid,
  fixed_activities: [{ name: "淺草和服體驗", area: "淺草", date: "2026-12-01", start: "15:30", end: null, paid: true }],
};

function deps(overrides: Partial<BaselineDeps> = {}, stored: { data: unknown; confirmedAt: string | null } | null = null) {
  const calls = { saved: [] as unknown[], confirmed: [] as string[], logs: [] as string[] };
  const d: BaselineDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => true,
    store: {
      save: async (tripId, data) => void calls.saved.push({ tripId, data }),
      load: async () => stored,
      confirm: async (tripId) => void calls.confirmed.push(tripId),
    },
    logError: (message) => void calls.logs.push(message),
    ...overrides,
  };
  return { d, calls };
}

describe("儲存基線草稿", () => {
  it("需要登入、遵守速率限制、行程編號格式正確", async () => {
    expect(await saveBaselineAction(deps({ getUser: async () => null }).d, TRIP, JSON.stringify(valid))).toMatchObject({ ok: false, message: "需要登入" });
    expect(await saveBaselineAction(deps({ checkRateLimit: async () => false }).d, TRIP, JSON.stringify(valid))).toMatchObject({
      ok: false,
      message: "操作過於頻繁，請稍後再試",
    });
    expect(await saveBaselineAction(deps().d, "../x", JSON.stringify(valid))).toMatchObject({ ok: false, message: "行程不正確" });
  });

  it("格式不正確時不儲存，指出欄位", async () => {
    const { d, calls } = deps();
    expect(await saveBaselineAction(d, TRIP, "{not json")).toMatchObject({ ok: false, message: "基線資料格式不正確" });
    const result = await saveBaselineAction(d, TRIP, JSON.stringify({ ...valid, end_date: "2026-11-01" }));
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("結束日期不可早於開始日期");
    const extra = await saveBaselineAction(d, TRIP, JSON.stringify({ ...valid, owner_id: "x" }));
    expect(extra.ok).toBe(false);
    expect(calls.saved).toEqual([]);
  });

  it("儲存後回傳限制分類與矛盾；有矛盾的草稿仍可儲存", async () => {
    const { d, calls } = deps();
    const result = await saveBaselineAction(d, TRIP, JSON.stringify(e5));
    expect(result.ok).toBe(true);
    expect(result.message).toBe("已儲存基線草稿，有 1 個矛盾需要處理");
    expect(result.issues?.map((i) => i.code)).toEqual(["check_in_too_close"]);
    expect(calls.saved).toEqual([{ tripId: TRIP, data: e5 }]);
  });

  it("沒有權限或已確認時回報原因", async () => {
    const forbidden = deps({ store: { save: async () => Promise.reject(new BaselineStoreError("forbidden")), load: async () => null, confirm: async () => undefined } });
    expect(await saveBaselineAction(forbidden.d, TRIP, JSON.stringify(valid))).toMatchObject({ ok: false, message: "沒有編輯基線的權限" });
    const state = deps({ store: { save: async () => Promise.reject(new BaselineStoreError("state")), load: async () => null, confirm: async () => undefined } });
    expect(await saveBaselineAction(state.d, TRIP, JSON.stringify(valid))).toMatchObject({ ok: false, message: "基線已確認，之後的修改請提出變更提案" });
  });

  it("其他錯誤記錄 log，回應不含資料內容", async () => {
    const { d, calls } = deps({ store: { save: async () => Promise.reject(new Error("db down: 新宿飯店")), load: async () => null, confirm: async () => undefined } });
    const result = await saveBaselineAction(d, TRIP, JSON.stringify(valid));
    expect(result).toEqual({ ok: false, message: "儲存失敗，請稍後再試" });
    expect(calls.logs).toEqual(["儲存基線失敗"]);
  });
});

describe("確認 Trip Baseline v1", () => {
  it("沒有矛盾時確認", async () => {
    const { d, calls } = deps({}, { data: valid, confirmedAt: null });
    expect(await confirmBaselineAction(d, TRIP)).toMatchObject({ ok: true, message: "已確認 Trip Baseline v1，行程進入規劃中" });
    expect(calls.confirmed).toEqual([TRIP]);
  });

  it("E5：有矛盾時不確認並列出矛盾", async () => {
    const { d, calls } = deps({}, { data: e5, confirmedAt: null });
    const result = await confirmBaselineAction(d, TRIP);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("有 1 個矛盾，處理後才能確認");
    expect(result.issues?.[0]?.code).toBe("check_in_too_close");
    expect(calls.confirmed).toEqual([]);
  });

  it("只有提醒時可以確認", async () => {
    const warning = { ...valid, lodgings: [] };
    const { d, calls } = deps({}, { data: warning, confirmedAt: null });
    expect((await confirmBaselineAction(d, TRIP)).ok).toBe(true);
    expect(calls.confirmed).toEqual([TRIP]);
  });

  it("沒有草稿、已確認或儲存的資料格式不合時不確認", async () => {
    expect(await confirmBaselineAction(deps({}, null).d, TRIP)).toMatchObject({ ok: false, message: "請先儲存基線" });
    expect(await confirmBaselineAction(deps({}, { data: valid, confirmedAt: "2026-11-24T00:00:00Z" }).d, TRIP)).toMatchObject({
      ok: false,
      message: "Trip Baseline v1 已確認",
    });
    const broken = deps({}, { data: { start_date: "x" }, confirmedAt: null });
    expect(await confirmBaselineAction(broken.d, TRIP)).toMatchObject({ ok: false, message: "基線資料格式不正確，請重新儲存" });
    expect(broken.calls.confirmed).toEqual([]);
  });

  it("需要登入與速率限制", async () => {
    expect(await confirmBaselineAction(deps({ getUser: async () => null }).d, TRIP)).toMatchObject({ ok: false, message: "需要登入" });
    expect((await confirmBaselineAction(deps({ checkRateLimit: async () => false }, { data: valid, confirmedAt: null }).d, TRIP)).ok).toBe(false);
  });
});
