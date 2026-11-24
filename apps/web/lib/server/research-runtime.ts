import "server-only";
import { adapterFor, defaultProviders } from "@atps/ai";
import type { AiProvider, ApiKeyProvider } from "@atps/core";
import { createGoogleMapsClient } from "@atps/data-sources";
import { SupabaseKeyDecryptor, SupabaseRoleSettingsRepository, SupabaseUsageRecorder } from "@atps/db";
import { tripBaselineData } from "@atps/schemas";
import type { ResearchTrackDeps } from "./research-core";
import { createSupabaseServiceClient } from "./supabase";

// T24：研究 job 背景 step 的 Supabase 連接（workflows/research-job.ts 在 step 內載入）。
// 以 service role 執行，只解密 job 發起人的 key（C-12）；候選只經 add_research_candidates 寫入。

const KEY_PROVIDER: Record<AiProvider, ApiKeyProvider> = { anthropic: "anthropic", google: "google_ai", openai: "openai" };

export async function setResearchJobStatus(jobId: string, status: "running" | "completed" | "failed"): Promise<void> {
  const service = createSupabaseServiceClient();
  const { error } = await service.from("background_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId).eq("kind", "research");
  if (error) throw new Error("更新研究 job 狀態失敗");
}

export function researchTrackDeps(jobId: string): ResearchTrackDeps {
  const service = createSupabaseServiceClient();
  const keys = new SupabaseKeyDecryptor(service);
  const providers = defaultProviders();
  const maps = createGoogleMapsClient();
  let mapsKey: Promise<string | null> | null = null;
  const googleMapsKey = () => (mapsKey ??= keys.forJob(jobId, "google_maps"));

  return {
    adapterFor: (provider) => adapterFor(providers, provider),
    credentialFor: async (provider) => {
      const secret = await keys.forJob(jobId, KEY_PROVIDER[provider]);
      return secret ? { kind: "api_key", secret } : null;
    },
    recordUsage: (entry) => new SupabaseUsageRecorder(service).record(entry),
    async loadContext(id) {
      const { data: job } = await service.from("background_jobs").select("kind, status, initiator_id, trip_id").eq("id", id).maybeSingle();
      if (!job || job.kind !== "research" || job.status !== "running" || !job.trip_id) return null;
      const tripId = String(job.trip_id);
      const initiatorId = String(job.initiator_id);
      const { data: member } = await service.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", initiatorId).maybeSingle();
      if (member?.role !== "owner" && member?.role !== "companion") return null;
      const { data: trip } = await service.from("trips").select("name, destination, status").eq("id", tripId).maybeSingle();
      if (!trip || !["planning", "locked", "in_progress"].includes(String(trip.status))) return null;
      const { data: stored } = await service.from("trip_baselines").select("data, confirmed_at").eq("trip_id", tripId).eq("version", 1).maybeSingle();
      const baseline = stored?.confirmed_at ? tripBaselineData.safeParse(stored.data) : null;
      if (!baseline?.success) return null;

      const settings = await new SupabaseRoleSettingsRepository(service).list(initiatorId);
      const setting = settings.find((s) => s.role === "research");
      if (!setting) return null;
      const forbidden = await Promise.all((Object.values(KEY_PROVIDER) as ApiKeyProvider[]).concat("google_maps").map((p) => keys.forJob(id, p)));
      return {
        tripId,
        initiatorId,
        trip: { name: String(trip.name), destination: (trip.destination as string | null) ?? null },
        baseline: baseline.data,
        setting,
        forbiddenValues: forbidden.filter((v): v is string => typeof v === "string"),
      };
    },
    resolvePlace: async (query) => {
      const key = await googleMapsKey();
      // 沒有 Google Maps key：視為無法解析（not_found），候選維持 Unverified
      if (!key) return { status: "unresolved", reason: "not_found" };
      return maps.resolvePlaceId(key, { name: query.name, area: query.area, languageCode: "ja" });
    },
    async storeCandidates(id, track, rows) {
      const { data, error } = await service.rpc("add_research_candidates", { p_job: id, p_track: track, p_candidates: rows });
      if (error) throw new Error("寫入候選失敗");
      return Number(data ?? 0);
    },
  };
}

