import { DEFAULT_ROLE_SETTINGS, checkRoleSpec } from "@atps/core";
import { describe, expect, it } from "vitest";
import { defaultRoles, listModels } from "./index";
import { fakeFetch } from "./testing/fake-fetch";
import { anthropicFixtures, geminiFixtures, openaiFixtures } from "./testing/fixtures";

describe("五個 RoleSpec", () => {
  const roles = defaultRoles();

  it("五個角色都通過註冊表契約", () => {
    expect(roles.list().map((r) => r.id)).toEqual(["research", "verification", "transport", "master_planner", "live_planner"]);
    for (const role of roles.list()) expect(checkRoleSpec(role)).toEqual([]);
  });

  it("工具權限依 S-04", () => {
    const tools = Object.fromEntries(roles.list().map((r) => [r.id, r.tools]));
    expect(tools).toEqual({
      research: ["provider_search"],
      verification: ["provider_search", "allowlisted_fetch"],
      transport: ["provider_search", "transit_status"],
      master_planner: [],
      live_planner: [],
    });
  });

  it("上限與決策 0006 的預設值相同", () => {
    for (const setting of DEFAULT_ROLE_SETTINGS) {
      const role = roles.require(setting.role);
      expect([role.maxSteps, role.maxTokens]).toEqual([setting.maxSteps, setting.maxTokens]);
    }
  });

  it("輸出 JSON Schema 由角色的 Zod schema 產生，物件不允許額外欄位", () => {
    for (const role of roles.list()) {
      expect(role.outputJsonSchema.type).toBe("object");
      expect(JSON.stringify(role.outputJsonSchema)).toContain('"additionalProperties":false');
    }
  });

  it("記憶範圍依角色限定（MEM-11）：Verification 不讀記憶", () => {
    expect(roles.require("verification").memoryScope).toEqual({ layers: [], kinds: [] });
    expect(roles.require("live_planner").memoryScope.layers).toEqual(["personal", "trip_context"]);
    expect(roles.require("research").memoryScope.kinds).toEqual(["preference", "constraint"]);
  });

  it("輸出驗證使用 Zod：未知欄位被拒（S-02）", () => {
    const parsed = roles.require("master_planner").output.safeParse({ proposals: [], extra: 1 });
    expect(parsed.success).toBe(false);
  });
});

describe("列出可用模型（決策 0006）", () => {
  const opts = (steps: Parameters<typeof fakeFetch>[0]) => {
    const fake = fakeFetch(steps);
    return { fake, options: { fetch: fake.fetch, maxRetries: 0, timeoutMs: 5_000 } };
  };

  it("Anthropic", async () => {
    const { options } = opts([anthropicFixtures.models]);
    await expect(listModels("anthropic", "test-only-key-value-0001", options)).resolves.toEqual(["claude-fixture"]);
  });

  it("Gemini：只列可產生內容的模型，去掉 models/ 前綴", async () => {
    const { options } = opts([
      {
        status: 200,
        body: {
          models: [
            { name: "models/gemini-fixture", supportedGenerationMethods: ["generateContent", "countTokens"] },
            { name: "models/embedding-fixture", supportedGenerationMethods: ["embedContent"] },
          ],
        },
      },
    ]);
    await expect(listModels("google", "test-only-key-value-0001", options)).resolves.toEqual(["gemini-fixture"]);
  });

  it("OpenAI", async () => {
    const { options } = opts([openaiFixtures.models]);
    await expect(listModels("openai", "test-only-key-value-0001", options)).resolves.toEqual(["gpt-fixture"]);
  });

  it("失敗時拋出 ProviderError，不含 key", async () => {
    const { options } = opts([geminiFixtures.error(401, "UNAUTHENTICATED")]);
    const error = await listModels("google", "test-only-key-value-0001", options).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("test-only-key-value-0001");
  });
});
