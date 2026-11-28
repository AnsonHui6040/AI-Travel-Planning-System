import "server-only";
import type { ComparisonRow, IncidentItem, IncidentScope, IncidentSnapshot, StoredMobilityEstimate, TransportOptions } from "@atps/core";
import { availabilitySlot, storedMobilityEstimate, tripBaselineData, uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { IncidentStoreError, type IncidentDeps } from "./incident-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";
import { loadBookingConstraints } from "./bookings";

// T38：Incident Mode 以使用者本人的 session 讀取（RLS）並呼叫 start_incident；批准經 /proposals 的 approve_proposal

const SCHEDULED_STATES = ["approved", "locked", "change_proposed", "modified"];
const OPEN_STATES = ["candidate", "pending_verification", "verified"];

function storeError(code: string | undefined): IncidentStoreError {
  if (code === "42501") return new IncidentStoreError("forbidden");
  if (code === "55000") return new IncidentStoreError("state");
  if (code === "22023" || code === "23514") return new IncidentStoreError("invalid");
  return new IncidentStoreError("unknown");
}

const hhmm = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 5));

export async function incidentDeps(): Promise<IncidentDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async loadContext(tripId, date) {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) return null;
      const { data: trip } = await session.from("trips").select("timezone, status").eq("id", tripId).maybeSingle();
      if (!trip) return null;
      const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
      const { data: stored } = await session.from("trip_baselines").select("data").eq("trip_id", tripId).eq("version", 1).maybeSingle();
      const baseline = stored ? tripBaselineData.safeParse(stored.data) : null;
      if (!baseline?.success) return null;
      const { data: rows } = await session
        .from("itinerary_items")
        .select(
          "id, name_zh, type, zone_id, scheduled_date, scheduled_start, scheduled_end, constraint_class, is_fixed, priority, weather_dependency, suggested_stay_minutes, availability, verification_status, standby, estimated_cost_amount, estimated_cost_currency, lifecycle_status, created_at",
        )
        .eq("trip_id", tripId)
        .in("lifecycle_status", [...SCHEDULED_STATES, ...OPEN_STATES])
        .order("created_at")
        .limit(600);
      const items: IncidentItem[] = (rows ?? [])
        .filter((r) => (SCHEDULED_STATES.includes(String(r.lifecycle_status)) ? r.scheduled_date !== null : r.scheduled_date === null))
        .map((r, order) => {
          const availability = availabilitySlot.array().safeParse(r.availability);
          return {
            id: String(r.id),
            name_zh: String(r.name_zh),
            type: r.type as IncidentItem["type"],
            zone_id: (r.zone_id as string | null) ?? null,
            scheduled_date: (r.scheduled_date as string | null) ?? null,
            scheduled_start: hhmm(r.scheduled_start),
            scheduled_end: hhmm(r.scheduled_end),
            hard: r.constraint_class === "hard_constraint" || r.is_fixed === true,
            priority: Number(r.priority),
            weather_dependency: r.weather_dependency as IncidentItem["weather_dependency"],
            suggested_stay_minutes: Number(r.suggested_stay_minutes),
            availability: availability.success ? availability.data : [],
            verification_status: r.verification_status as IncidentItem["verification_status"],
            standby: r.standby === true,
            cost:
              r.estimated_cost_amount !== null && r.estimated_cost_currency
                ? { amount: Number(r.estimated_cost_amount), currency: String(r.estimated_cost_currency) }
                : null,
            order,
          };
        });
      const { data: segmentRows } = await session.from("mobility_segments").select("from_item_id, to_item_id, estimates").eq("trip_id", tripId).limit(1000);
      const segments = new Map<string, StoredMobilityEstimate[]>();
      for (const s of segmentRows ?? []) {
        const estimates = storedMobilityEstimate.array().safeParse(s.estimates);
        if (estimates.success && estimates.data.length > 0) segments.set(`${String(s.from_item_id)}>${String(s.to_item_id)}`, estimates.data);
      }
      const { data: morning } = await session
        .from("morning_checks")
        .select("result")
        .eq("trip_id", tripId)
        .eq("date", date)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const checks = (morning?.result as { checks?: Array<{ check?: unknown; detail?: unknown }> } | null)?.checks ?? [];
      const weather = checks.find((c) => c.check === "weather")?.detail;
      return {
        canEdit: member?.role === "owner" || member?.role === "companion",
        tripStatus: String(trip.status),
        timezone: String(trip.timezone),
        baseline: baseline.data,
        items,
        segments,
        weather: typeof weather === "string" ? weather.slice(0, 200) : null,
        bookings: await loadBookingConstraints(session, tripId),
      };
    },
    async start(tripId, level, snapshot, availableMinutes, alternatives) {
      const { data, error } = await session.rpc("start_incident", {
        p_trip: tripId,
        p_level: level === "none" ? null : level,
        p_snapshot: snapshot,
        p_available_minutes: availableMinutes,
        p_alternatives: alternatives,
      });
      if (error) throw storeError(error.code);
      const id = uuid.safeParse((data as { incident_id?: unknown } | null)?.incident_id);
      if (!id.success) throw new IncidentStoreError("unknown");
      return { incidentId: id.data };
    },
    now: () => new Date(),
    logError: (message) => createLogger().error(message),
  };
}

