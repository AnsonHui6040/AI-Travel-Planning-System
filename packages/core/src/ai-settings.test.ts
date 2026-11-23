import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_SETTINGS,
  defaultRoleSetting,
  sameProviderWarning,
  validateRoleSetting,
  verificationCap,
  type RoleSetting,
} from "./index";

describe("角色預設值（決策 0006）", () => {
  it("步數與 token 上限", () => {
    expect(DEFAULT_ROLE_SETTINGS.map((s) => [s.role, s.maxSteps, s.maxTokens])).toEqual([
      ["research", 6, 200_000],
      ["verification", 10, 200_000],
      ["transport", 6, 120_000],
      ["master_planner", 4, 150_000],
      ["live_planner", 3, 60_000],
    ]);
  });

  it("Verification 預設 Gemini → OpenAI → Claude，其餘 Claude → Gemini → OpenAI", () => {
    expect(defaultRoleSetting("verification").chain.map((c) => c.provider)).toEqual(["google", "openai", "anthropic"]);
    for (const role of ["research", "transport", "master_planner", "live_planner"] as const) {
      expect(defaultRoleSetting(role).chain.map((c) => c.provider)).toEqual(["anthropic", "google", "openai"]);
    }
  });

  it("Claude 預設 claude-opus-5-5，Gemini 與 OpenAI 預設空白待選擇", () => {
    const chain = defaultRoleSetting("research").chain;
    expect(chain).toEqual([
      { provider: "anthropic", model: "claude-opus-5-5" },
      { provider: "google", model: null },
      { provider: "openai", model: null },
    ]);
  });

  it("預設值本身通過檢查，且預設不出現同一家警告", () => {
    for (const s of DEFAULT_ROLE_SETTINGS) expect(validateRoleSetting(s)).toEqual([]);
    expect(sameProviderWarning(DEFAULT_ROLE_SETTINGS)).toBeNull();
  });

  it("每次取得的預設值是新物件，修改不影響其他呼叫", () => {
    const a = defaultRoleSetting("research");
    a.chain[0] = { provider: "openai", model: "x" };
    expect(defaultRoleSetting("research").chain[0]?.provider).toBe("anthropic");
  });
});

describe("設定檢查", () => {
  const base = defaultRoleSetting("research");

  it("上限必須在範圍內（S-06）", () => {
    expect(validateRoleSetting({ ...base, maxSteps: 0 })).not.toEqual([]);
    expect(validateRoleSetting({ ...base, maxSteps: 101 })).not.toEqual([]);
    expect(validateRoleSetting({ ...base, maxTokens: 999 })).not.toEqual([]);
    expect(validateRoleSetting({ ...base, maxTokens: 1_000_001 })).not.toEqual([]);
  });

  it("備援次序 1–3 家且不重複", () => {
    expect(validateRoleSetting({ ...base, chain: [] })).not.toEqual([]);
    expect(
      validateRoleSetting({
        ...base,
        chain: [
          { provider: "anthropic", model: "claude-opus-5-5" },
          { provider: "anthropic", model: "claude-opus-5-5" },
        ],
      }),
    ).not.toEqual([]);
  });

  it("模型名稱只接受英數與 . _ - : /，最多 100 字元", () => {
    const withModel = (model: string) => ({ ...base, chain: [{ provider: "openai" as const, model }] });
    expect(validateRoleSetting(withModel("gpt-x.1"))).toEqual([]);
    expect(validateRoleSetting(withModel("models/gemini-x"))).toEqual([]);
    expect(validateRoleSetting(withModel("bad model"))).not.toEqual([]);
    expect(validateRoleSetting(withModel("x".repeat(101)))).not.toEqual([]);
  });
});

describe("同一家警告與核實上限（D07）", () => {
  const settings = (verificationPrimary: RoleSetting["chain"][number]["provider"]) =>
    DEFAULT_ROLE_SETTINGS.map((s) =>
      s.role === "verification" ? { ...s, chain: [{ provider: verificationPrimary, model: "m" }] } : s,
    );

  it("Research 與 Verification 主要供應商相同時警告", () => {
    expect(sameProviderWarning(settings("anthropic"))).toMatch(/同一家/);
    expect(sameProviderWarning(settings("openai"))).toBeNull();
  });

  it("實際執行的兩家相同時，核實上限為 Partially Verified", () => {
    expect(verificationCap("anthropic", "anthropic")).toBe("partially_verified");
    expect(verificationCap("anthropic", "google")).toBe("verified");
  });
});
