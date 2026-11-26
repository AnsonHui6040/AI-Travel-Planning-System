import "server-only";
import type { MorningCandidate, MorningItem } from "@atps/core";
import { createOpenMeteoClient } from "@atps/data-sources";
import { availabilitySlot, tripBaselineData } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { MorningCheckStoreError, type MorningCheckDeps } from "./morning-check-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T36：Morning Check 以使用者本人的 session 讀取（RLS）並呼叫 complete_morning_check；
// 天氣以 Open-Meteo 取得（不需 key，座標只送小數第二位，結果不保存）

const SCHEDULED_STATES = ["approved", "locked", "change_proposed", "modified"];
const OPEN_STATES = ["candidate", "pending_verification", "verified"];
const COORD_DAYS = 30;

function storeError(code: string | undefined): MorningCheckStoreError {
  if (code === "42501") return new MorningCheckStoreError("forbidden");
  if (code === "55000") return new MorningCheckStoreError("state");
  if (code === "22023") return new MorningCheckStoreError("invalid");
  return new MorningCheckStoreError("unknown");
}

export async function morningCheckDeps(): Promise<MorningCheckDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const weather = createOpenMeteoClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async loadContext(tripId, date) {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) return null;
      const { data: trip } = await session.from("trips").select("timezone").eq("id", tripId).maybeSingle();
      if (!trip) return null;
      const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
      const { data: day } = await session.from("days").select("status").eq("trip_id", tripId).eq("date", date).maybeSingle();
      const { data: stored } = await session.from("trip_baselines").select("data").eq("trip_id", tripId).eq("version", 1).maybeSingle();
      const baseline = stored ? tripBaselineData.safeParse(stored.data) : null;
      if (!baseline?.success) return null;
      const { data: rows } = await session
        .from("itinerary_items")
        .select("id, name_zh, type, zone_id, weather_dependency, scheduled_start, scheduled_end, reservation_requirement, availability, at_risk, coord_lat, coord_lng, coord_fetched_at")
        .eq("trip_id", tripId)
        .eq("scheduled_date", date)
        .in("lifecycle_status", SCHEDULED_STATES)
        .order("scheduled_start")
        .limit(100);
      const { data: open } = await session
        .from("itinerary_items")
        .select("id, name_zh, zone_id, weather_dependency, verification_status, standby")
        .eq("trip_id", tripId)
        .is("scheduled_date", null)
        .in("lifecycle_status", OPEN_STATES)
        .limit(300);
      const fresh = Date.now() - COORD_DAYS * 24 * 60 * 60 * 1000;
      const located = (rows ?? []).find(
        (r) => typeof r.coord_lat === "number" && typeof r.coord_lng === "number" && r.coord_fetched_at && Date.parse(String(r.coord_fetched_at)) >= fresh,
      );
      const items: MorningItem[] = (rows ?? []).map((r) => {
        const availability = availabilitySlot.array().safeParse(r.availability);
        return {
          id: String(r.id),
          name_zh: String(r.name_zh),
          type: r.type as MorningItem["type"],
          zone_id: (r.zone_id as string | null) ?? null,
          weather_dependency: r.weather_dependency as MorningItem["weather_dependency"],
          scheduled_start: String(r.scheduled_start).slice(0, 5),
          scheduled_end: String(r.scheduled_end).slice(0, 5),
          reservation_requirement: r.reservation_requirement as MorningItem["reservation_requirement"],
          availability: availability.success ? availability.data : [],
          at_risk: r.at_risk === true,
        };
      });
      const candidates: MorningCandidate[] = (open ?? []).map((c) => ({
        id: String(c.id),
        name_zh: String(c.name_zh),
        zone_id: (c.zone_id as string | null) ?? null,
        weather_dependency: c.weather_dependency as MorningCandidate["weather_dependency"],
        verification_status: c.verification_status as MorningCandidate["verification_status"],
        standby: c.standby === true,
      }));
      return {
        canEdit: member?.role === "owner" || member?.role === "companion",
        dayStatus: (day?.status as string | undefined) ?? null,
        timezone: String(trip.timezone),
        baseline: baseline.data,
        coords: located ? { lat: Number(located.coord_lat), lng: Number(located.coord_lng) } : null,
        firstLegMinutes: null,
        items,
        candidates,
      };
    },
    async fetchWeather(coords, timezone) {
      const forecast = await weather.forecast({ lat: coords.lat, lng: coords.lng, timeZone: timezone, days: 16 });
      return forecast.hours.map((h) => ({ time: h.time.slice(0, 16), precipitationProbability: h.precipitationProbability, precipitationMm: h.precipitationMm }));
    },
    async complete(tripId, date, result, atRisk, standby) {
      const { error } = await session.rpc("complete_morning_check", { p_trip: tripId, p_date: date, p_result: result, p_at_risk: atRisk, p_standby: standby });
      if (error) throw storeError(error.code);
    },
    logError: (message) => createLogger().error(message),
  };
}
