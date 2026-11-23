import { describe, expect, it } from "vitest";
import { roleOutputs } from "./index";

const source = { url: "https://www.senso-ji.jp/", fetched_at: "2026-11-23T08:00:00+09:00", grade: "facility_official" };

const candidate = {
  name_zh: "淺草寺",
  name_local: "浅草寺",
  area: "淺草",
  type: "attraction",
  recommendation_reason: "早上人少，適合拍照",
  suggested_stay_minutes: 60,
  constraints: "本堂 17:00 關閉",
  sources: [source],
  data_date: "2026-11-23",
};

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("Research 輸出（T24 必填欄位）", () => {
  it("完整候選通過", () => {
    expect(roleOutputs.research.safeParse({ candidates: [candidate] }).error?.issues).toBeUndefined();
  });

  it.each(["name_zh", "area", "type", "recommendation_reason", "suggested_stay_minutes", "constraints", "sources", "data_date"])(
    "缺少 %s 時拒絕",
    (field) => {
      const rest = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== field));
      expect(ok(roleOutputs.research, { candidates: [rest] })).toBe(false);
    },
  );

  it("含圖片網址等未定義欄位時拒絕（S-16）", () => {
    expect(ok(roleOutputs.research, { candidates: [{ ...candidate, image_url: "https://x/a.jpg" }] })).toBe(false);
  });

  it("沒有來源或來源不是 https 時拒絕（S-03）", () => {
    expect(ok(roleOutputs.research, { candidates: [{ ...candidate, sources: [] }] })).toBe(false);
    expect(ok(roleOutputs.research, { candidates: [{ ...candidate, sources: [{ ...source, url: "http://x.jp/" }] }] })).toBe(false);
  });

  it("停留時間超出範圍時拒絕（S-02）", () => {
    expect(ok(roleOutputs.research, { candidates: [{ ...candidate, suggested_stay_minutes: 2 }] })).toBe(false);
  });
});

describe("Verification 輸出", () => {
  const result = {
    item_id: "30000000-0000-4000-8000-000000000001",
    status: "verified",
    findings: "官方網站確認營業時間",
    sources: [source],
  };

  it("有效結果通過", () => {
    expect(roleOutputs.verification.safeParse({ results: [result] }).error?.issues).toBeUndefined();
  });

  it("核實狀態只接受四種", () => {
    expect(ok(roleOutputs.verification, { results: [{ ...result, status: "maybe" }] })).toBe(false);
  });
});

describe("Transport 輸出", () => {
  const estimate = {
    mode: "rail",
    door_to_door_minutes: 25,
    price: { amount: 210, currency: "JPY" },
    walk_minutes: 8,
    transfers: 1,
    luggage_friendliness: "medium",
    comfort: "medium",
    delay_risk: "low",
  };
  const segment = {
    from_item_id: "30000000-0000-4000-8000-000000000001",
    to_item_id: "30000000-0000-4000-8000-000000000002",
    estimates: [estimate],
    sources: [source],
  };

  it("有效估算通過", () => {
    expect(roleOutputs.transport.safeParse({ segments: [segment] }).error?.issues).toBeUndefined();
  });

  it("沒有來源時拒絕", () => {
    expect(ok(roleOutputs.transport, { segments: [{ ...segment, sources: [] }] })).toBe(false);
  });
});

describe("Master Planner 與 Live Planner 輸出（S-01：只輸出變更提案）", () => {
  const proposal = {
    changeKind: "minor_non_incident",
    versionKind: "minor",
    summary: "淺草寺改到早上",
    operations: [
      { op: "schedule_item", itemId: "30000000-0000-4000-8000-000000000001", date: "2026-12-01", start: "08:00", end: "09:00" },
    ],
  };

  it("變更提案通過", () => {
    expect(roleOutputs.master_planner.safeParse({ proposals: [proposal] }).error?.issues).toBeUndefined();
    expect(roleOutputs.live_planner.safeParse({ proposals: [proposal] }).error?.issues).toBeUndefined();
  });

  it("沒有提案或提案過多時拒絕", () => {
    expect(ok(roleOutputs.master_planner, { proposals: [] })).toBe(false);
    expect(ok(roleOutputs.live_planner, { proposals: [proposal, proposal, proposal, proposal] })).toBe(false);
  });
});
