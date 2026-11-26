import { mergeMemories } from "@atps/memory";
import { roleSpec } from "@atps/ai";
import { defaultRoleSetting, type ProviderAdapter, type ProviderRequest } from "@atps/core";
import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  runResearchTrack,
  startResearchAction,
  type CandidateInsert,
  type ResearchStartDeps,
  type ResearchTrackDeps,
} from "./research-core";

// T24：多 AI 獨立研究的伺服器邏輯

const TRIP = "c2000000-0000-4000-8000-000000000001";
const JOB = "c3000000-0000-4000-8000-000000000001";
const USER = { id: "00000000-0000-4000-8000-0000000000c1" };

function startDeps(over: Partial<ResearchStartDeps> = {}): ResearchStartDeps {
  return {
    getUser: async () => USER,
    checkRateLimit: async () => true,
    loadTrip: async () => ({ status: "planning", role: "owner" }),
    loadResearchSetting: async () => defaultRoleSetting("research"),
    hasKey: async () => true,
    createJob: async () => JOB,
    startWorkflow: vi.fn(async () => undefined),
    failJob: vi.fn(async () => undefined),
    logError: () => undefined,
    ...over,
  };
}

describe("startResearchAction", () => {
  it("建立 research job，發起人取自 session，啟動 workflow", async () => {
    const deps = startDeps();
    expect(await startResearchAction(deps, TRIP)).toEqual({ ok: true, message: "已開始研究，四個方向平行執行", jobId: JOB });
    expect(deps.startWorkflow).toHaveBeenCalledWith({ jobId: JOB });
  });

  it.each([
    [{ getUser: async () => null }, "需要登入"],
    [{ checkRateLimit: async () => false }, "操作過於頻繁，請稍後再試"],
    [{ loadTrip: async () => null }, "找不到這個行程，或你不是成員。"],
    [{ loadTrip: async () => ({ status: "planning" as const, role: "viewer" as const }) }, "只有 Owner 與 Companion 可以開始研究"],
    [{ loadTrip: async () => ({ status: "baseline" as const, role: "owner" as const }) }, "請先確認 Trip Baseline v1 再開始研究"],
    [{ hasKey: async () => false }, "尚未設定 Claude 的 API key"],
  ])("不符條件時不建立 job：%#", async (over, message) => {
    const deps = startDeps(over as Partial<ResearchStartDeps>);
    const create = vi.fn(async () => JOB);
    deps.createJob = create;
    expect(await startResearchAction(deps, TRIP)).toEqual({ ok: false, message });
    expect(create).not.toHaveBeenCalled();
  });

  it("尚未選擇模型時提示", async () => {
    const setting = { ...defaultRoleSetting("research"), chain: [{ provider: "google" as const, model: null }] };
    const deps = startDeps({ loadResearchSetting: async () => setting });
    expect(await startResearchAction(deps, TRIP)).toEqual({ ok: false, message: "尚未選擇 Gemini 的模型" });
  });

  it("行程編號不正確時拒絕", async () => {
    expect(await startResearchAction(startDeps(), "not-a-uuid")).toEqual({ ok: false, message: "行程不正確" });
  });

  it("workflow 啟動失敗時把 job 標為失敗", async () => {
    const deps = startDeps({ startWorkflow: async () => Promise.reject(new Error("boom")) });
    expect(await startResearchAction(deps, TRIP)).toEqual({ ok: false, message: "無法開始研究，請稍後再試" });
    expect(deps.failJob).toHaveBeenCalledWith(JOB);
  });
});

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-05",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [],
  paid_items: [],
  must_visit: ["淺草寺"],
  excluded: [],
  transport_preferences: [],
  photography_needs: null,
};
const source = { url: "https://www.senso-ji.jp/", fetched_at: "2026-11-23T10:00:00+09:00", grade: "facility_official" };
const candidate = {
  name_zh: "淺草寺",
  name_local: "浅草寺",
  area: "淺草",
  type: "attraction",
  recommendation_reason: "早上人少",
  suggested_stay_minutes: 60,
  constraints: null,
  sources: [source],
  data_date: "2026-11-23",
};

function trackDeps(output: unknown, over: Partial<ResearchTrackDeps> = {}) {
  const requests: ProviderRequest[] = [];
  const stored: CandidateInsert[][] = [];
  const adapter: ProviderAdapter = {
    id: "anthropic",
    authMethods: ["api_key"],
    builtInSearch: true,
    generate: async (request) => {
      requests.push(request);
      return { output, usage: { inputTokens: 10, outputTokens: 10 }, citations: [] };
    },
    classifyError: () => "unknown",
  };
  const deps: ResearchTrackDeps = {
    adapterFor: () => adapter,
    credentialFor: async () => ({ kind: "api_key", secret: "test-only-key-0001" }),
    recordUsage: async () => undefined,
    loadContext: async () => ({
      tripId: TRIP,
      initiatorId: USER.id,
      trip: { name: "東京五日", destination: "東京" },
      baseline,
      setting: defaultRoleSetting("research"),
      forbiddenValues: ["test-only-key-0001"],
    }),
    resolvePlace: async () => ({ status: "resolved", placeId: "ChIJ_senso" }),
    storeCandidates: async (_job, _track, rows) => {
      stored.push(rows);
      return rows.length;
    },
    ...over,
  };
  return { deps, requests, stored };
}

