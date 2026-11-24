import { roleSpec } from "@atps/ai";
import { defaultRoleSetting, type ProviderAdapter } from "@atps/core";
import type { ChangePayload } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { authorizeCron, runReverifyChunk, runReverifyCron, type ReverifyChunkDeps, type ReverifyCronDeps } from "./reverify-core";
import type { CandidateForCheck } from "./verification-core";

// T31：旅前自動再核實。排程端點以 CRON_SECRET 驗證；以目的地時區判斷 T-7、T-1；Owner 未開啟排程時不執行

const TRIP = "e2000000-0000-4000-8000-000000000001";
const JOB = "e3000000-0000-4000-8000-000000000001";
const A = "e4000000-0000-4000-8000-000000000001";
const B = "e4000000-0000-4000-8000-000000000002";

describe("authorizeCron", () => {
  it("只接受與 CRON_SECRET 相同的 Bearer token", () => {
    const secret = "test-only-cron-secret-123456";
    expect(authorizeCron(`Bearer ${secret}`, secret)).toBe(true);
    expect(authorizeCron(`Bearer ${secret}x`, secret)).toBe(false);
    expect(authorizeCron(null, secret)).toBe(false);
    // 未設定或太短的 secret 一律拒絕
    expect(authorizeCron("Bearer ", "")).toBe(false);
    expect(authorizeCron("Bearer short", "short")).toBe(false);
    expect(authorizeCron(`Bearer ${secret}`, undefined)).toBe(false);
  });
});

function cronDeps(trips: Awaited<ReturnType<ReverifyCronDeps["listTrips"]>>, startResult: string | null = JOB) {
  const started: Array<[string, string]> = [];
  const launched: string[] = [];
  const deps: ReverifyCronDeps = {
    listTrips: async () => trips,
    start: async (tripId, kind) => {
      started.push([tripId, kind]);
      return startResult;
    },
    launch: async (jobId) => {
      launched.push(jobId);
    },
  };
  return { deps, started, launched };
}

const trip = { id: TRIP, start_date: "2026-12-10", timezone: "Asia/Tokyo", status: "locked" as const, reverify_enabled: true, ran: [] };

describe("runReverifyCron（時間模擬）", () => {
  it("Owner 未開啟排程時不執行", async () => {
    const { deps, started, launched } = cronDeps([{ ...trip, reverify_enabled: false }]);
    expect(await runReverifyCron(deps, new Date("2026-12-03T00:00:00Z"))).toEqual([]);
    expect(started).toEqual([]);
    expect(launched).toEqual([]);
  });

  it("T-7 與 T-1 當天建立 job 並啟動背景執行", async () => {
    const t7 = cronDeps([trip]);
    expect(await runReverifyCron(t7.deps, new Date("2026-12-03T00:00:00Z"))).toEqual([{ tripId: TRIP, kind: "T-7", jobId: JOB }]);
    expect(t7.launched).toEqual([JOB]);
    const t1 = cronDeps([{ ...trip, ran: ["T-7"] }]);
    expect(await runReverifyCron(t1.deps, new Date("2026-12-09T00:00:00Z"))).toEqual([{ tripId: TRIP, kind: "T-1", jobId: JOB }]);
  });

  it("不是 T-7、T-1 的日子不執行；資料庫拒絕建立 job 時不啟動", async () => {
    const early = cronDeps([trip]);
    expect(await runReverifyCron(early.deps, new Date("2026-11-30T00:00:00Z"))).toEqual([]);
    const refused = cronDeps([trip], null);
    expect(await runReverifyCron(refused.deps, new Date("2026-12-03T00:00:00Z"))).toEqual([]);
    expect(refused.started).toEqual([[TRIP, "T-7"]]);
    expect(refused.launched).toEqual([]);
  });
});

const official = { url: "https://www.example.jp/", fetched_at: "2026-12-03T09:00:00+09:00", grade: "facility_official" as const };

