import type { CredentialProvider, ProviderAdapter, RoleSpec } from "@atps/core";
import { describe, expect, it } from "vitest";
import { createCredentialRegistry, createProviderRegistry, createRoleRegistry } from "./index";

// 假實作：只在本測試註冊，不修改 packages/core
const fakeProvider: ProviderAdapter = {
  id: "fake-ai",
  authMethods: ["api_key", "plan_oauth"],
  builtInSearch: false,
  generate: async () => ({ output: { ok: true }, usage: { inputTokens: 3, outputTokens: 2 }, citations: [] }),
  classifyError: () => "interrupted",
};

const fakeRole: RoleSpec = {
  id: "fake_reviewer",
  tools: [],
  instructions: "假角色",
  output: { safeParse: (value) => ({ success: typeof value === "object" && value !== null }) },
  outputJsonSchema: { type: "object", properties: {} },
  maxSteps: 3,
  maxTokens: 4_000,
  dataScope: ["itinerary"],
  memoryScope: { layers: [], kinds: [] },
};

const fakeCredential: CredentialProvider = {
  kind: "api_key",
  available: true,
  resolve: async ({ ownerId }) => (ownerId === "owner" ? { kind: "api_key", secret: "test-only" } : null),
};

describe("ProviderAdapter 註冊表", () => {
  it("假 provider 註冊後通過共用契約並可呼叫", async () => {
    const registry = createProviderRegistry();
    registry.register(fakeProvider);
    const adapter = registry.require("fake-ai");
    expect(adapter.authMethods).toContain("plan_oauth");
    const response = await adapter.generate(
      { model: "m", system: "s", input: "i", outputSchema: {}, tools: [], maxTokens: 10 },
      { kind: "api_key", secret: "test-only" },
    );
    expect(response.usage.outputTokens).toBe(2);
  });

  it("不符合契約的 provider 不能註冊", () => {
    const registry = createProviderRegistry();
    expect(() => registry.register({ ...fakeProvider, authMethods: [] })).toThrow(/ProviderAdapter/);
  });
});

describe("RoleSpec 註冊表", () => {
  it("假角色註冊後通過共用契約", () => {
    const registry = createRoleRegistry();
    registry.register(fakeRole);
    expect(registry.require("fake_reviewer").maxSteps).toBe(3);
  });

  it("步數上限不合格的角色不能註冊", () => {
    const registry = createRoleRegistry();
    expect(() => registry.register({ ...fakeRole, maxSteps: 0 })).toThrow(/RoleSpec/);
  });
});

describe("CredentialProvider 註冊表", () => {
  it("假認證方式註冊後可取得憑證；不可用的認證方式不列入 available", async () => {
    const registry = createCredentialRegistry();
    registry.register(fakeCredential);
    registry.register({ kind: "plan_oauth", available: false, resolve: async () => null });
    expect(registry.available().map((c) => c.kind)).toEqual(["api_key"]);
    expect(await registry.require("api_key").resolve({ ownerId: "owner", provider: "fake-ai" })).toEqual({
      kind: "api_key",
      secret: "test-only",
    });
  });

  it("同一種認證方式不能註冊兩次", () => {
    const registry = createCredentialRegistry();
    registry.register(fakeCredential);
    expect(() => registry.register(fakeCredential)).toThrow(/重複/);
  });
});
