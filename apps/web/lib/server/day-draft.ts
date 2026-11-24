import "server-only";
import {
  DEFAULT_TRAVEL_MINUTES,
  categorizeForSchedule,
  dayApprovalEntries,
  isDayBlocked,
  planFeasibleDays,
  type DayDraft,
  type DraftEntry,
  type FeasibilityIssue,
  type FeasibilityItem,
  type ReturnedItem,
  type SegmentInfo,
} from "@atps/core";
import { availabilitySlot, segmentPlans, storedMobilityEstimate, tripBaselineData, uuid, type TripBaselineData } from "@atps/schemas";
import { photoDisplay, type PhotoView } from "../photo-display";
import type { DayPlan } from "./day-approval-core";
import { createSupabaseServerClient } from "./supabase";

// T29、T30：每日時段草案與可行性驗證的畫面資料。以使用者 session（RLS）讀取。
// 已批准的日期顯示資料庫中的時段；其餘日期由 core 的 planFeasibleDays 計算（不寫入），
// 未通過可行性驗證的項目回到地理分區、留在 Candidate List。

export interface CardItem {
  id: string;
  nameZh: string;
  stayMinutes: number;
  verificationStatus: FeasibilityItem["verification_status"];
  atRisk: boolean;
  photo: PhotoView;
}

export interface TravelInfo {
  minutes: number;
  mode: string | null;
  estimated: boolean;
}

export type DayStatus = DayPlan["days"][number]["status"];

export interface DayView extends DayDraft {
  status: DayStatus;
  issues: FeasibilityIssue[];
  returned: ReturnedItem[];
}

export type DayDraftView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | { state: "no_baseline"; tripName: string }
  | {
      state: "ok";
      tripName: string;
      tripStatus: string;
      // Owner、Companion
      canEdit: boolean;
      // T31：只有 Owner 可開關旅前自動再核實
      isOwner: boolean;
      reverifyEnabled: boolean;
      canApprove: boolean;
      baseVersion: number;
      days: DayView[];
      items: Record<string, CardItem>;
      travel: Record<string, TravelInfo>;
    };

const OPEN_STATES = new Set(["candidate", "pending_verification", "verified"]);
const SCHEDULED_STATES = ["approved", "locked", "change_proposed", "modified"];
const DAY_STATUSES = new Set<DayStatus>(["draft", "approved", "day_ready", "in_progress", "completed"]);

const hhmm = (t: unknown) => String(t ?? "").slice(0, 5);

// 已批准日期的時段：基線的固定活動與資料庫中排入的項目
function storedDay(date: string, baseline: TripBaselineData, items: FeasibilityItem[], rows: ReadonlyArray<Record<string, unknown>>): DayDraft {
  const fixed: DraftEntry[] = baseline.fixed_activities
    .filter((a) => a.date === date)
    .map((a) => ({ kind: "fixed", name: a.name, start: a.start, end: a.end ?? a.start }));
  const placed: DraftEntry[] = rows
    .filter((r) => r.scheduled_date === date && SCHEDULED_STATES.includes(String(r.lifecycle_status)))
    .flatMap((r) => {
      const item = items.find((i) => i.id === String(r.id));
      if (!item) return [];
      const category = categorizeForSchedule(item);
      return [
        {
          kind: "item" as const,
          item_id: item.id,
          category: category === "backup" ? "flexible" : category,
          start: hhmm(r.scheduled_start),
          end: hhmm(r.scheduled_end),
          travel_minutes_before: 0,
          movable_from: hhmm(r.movable_from),
          movable_to: hhmm(r.movable_to),
        },
      ];
    });
  return { date, zone_ids: [], entries: [...fixed, ...placed].sort((a, b) => a.start.localeCompare(b.start)), backups: [], unplaced: [] };
}

