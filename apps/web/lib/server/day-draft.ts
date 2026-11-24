import "server-only";
import { DEFAULT_TRAVEL_MINUTES, draftDays, type DayDraft, type DraftItem } from "@atps/core";
import { segmentPlans, storedMobilityEstimate, tripBaselineData, uuid } from "@atps/schemas";
import { photoDisplay, type PhotoView } from "../photo-display";
import { createSupabaseServerClient } from "./supabase";

// T29：每日時段草案的畫面資料。以使用者 session（RLS）讀取，草案由 core 的 draftDays 計算，不寫入行程。

export interface CardItem {
  id: string;
  nameZh: string;
  stayMinutes: number;
  verificationStatus: DraftItem["verification_status"];
  atRisk: boolean;
  photo: PhotoView;
}

export interface TravelInfo {
  minutes: number;
  mode: string | null;
  estimated: boolean;
}

export type DayDraftView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | { state: "no_baseline"; tripName: string }
  | {
      state: "ok";
      tripName: string;
      days: DayDraft[];
      items: Record<string, CardItem>;
      travel: Record<string, TravelInfo>;
    };

const OPEN_STATES = ["candidate", "pending_verification", "verified"];

export async function loadDayDraft(tripId: string): Promise<DayDraftView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const tripName = String(trip.name);

  const { data: stored } = await session.from("trip_baselines").select("data, confirmed_at").eq("trip_id", tripId).eq("version", 1).maybeSingle();
  const baseline = stored?.confirmed_at ? tripBaselineData.safeParse(stored.data) : null;
  if (!baseline?.success) return { state: "no_baseline", tripName };

  const { data: rows, error } = await session
    .from("itinerary_items")
    .select("id, name_zh, name_local, address, type, suggested_stay_minutes, priority, candidate_role, verification_status, zone_id, score_time_slot_dependency, at_risk")
    .eq("trip_id", tripId)
    .in("lifecycle_status", OPEN_STATES)
    .limit(500);
  if (error) throw new Error("讀取候選失敗");
  const { data: segmentRows } = await session.from("mobility_segments").select("from_item_id, to_item_id, estimates, plans").eq("trip_id", tripId).limit(500);
  const { data: photoRows } = await session.from("photos").select("item_id, source, license, author, source_url, storage_path").eq("trip_id", tripId).limit(500);

  const segments = new Map<string, { minutes: number; mode: string }>();
  for (const s of segmentRows ?? []) {
    const estimates = storedMobilityEstimate.array().safeParse(s.estimates);
    const plans = segmentPlans.nullable().safeParse(s.plans);
    if (!estimates.success) continue;
    const mode = plans.success && plans.data ? plans.data.recommended : estimates.data[0]?.mode;
    const chosen = estimates.data.find((e) => e.mode === mode);
    if (chosen) segments.set(`${String(s.from_item_id)}>${String(s.to_item_id)}`, { minutes: chosen.total_minutes, mode: chosen.mode });
  }

  const items: DraftItem[] = (rows ?? []).map((r) => ({
    id: String(r.id),
    name_zh: String(r.name_zh),
    type: r.type as DraftItem["type"],
    suggested_stay_minutes: Number(r.suggested_stay_minutes),
    priority: Number(r.priority),
    candidate_role: r.candidate_role === "backup" ? "backup" : "primary",
    verification_status: r.verification_status as DraftItem["verification_status"],
    zone_id: (r.zone_id as string | null) ?? null,
    score_time_slot_dependency: Number(r.score_time_slot_dependency),
  }));
  const travelMinutes = (from: string, to: string) => segments.get(`${from}>${to}`)?.minutes ?? segments.get(`${to}>${from}`)?.minutes ?? null;
  const days = draftDays({ baseline: baseline.data, items, travelMinutes });

  const cards: Record<string, CardItem> = {};
  for (const r of rows ?? []) {
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
      verificationStatus: r.verification_status as DraftItem["verification_status"],
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
      const seg = segments.get(`${from}>${to}`) ?? segments.get(`${to}>${from}`);
      travel[`${from}>${to}`] = seg ? { minutes: seg.minutes, mode: seg.mode, estimated: true } : { minutes: DEFAULT_TRAVEL_MINUTES, mode: null, estimated: false };
    });
  }
  return { state: "ok", tripName, days, items: cards, travel };
}
