import "server-only";
import { tripBaselineData, uuid } from "@atps/schemas";
import { createSupabaseServerClient } from "./supabase";

// 決策 0010 I：匯入畫面的行程資料（本人 session，RLS）。日期取自旅行基線（與行程編輯相同）

export type ImportView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | { state: "ok"; tripName: string; timezone: string; canEdit: boolean; locked: boolean; dates: string[] };

export async function loadImportView(tripId: string): Promise<ImportView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name, timezone, status").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const [{ data: member }, { data: stored }] = await Promise.all([
    session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle(),
    session.from("trip_baselines").select("data").eq("trip_id", tripId).eq("version", 1).maybeSingle(),
  ]);
  const baseline = stored ? tripBaselineData.safeParse(stored.data) : null;
  const dates: string[] = [];
  if (baseline?.success) {
    for (let d = new Date(`${baseline.data.start_date}T00:00:00Z`); d <= new Date(`${baseline.data.end_date}T00:00:00Z`) && dates.length < 60; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return {
    state: "ok",
    tripName: String(trip.name),
    timezone: String(trip.timezone),
    canEdit: member?.role === "owner" || member?.role === "companion",
    locked: !["baseline", "planning"].includes(String(trip.status)),
    dates,
  };
}