// 畫面 -------------------------------------------------------------------

export interface IncidentAlternativeView {
  proposalId: string;
  tier: string;
  summary: string;
  status: string;
  versionKind: string;
  comparison: ComparisonRow;
  transport: TransportOptions | null;
}

export type IncidentView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripName: string;
      canEdit: boolean;
      level: string | null;
      createdAt: string;
      trigger: { type: string } | null;
      snapshot: IncidentSnapshot | null;
      scope: IncidentScope | null;
      warnings: string[];
      alternatives: IncidentAlternativeView[];
    };

export async function loadIncident(tripId: string, incidentId: string): Promise<IncidentView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(incidentId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const { data: incident } = await session
    .from("incidents")
    .select("level, snapshot, live_branch_id, created_at")
    .eq("id", incidentId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (!incident) return { state: "not_found" };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const { data: proposals } = await session
    .from("proposals")
    .select("id, status, change")
    .eq("trip_id", tripId)
    .eq("live_branch_id", String(incident.live_branch_id))
    .limit(3);
  // snapshot 由 start_incident 依 core 的型別寫入；畫面只讀取已知欄位
  const stored = (incident.snapshot ?? {}) as {
    trigger?: { type: string };
    snapshot?: IncidentSnapshot;
    scope?: IncidentScope;
    warnings?: string[];
    alternatives?: Array<{ proposalId: string; tier: string; comparison: ComparisonRow; transport: TransportOptions | null }>;
  };
  const byId = new Map((proposals ?? []).map((p) => [String(p.id), p]));
  const alternatives = (stored.alternatives ?? []).flatMap((a) => {
    const p = byId.get(a.proposalId);
    if (!p) return [];
    const change = p.change as { summary?: string; versionKind?: string };
    return [{ ...a, summary: String(change.summary ?? ""), versionKind: String(change.versionKind ?? ""), status: String(p.status) }];
  });
  return {
    state: "ok",
    tripName: String(trip.name),
    canEdit: member?.role === "owner" || member?.role === "companion",
    level: (incident.level as string | null) ?? null,
    createdAt: String(incident.created_at),
    trigger: stored.trigger ?? null,
    snapshot: stored.snapshot ?? null,
    scope: stored.scope ?? null,
    warnings: Array.isArray(stored.warnings) ? stored.warnings.map(String) : [],
    alternatives,
  };
}

// 進入畫面：當天排入的項目（選擇受影響項目）與最近的 Incident
export async function loadIncidentEntry(tripId: string, requestedDate: string | undefined) {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" as const };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" as const };
  const { data: trip } = await session.from("trips").select("name, timezone, status").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" as const };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: String(trip.timezone), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  const { data: rows } = await session
    .from("itinerary_items")
    .select("id, name_zh, scheduled_start, scheduled_end, constraint_class, is_fixed")
    .eq("trip_id", tripId)
    .eq("scheduled_date", date)
    .in("lifecycle_status", SCHEDULED_STATES)
    .order("scheduled_start")
    .limit(100);
  const { data: recent } = await session.from("incidents").select("id, level, created_at").eq("trip_id", tripId).order("created_at", { ascending: false }).limit(5);
  return {
    state: "ok" as const,
    tripName: String(trip.name),
    tripStatus: String(trip.status),
    timezone: String(trip.timezone),
    canEdit: member?.role === "owner" || member?.role === "companion",
    date,
    items: (rows ?? [])
      .filter((r) => r.constraint_class !== "hard_constraint" && r.is_fixed !== true)
      .map((r) => ({ id: String(r.id), name: String(r.name_zh), start: hhmm(r.scheduled_start) ?? "", end: hhmm(r.scheduled_end) ?? "" })),
    recent: (recent ?? []).map((r) => ({ id: String(r.id), level: (r.level as string | null) ?? null, createdAt: String(r.created_at) })),
  };
}
