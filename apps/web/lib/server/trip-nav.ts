import "server-only";
import { uuid } from "@atps/schemas";
import { createSupabaseServerClient } from "./supabase";

// 「提案」分頁的待批准數。以使用者 session 讀取（RLS：非成員為 0）
export async function pendingProposalCount(tripId: string): Promise<number> {
  if (!uuid.safeParse(tripId).success) return 0;
  const session = await createSupabaseServerClient();
  const { count } = await session.from("proposals").select("id", { count: "exact", head: true }).eq("trip_id", tripId).eq("status", "pending");
  return count ?? 0;
}

export type TripHeader =
  | { state: "signed_out" }
  | { state: "not_found" }
  | { state: "ok"; tripName: string; tripStatus: string; role: string | null; reverifyEnabled: boolean };

// 「更多」與各畫面標題用的行程基本資料
export async function loadTripHeader(tripId: string): Promise<TripHeader> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name, status, reverify_enabled").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  return {
    state: "ok",
    tripName: String(trip.name),
    tripStatus: String(trip.status),
    role: (member?.role as string | undefined) ?? null,
    reverifyEnabled: trip.reverify_enabled === true,
  };
}
