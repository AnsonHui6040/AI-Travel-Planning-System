import { describe, expect, it } from "vitest";
import type { TripBaselineData } from "@atps/schemas";
import { parseLegForm, parseSettingsForm, submitLeg, submitSettings, type SettingsContext, type SettingsDeps } from "./trip-edit-core";

// 決策 0011：行程設定（只限 Owner）與兩站之間的交通
const TRIP = "f2000000-0000-4000-8000-000000000001";
const A = "f4000000-0000-4000-8000-000000000001";
const B = "f4000000-0000-4000-8000-000000000002";

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-03",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [{ name: "淺草旅館", area: null, check_in: "2026-12-01", check_out: "2026-12-03", check_in_time: null }],
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

function deps(ctx: Partial<SettingsContext> = {}) {
  const saved: unknown[] = [];
  const d: SettingsDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => true,
    load: async () => ({ isOwner: true, tripStatus: "locked", baseline, scheduled: [{ itemId: A, date: "2026-12-03" }], ...ctx }),
    save: async (_trip, input) => {
      saved.push(input);
      return { movedToCandidates: 1 };
    },
    logError: () => {},
  };
  return { d, saved };
}

const input = { name: "東京三日", destination: "東京", start: "2026-12-01", end: "2026-12-03" };

describe("行程設定", () => {
  it("只改名稱與目的地：不帶日期", async () => {
    const { d, saved } = deps();
    expect(await submitSettings(d, TRIP, input, false)).toMatchObject({ ok: true });
    expect(saved).toEqual([{ ...input, start: null, end: null }]);
  });

  it("只限 Owner", async () => {
    expect(await submitSettings(deps({ isOwner: false }).d, TRIP, input, false)).toEqual({ ok: false, message: "只有 Owner 可以修改行程設定" });
  });

  it("延長日期：同步基線", async () => {
    const { d, saved } = deps();
    await submitSettings(d, TRIP, { ...input, end: "2026-12-04" }, false);
    expect(saved).toEqual([{ ...input, end: "2026-12-04" }]);
  });

  it("移除日期要先確認；確認後回報移回候選清單的項目數", async () => {
    const { d } = deps({ baseline: { ...baseline, lodgings: [] } });
    expect(await submitSettings(d, TRIP, { ...input, end: "2026-12-02" }, false)).toEqual({ ok: false, message: "移除日期需要確認" });
    expect(await submitSettings(d, TRIP, { ...input, end: "2026-12-02" }, true)).toEqual({ ok: true, message: "已儲存，1 個項目移回候選清單" });
  });

  it("新日期讓基線產生矛盾（住宿超出日期）時不送出", async () => {
    const { d, saved } = deps();
    const result = await submitSettings(d, TRIP, { ...input, end: "2026-12-02" }, true);
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("請先修改旅行基線");
    expect(saved).toEqual([]);
  });

  it("表單：名稱必填、日期一起填寫", () => {
    const form = new FormData();
    form.set("name", "");
    expect(parseSettingsForm(form)).toMatchObject({ ok: false });
    form.set("name", "東京");
    form.set("start", "2026-12-01");
    expect(parseSettingsForm(form)).toEqual({ ok: false, message: "開始與結束日期要一起填寫" });
    form.set("end", "2026-11-30");
    expect(parseSettingsForm(form)).toEqual({ ok: false, message: "結束日期不可早於開始日期" });
    form.set("end", "2026-12-02");
    expect(parseSettingsForm(form)).toEqual({ ok: true, input: { name: "東京", destination: null, start: "2026-12-01", end: "2026-12-02" } });
  });
});

describe("兩站之間的交通", () => {
  it("表單：交通方式五種，分鐘 0 到 600", () => {
    const form = new FormData();
    form.set("from", A);
    form.set("to", B);
    form.set("mode", "plane");
    form.set("minutes", "15");
    expect(parseLegForm(form)).toEqual({ ok: false, message: "請選擇交通方式" });
    form.set("mode", "train");
    expect(parseLegForm(form)).toEqual({ ok: true, input: { from: A, to: B, mode: "train", minutes: 15 } });
    form.set("minutes", "601");
    expect(parseLegForm(form)).toMatchObject({ ok: false });
  });

  it("Viewer 不可設定", async () => {
    const saved: unknown[] = [];
    const d = {
      getUser: async () => ({ id: "u1" }),
      checkRateLimit: async () => true,
      canEdit: async () => false,
      save: async (_t: string, i: unknown) => void saved.push(i),
      logError: () => {},
    };
    expect(await submitLeg(d, TRIP, { from: A, to: B, mode: "walk", minutes: 5 })).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
  });
});
