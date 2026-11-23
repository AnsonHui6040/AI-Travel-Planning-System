import { describe, expect, it } from "vitest";
import { SupabaseApiKeyStore, SupabaseKeyDecryptor, type RpcClient } from "./index";

const OWNER = "44444444-4444-4444-8444-444444444444";
const JOB = "91000000-0000-4000-8000-000000000001";
const SECRET = "test-only-value-1234";

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

describe("SupabaseApiKeyStore", () => {
  it("呼叫 save_api_key，傳入擁有者、供應商、key 與測試時間", async () => {
    const { client, calls } = fakeRpc({ data: null, error: null });
    const testedAt = new Date("2026-11-23T08:00:00Z");
    await new SupabaseApiKeyStore(client).save({ ownerId: OWNER, provider: "openai", secret: SECRET, testedAt });
    expect(calls).toEqual([
      [
        "save_api_key",
        { p_owner: OWNER, p_provider: "openai", p_secret: SECRET, p_tested_at: "2026-11-23T08:00:00.000Z" },
      ],
    ]);
  });

  it("失敗時拋出固定訊息，不含 key 也不含資料庫訊息", async () => {
    const { client } = fakeRpc({ data: null, error: { message: `invalid ${SECRET}` } });
    const error = await new SupabaseApiKeyStore(client)
      .save({ ownerId: OWNER, provider: "openai", secret: SECRET, testedAt: null })
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("儲存 API key 失敗");
  });
});

describe("SupabaseKeyDecryptor", () => {
  it("請求：解密指定擁有者的 key", async () => {
    const { client, calls } = fakeRpc({ data: SECRET, error: null });
    await expect(new SupabaseKeyDecryptor(client).forOwner(OWNER, "openai")).resolves.toBe(SECRET);
    expect(calls).toEqual([["decrypt_api_key", { p_owner: OWNER, p_provider: "openai" }]]);
  });

  it("背景 job：只傳 job 編號，由資料庫取發起人（C-12）", async () => {
    const { client, calls } = fakeRpc({ data: SECRET, error: null });
    await expect(new SupabaseKeyDecryptor(client).forJob(JOB, "anthropic")).resolves.toBe(SECRET);
    expect(calls).toEqual([["decrypt_job_api_key", { p_job_id: JOB, p_provider: "anthropic" }]]);
  });

  it("沒有 key 時回傳 null", async () => {
    const { client } = fakeRpc({ data: null, error: null });
    await expect(new SupabaseKeyDecryptor(client).forOwner(OWNER, "odpt")).resolves.toBeNull();
  });

  it("失敗時拋出固定訊息", async () => {
    const { client } = fakeRpc({ data: null, error: { message: "permission denied" } });
    await expect(new SupabaseKeyDecryptor(client).forJob(JOB, "openai")).rejects.toThrow(/^讀取 API key 失敗$/);
  });
});