export async function loadDayDraft(tripId: string): Promise<DayDraftView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name, status, current_version, reverify_enabled").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const tripName = String(trip.name);

  const { data: stored } = await session.from("trip_baselines").select("data, confirmed_at").eq("trip_id", tripId).eq("version", 1).maybeSingle();
  const baseline = stored?.confirmed_at ? tripBaselineData.safeParse(stored.data) : null;
  if (!baseline?.success) return { state: "no_baseline", tripName };

  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const role = (member?.role as string | undefined) ?? null;

  const { data: rows, error } = await session
    .from("itinerary_items")
    .select(
      "id, name_zh, name_local, address, type, suggested_stay_minutes, priority, candidate_role, verification_status, zone_id, score_time_slot_dependency, at_risk, availability, reservation_requirement, weather_dependency, lifecycle_status, scheduled_date, scheduled_start, scheduled_end, movable_from, movable_to",
    )
    .eq("trip_id", tripId)
    .in("lifecycle_status", [...OPEN_STATES, ...SCHEDULED_STATES])
    .limit(500);
  if (error) throw new Error("讀取候選失敗");
  const { data: dayRows } = await session.from("days").select("date, status").eq("trip_id", tripId).limit(400);
  const { data: segmentRows } = await session.from("mobility_segments").select("from_item_id, to_item_id, estimates, plans").eq("trip_id", tripId).limit(500);
  const { data: photoRows } = await session.from("photos").select("item_id, source, license, author, source_url, storage_path").eq("trip_id", tripId).limit(500);

  const segments = new Map<string, SegmentInfo & { mode: string }>();
  for (const s of segmentRows ?? []) {
    const estimates = storedMobilityEstimate.array().safeParse(s.estimates);
    const plans = segmentPlans.nullable().safeParse(s.plans);
    if (!estimates.success) continue;
    const mode = plans.success && plans.data ? plans.data.recommended : estimates.data[0]?.mode;
    const chosen = estimates.data.find((e) => e.mode === mode);
    if (chosen) {
      segments.set(`${String(s.from_item_id)}>${String(s.to_item_id)}`, {
        minutes: chosen.total_minutes,
        walk_minutes: chosen.walk_minutes,
        luggage: chosen.luggage_friendliness,
        mode: chosen.mode,
      });
    }
  }
  const segmentOf = (from: string, to: string) => segments.get(`${from}>${to}`) ?? segments.get(`${to}>${from}`) ?? null;

  const rowList = (rows ?? []) as Array<Record<string, unknown>>;
  const items: FeasibilityItem[] = rowList.map((r) => {
    const availability = availabilitySlot.array().safeParse(r.availability);
    return {
      id: String(r.id),
      name_zh: String(r.name_zh),
      type: r.type as FeasibilityItem["type"],
      suggested_stay_minutes: Number(r.suggested_stay_minutes),
      priority: Number(r.priority),
      candidate_role: r.candidate_role === "backup" ? "backup" : "primary",
      verification_status: r.verification_status as FeasibilityItem["verification_status"],
      zone_id: (r.zone_id as string | null) ?? null,
      score_time_slot_dependency: Number(r.score_time_slot_dependency),
      availability: availability.success ? availability.data : [],
      reservation_requirement: r.reservation_requirement as FeasibilityItem["reservation_requirement"],
      weather_dependency: r.weather_dependency as FeasibilityItem["weather_dependency"],
    };
  });

  const statusOf = new Map<string, DayStatus>();
  for (const d of dayRows ?? []) {
    const status = d.status as DayStatus;
    if (DAY_STATUSES.has(status)) statusOf.set(String(d.date), status);
  }
  const allDates: string[] = [];
  for (let d = new Date(`${baseline.data.start_date}T00:00:00Z`); d <= new Date(`${baseline.data.end_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    allDates.push(d.toISOString().slice(0, 10));
  }
  const draftDates = allDates.filter((d) => (statusOf.get(d) ?? "draft") === "draft");
  const openItems = items.filter((i) => OPEN_STATES.has(String(rowList.find((r) => String(r.id) === i.id)?.lifecycle_status)));
  const plan =
    draftDates.length > 0
      ? planFeasibleDays({ baseline: baseline.data, items: openItems, segment: segmentOf, dates: draftDates })
      : { days: [], issues: [], returned: [] };

  const days: DayView[] = allDates.map((date) => {
    const status = statusOf.get(date) ?? "draft";
    const drafted = plan.days.find((d) => d.date === date);
    if (status === "draft" && drafted) {
      return {
        ...drafted,
        status,
        issues: plan.issues.filter((i) => i.date === date),
        returned: plan.returned.filter((r) => r.date === date),
      };
    }
    return { ...storedDay(date, baseline.data, items, rowList), status, issues: [], returned: [] };
  });

  const cards: Record<string, CardItem> = {};
  for (const r of rowList) {
    const id = String(r.id);
    const photos = (photoRows ?? [])
      .filter((p) => String(p.item_id) === id)
      .map((p) => ({
        url: `/api/photos/${String(p.storage_path)}`,
        source: p.source as "user_upload" | "wikimedia_commons",
        license: String(p.license),
        author: String(p.author),
        source_url: (p.source_url as string | null) ?? null,
      }));
    cards[id] = {
      id,
      nameZh: String(r.name_zh),
      stayMinutes: Number(r.suggested_stay_minutes),
      verificationStatus: r.verification_status as FeasibilityItem["verification_status"],
      atRisk: r.at_risk === true,
      photo: photoDisplay(
        { name_zh: String(r.name_zh), name_local: (r.name_local as string | null) ?? null, address: (r.address as string | null) ?? null },
        photos,
      ),
    };
  }

  // 相鄰兩個項目之間的交通（下一站用）
  const travel: Record<string, TravelInfo> = {};
  for (const day of days) {
    const placed = day.entries.flatMap((e) => (e.kind === "item" ? [e.item_id] : []));
    placed.slice(0, -1).forEach((from, k) => {
      const to = placed[k + 1] ?? "";
      const seg = segmentOf(from, to);
      travel[`${from}>${to}`] = seg ? { minutes: seg.minutes, mode: seg.mode, estimated: true } : { minutes: DEFAULT_TRAVEL_MINUTES, mode: null, estimated: false };
    });
  }
  return {
    state: "ok",
    tripName,
    tripStatus: String(trip.status),
    canEdit: role === "owner" || role === "companion",
    isOwner: role === "owner",
    reverifyEnabled: trip.reverify_enabled === true,
    canApprove: (role === "owner" || role === "companion") && trip.status === "planning",
    baseVersion: Number(trip.current_version),
    days,
    items: cards,
    travel,
  };
}

// T30：Server Action 用的批准資料（與畫面同一份計算）
export async function loadDayPlan(tripId: string): Promise<DayPlan | null> {
  const view = await loadDayDraft(tripId);
  if (view.state !== "ok") return null;
  return {
    baseVersion: view.baseVersion,
    days: view.days.map((d) => ({
      date: d.date,
      status: d.status,
      entries: d.status === "draft" ? dayApprovalEntries(d) : [],
      blocked: isDayBlocked(d.issues, d.date),
    })),
  };
}
