import { describe, expect, it, vi } from "vitest";
import { decryptOwnKey, deleteKeyAction, saveKeyAction, type ApiKeyActionDeps } from "./api-keys-core";

const USER = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const SECRET = "sk-test-web-ABCD1234";

function deps(overrides: Partial<ApiKeyActionDeps> = {}) {
  const save = vi.fn(async () => undefined);
  const forOwner = vi.fn(async () => SECRET);
  const remove = vi.fn(async () => undefined);
  const base: ApiKeyActionDeps = {
    getUser: async () => ({ id: USER }),
    checkRateLimit: async () => true,
    store: { save },
    decryptor: { forOwner },
    removeOwn: remove,
    testers: [],
    clock: { now: () => new Date("2026-11-23T08:00:00Z") },
  };
  return { deps: { ...base, ...overrides }, save, forOwner, remove };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("儲存 API key 的 Server Action", () => {
  it("擁有者取自 session，忽略表單傳入的 ownerId（C-05）", async () => {
    const { deps: d, save } = deps();
    const result = await saveKeyAction(d, form({ provider: "openai", secret: SECRET, ownerId: OTHER }));
    expect(result).toEqual({ ok: true, message: "已儲存，末四碼 1234（尚未測試）" });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ ownerId: USER }));
  });

  it("未登入時不儲存", async () => {
    const { deps: d, save } = deps({ getUser: async () => null });
    expect(await saveKeyAction(d, form({ provider: "openai", secret: SECRET }))).toEqual({ ok: false, message: "需要登入" });
    expect(save).not.toHaveBeenCalled();
  });

  it("超過速率限制時不儲存", async () => {
    const { deps: d, save } = deps({ checkRateLimit: async () => false });
    expect((await saveKeyAction(d, form({ provider: "openai", secret: SECRET }))).ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("不認識的供應商被拒", async () => {
    const { deps: d, save } = deps();
    expect(await saveKeyAction(d, form({ provider: "aws", secret: SECRET }))).toEqual({
      ok: false,
      message: "不支援的服務",
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("掛鉤回傳失敗時不儲存（C-03）", async () => {
    const { deps: d, save } = deps({
      testers: [{ provider: "openai", test: async () => ({ ok: false, reason: "key 無效" }) }],
    });
    expect(await saveKeyAction(d, form({ provider: "openai", secret: SECRET }))).toEqual({ ok: false, message: "key 無效" });
    expect(save).not.toHaveBeenCalled();
  });

  it("儲存失敗時回傳固定訊息，不含 key", async () => {
    const { deps: d } = deps({
      store: {
        save: async () => {
          throw new Error(`db error ${SECRET}`);
        },
      },
    });
    const result = await saveKeyAction(d, form({ provider: "openai", secret: SECRET }));
    expect(result).toEqual({ ok: false, message: "儲存失敗，請稍後再試" });
  });
});

describe("刪除 API key 的 Server Action", () => {
  it("以 session 刪除本人的 key", async () => {
    const { deps: d, remove } = deps();
    expect(await deleteKeyAction(d, form({ provider: "google_maps" }))).toEqual({ ok: true, message: "已刪除" });
    expect(remove).toHaveBeenCalledWith("google_maps");
  });

  it("未登入時不刪除", async () => {
    const { deps: d, remove } = deps({ getUser: async () => null });
    expect((await deleteKeyAction(d, form({ provider: "openai" }))).ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("伺服器請求解密 key", () => {
  it("只解密請求者本人的 key，沒有指定其他擁有者的參數（C-02、C-05）", async () => {
    const { deps: d, forOwner } = deps();
    await expect(decryptOwnKey(d, "openai")).resolves.toBe(SECRET);
    expect(forOwner).toHaveBeenCalledWith(USER, "openai");
    expect(decryptOwnKey.length).toBe(2);
  });

  it("未登入時不解密", async () => {
    const { deps: d, forOwner } = deps({ getUser: async () => null });
    await expect(decryptOwnKey(d, "openai")).resolves.toBeNull();
    expect(forOwner).not.toHaveBeenCalled();
  });
});
