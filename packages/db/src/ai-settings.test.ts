import { defaultRoleSetting } from "@atps/core";
import { describe, expect, it } from "vitest";
import { SupabaseRoleSettingsRepository, SupabaseUsageRecorder, type QueryClient } from "./index";

const OWNER = "44444444-4444-4444-8444-444444444444";

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "order", "insert", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  } as unknown as QueryClient;
  return { client, calls };
}

const row = {
  owner_id: OWNER,
  role: "verification",
  chain: [{ provider: "openai", model: "gpt-x" }],
  max_steps: 8,
  max_tokens: 100000,
  updated_at: "2026-11-23T08:00:00+00:00",
};

describe("SupabaseRoleSettingsRepository", () => {
  it("沒有儲存的角色用預設值，儲存過的用本人設定", async () => {
    const { client, calls } = fakeClient({ data: [row], error: null });
    const settings = await new SupabaseRoleSettingsRepository(client).list(OWNER);
    expect(settings.map((s) => s.role)).toEqual(["research", "verification", "transport", "master_planner", "live_planner"]);
    expect(settings[0]).toEqual(defaultRoleSetting("research"));
    expect(settings[1]).toEqual({ role: "verification", chain: [{ provider: "openai", model: "gpt-x" }], maxSteps: 8, maxTokens: 100000 });
    expect(calls).toContainEqual(["eq", "owner_id", OWNER]);
  });

  it("儲存前檢查設定，不合格時不寫入", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await expect(
      new SupabaseRoleSettingsRepository(client).save(OWNER, { ...defaultRoleSetting("research"), maxSteps: 0 }),
    ).rejects.toThrow(/步數/);
    expect(calls).toEqual([]);
  });

  it("以擁有者與角色 upsert", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await new SupabaseRoleSettingsRepository(client).save(OWNER, defaultRoleSetting("transport"));
    const upsert = calls.find(([m]) => m === "upsert");
    expect(upsert?.[1]).toMatchObject({ owner_id: OWNER, role: "transport", max_steps: 6, max_tokens: 120000 });
    expect(upsert?.[2]).toEqual({ onConflict: "owner_id,role" });
  });

  it("資料庫內容格式不符時拋出", async () => {
    const { client } = fakeClient({ data: [{ ...row, chain: [{ provider: "aws", model: null }] }], error: null });
    await expect(new SupabaseRoleSettingsRepository(client).list(OWNER)).rejects.toThrow();
  });
});

describe("SupabaseUsageRecorder（S-06 用量）", () => {
  it("寫入用量紀錄", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await new SupabaseUsageRecorder(client).record({
      ownerId: OWNER,
      jobId: null,
      role: "research",
      provider: "anthropic",
      model: "claude-opus-5-5",
      steps: 2,
      inputTokens: 3000,
      outputTokens: 500,
      outcome: "completed",
    });
    const insert = calls.find(([m]) => m === "insert");
    expect(insert?.[1]).toMatchObject({ owner_id: OWNER, role: "research", input_tokens: 3000, outcome: "completed" });
  });

  it("依角色加總用量", async () => {
    const usage = (role: string, steps: number, input: number, output: number) => ({
      id: "55555555-5555-4555-8555-555555555555",
      owner_id: OWNER,
      job_id: null,
      role,
      provider: "anthropic",
      model: "m",
      steps,
      input_tokens: input,
      output_tokens: output,
      outcome: "completed",
      created_at: "2026-11-23T08:00:00+00:00",
    });
    const { client, calls } = fakeClient({ data: [usage("research", 2, 100, 10), usage("research", 1, 50, 5), usage("transport", 1, 10, 1)], error: null });
    const summary = await new SupabaseUsageRecorder(client).summary(OWNER, new Date("2026-11-01T00:00:00Z"));
    expect(summary).toEqual([
      { role: "research", runs: 2, steps: 3, inputTokens: 150, outputTokens: 15 },
      { role: "verification", runs: 0, steps: 0, inputTokens: 0, outputTokens: 0 },
      { role: "transport", runs: 1, steps: 1, inputTokens: 10, outputTokens: 1 },
      { role: "master_planner", runs: 0, steps: 0, inputTokens: 0, outputTokens: 0 },
      { role: "live_planner", runs: 0, steps: 0, inputTokens: 0, outputTokens: 0 },
    ]);
    expect(calls).toContainEqual(["gte", "created_at", "2026-11-01T00:00:00.000Z"]);
  });
});
