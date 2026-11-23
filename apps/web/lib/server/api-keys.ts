import "server-only";
import { defaultKeyTesters } from "@atps/ai";
import { createGoogleMapsKeyTester } from "@atps/data-sources";
import { createKeyTesterRegistry, type ApiKeyProvider } from "@atps/core";
import { SupabaseApiKeyStore, SupabaseKeyDecryptor } from "@atps/db";
import type { ApiKeyActionDeps } from "./api-keys-core";
import { createSupabaseServerClient, createSupabaseServiceClient, supabaseGuardDeps } from "./supabase";

// 儲存前測試呼叫的掛鉤：T13（三家 AI）、T19（Google Maps）、T22（ODPT）各自註冊
export const keyTesters = createKeyTesterRegistry();
for (const tester of defaultKeyTesters()) keyTesters.register(tester);
keyTesters.register(createGoogleMapsKeyTester());

export async function apiKeyDeps(): Promise<ApiKeyActionDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    store: new SupabaseApiKeyStore(service),
    decryptor: new SupabaseKeyDecryptor(service),
    removeOwn: async (provider: ApiKeyProvider) => {
      const { error } = await session.from("api_key_records").delete().eq("provider", provider);
      if (error) throw new Error("刪除 API key 失敗");
    },
    testers: keyTesters.list(),
    clock: { now: () => new Date() },
  };
}

export interface ApiKeySummary {
  provider: ApiKeyProvider;
  last4: string;
  lastTestedAt: string | null;
}

// 以請求者本人的 session 讀取，只取顯示所需欄位
export async function listOwnApiKeys(): Promise<{ signedIn: boolean; keys: ApiKeySummary[] }> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { signedIn: false, keys: [] };
  const { data, error } = await session.from("api_key_records").select("provider, last4, last_tested_at");
  if (error) throw new Error("讀取 API key 失敗");
  return {
    signedIn: true,
    keys: (data ?? []).map((row) => ({
      provider: row.provider as ApiKeyProvider,
      last4: String(row.last4),
      lastTestedAt: (row.last_tested_at as string | null) ?? null,
    })),
  };
}
