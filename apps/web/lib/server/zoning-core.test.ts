import { zoningSpec } from "@atps/ai";
import { defaultRoleSetting, type ProviderAdapter, type ProviderRequest } from "@atps/core";
import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { runZoning, type ZoningDeps, type ZoningWrite } from "./zoning-core";

// T27：地理分區的伺服器邏輯

const JOB = "f3000000-0000-4000-8000-000000000001";
const A = "f4000000-0000-4000-8000-000000000001";
const B = "f4000000-0000-4000-8000-000000000002";

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-05",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-05", check_in_time: null }],
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

const candidate = (id: string, name: string) => ({
  id,
  name_zh: name,
  name_local: null,
  area: "淺草",
  type: "attraction" as const,
  suggested_stay_minutes: 60,
  candidate_role: "primary" as const,
  place_id: "ChIJ_should_not_be_sent",
  coord_lat: 35.71,
  coord_lng: 139.79,
  total: name === "雷門" ? 20 : 30,
});

const src = { url: "https://railway.example.jp/", fetched_at: "2026-11-24T10:00:00+09:00", grade: "official_transport_tourism" };
const output = {
  zones: [
    {
      name: "淺草",
      base_area: null,
      rationale: "同一條路線",
      items: [
        { item_id: A, transfers_from_base: 1, minutes_from_base: 30 },
        { item_id: B, transfers_from_base: 1, minutes_from_base: 32 },
      ],
      sources: [src],
    },
  ],
};

function deps(result: unknown, over: Partial<ZoningDeps> = {}) {
  const requests: ProviderRequest[] = [];
  const writes: ZoningWrite[] = [];
  const adapter: ProviderAdapter = {
    id: "anthropic",
    authMethods: ["api_key"],
    builtInSearch: true,
    generate: async (request) => {
      requests.push(request);
      return { output: result, usage: { inputTokens: 10, outputTokens: 10 }, citations: [] };
    },
    classifyError: () => "unknown",
  };
  const d: ZoningDeps = {
    adapterFor: () => adapter,
    credentialFor: async () => ({ kind: "api_key", secret: "test-only-key-0004" }),
    recordUsage: async () => undefined,
    loadContext: async () => ({
      tripId: "f2000000-0000-4000-8000-000000000001",
      initiatorId: "00000000-0000-4000-8000-0000000000f1",
      trip: { name: "東京五日", destination: "東京" },
      baseline,
      setting: defaultRoleSetting("transport"),
      forbiddenValues: ["test-only-key-0004"],
      candidates: [candidate(A, "淺草寺"), candidate(B, "雷門")],
    }),
    applyZoning: async (_job, write) => {
      writes.push(write);
      return write.zones.length;
    },
    ...over,
  };
  return { deps: d, requests, writes };
}

describe("runZoning", () => {
  it("送出的輸入不含 Google Maps 內容（D29）；分區寫入並為主要區域補上 Backup", async () => {
    const { deps: d, requests, writes } = deps(output);
    expect(await runZoning(d, { jobId: JOB, spec: zoningSpec() })).toEqual({ status: "stored", zones: 1, backups: 1 });
    expect(requests[0]?.input).not.toContain("ChIJ_should_not_be_sent");
    expect(requests[0]?.input).not.toContain("139.79");
    expect(requests[0]?.input).toContain("[資料開始");
    expect(writes[0]?.zones).toEqual(output.zones);
    expect(writes[0]?.roles).toEqual([{ item_id: B, candidate_role: "backup" }]);
  });

  it("輸出不符 schema 時不寫入", async () => {
    const { deps: d, writes } = deps({ zones: [{ name: "x" }] });
    const result = await runZoning(d, { jobId: JOB, spec: zoningSpec() });
    expect(result).toMatchObject({ status: "rejected" });
    expect(writes).toEqual([]);
  });

  it("候選少於 2 個或 job 已失效時不呼叫 AI", async () => {
    const few = deps(output, {
      loadContext: async () => ({
        tripId: "t",
        initiatorId: "u",
        trip: { name: "x", destination: null },
        baseline,
        setting: defaultRoleSetting("transport"),
        forbiddenValues: [],
        candidates: [candidate(A, "淺草寺")],
      }),
    });
    expect(await runZoning(few.deps, { jobId: JOB, spec: zoningSpec() })).toEqual({ status: "skipped", reason: "候選少於 2 個" });
    expect(few.requests).toEqual([]);
    const gone = deps(output, { loadContext: async () => null });
    expect(await runZoning(gone.deps, { jobId: JOB, spec: zoningSpec() })).toEqual({ status: "skipped", reason: "研究 job 不存在或已沒有權限" });
  });
});
