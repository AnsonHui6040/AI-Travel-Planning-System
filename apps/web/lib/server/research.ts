import "server-only";
import { RESEARCH_TRACKS, SCREENING_DIMENSIONS, type AiProvider, type ApiKeyProvider, type ResearchCandidate, type ResearchTrackId, type ResolvedFact, type ScreeningDimension } from "@atps/core";
import { SupabaseRoleSettingsRepository } from "@atps/db";
import { modelRef, resolvedFact, sourceRef, uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { start } from "workflow/api";
import { researchJob } from "../../workflows/research-job";
import type { ResearchStartDeps } from "./research-core";
import { createSupabaseServerClient, createSupabaseServiceClient, supabaseGuardDeps } from "./supabase";

// T24：研究 job 的 Supabase 連接。
// 開始研究以使用者 session（RLS）讀取與建立 job；背景 step 的連接在 research-runtime.ts。

const KEY_PROVIDER: Record<AiProvider, ApiKeyProvider> = { anthropic: "anthropic", google: "google_ai", openai: "openai" };
const ROLES = new Set(["owner", "companion", "viewer"]);

export async function researchStartDeps(): Promise<ResearchStartDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async loadTrip(tripId) {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) return null;
      const { data: trip } = await session.from("trips").select("status").eq("id", tripId).maybeSingle();
      const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
      const role = member?.role as string | undefined;
      if (!trip || !role || !ROLES.has(role)) return null;
      return { status: String(trip.status), role: role as "owner" | "companion" | "viewer" };
    },
    async loadResearchSetting(userId) {
      const settings = await new SupabaseRoleSettingsRepository(session).list(userId);
      const research = settings.find((s) => s.role === "research");
      if (!research) throw new Error("讀取 Research 設定失敗");
      return research;
    },
    async hasKey(provider) {
      const { data, error } = await session.from("api_key_records").select("provider").eq("provider", KEY_PROVIDER[provider]);
      if (error) throw new Error("讀取 API key 失敗");
      return (data ?? []).length > 0;
    },
    async createJob(tripId, userId) {
      const { data, error } = await session
        .from("background_jobs")
        .insert({ kind: "research", initiator_id: userId, trip_id: tripId })
        .select("id")
        .single();
      if (error || !data) throw new Error("建立研究 job 失敗");
      return String(data.id);
    },
    async startWorkflow({ jobId }) {
      const run = await start(researchJob, [{ jobId }]);
      await service.from("background_jobs").update({ workflow_run_id: run.runId }).eq("id", jobId);
    },
    async failJob(jobId) {
      await service.from("background_jobs").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", jobId);
    },
    logError: (message) => createLogger().error(message),
  };
}

// ---- Candidate List 畫面 -------------------------------------------------------

export interface CandidateView {
  id: string;
  nameZh: string;
  nameLocal: string | null;
  area: string | null;
  type: ResearchCandidate["type"];
  stayMinutes: number;
  reason: string;
  constraintNote: string | null;
  placeId: string | null;
  verificationStatus: "verified" | "partially_verified" | "unverified" | "conflict";
  track: ResearchTrackId | null;
  sources: { url: string; fetched_at: string; grade: string }[];
  generatedBy: { provider: string; model: string } | null;
  verifiedBy: { provider: string; model: string } | null;
  // T25：依證據順序判定的事實
  facts: ResolvedFact[];
  // T26：八個篩選維度與候選角色
  scores: Record<ScreeningDimension, number>;
  role: "primary" | "backup";
}

export type CandidateListView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripName: string;
      tripStatus: string;
      canResearch: boolean;
      latestJob: { status: string; createdAt: string } | null;
      candidates: CandidateView[];
    };

const TRACK_IDS = new Set<string>(RESEARCH_TRACKS.map((t) => t.id));

export async function loadCandidateList(tripId: string): Promise<CandidateListView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };

  const { data: trip, error } = await session.from("trips").select("name, status").eq("id", tripId).maybeSingle();
  if (error) throw new Error("讀取行程失敗");
  if (!trip) return { state: "not_found" };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const role = (member?.role as string | undefined) ?? null;

  const { data: rows, error: itemsError } = await session
    .from("itinerary_items")
    .select("id, name_zh, name_local, area, type, suggested_stay_minutes, recommendation_reason, constraint_note, place_id, verification_status, research_track, sources, generated_by, verified_by, facts, candidate_role, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability")
    .eq("trip_id", tripId)
    // 候選、待核實與已核實（尚未排入行程）
    .in("lifecycle_status", ["candidate", "pending_verification", "verified"])
    .order("research_track", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(500);
  if (itemsError) throw new Error("讀取候選失敗");

  // 背景 job 只有發起人看得到（RLS）
  const { data: job } = await session
    .from("background_jobs")
    .select("status, created_at")
    .eq("trip_id", tripId)
    .eq("kind", "research")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const candidates: CandidateView[] = (rows ?? []).map((r) => {
    const sources = sourceRef.array().safeParse(r.sources);
    const generatedBy = modelRef.nullable().safeParse(r.generated_by);
    const verifiedBy = modelRef.nullable().safeParse(r.verified_by);
    const facts = resolvedFact.array().safeParse(r.facts);
    const track = typeof r.research_track === "string" && TRACK_IDS.has(r.research_track) ? (r.research_track as ResearchTrackId) : null;
    return {
      id: String(r.id),
      nameZh: String(r.name_zh),
      nameLocal: (r.name_local as string | null) ?? null,
      area: (r.area as string | null) ?? null,
      type: r.type as CandidateView["type"],
      stayMinutes: Number(r.suggested_stay_minutes),
      reason: String(r.recommendation_reason),
      constraintNote: (r.constraint_note as string | null) ?? null,
      placeId: (r.place_id as string | null) ?? null,
      verificationStatus: r.verification_status as CandidateView["verificationStatus"],
      track,
      sources: sources.success ? sources.data : [],
      generatedBy: generatedBy.success ? generatedBy.data : null,
      verifiedBy: verifiedBy.success ? verifiedBy.data : null,
      facts: facts.success ? facts.data : [],
      scores: Object.fromEntries(SCREENING_DIMENSIONS.map((d) => [d, Number(r[`score_${d}`])])) as Record<ScreeningDimension, number>,
      role: r.candidate_role === "backup" ? "backup" : "primary",
    };
  });

  return {
    state: "ok",
    tripName: String(trip.name),
    tripStatus: String(trip.status),
    canResearch: (role === "owner" || role === "companion") && ["planning", "locked", "in_progress"].includes(String(trip.status)),
    latestJob: job ? { status: String(job.status), createdAt: String(job.created_at) } : null,
    candidates,
  };
}
