import "server-only";
import { tripBaselineData, uuid, type TripBaselineData } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { BaselineStoreError, type BaselineDeps, type BaselineStore } from "./baseline-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T23：旅行基線以使用者本人的 session 存取；寫入只經資料庫函式 save_trip_baseline、confirm_trip_baseline

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function storeError(code: string | undefined): BaselineStoreError {
  if (code === "42501") return new BaselineStoreError("forbidden");
  if (code === "55000") return new BaselineStoreError("state");
  if (code === "22023") return new BaselineStoreError("invalid");
  return new BaselineStoreError("unknown");
}

function supabaseBaselineStore(session: Session): BaselineStore {
  return {
    async save(tripId, data) {
      const { error } = await session.rpc("save_trip_baseline", { p_trip: tripId, p_data: data });
      if (error) throw storeError(error.code);
    },
    async load(tripId) {
      const { data, error } = await session.from("trip_baselines").select("data, confirmed_at").eq("trip_id", tripId).eq("version", 1).maybeSingle();
      if (error) throw storeError(error.code);
      return data ? { data: data.data as unknown, confirmedAt: (data.confirmed_at as string | null) ?? null } : null;
    },
    async confirm(tripId) {
      const { error } = await session.rpc("confirm_trip_baseline", { p_trip: tripId });
      if (error) throw storeError(error.code);
    },
  };
}

export async function baselineActionDeps(): Promise<BaselineDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    store: supabaseBaselineStore(session),
    logError: (message) => createLogger().error(message),
  };
}

export type BaselineView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripName: string;
      tripStatus: string;
      canEdit: boolean;
      baseline: TripBaselineData | null;
      // 儲存的資料不符合目前格式時為 true（需要重新填寫）
      unreadable: boolean;
      confirmedAt: string | null;
    };

export async function loadBaseline(tripId: string): Promise<BaselineView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };

  // RLS：只有成員看得到行程與基線
  const { data: trip, error } = await session.from("trips").select("name, status").eq("id", tripId).maybeSingle();
  if (error) throw new Error("讀取行程失敗");
  if (!trip) return { state: "not_found" };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const role = (member?.role as string | undefined) ?? null;

  const stored = await supabaseBaselineStore(session).load(tripId);
  const parsed = stored ? tripBaselineData.safeParse(stored.data) : null;
  return {
    state: "ok",
    tripName: String(trip.name),
    tripStatus: String(trip.status),
    canEdit: role === "owner" || role === "companion",
    baseline: parsed?.success ? parsed.data : null,
    unreadable: parsed !== null && !parsed.success,
    confirmedAt: stored?.confirmedAt ?? null,
  };
}
