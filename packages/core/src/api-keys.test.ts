import { describe, expect, it, vi } from "vitest";
import {
  API_KEY_PROVIDERS,
  checkKeyTester,
  createKeyTesterRegistry,
  isValidApiKeyFormat,
  maskApiKey,
  saveApiKey,
  type ApiKeyStore,
  type KeyTester,
} from "./index";

const OWNER = "44444444-4444-4444-8444-444444444444";
const SECRET = "sk-test-unit-ABCD1234";
const now = new Date("2026-11-23T08:00:00Z");

function makeStore() {
  const save = vi.fn<ApiKeyStore["save"]>(async () => undefined);
  return { store: { save } satisfies ApiKeyStore, save };
}

const tester = (result: Awaited<ReturnType<KeyTester["test"]>>): KeyTester => ({
  provider: "openai",
  test: async () => result,
});

describe("API key 格式", () => {
  it.each([
    [SECRET, true],
    ["short", false],
    ["has space inside key", false],
    ["tab\tinside-key-value", false],
    ["x".repeat(513), false],
    ["中文中文中文中文中文", false],
  ])("%j → %s", (value, expected) => {
    expect(isValidApiKeyFormat(value)).toBe(expected);
  });

  it("畫面只顯示末四碼", () => {
    expect(maskApiKey("1234")).toBe("••••1234");
  });

  it("五種 key 供應商與資料庫 enum 相同", () => {
    expect(API_KEY_PROVIDERS).toEqual(["anthropic", "google_ai", "openai", "google_maps", "odpt"]);
  });
});

describe("儲存前測試呼叫的掛鉤（C-03）", () => {
  it("測試成功才儲存，並記錄測試時間", async () => {
    const { store, save } = makeStore();
    const result = await saveApiKey(
      { store, testers: [tester({ ok: true })], clock: { now: () => now } },
      { ownerId: OWNER, provider: "openai", secret: SECRET },
    );
    expect(result).toEqual({ ok: true, last4: "1234", tested: true });
    expect(save).toHaveBeenCalledWith({ ownerId: OWNER, provider: "openai", secret: SECRET, testedAt: now });
  });

  it("掛鉤回傳失敗時不儲存，原因不含 key", async () => {
    const { store, save } = makeStore();
    const result = await saveApiKey(
      { store, testers: [tester({ ok: false, reason: "驗證失敗" })], clock: { now: () => now } },
      { ownerId: OWNER, provider: "openai", secret: SECRET },
    );
    expect(result).toEqual({ ok: false, reason: "驗證失敗" });
    expect(save).not.toHaveBeenCalled();
  });

  it("掛鉤拋出錯誤時不儲存，回傳固定訊息", async () => {
    const { store, save } = makeStore();
    const throwing: KeyTester = {
      provider: "openai",
      test: async () => {
        throw new Error(`request failed with ${SECRET}`);
      },
    };
    const result = await saveApiKey(
      { store, testers: [throwing], clock: { now: () => now } },
      { ownerId: OWNER, provider: "openai", secret: SECRET },
    );
    expect(result).toEqual({ ok: false, reason: "測試呼叫失敗，請稍後再試" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(save).not.toHaveBeenCalled();
  });

  it("掛鉤回傳的原因若含 key，改為固定訊息", async () => {
    const { store } = makeStore();
    const result = await saveApiKey(
      { store, testers: [tester({ ok: false, reason: `bad key ${SECRET}` })], clock: { now: () => now } },
      { ownerId: OWNER, provider: "openai", secret: SECRET },
    );
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("尚未提供掛鉤的供應商直接儲存，標示未測試（T13、T19、T22 實作）", async () => {
    const { store, save } = makeStore();
    const result = await saveApiKey(
      { store, testers: [tester({ ok: true })], clock: { now: () => now } },
      { ownerId: OWNER, provider: "odpt", secret: SECRET },
    );
    expect(result).toEqual({ ok: true, last4: "1234", tested: false });
    expect(save).toHaveBeenCalledWith({ ownerId: OWNER, provider: "odpt", secret: SECRET, testedAt: null });
  });

  it("格式錯誤時不呼叫掛鉤也不儲存", async () => {
    const { store, save } = makeStore();
    const test = vi.fn(async () => ({ ok: true as const }));
    const result = await saveApiKey(
      { store, testers: [{ provider: "openai", test }], clock: { now: () => now } },
      { ownerId: OWNER, provider: "openai", secret: "bad key" },
    );
    expect(result).toEqual({ ok: false, reason: "API key 格式不正確" });
    expect(test).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("前後空白會先去除", async () => {
    const { store, save } = makeStore();
    await saveApiKey({ store, testers: [], clock: { now: () => now } }, { ownerId: OWNER, provider: "openai", secret: `  ${SECRET}\n` });
    expect(save.mock.calls[0]?.[0].secret).toBe(SECRET);
  });
});

describe("KeyTester 註冊表", () => {
  it("每個供應商只能有一個掛鉤", () => {
    const registry = createKeyTesterRegistry();
    registry.register(tester({ ok: true }));
    expect(() => registry.register(tester({ ok: true }))).toThrow(/重複/);
  });

  it("不認識的供應商不能註冊", () => {
    expect(checkKeyTester({ provider: "aws" as unknown as "openai", test: async () => ({ ok: true }) })).not.toEqual([]);
  });
});
