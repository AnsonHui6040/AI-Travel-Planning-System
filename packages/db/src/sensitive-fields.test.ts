import { describe, expect, it } from "vitest";
import { SupabaseSensitiveFields, type RpcClient } from "./index";

// T17：敏感欄位只經資料庫函式存取
const TRIP = "a7000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";

function fakeRpc(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, unknown]> = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return result;
    },
  } as unknown as RpcClient;
  return { client, calls };
}

describe("SupabaseSensitiveFields", () => {
  it("儲存：只傳行程、欄位與值，使用者由資料庫取自 session", async () => {
    const { client, calls } = fakeRpc({ data: null, error: null });
    await new SupabaseSensitiveFields(client).save(TRIP, "phone", "+886 912-345-678");
    expect(calls).toEqual([["save_sensitive_field", { p_trip: TRIP, p_field: "phone", p_value: "+886 912-345-678" }]]);
  });

  it("設定開關", async () => {
    const { client, calls } = fakeRpc({ data: null, error: null });
    await new SupabaseSensitiveFields(client).setSharing(TRIP, "email", { ai: true, members: false, viewers: true });
    expect(calls).toEqual([
      ["set_sensitive_sharing", { p_trip: TRIP, p_field: "email", p_share_ai: true, p_share_members: false, p_share_viewers: true }],
    ]);
  });

  it("列出可見的欄位；他人的開關為 null", async () => {
    const { client } = fakeRpc({
      data: [
        { user_id: A, field: "full_name", value: "王小明", share_ai: false, share_members: true, share_viewers: false },
        { user_id: B, field: "email", value: "hua@example.test", share_ai: null, share_members: null, share_viewers: null },
      ],
      error: null,
    });
    await expect(new SupabaseSensitiveFields(client).listForTrip(TRIP)).resolves.toEqual([
      { userId: A, field: "full_name", value: "王小明", sharing: { ai: false, members: true, viewers: false } },
      { userId: B, field: "email", value: "hua@example.test", sharing: null },
    ]);
  });

  it("AI 用：只回傳資料庫給的欄位，並標示為開啟提供給 AI", async () => {
    const { client, calls } = fakeRpc({ data: [{ user_id: A, field: "email", value: "ming@example.test" }], error: null });
    await expect(new SupabaseSensitiveFields(client).forAi(TRIP, B)).resolves.toEqual([
      { userId: A, field: "email", value: "ming@example.test", shareAi: true },
    ]);
    expect(calls).toEqual([["ai_sensitive_fields", { p_trip: TRIP, p_requester: B }]]);
  });

  it("回傳格式不符或失敗時拋出固定訊息，不含值", async () => {
    const bad = fakeRpc({ data: [{ user_id: A, field: "passport", value: "X1234567" }], error: null });
    await expect(new SupabaseSensitiveFields(bad.client).forAi(TRIP, B)).rejects.toThrow(/^讀取敏感欄位失敗$/);
    const failed = fakeRpc({ data: null, error: { message: "value 王小明 invalid" } });
    await expect(new SupabaseSensitiveFields(failed.client).save(TRIP, "full_name", "王小明")).rejects.toThrow(/^儲存敏感欄位失敗$/);
  });

  it("格式錯誤時回報欄位錯誤（22023），其他錯誤回報一般失敗", async () => {
    const invalid = fakeRpc({ data: null, error: { message: "x", code: "22023" } as { message: string } });
    await expect(new SupabaseSensitiveFields(invalid.client).save(TRIP, "email", "bad")).rejects.toThrow(/^敏感欄位格式不正確$/);
  });
});
