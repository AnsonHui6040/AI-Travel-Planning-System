import "server-only";
import { buildDayPack, type DayPack } from "@atps/offline";
import { segmentPlans, storedMobilityEstimate, tripBaselineData, uuid } from "@atps/schemas";
import { createSupabaseServerClient } from "./supabase";

// T35：當日包的伺服器資料。以使用者 session（RLS）讀取已排入當天的項目、固定活動、交通估算、Backup 與照片，
// 由 @atps/offline 的 buildDayPack 計算最遲離開時間；瀏覽器把結果存入 IndexedDB 供離線閱讀

const SCHEDULED_STATES = ["approved", "locked", "change_proposed", "modified"];

export type TodayView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripName: string;
      canEdit: boolean;
      dates: string[];
      pack: DayPack | null;
      // T36
      dayStatus: string | null;
      morning: { checks: Array<{ check: string; status: string; detail: string }>; createdAt: string } | null;
    };

function localToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function loadToday(tripId: string, requestedDate: string | undefined): Promise<TodayView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name, timezone, current_version").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const canEdit = member?.role === "owner" || member?.role === "companion";
  const timezone = String(trip.timezone);

  const { data: rows } = await session
    .from("itinerary_items")
    .select("id, name_zh, name_local, address, scheduled_date, scheduled_start, scheduled_end, at_risk, verification_status")
    .eq("trip_id", tripId)
    .in("lifecycle_status", SCHEDULED_STATES)
    .not("scheduled_date", "is", null)
    .limit(500);
  const dates = [...new Set((rows ?? []).map((r) => String(r.scheduled_date)))].sort();
  const today = localToday(timezone);
  const date = requestedDate && dates.includes(requestedDate) ? requestedDate : dates.includes(today) ? today : dates[0];
  if (!date) return { state: "ok", tripName: String(trip.name), canEdit, dates, pack: null, dayStatus: null, morning: null };

  const dayRows = (rows ?? []).filter((r) => r.scheduled_date === date && r.scheduled_start && r.scheduled_end);
  const ids = dayRows.map((r) => String(r.id));
  const { data: baseline } = await session.from("trip_baselines").select("data").eq("trip_id", tripId).eq("version", 1).maybeSingle();
  const parsedBaseline = baseline ? tripBaselineData.safeParse(baseline.data) : null;
  const fixed = parsedBaseline?.success
    ? parsedBaseline.data.fixed_activities.filter((a) => a.date === date).map((a) => ({ name: a.name, start: a.start, end: a.end ?? a.start }))
    : [];
  const { data: segmentRows } = ids.length > 0 ? await session.from("mobility_segments").select("from_item_id, to_item_id, estimates, plans").eq("trip_id", tripId).in("from_item_id", ids) : { data: [] };
  const segments = new Map<string, number>();
  for (const s of segmentRows ?? []) {
    const estimates = storedMobilityEstimate.array().safeParse(s.estimates);
    const plans = segmentPlans.nullable().safeParse(s.plans);
    if (!estimates.success) continue;
    const mode = plans.success && plans.data ? plans.data.recommended : estimates.data[0]?.mode;
    const chosen = estimates.data.find((e) => e.mode === mode);
    if (chosen) segments.set(`${String(s.from_item_id)}>${String(s.to_item_id)}`, chosen.total_minutes);
  }
  // Backup 與 Morning Check 提升的 Standby（尚未排入的已核實候選）
  const { data: backups } = await session
    .from("itinerary_items")
    .select("id, name_zh, standby")
    .eq("trip_id", tripId)
    .is("scheduled_date", null)
    .or("candidate_role.eq.backup,standby.eq.true")
    .in("verification_status", ["verified", "partially_verified"])
    .limit(20);
  const { data: photos } = ids.length > 0 ? await session.from("photos").select("item_id, storage_path, author").eq("trip_id", tripId).in("item_id", ids).limit(50) : { data: [] };

  const pack = buildDayPack({
    tripId,
    date,
    timezone,
    baseVersion: Number(trip.current_version),
    generatedAt: new Date().toISOString(),
    items: dayRows.map((r) => ({
      id: String(r.id),
      name_zh: String(r.name_zh),
      name_local: (r.name_local as string | null) ?? null,
      address: (r.address as string | null) ?? null,
      scheduled_start: String(r.scheduled_start).slice(0, 5),
      scheduled_end: String(r.scheduled_end).slice(0, 5),
      at_risk: r.at_risk === true,
      verification_status: String(r.verification_status),
    })),
    fixed,
    travelMinutes: (from, to) => segments.get(`${from}>${to}`) ?? null,
    backups: (backups ?? []).map((b) => ({ id: String(b.id), name_zh: String(b.name_zh), standby: b.standby === true })),
    photos: (photos ?? []).map((p) => ({ item_id: String(p.item_id), url: `/api/photos/${String(p.storage_path)}`, credit: String(p.author) })),
  });
  const { data: day } = await session.from("days").select("status").eq("trip_id", tripId).eq("date", date).maybeSingle();
  const { data: check } = await session
    .from("morning_checks")
    .select("result, created_at")
    .eq("trip_id", tripId)
    .eq("date", date)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const checks = (check?.result as { checks?: unknown } | undefined)?.checks;
  const morning = Array.isArray(checks)
    ? {
        checks: checks
          .filter((c): c is { check: string; status: string; detail: string } => typeof c === "object" && c !== null && "check" in c)
          .map((c) => ({ check: String(c.check), status: String(c.status), detail: String(c.detail) })),
        createdAt: String(check?.created_at),
      }
    : null;
  return { state: "ok", tripName: String(trip.name), canEdit, dates, pack, dayStatus: (day?.status as string | undefined) ?? null, morning };
}
