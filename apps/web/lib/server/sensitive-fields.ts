import "server-only";
import { SupabaseSensitiveFields, type Sharing } from "@atps/db";
import { SENSITIVE_FIELDS, uuid, type SensitiveField } from "@atps/schemas";
import { createLogger } from "@atps/security";
import type { SensitiveActionDeps } from "./sensitive-fields-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T17：敏感欄位以使用者本人的 session 存取（C-09）；權限由資料庫函式依第 6 節權限表判斷

export async function sensitiveActionDeps(): Promise<SensitiveActionDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    fields: new SupabaseSensitiveFields(session),
    logError: (message, values) => createLogger({ sensitiveValues: () => values }).error(message),
  };
}

export interface OwnField {
  field: SensitiveField;
  value: string;
  sharing: Sharing;
}

export interface SharedField {
  memberName: string;
  field: SensitiveField;
  value: string;
}

export type MyInfoView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | { state: "ok"; tripName: string; own: OwnField[]; shared: SharedField[] };

export async function loadMyInfo(tripId: string): Promise<MyInfoView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };

  // RLS：只有成員看得到行程
  const { data: trip, error } = await session.from("trips").select("name").eq("id", tripId).maybeSingle();
  if (error) throw new Error("讀取行程失敗");
  if (!trip) return { state: "not_found" };

  const visible = await new SupabaseSensitiveFields(session).listForTrip(tripId);
  const own = SENSITIVE_FIELDS.flatMap((field) => {
    const row = visible.find((v) => v.userId === auth.user.id && v.field === field);
    return row?.sharing ? [{ field, value: row.value, sharing: row.sharing }] : [];
  });

  const others = visible.filter((v) => v.userId !== auth.user.id);
  const ids = [...new Set(others.map((o) => o.userId))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await session.from("profiles").select("id, display_name").in("id", ids);
    for (const p of profiles ?? []) names.set(String(p.id), (p.display_name as string | null) ?? "同行成員");
  }
  const shared = others.map((o) => ({ memberName: names.get(o.userId) ?? "同行成員", field: o.field, value: o.value }));

  return { state: "ok", tripName: String(trip.name), own, shared };
}
