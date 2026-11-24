import "server-only";
import { createLogger } from "@atps/security";
import { InboxStoreError, notificationLabel, type InboxDeps } from "./inbox-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T31：未讀通知與 At Risk 項目（SH-06），以使用者本人的 session 讀取（RLS：只有本人的通知、只有成員的行程）

export async function inboxActionDeps(): Promise<InboxDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async setReverify(tripId, enabled) {
      const { error } = await session.rpc("set_reverify_schedule", { p_trip: tripId, p_enabled: enabled });
      if (error) throw new InboxStoreError(error.code === "42501" ? "forbidden" : "unknown");
    },
    async markAllRead() {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) throw new InboxStoreError("forbidden");
      const { error } = await session.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", auth.user.id).is("read_at", null);
      if (error) throw new InboxStoreError("unknown");
    },
    logError: (message) => createLogger().error(message),
  };
}

export interface InboxView {
  notifications: Array<{ id: string; label: string; tripId: string | null; tripName: string; createdAt: string }>;
  atRisk: Array<{ id: string; name: string; tripId: string; tripName: string; date: string | null }>;
}

const SCHEDULED_STATES = ["approved", "locked", "change_proposed", "modified"];

export async function loadInbox(): Promise<InboxView | null> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return null;
  const { data: rows } = await session
    .from("notifications")
    .select("id, kind, trip_id, created_at")
    .eq("recipient_id", auth.user.id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  const { data: items } = await session
    .from("itinerary_items")
    .select("id, name_zh, trip_id, scheduled_date")
    .eq("at_risk", true)
    .in("lifecycle_status", SCHEDULED_STATES)
    .order("scheduled_date", { ascending: true })
    .limit(50);
  const tripIds = [...new Set([...(rows ?? []).map((r) => r.trip_id), ...(items ?? []).map((i) => i.trip_id)].filter((id): id is string => typeof id === "string"))];
  const { data: trips } = tripIds.length > 0 ? await session.from("trips").select("id, name").in("id", tripIds) : { data: [] };
  const nameOf = (id: unknown) => String((trips ?? []).find((t) => t.id === id)?.name ?? "行程");
  return {
    notifications: (rows ?? []).map((r) => ({
      id: String(r.id),
      label: notificationLabel(String(r.kind)),
      tripId: (r.trip_id as string | null) ?? null,
      tripName: nameOf(r.trip_id),
      createdAt: String(r.created_at),
    })),
    atRisk: (items ?? []).map((i) => ({
      id: String(i.id),
      name: String(i.name_zh),
      tripId: String(i.trip_id),
      tripName: nameOf(i.trip_id),
      date: (i.scheduled_date as string | null) ?? null,
    })),
  };
}
