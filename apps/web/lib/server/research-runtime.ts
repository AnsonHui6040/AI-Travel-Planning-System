import "server-only";
import { adapterFor, defaultProviders } from "@atps/ai";
import type { AiProvider, AiRole, ApiKeyProvider, RoleSetting } from "@atps/core";
import { createGoogleMapsClient } from "@atps/data-sources";
import { SupabaseKeyDecryptor, SupabaseRoleSettingsRepository, SupabaseUsageRecorder } from "@atps/db";
import { factClaimRecord, modelRef, sourceRef, tripBaselineData } from "@atps/schemas";
import type { ResearchTrackDeps } from "./research-core";
import { VERIFICATION_CHUNK_SIZE, type CandidateForCheck, type DedupeDeps, type VerificationDeps } from "./verification-core";
import { createSupabaseServiceClient } from "./supabase";

// T24：研究 job 背景 step 的 Supabase 連接（workflows/research-job.ts 在 step 內載入）。
// 以 service role 執行，只解密 job 發起人的 key（C-12）；候選只經 add_research_candidates 寫入，
// 去重與核實結果只經 merge_duplicate_candidates、apply_verification 寫入（T25）。

const KEY_PROVIDER: Record<AiProvider, ApiKeyProvider> = { anthropic: "anthropic", google: "google_ai", openai: "openai" };

