import "server-only";
import { createLogger } from "@atps/security";
import { tripBaselineData } from "@atps/schemas";
import type { LegDeps, SettingsDeps } from "./trip-edit-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// 決策 0011：行程設定經 update_trip_settings（擁有者 atps_trip_settings_writer，只限 Owner）；
// 交通以使用者本人的 session 直接寫入 travel_legs（RLS：Owner、Companion）

export async function tripSettingsDeps(): Promise<SettingsDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async load(tripId) {
      const user = await guard.getUser();
      if (!user) return null;
      const { data: trip } = await session.from("trips").select("status").eq("id", tripId).maybeSingle();
      if (!trip) return null;
      const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
      const { data: stored } = await session.from("trip_baselines").select("data, confirmed_at").eq("trip_id", tripId).eq("version", 1).maybeSingle();
      const parsed = stored?.confirmed_at ? tripBaselineData.safeParse(stored.data) : null;
      const { data: rows } = await session.from("itinerary_items").select("id, scheduled_date").eq("trip_id", tripId).not("scheduled_date", "is", null).limit(500);
      return {
        isOwner: member?.role === "owner",
        tripStatus: String(trip.status),
        baseline: parsed?.success ? parsed.data : null,
        scheduled: (rows ?? []).map((r) => ({ itemId: String(r.id), date: String(r.scheduled_date) })),
      };
    },
    async save(tripId, input) {
      const { data, error } = await session.rpc("update_trip_settings", {
        p_trip: tripId,
        p_name: input.name,
        p_destination: input.destination,
        p_start: input.start,
        p_end: input.end,
      });
      if (error) throw new Error("update_trip_settings");
      return { movedToCandidates: Number((data as { moved_to_candidates?: number } | null)?.moved_to_candidates ?? 0) };
    },
    logError: (message) => createLogger().error(message),
  };
}

export async function travelLegDeps(): Promise<LegDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async canEdit(tripId) {
      const user = await guard.getUser();
      if (!user) return false;
      const { data } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
      return data?.role === "owner" || data?.role === "companion";
    },
    async save(tripId, input) {
      const { error } = await session
        .from("travel_legs")
        .upsert({ trip_id: tripId, from_item_id: input.from, to_item_id: input.to, mode: input.mode, minutes: input.minutes, updated_at: new Date().toISOString() });
      if (error) throw new Error("travel_legs");
    },
    logError: (message) => createLogger().error(message),
  };
}
