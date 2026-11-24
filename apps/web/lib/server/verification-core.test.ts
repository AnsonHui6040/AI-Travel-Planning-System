import { roleSpec } from "@atps/ai";
import { defaultRoleSetting, type ProviderAdapter, type ProviderRequest } from "@atps/core";
import { describe, expect, it } from "vitest";
import {
  dedupeCandidates,
  runVerificationChunk,
  type CandidateForCheck,
  type DedupeDeps,
  type VerificationDeps,
  type VerificationWrite,
} from "./verification-core";

// T25：合併、去重、交叉核查的伺服器邏輯

const JOB = "d3000000-0000-4000-8000-000000000001";
const A = "d4000000-0000-4000-8000-000000000001";
const B = "d4000000-0000-4000-8000-000000000002";
const C = "d4000000-0000-4000-8000-000000000003";
const claude = { provider: "anthropic" as const, model: "claude-opus-5-5" };
const src = (url: string, grade: "facility_official" | "reliable_third_party") => ({ url, fetched_at: "2026-11-23T10:00:00+09:00", grade });

const candidate = (over: Partial<CandidateForCheck> & { id: string }): CandidateForCheck => ({
  name_zh: "淺草寺",
  name_local: "浅草寺",
  area: "淺草",
  type: "attraction",
  place_id: null,
  coord_lat: null,
  coord_lng: null,
  created_at: "2026-11-24T01:00:00Z",
  recommendation_reason: "早上人少",
  constraint_note: null,
  sources: [src("https://blog.example/senso", "reliable_third_party")],
  generated_by: claude,
  fact_claims: [
    { field: "opening_hours", value: "10:00–18:00", source: src("https://blog.example/senso", "reliable_third_party"), by: claude },
  ],
  ...over,
});

describe("dedupeCandidates", () => {
  it("找出重複並逐組合併，回傳合併筆數", async () => {
    const merges: Array<[string, string[]]> = [];
    const deps: DedupeDeps = {
      listCandidates: async () => [candidate({ id: A }), candidate({ id: B, created_at: "2026-11-24T02:00:00Z" }), candidate({ id: C, name_zh: "雷門", name_local: "雷門" })],
      merge: async (_job, keep, drop) => {
        merges.push([keep, drop]);
        return drop.length;
      },
    };
    expect(await dedupeCandidates(deps, JOB)).toBe(1);
    expect(merges).toEqual([[A, [B]]]);
  });
});

function verificationDeps(output: unknown, over: Partial<VerificationDeps> = {}) {
  const requests: ProviderRequest[] = [];
  const writes: VerificationWrite[] = [];
  const adapter: ProviderAdapter = {
    id: "google",
    authMethods: ["api_key"],
    builtInSearch: true,
    generate: async (request) => {
      requests.push(request);
      return { output, usage: { inputTokens: 10, outputTokens: 10 }, citations: [] };
    },
    classifyError: () => "unknown",
  };
  const deps: VerificationDeps = {
    adapterFor: () => adapter,
    credentialFor: async () => ({ kind: "api_key", secret: "test-only-key-0002" }),
    recordUsage: async () => undefined,
    loadContext: async () => ({
      tripId: "d2000000-0000-4000-8000-000000000001",
      initiatorId: "00000000-0000-4000-8000-0000000000d1",
      setting: { ...defaultRoleSetting("verification"), chain: [{ provider: "google", model: "gemini-model" }] },
      forbiddenValues: ["test-only-key-0002"],
    }),
    loadCandidates: async (_job, ids) => [candidate({ id: A }), candidate({ id: B, name_zh: "雷門" })].filter((c) => ids.includes(c.id)),
    applyVerification: async (_job, write) => {
      writes.push(write);
    },
    ...over,
  };
  return { deps, requests, writes };
}

const official = src("https://www.senso-ji.jp/", "facility_official");

describe("runVerificationChunk", () => {
  it("E4：依證據順序採用官方營業時間，寫入 Verified 與事實", async () => {
    const output = {
      results: [
        {
          item_id: A,
          status: "verified",
          findings: "官網營業時間 09:00–17:00",
          sources: [official],
          facts: [{ field: "opening_hours", value: "09:00–17:00", source: official }],
        },
      ],
    };
    const { deps, requests, writes } = verificationDeps(output);
    const result = await runVerificationChunk(deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") });
    expect(result).toEqual({ status: "stored", kind: "verification", count: 1 });
    expect(writes).toEqual([
      {
        itemId: A,
        status: "verified",
        facts: [{ field: "opening_hours", status: "resolved", value: "09:00–17:00", grade: "facility_official" }],
        claims: [{ field: "opening_hours", value: "09:00–17:00", source: official, by: { provider: "google", model: "gemini-model" } }],
        sources: [official],
        verifiedBy: { provider: "google", model: "gemini-model" },
      },
    ]);
    // 候選資料以資料區塊傳入（S-03），含 Research 的主張與來源
    expect(requests[0]?.input).toContain("[資料開始");
    expect(requests[0]?.input).toContain("10:00–18:00");
    expect(requests[0]?.input).toContain(A);
  });

  it("E4：同等級來源不一致時寫入 Conflict", async () => {
    const third = src("https://guide.example/senso", "reliable_third_party");
    const output = {
      results: [{ item_id: A, status: "verified", findings: "兩個來源不同", sources: [third], facts: [{ field: "opening_hours", value: "11:00–19:00", source: third }] }],
    };
    const { deps, writes } = verificationDeps(output);
    await runVerificationChunk(deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") });
    expect(writes[0]?.status).toBe("conflict");
  });

  it("核實結果指向本批以外的項目時整份拒絕", async () => {
    const output = { results: [{ item_id: C, status: "verified", findings: "x", sources: [official], facts: [] }] };
    const { deps, writes } = verificationDeps(output);
    expect(await runVerificationChunk(deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") })).toMatchObject({
      status: "rejected",
      reason: "unknown_item",
    });
    expect(writes).toEqual([]);
  });

  it("含圖片網址的核實結果被拒", async () => {
    const output = { results: [{ item_id: A, status: "verified", findings: "見 https://x.example/a.png", sources: [official], facts: [] }] };
    const { deps, writes } = verificationDeps(output);
    expect(await runVerificationChunk(deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") })).toMatchObject({ reason: "image_url" });
    expect(writes).toEqual([]);
  });

  it("job 不存在或已沒有權限時不呼叫 AI", async () => {
    const { deps, requests } = verificationDeps({ results: [] }, { loadContext: async () => null });
    expect(await runVerificationChunk(deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") })).toMatchObject({ status: "rejected" });
    expect(requests).toEqual([]);
  });

  it("沒有候選時不呼叫 AI", async () => {
    const { deps, requests } = verificationDeps({ results: [] }, { loadCandidates: async () => [] });
    expect(await runVerificationChunk(deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") })).toEqual({
      status: "stored",
      kind: "verification",
      count: 0,
    });
    expect(requests).toEqual([]);
  });
});