export async function setResearchJobStatus(jobId: string, status: "running" | "completed" | "failed"): Promise<void> {
  const service = createSupabaseServiceClient();
  const { error } = await service.from("background_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId).eq("kind", "research");
  if (error) throw new Error("更新研究 job 狀態失敗");
}

type Service = ReturnType<typeof createSupabaseServiceClient>;
type Keys = SupabaseKeyDecryptor;

// 執行中的研究 job、發起人仍為 Owner 或 Companion、行程已確認基線時回傳；否則 null
async function loadJob(service: Service, keys: Keys, id: string, role: AiRole) {
  const { data: job } = await service.from("background_jobs").select("kind, status, initiator_id, trip_id").eq("id", id).maybeSingle();
  if (!job || job.kind !== "research" || job.status !== "running" || !job.trip_id) return null;
  const tripId = String(job.trip_id);
  const initiatorId = String(job.initiator_id);
  const { data: member } = await service.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", initiatorId).maybeSingle();
  if (member?.role !== "owner" && member?.role !== "companion") return null;
  const { data: trip } = await service.from("trips").select("name, destination, status").eq("id", tripId).maybeSingle();
  if (!trip || !["planning", "locked", "in_progress"].includes(String(trip.status))) return null;
  const settings = await new SupabaseRoleSettingsRepository(service).list(initiatorId);
  const setting: RoleSetting | undefined = settings.find((s) => s.role === role);
  if (!setting) return null;
  const forbidden = await Promise.all((Object.values(KEY_PROVIDER) as ApiKeyProvider[]).concat("google_maps").map((p) => keys.forJob(id, p)));
  return {
    tripId,
    initiatorId,
    trip: { name: String(trip.name), destination: (trip.destination as string | null) ?? null },
    setting,
    forbiddenValues: forbidden.filter((v): v is string => typeof v === "string"),
  };
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
      const base = await loadJob(service, keys, id, "research");
      if (!base) return null;
      const { data: stored } = await service.from("trip_baselines").select("data, confirmed_at").eq("trip_id", base.tripId).eq("version", 1).maybeSingle();
      const baseline = stored?.confirmed_at ? tripBaselineData.safeParse(stored.data) : null;
      if (!baseline?.success) return null;
      return { ...base, baseline: baseline.data };
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

// ---- T25：去重與交叉核查 -----------------------------------------------------

const CANDIDATE_COLUMNS =
  "id, name_zh, name_local, area, type, place_id, coord_lat, coord_lng, created_at, recommendation_reason, constraint_note, sources, generated_by, fact_claims";
const OPEN_STATES = ["candidate", "pending_verification"];
const MAX_VERIFICATION_ITEMS = 120;

function toCandidate(r: Record<string, unknown>): CandidateForCheck {
  const sources = sourceRef.array().safeParse(r.sources);
  const claims = factClaimRecord.array().safeParse(r.fact_claims);
  const generatedBy = modelRef.nullable().safeParse(r.generated_by);
  return {
    id: String(r.id),
    name_zh: String(r.name_zh),
    name_local: (r.name_local as string | null) ?? null,
    area: (r.area as string | null) ?? null,
    type: r.type as CandidateForCheck["type"],
    place_id: (r.place_id as string | null) ?? null,
    coord_lat: (r.coord_lat as number | null) ?? null,
    coord_lng: (r.coord_lng as number | null) ?? null,
    created_at: String(r.created_at),
    recommendation_reason: String(r.recommendation_reason),
    constraint_note: (r.constraint_note as string | null) ?? null,
    sources: sources.success ? sources.data : [],
    generated_by: generatedBy.success ? generatedBy.data : null,
    fact_claims: claims.success ? claims.data : [],
  };
}

async function jobTripId(service: Service, jobId: string): Promise<string | null> {
  const { data } = await service.from("background_jobs").select("trip_id, kind").eq("id", jobId).maybeSingle();
  return data?.kind === "research" && data.trip_id ? String(data.trip_id) : null;
}

export function dedupeDeps(): DedupeDeps {
  const service = createSupabaseServiceClient();
  return {
    async listCandidates(jobId) {
      const tripId = await jobTripId(service, jobId);
      if (!tripId) return [];
      const { data, error } = await service.from("itinerary_items").select(CANDIDATE_COLUMNS).eq("trip_id", tripId).in("lifecycle_status", OPEN_STATES).limit(500);
      if (error) throw new Error("讀取候選失敗");
      return (data ?? []).map((r) => toCandidate(r as Record<string, unknown>));
    },
    async merge(jobId, keep, drop) {
      const { data, error } = await service.rpc("merge_duplicate_candidates", { p_job: jobId, p_keep: keep, p_drop: drop });
      if (error) throw new Error("合併候選失敗");
      return Number(data ?? 0);
    },
  };
}

// 尚未核實的候選，分批（每批 VERIFICATION_CHUNK_SIZE 個）
export async function verificationTargets(jobId: string): Promise<string[][]> {
  const service = createSupabaseServiceClient();
  const tripId = await jobTripId(service, jobId);
  if (!tripId) return [];
  const { data, error } = await service
    .from("itinerary_items")
    .select("id")
    .eq("trip_id", tripId)
    .eq("lifecycle_status", "candidate")
    .eq("verification_status", "unverified")
    .order("created_at", { ascending: true })
    .limit(MAX_VERIFICATION_ITEMS);
  if (error) throw new Error("讀取待核實候選失敗");
  const ids = (data ?? []).map((r) => String(r.id));
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += VERIFICATION_CHUNK_SIZE) chunks.push(ids.slice(i, i + VERIFICATION_CHUNK_SIZE));
  return chunks;
}

export function verificationDeps(jobId: string): VerificationDeps {
  const service = createSupabaseServiceClient();
  const keys = new SupabaseKeyDecryptor(service);
  const providers = defaultProviders();
  return {
    adapterFor: (provider) => adapterFor(providers, provider),
    credentialFor: async (provider) => {
      const secret = await keys.forJob(jobId, KEY_PROVIDER[provider]);
      return secret ? { kind: "api_key", secret } : null;
    },
    recordUsage: (entry) => new SupabaseUsageRecorder(service).record(entry),
    async loadContext(id) {
      const base = await loadJob(service, keys, id, "verification");
      return base ? { tripId: base.tripId, initiatorId: base.initiatorId, setting: base.setting, forbiddenValues: base.forbiddenValues } : null;
    },
    async loadCandidates(id, itemIds) {
      const tripId = await jobTripId(service, id);
      if (!tripId || itemIds.length === 0) return [];
      const { data, error } = await service.from("itinerary_items").select(CANDIDATE_COLUMNS).eq("trip_id", tripId).in("id", [...itemIds]).in("lifecycle_status", OPEN_STATES);
      if (error) throw new Error("讀取候選失敗");
      return (data ?? []).map((r) => toCandidate(r as Record<string, unknown>));
    },
    async applyVerification(id, write) {
      const { error } = await service.rpc("apply_verification", {
        p_job: id,
        p_item: write.itemId,
        p_status: write.status,
        p_facts: write.facts,
        p_claims: write.claims,
        p_sources: write.sources,
        p_verified_by: write.verifiedBy,
      });
      if (error) throw new Error("寫入核實結果失敗");
    },
  };
}
