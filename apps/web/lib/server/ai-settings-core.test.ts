import { defaultRoleSetting, type RoleSetting } from "@atps/core";
import { describe, expect, it, vi } from "vitest";
import { listModelsAction, parseRoleSettingForm, saveRoleSettingAction, type AiSettingsDeps } from "./ai-settings-core";

const USER = "44444444-4444-4444-8444-444444444444";

function deps(overrides: Partial<AiSettingsDeps> = {}) {
  const save = vi.fn<(ownerId: string, setting: RoleSetting) => Promise<void>>(async () => undefined);
  const listModels = vi.fn(async () => ["model-b", "model-a"]);
  const base: AiSettingsDeps = {
    getUser: async () => ({ id: USER }),
    checkRateLimit: async () => true,
    saveSetting: save,
    decryptOwnKey: async () => "test-only-key",
    listModels,
  };
  return { deps: { ...base, ...overrides }, save, listModels };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const valid = {
  role: "verification",
  provider_0: "anthropic",
  model_0: "claude-opus-5-5",
  provider_1: "openai",
  model_1: "",
  provider_2: "",
  model_2: "",
  max_steps: "10",
  max_tokens: "200000",
};

describe("角色設定表單", () => {
  it("解析備援次序，略過未選的順位，空白模型為 null", () => {
    expect(parseRoleSettingForm(form(valid))).toEqual({
      role: "verification",
      chain: [
        { provider: "anthropic", model: "claude-opus-5-5" },
        { provider: "openai", model: null },
      ],
      maxSteps: 10,
      maxTokens: 200000,
    });
  });

  it("不認識的角色或供應商回傳 null", () => {
    expect(parseRoleSettingForm(form({ ...valid, role: "admin" }))).toBeNull();
    expect(parseRoleSettingForm(form({ ...valid, provider_0: "aws" }))).toBeNull();
  });

  it("以 session 的使用者儲存，忽略表單的擁有者欄位", async () => {
    const { deps: d, save } = deps();
    const result = await saveRoleSettingAction(d, form({ ...valid, ownerId: "55555555-5555-4555-8555-555555555555" }));
    expect(result).toEqual({ ok: true, message: "已儲存 Verification 的設定" });
    expect(save).toHaveBeenCalledWith(USER, expect.objectContaining({ role: "verification" }));
  });

  it("設定不合格時不儲存，回傳原因", async () => {
    const { deps: d, save } = deps();
    const result = await saveRoleSettingAction(d, form({ ...valid, max_steps: "0" }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/步數/);
    expect(save).not.toHaveBeenCalled();
  });

  it("未登入或超過速率限制時不儲存", async () => {
    const a = deps({ getUser: async () => null });
    expect((await saveRoleSettingAction(a.deps, form(valid))).ok).toBe(false);
    const b = deps({ checkRateLimit: async () => false });
    expect((await saveRoleSettingAction(b.deps, form(valid))).ok).toBe(false);
    expect(a.save).not.toHaveBeenCalled();
    expect(b.save).not.toHaveBeenCalled();
  });
});

describe("列出可用模型", () => {
  it("以本人的 key 取得並排序", async () => {
    const { deps: d, listModels } = deps();
    expect(await listModelsAction(d, form({ provider: "google" }))).toEqual({
      ok: true,
      provider: "google",
      models: ["model-a", "model-b"],
      message: "已取得 2 個 Gemini 模型",
    });
    expect(listModels).toHaveBeenCalledWith("google", "test-only-key");
  });

  it("沒有 key 時提示先設定，不呼叫供應商", async () => {
    const { deps: d, listModels } = deps({ decryptOwnKey: async () => null });
    expect(await listModelsAction(d, form({ provider: "openai" }))).toMatchObject({
      ok: false,
      message: "請先在 API key 設定頁設定 OpenAI 的 key",
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it("供應商失敗時回傳固定訊息", async () => {
    const { deps: d } = deps({
      listModels: async () => {
        throw new Error("upstream test-only-key");
      },
    });
    const result = await listModelsAction(d, form({ provider: "anthropic" }));
    expect(result).toMatchObject({ ok: false, message: "無法取得模型清單，請稍後再試" });
  });

  it("預設設定可直接儲存", async () => {
    const { deps: d, save } = deps();
    const setting = defaultRoleSetting("research");
    const fields: Record<string, string> = { role: "research", max_steps: "6", max_tokens: "200000" };
    setting.chain.forEach((c, i) => {
      fields[`provider_${i}`] = c.provider;
      fields[`model_${i}`] = c.model ?? "";
    });
    expect((await saveRoleSettingAction(d, form(fields))).ok).toBe(true);
    expect(save).toHaveBeenCalledWith(USER, setting);
  });
});