const candidate = (id: string): CandidateForCheck => ({
  id,
  name_zh: "咖啡店",
  name_local: null,
  area: "淺草",
  type: "restaurant",
  place_id: null,
  coord_lat: null,
  coord_lng: null,
  created_at: "2026-11-24T01:00:00Z",
  recommendation_reason: "測試",
  constraint_note: null,
  sources: [official],
  generated_by: { provider: "anthropic", model: "claude-opus-5-5" },
  fact_claims: [],
});

function chunkDeps(output: unknown) {
  const submitted: Array<{ change: ChangePayload; by: unknown }> = [];
  const adapter: ProviderAdapter = {
    id: "google",
    authMethods: ["api_key"],
    builtInSearch: true,
    generate: async () => ({ output, usage: { inputTokens: 10, outputTokens: 10 }, citations: [] }),
    classifyError: () => "unknown",
  };
  const deps: ReverifyChunkDeps = {
    adapterFor: () => adapter,
    credentialFor: async () => ({ kind: "api_key", secret: "test-only-key-0003" }),
    recordUsage: async () => undefined,
    loadContext: async () => ({
      tripId: TRIP,
      initiatorId: "00000000-0000-4000-8000-0000000000e1",
      setting: { ...defaultRoleSetting("verification"), chain: [{ provider: "google", model: "gemini-model" }] },
      forbiddenValues: ["test-only-key-0003"],
    }),
    loadCandidates: async (_job, ids) => ids.map(candidate),
    loadScheduled: async () => [
      { id: A, scheduled_date: "2026-12-10", scheduled_start: "13:00:00", scheduled_end: "14:00:00", at_risk: false },
      { id: B, scheduled_date: "2026-12-10", scheduled_start: "15:00:00", scheduled_end: "16:00:00", at_risk: false },
    ],
    submitAtRisk: async (_job, change, by) => {
      submitted.push({ change, by });
    },
  };
  return { deps, submitted };
}

describe("runReverifyChunk", () => {
  it("問題項目以一個 At Risk 提案送出；核實結果不寫回行程", async () => {
    const output = {
      results: [
        // 2026-12-10 是星期四；A 改為星期四公休
        { item_id: A, status: "verified", findings: "官網公告星期四公休", sources: [official], availability: [{ weekday: 5, start: "10:00", end: "18:00" }] },
        { item_id: B, status: "verified", findings: "營業時間不變", sources: [official], availability: [{ weekday: 4, start: "10:00", end: "18:00" }] },
      ],
    };
    const { deps, submitted } = chunkDeps(output);
    expect(await runReverifyChunk(deps, { jobId: JOB, itemIds: [A, B], role: roleSpec("verification") })).toEqual({ checked: 2, flagged: 1 });
    expect(submitted).toEqual([
      {
        change: {
          changeKind: "approved_fact_invalidated",
          versionKind: "minor",
          summary: "旅前再核實：1 個項目的資料可能已有變動，標示為 At Risk",
          operations: [{ op: "set_at_risk", itemId: A, atRisk: true }],
        },
        by: { provider: "google", model: "gemini-model" },
      },
    ]);
  });

  it("沒有問題時不送出提案；AI 輸出不合格時不送出", async () => {
    const ok = chunkDeps({ results: [{ item_id: A, status: "verified", findings: "不變", sources: [official] }] });
    expect(await runReverifyChunk(ok.deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") })).toEqual({ checked: 1, flagged: 0 });
    expect(ok.submitted).toEqual([]);
    const bad = chunkDeps({ results: [{ item_id: "e4000000-0000-4000-8000-000000000099", status: "conflict", findings: "x", sources: [official] }] });
    expect(await runReverifyChunk(bad.deps, { jobId: JOB, itemIds: [A], role: roleSpec("verification") })).toEqual({ checked: 0, flagged: 0 });
    expect(bad.submitted).toEqual([]);
  });
});
