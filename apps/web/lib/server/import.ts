import "server-only";
import { adapterFor, defaultProviders } from "@atps/ai";
import type { AiProvider, ApiKeyProvider, ProviderAdapter } from "@atps/core";
import { SupabaseKeyDecryptor, SupabaseRoleSettingsRepository, SupabaseSensitiveFields, SupabaseUsageRecorder } from "@atps/db";
import { tripBaselineData, uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { importFixtureOutput } from "./import-fixture";
import type { ImportContext, ImportPreviewDeps } from "./import-core";
import { createSupabaseServerClient, createSupabaseServiceClient, supabaseGuardDeps } from "./supabase";

// 決策 0010 I：行程匯入的 Supabase 與 AI 連接。
// 行程、成員、角色設定與敏感欄位以本人 session 讀取（RLS）；API key 只解密請求者本人的（C-05，service role 只用於 decrypt_api_key）。
// 這個模組只產生預覽，不寫入任何資料表；確認的寫入在 import-confirm.ts（預訂與行程編輯的路徑，本人 session）。
// E2E 以 E2E_AI_FIXTURE=1 改用錄製的 AI 回應（不連 AI 供應商）；Vercel 上一律關閉

const KEY_PROVIDER: Record<AiProvider, ApiKeyProvider> = { anthropic: "anthropic", google: "google_ai", openai: "openai" };

function fixtureAdapter(provider: AiProvider): ProviderAdapter {
  return {
    id: provider,
    authMethods: ["api_key"],
    builtInSearch: false,
    async generate(request) {
      return { output: importFixtureOutput(request.input), usage: { inputTokens: 1, outputTokens: 1 }, citations: [] };
    },
    classifyError: () => "unknown",
  };
}

const useFixture = () => process.env.E2E_AI_FIXTURE === "1" && process.env.VERCEL !== "1";

function tripDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`) && dates.length < 60; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export async function importPreviewDeps(): Promise<ImportPreviewDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();
  const keys = new SupabaseKeyDecryptor(service);
  const providers = defaultProviders();
  const me = async () => (await guard.getUser())?.id ?? null;

  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    adapterFor: (provider) => (useFixture() ? fixtureAdapter(provider) : adapterFor(providers, provider)),
    credentialFor: async (provider) => {
      const userId = await me();
      const secret = userId ? await keys.forOwner(userId, KEY_PROVIDER[provider]) : null;
      return secret ? { kind: "api_key", secret } : null;
    },
    recordUsage: (entry) => new SupabaseUsageRecorder(session).record(entry),
    async load(tripId): Promise<ImportContext | null> {
      const userId = await me();
      if (!userId || !uuid.safeParse(tripId).success) return null;
      const { data: trip } = await session.from("trips").select("timezone").eq("id", tripId).maybeSingle();
      if (!trip) return null;
      const [{ data: member }, { data: stored }, settings, sensitive] = await Promise.all([
        session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", userId).maybeSingle(),
        session.from("trip_baselines").select("data").eq("trip_id", tripId).eq("version", 1).maybeSingle(),
        new SupabaseRoleSettingsRepository(session).list(userId),
        new SupabaseSensitiveFields(session).listForTrip(tripId),
      ]);
      const setting = settings.find((s) => s.role === "master_planner");
      if (!setting) return null;
      const baseline = stored ? tripBaselineData.safeParse(stored.data) : null;
      const knownValues = sensitive.map((s) => s.value);
      const apiKeys = await Promise.all((Object.values(KEY_PROVIDER) as ApiKeyProvider[]).concat("google_maps").map((p) => keys.forOwner(userId, p)));
      return {
        tripId,
        userId,
        timezone: String(trip.timezone),
        dates: baseline?.success ? tripDates(baseline.data.start_date, baseline.data.end_date) : [],
        canEdit: member?.role === "owner" || member?.role === "companion",
        setting,
        knownValues,
        forbiddenValues: [...apiKeys.filter((v): v is string => typeof v === "string"), ...knownValues],
      };
    },
    logError: (message) => createLogger().error(message),
  };
}
