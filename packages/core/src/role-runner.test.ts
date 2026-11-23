import { describe, expect, it } from "vitest";
import {
  defaultRoleSetting,
  runRole,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
  type RoleRunDeps,
  type RoleSpec,
  type UsageEntry,
} from "./index";

// S-02、S-06、C-08：角色執行器。供應商以假 adapter 取代
const OWNER = "44444444-4444-4444-8444-444444444444";

const role: RoleSpec = {
  id: "research",
  instructions: "列出候選。",
  tools: ["provider_search", "allowlisted_fetch"],
  output: {
    safeParse: (v: unknown) =>
      typeof v === "object" && v !== null && "ok" in v
        ? { success: true }
        : { success: false, error: { issues: [{ path: ["candidates", 0, "sources"], message: "required" }] } },
  },
  outputJsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  maxSteps: 6,
  maxTokens: 200_000,
  dataScope: ["candidates"],
  memoryScope: { layers: ["personal"], kinds: ["preference"] },
};

const response = (output: unknown, tokens = { inputTokens: 1000, outputTokens: 200 }): ProviderResponse => ({
  output,
  usage: tokens,
  citations: [],
});

function setup(results: Array<ProviderResponse | Error>, overrides: Partial<RoleRunDeps> = {}) {
  const calls: Array<{ provider: string; request: ProviderRequest }> = [];
  const usage: UsageEntry[] = [];
  const adapter = (id: string): ProviderAdapter => ({
    id,
    authMethods: ["api_key"],
    builtInSearch: true,
    generate: async (request) => {
      calls.push({ provider: id, request });
      const next = results.shift();
      if (!next) throw new Error("沒有更多回應");
      if (next instanceof Error) throw next;
      return next;
    },
    classifyError: (e) => (e as { kind?: "timeout" | "rate_limit" | "interrupted" | "auth" }).kind ?? "unknown",
  });
  const deps: RoleRunDeps = {
    adapterFor: (provider) => adapter(provider),
    credentialFor: async () => ({ kind: "api_key", secret: "test-only" }),
    recordUsage: async (entry) => {
      usage.push(entry);
    },
    ...overrides,
  };
  return { deps, calls, usage };
}

const failure = (kind: string) => Object.assign(new Error("x"), { kind });
const run = (deps: RoleRunDeps, setting = defaultRoleSetting("research"), providerIndex = 0) =>
  runRole(deps, { role, setting, input: "淺草", ownerId: OWNER, jobId: null, providerIndex });

describe("角色執行器", () => {
  it("輸出通過 schema 時完成，記錄用量", async () => {
    const { deps, calls, usage } = setup([response({ ok: true })]);
    const result = await run(deps);
    expect(result).toMatchObject({ status: "completed", output: { ok: true }, provider: "anthropic", model: "claude-opus-5-5" });
    expect(result.usage).toEqual({ steps: 1, inputTokens: 1000, outputTokens: 200 });
    expect(usage).toEqual([
      expect.objectContaining({ ownerId: OWNER, role: "research", provider: "anthropic", steps: 1, outcome: "completed" }),
    ]);
    expect(calls[0]?.request.model).toBe("claude-opus-5-5");
  });

  it("只把供應商內建搜尋交給 AI；伺服器端工具不送出，也不超出角色權限（S-04）", async () => {
    const { deps, calls } = setup([response({ ok: true })]);
    await run(deps);
    expect(calls[0]?.request.tools).toEqual(["provider_search"]);
  });

  it("schema 不符的輸出被丟棄並重試，成功時只回傳合格輸出（S-02）", async () => {
    const { deps, calls } = setup([response({ bad: 1 }), response({ ok: true })]);
    const result = await run(deps);
    expect(result).toMatchObject({ status: "completed", output: { ok: true } });
    expect(result.usage.steps).toBe(2);
    expect(calls[1]?.request.input).toContain("candidates.0.sources");
  });

  it("每次都不符時用完步數後停止，回傳原因與欄位，不回傳內容（S-02、S-06）", async () => {
    const setting = { ...defaultRoleSetting("research"), maxSteps: 3 };
    const { deps, calls, usage } = setup([response({ bad: 1 }), response({ bad: 2 }), response({ bad: 3 }), response({ ok: true })]);
    const result = await run(deps, setting);
    expect(result.status).toBe("output_invalid");
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('"bad"');
    if (result.status === "output_invalid") expect(result.fields).toEqual(["candidates.0.sources"]);
    expect(usage[0]?.outcome).toBe("output_invalid");
  });

  it("超過 token 上限即停止並丟棄輸出（S-06）", async () => {
    const setting = { ...defaultRoleSetting("research"), maxTokens: 1_500 };
    const { deps, calls } = setup([response({ bad: 1 }, { inputTokens: 1000, outputTokens: 600 }), response({ ok: true })]);
    const result = await run(deps, setting);
    expect(result).toMatchObject({ status: "limit_reached", limit: "tokens" });
    expect(calls).toHaveLength(1);
  });

  it("每次呼叫的輸出上限不超過剩餘 token", async () => {
    const setting = { ...defaultRoleSetting("research"), maxTokens: 5_000 };
    const { deps, calls } = setup([response({ ok: true })]);
    await run(deps, setting);
    expect(calls[0]?.request.maxTokens).toBe(5_000);
  });

  it.each(["timeout", "rate_limit", "interrupted"])("供應商 %s 時不自動切換，回傳下一家供使用者確認（C-08）", async (kind) => {
    const { deps, calls, usage } = setup([failure(kind), response({ ok: true })]);
    const result = await run(deps);
    expect(result).toMatchObject({
      status: "provider_failed",
      kind,
      failedProvider: "anthropic",
      next: { provider: "google", model: null },
    });
    expect(calls).toHaveLength(1);
    expect(usage[0]?.outcome).toBe("provider_failed");
  });

  it("使用者確認後以指定的備援執行", async () => {
    const setting = defaultRoleSetting("research");
    setting.chain[1] = { provider: "google", model: "gemini-x" };
    const { deps, calls } = setup([response({ ok: true })]);
    const result = await run(deps, setting, 1);
    expect(result).toMatchObject({ status: "completed", provider: "google", model: "gemini-x" });
    expect(calls[0]?.provider).toBe("google");
  });

  it("最後一家故障時沒有下一家", async () => {
    const setting = { ...defaultRoleSetting("research"), chain: [{ provider: "anthropic" as const, model: "m" }] };
    const { deps } = setup([failure("timeout")]);
    expect(await run(deps, setting)).toMatchObject({ status: "provider_failed", next: null });
  });

  it("沒有選模型或沒有 key 時不呼叫，提示設定（C-05 不借用他人 key）", async () => {
    const { deps, calls } = setup([]);
    expect(await run(deps, defaultRoleSetting("research"), 1)).toMatchObject({ status: "not_configured" });
    const noKey = setup([], { credentialFor: async () => null });
    expect(await run(noKey.deps)).toMatchObject({ status: "not_configured" });
    expect(calls).toHaveLength(0);
    expect(noKey.calls).toHaveLength(0);
  });

  it("超出備援次序範圍時拒絕", async () => {
    const { deps } = setup([]);
    await expect(run(deps, defaultRoleSetting("research"), 5)).rejects.toThrow(/備援次序/);
  });
});
