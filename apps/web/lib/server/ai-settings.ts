import "server-only";
import { listModels } from "@atps/ai";
import { sameProviderWarning, type AiProvider, type ApiKeyProvider, type RoleSetting } from "@atps/core";
import { SupabaseRoleSettingsRepository, SupabaseUsageRecorder, type RoleUsageSummary } from "@atps/db";
import type { AiSettingsDeps } from "./ai-settings-core";
import { decryptOwnKey } from "./api-keys-core";
import { apiKeyDeps } from "./api-keys";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// 角色設定的供應商代碼與 API key 的供應商代碼對照
const KEY_PROVIDER: Record<AiProvider, ApiKeyProvider> = { anthropic: "anthropic", google: "google_ai", openai: "openai" };
const USAGE_DAYS = 30;

export async function aiSettingsDeps(): Promise<AiSettingsDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const keys = await apiKeyDeps();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    saveSetting: (ownerId, setting) => new SupabaseRoleSettingsRepository(session).save(ownerId, setting),
    decryptOwnKey: (provider) => decryptOwnKey(keys, KEY_PROVIDER[provider]),
    listModels: (provider, apiKey) => listModels(provider, apiKey),
  };
}

export interface AiSettingsView {
  signedIn: boolean;
  settings: RoleSetting[];
  warning: string | null;
  usage: RoleUsageSummary[];
}

// 以請求者本人的 session 讀取設定與近 30 日用量
export async function loadAiSettings(): Promise<AiSettingsView> {
  const session = await createSupabaseServerClient();
  const { data } = await session.auth.getUser();
  if (!data.user) return { signedIn: false, settings: [], warning: null, usage: [] };
  const settings = await new SupabaseRoleSettingsRepository(session).list(data.user.id);
  const since = new Date(Date.now() - USAGE_DAYS * 24 * 60 * 60 * 1000);
  const usage = await new SupabaseUsageRecorder(session).summary(data.user.id, since);
  return { signedIn: true, settings, warning: sameProviderWarning(settings), usage };
}