describe("runResearchTrack", () => {
  it("以該方向的工作說明與資料區塊呼叫 Research，候選經 place_id 解析後寫入", async () => {
    const { deps, requests, stored } = trackDeps({ candidates: [candidate] });
    const result = await runResearchTrack(deps, { jobId: JOB, track: "B", role: roleSpec("research") });
    expect(result).toEqual({ status: "stored", kind: "candidates", count: 1 });
    expect(requests[0]?.input).toContain("餐飲");
    expect(requests[0]?.input).toContain("[資料開始");
    expect(stored[0]?.[0]).toMatchObject({ name_zh: "淺草寺", place_id: "ChIJ_senso", verification_status: "unverified" });
    expect(stored[0]?.[0]).toMatchObject({ generated_by: { provider: "anthropic", model: "claude-opus-5-5" } });
  });

  // T41：MEM-07、MEM-08、MEM-11；刪除的記憶不會由讀取端回傳，因此不出現在 payload
  it("成員記憶依角色記憶範圍放入成員偏好資料區塊；刪除後不出現在 payload", async () => {
    const memories = mergeMemories([
      { layer: "personal", kind: "constraint", item: "每日步行上限", value: "12", unit: "公里" },
      { layer: "personal", kind: "constraint", item: "每日步行上限", value: "8", unit: "公里" },
      { layer: "planning_rules", kind: "preference", item: "喜歡的活動類型", value: "古書店巡禮", unit: null },
    ]);
    const base = await trackDeps({ candidates: [] }).deps.loadContext(JOB);
    if (!base) throw new Error("沒有測試資料");
    const withMemory = trackDeps({ candidates: [] }, { loadContext: async () => ({ ...base, memories }) });
    await runResearchTrack(withMemory.deps, { jobId: JOB, track: "A", role: roleSpec("research") });
    const input = withMemory.requests[0]?.input ?? "";
    expect(input).toContain("種類：成員偏好");
    expect(input).toContain("每日步行上限：8 公里（成員間有不同設定，已取最保守值）");
    expect(input).not.toContain("12 公里");
    expect(input).toContain("古書店巡禮");

    // 角色沒有記憶範圍時不放入
    const noScope = trackDeps({ candidates: [] }, { loadContext: async () => ({ ...base, memories }) });
    await runResearchTrack(noScope.deps, { jobId: JOB, track: "A", role: { ...roleSpec("research"), memoryScope: { layers: [], kinds: [] } } });
    expect(noScope.requests[0]?.input).not.toContain("成員偏好");

    // 刪除「古書店巡禮」後重新讀取：payload 不再出現
    const after = trackDeps({ candidates: [] }, { loadContext: async () => ({ ...base, memories: memories.filter((m) => m.value !== "古書店巡禮") }) });
    await runResearchTrack(after.deps, { jobId: JOB, track: "A", role: roleSpec("research") });
    expect(after.requests[0]?.input).not.toContain("古書店巡禮");
  });

  it("含圖片網址的輸出被拒，不寫入", async () => {
    const bad = { candidates: [{ ...candidate, sources: [{ ...source, url: "https://example.com/senso.jpg" }] }] };
    const { deps, stored } = trackDeps(bad);
    expect(await runResearchTrack(deps, { jobId: JOB, track: "A", role: roleSpec("research") })).toMatchObject({
      status: "rejected",
      reason: "image_url",
    });
    expect(stored).toEqual([]);
  });

  it("缺必填欄位（推薦原因）的候選被拒", async () => {
    const missing = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "recommendation_reason"));
    const { deps, stored } = trackDeps({ candidates: [missing] });
    const result = await runResearchTrack(deps, { jobId: JOB, track: "A", role: roleSpec("research") });
    expect(result).toMatchObject({ status: "rejected", reason: "output_invalid" });
    expect(stored).toEqual([]);
  });

  it("沒有 Google Maps key 時候選仍寫入，place_id 為 null、Unverified", async () => {
    const { deps, stored } = trackDeps({ candidates: [candidate] }, { resolvePlace: null });
    await runResearchTrack(deps, { jobId: JOB, track: "D", role: roleSpec("research") });
    expect(stored[0]?.[0]).toMatchObject({ place_id: null, verification_status: "unverified" });
  });

  it("沒有候選時不寫入", async () => {
    const { deps, stored } = trackDeps({ candidates: [] });
    expect(await runResearchTrack(deps, { jobId: JOB, track: "C", role: roleSpec("research") })).toEqual({
      status: "stored",
      kind: "candidates",
      count: 0,
    });
    expect(stored).toEqual([]);
  });

  it("job 不存在或已失去權限時不呼叫 AI", async () => {
    const { deps, requests } = trackDeps({ candidates: [candidate] }, { loadContext: async () => null });
    expect(await runResearchTrack(deps, { jobId: JOB, track: "A", role: roleSpec("research") })).toEqual({
      status: "rejected",
      reason: "schema",
      detail: "研究 job 不存在或已沒有權限",
    });
    expect(requests).toEqual([]);
  });
});
