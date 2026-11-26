import "server-only";
import { actualTimeline, type ActualTimeline, type TimelineEntry, type TimelinePlanned } from "@atps/core";
import { uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { TimelineStoreError, type TimelineContext, type TimelineDeps } from "./timeline-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T39：Actual Timeline 以使用者本人的 session 讀取（RLS）與寫入；產生經 produce_actual_timeline

const SCHEDULED_STATES = ["approved", "locked", "change_proposed", "modified", "completed"];

function storeError(code: string | undefined): TimelineStoreError {
  if (code === "42501") return new TimelineStoreError("forbidden");
  if (code === "55000") return new TimelineStoreError("state");
  if (code === "22023" || code === "23514") return new TimelineStoreError("invalid");
  return new TimelineStoreError("unknown");
}

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function readContext(session: Session, tripId: string, date: string): Promise<(TimelineContext & { tripName: string; dates: string[]; stored: unknown }) | null> {
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return null;
  const { data: trip } = await session.from("trips").select("name, timezone").eq("id", tripId).maybeSingle();
  if (!trip) return null;
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const { data: days } = await session.from("days").select("date, status, actual_timeline").eq("trip_id", tripId).neq("status", "draft").order("date").limit(60);
  const day = (days ?? []).find((d) => d.date === date);
  const { data: rows } = await session
    .from("itinerary_items")
    .select("id, name_zh, scheduled_start, scheduled_end")
    .eq("trip_id", tripId)
    .eq("scheduled_date", date)
    .in("lifecycle_status", SCHEDULED_STATES)
    .order("scheduled_start")
    .limit(100);
  const planned: TimelinePlanned[] = (rows ?? []).map((r) => ({
    id: String(r.id),
    name_zh: String(r.name_zh),
    scheduled_start: r.scheduled_start ? String(r.scheduled_start).slice(0, 5) : null,
    scheduled_end: r.scheduled_end ? String(r.scheduled_end).slice(0, 5) : null,
  }));
  const { data: entryRows } = await session
    .from("actual_timeline_entries")
    .select("item_id, arrived_at, departed_at, completion, recorded_by, created_at")
    .eq("trip_id", tripId)
    .order("created_at")
    .limit(2000);
  const entries: TimelineEntry[] = (entryRows ?? []).map((e) => ({
    item_id: String(e.item_id),
    arrived_at: (e.arrived_at as string | null) ?? null,
    departed_at: (e.departed_at as string | null) ?? null,
    completion: e.completion as TimelineEntry["completion"],
    recorded_by: String(e.recorded_by),
    created_at: String(e.created_at),
  }));
  // 計畫外：有紀錄但沒有排在這天的項目，以及可現場改去的 Backup 與 Standby
  const plannedIds = new Set(planned.map((p) => p.id));
  const recordedIds = [...new Set(entries.map((e) => e.item_id))].filter((id) => !plannedIds.has(id)).slice(0, 100);
  const { data: recorded } = recordedIds.length > 0 ? await session.from("itinerary_items").select("id, name_zh").eq("trip_id", tripId).in("id", recordedIds) : { data: [] };
  const { data: backups } = await session
    .from("itinerary_items")
    .select("id, name_zh")
    .eq("trip_id", tripId)
    .is("scheduled_date", null)
    .or("candidate_role.eq.backup,standby.eq.true")
    .in("verification_status", ["verified", "partially_verified"])
    .limit(20);
  const unplanned = new Map<string, string>();
  for (const r of [...(recorded ?? []), ...(backups ?? [])]) unplanned.set(String(r.id), String(r.name_zh));
  return {
    tripName: String(trip.name),
    dates: (days ?? []).map((d) => String(d.date)),
    stored: day?.actual_timeline ?? null,
    canEdit: member?.role === "owner" || member?.role === "companion",
    dayStatus: (day?.status as string | undefined) ?? null,
    timezone: String(trip.timezone),
    planned,
    unplanned: [...unplanned].map(([id, name_zh]) => ({ id, name_zh })),
    entries,
  };
}

export async function timelineDeps(): Promise<TimelineDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    loadContext: (tripId, date) => readContext(session, tripId, date),
    async record(entry) {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) throw new TimelineStoreError("forbidden");
      const { error } = await session.from("actual_timeline_entries").insert({
        trip_id: entry.tripId,
        item_id: entry.itemId,
        arrived_at: entry.arrivedAt,
        departed_at: entry.departedAt,
        completion: entry.completion,
        recorded_by: auth.user.id,
      });
      if (error) throw storeError(error.code);
    },
    async produce(tripId, date, timeline) {
      const { data, error } = await session.rpc("produce_actual_timeline", { p_trip: tripId, p_date: date, p_timeline: timeline });
      if (error) throw storeError(error.code);
      return { tripStatus: String((data as { trip_status?: unknown } | null)?.trip_status ?? "") };
    },
    logError: (message) => createLogger().error(message),
  };
}

export type TimelineView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripName: string;
      date: string | null;
      dates: string[];
      canEdit: boolean;
      dayStatus: string | null;
      // 已產生時為保存的 Planned vs Actual，否則為目前紀錄的預覽
      timeline: ActualTimeline | null;
      produced: boolean;
      unplanned: Array<{ id: string; name_zh: string }>;
    };

function isTimeline(value: unknown): value is ActualTimeline {
  return typeof value === "object" && value !== null && Array.isArray((value as { rows?: unknown }).rows) && typeof (value as { summary?: unknown }).summary === "object";
}

export async function loadTimeline(tripId: string, requestedDate: string | undefined): Promise<TimelineView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: days } = await session.from("days").select("date").eq("trip_id", tripId).neq("status", "draft").order("date").limit(60);
  const all = (days ?? []).map((d) => String(d.date));
  const { data: trip } = await session.from("trips").select("timezone").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: String(trip.timezone), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = requestedDate && all.includes(requestedDate) ? requestedDate : all.includes(today) ? today : (all[0] ?? null);
  if (!date) return { state: "ok", tripName: "", date: null, dates: [], canEdit: false, dayStatus: null, timeline: null, produced: false, unplanned: [] };
  const ctx = await readContext(session, tripId, date);
  if (!ctx) return { state: "not_found" };
  const produced = ctx.dayStatus === "completed" && isTimeline(ctx.stored);
  const timeline = produced
    ? (ctx.stored as ActualTimeline)
    : actualTimeline({ date, timezone: ctx.timezone, planned: ctx.planned, unplanned: ctx.unplanned, entries: ctx.entries });
  return { state: "ok", tripName: ctx.tripName, date, dates: ctx.dates, canEdit: ctx.canEdit, dayStatus: ctx.dayStatus, timeline, produced, unplanned: ctx.unplanned };
}
