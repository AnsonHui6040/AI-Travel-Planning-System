import "server-only";
import {
  allowedPostTripStatuses,
  postTripReport,
  type ActualTimeline,
  type PostTripItem,
  type PostTripReport,
  type PostTripStatus,
} from "@atps/core";
import { modelRef, segmentPlans, storedMobilityEstimate, uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { PostTripStoreError, type PostTripContext, type PostTripDeps } from "./post-trip-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T40：旅後狀態與 MEM-04 比較報告。以使用者本人的 session 讀取（RLS），標記經 set_post_trip_status

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface MarkableItem extends PostTripItem {
  visited: boolean;
  date: string | null;
  start: string | null;
}

function storeError(code: string | undefined): PostTripStoreError {
  if (code === "42501") return new PostTripStoreError("forbidden");
  if (code === "55000") return new PostTripStoreError("state");
  if (code === "22023") return new PostTripStoreError("invalid");
  return new PostTripStoreError("unknown");
}

async function readTrip(session: Session, tripId: string) {
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return null;
  const { data: trip } = await session.from("trips").select("name, status").eq("id", tripId).maybeSingle();
  if (!trip) return null;
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  // 最後一筆紀錄決定是否去過（與 T39、資料庫相同）
  const { data: entries } = await session
    .from("actual_timeline_entries")
    .select("item_id, completion, created_at")
    .eq("trip_id", tripId)
    .order("created_at")
    .limit(2000);
  const latest = new Map<string, string>();
  for (const e of entries ?? []) latest.set(String(e.item_id), String(e.completion));
  const { data: rows } = await session
    .from("itinerary_items")
    .select("id, name_zh, type, scheduled_date, scheduled_start, post_trip_status, generated_by, candidate_role, standby")
    .eq("trip_id", tripId)
    .limit(1000);
  const items: MarkableItem[] = (rows ?? [])
    .filter((r) => r.scheduled_date !== null || latest.has(String(r.id)))
    .map((r) => {
      const generated = modelRef.safeParse(r.generated_by);
      return {
        id: String(r.id),
        name_zh: String(r.name_zh),
        type: String(r.type),
        post_trip_status: (r.post_trip_status as PostTripStatus | null) ?? null,
        generated_by: generated.success ? { provider: generated.data.provider, model: generated.data.model } : null,
        backup: r.candidate_role === "backup" || r.standby === true,
        visited: latest.get(String(r.id)) === "completed",
        date: (r.scheduled_date as string | null) ?? null,
        start: r.scheduled_start ? String(r.scheduled_start).slice(0, 5) : null,
      };
    })
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.start ?? "99").localeCompare(b.start ?? "99") || a.name_zh.localeCompare(b.name_zh));
  return {
    name: String(trip.name),
    status: String(trip.status),
    canEdit: member?.role === "owner" || member?.role === "companion",
    items,
  };
}

export async function postTripDeps(): Promise<PostTripDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async loadContext(tripId): Promise<PostTripContext | null> {
      const trip = await readTrip(session, tripId);
      if (!trip) return null;
      return { canEdit: trip.canEdit, tripStatus: trip.status, items: trip.items.map((i) => ({ id: i.id, visited: i.visited })) };
    },
    async setStatus(tripId, itemId, status) {
      const { data, error } = await session.rpc("set_post_trip_status", { p_trip: tripId, p_item: itemId, p_status: status });
      if (error) throw storeError(error.code);
      const result = data as { trip_status?: unknown; remaining?: unknown } | null;
      return { tripStatus: String(result?.trip_status ?? ""), remaining: Number(result?.remaining ?? 0) };
    },
    logError: (message) => createLogger().error(message),
  };
}

export type PostTripView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripName: string;
      tripStatus: string;
      canEdit: boolean;
      items: Array<MarkableItem & { allowed: PostTripStatus[] }>;
      report: PostTripReport;
      daysWithTimeline: number;
    };

function isTimeline(value: unknown): value is ActualTimeline {
  return typeof value === "object" && value !== null && Array.isArray((value as { rows?: unknown }).rows) && typeof (value as { date?: unknown }).date === "string";
}

export async function loadPostTrip(tripId: string): Promise<PostTripView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const trip = await readTrip(session, tripId);
  if (!trip) return { state: "not_found" };
  const { data: days } = await session.from("days").select("actual_timeline").eq("trip_id", tripId).eq("status", "completed").limit(60);
  const timelines = (days ?? []).map((d) => d.actual_timeline).filter(isTimeline);
  const { data: segmentRows } = await session.from("mobility_segments").select("from_item_id, to_item_id, estimates, plans").eq("trip_id", tripId).limit(500);
  const segments: Array<{ from: string; to: string; minutes: number }> = [];
  for (const s of segmentRows ?? []) {
    const estimates = storedMobilityEstimate.array().safeParse(s.estimates);
    const plans = segmentPlans.nullable().safeParse(s.plans);
    if (!estimates.success) continue;
    const mode = plans.success && plans.data ? plans.data.recommended : estimates.data[0]?.mode;
    const chosen = estimates.data.find((e) => e.mode === mode);
    if (chosen) segments.push({ from: String(s.from_item_id), to: String(s.to_item_id), minutes: chosen.total_minutes });
  }
  const report = postTripReport({ days: timelines, items: trip.items, segments });
  return {
    state: "ok",
    tripName: trip.name,
    tripStatus: trip.status,
    canEdit: trip.canEdit,
    items: trip.items.map((i) => ({ ...i, allowed: allowedPostTripStatuses(i.visited) })),
    report,
    daysWithTimeline: timelines.length,
  };
}
