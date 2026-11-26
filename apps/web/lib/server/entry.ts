import "server-only";
import { randomUUID } from "node:crypto";
import { createLogger } from "@atps/security";
import type { EntryDeps } from "./entry-core";
import { allowedOrigins, createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// 進入 App：以使用者本人的 session 寄送 magic link（PKCE，驗證碼存在本人瀏覽器的 cookie）與建立行程

export async function entryDeps(): Promise<EntryDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    origin: allowedOrigins()[0] as string,
    async sendMagicLink(email, redirectTo) {
      const { error } = await session.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
      if (error) throw new Error("寄送失敗");
    },
    // 編號由伺服器產生：Owner 成員由 AFTER INSERT trigger 加入，insert 的 RETURNING 讀不到（RLS 以成員判斷）
    async createTrip(trip) {
      const id = randomUUID();
      const { error } = await session.from("trips").insert({ id, name: trip.name, destination: trip.destination, owner_id: trip.ownerId });
      if (error) throw new Error("建立行程失敗");
      return id;
    },
    logError: (message) => createLogger().error(message),
  };
}

export async function signOut(): Promise<void> {
  const session = await createSupabaseServerClient();
  await session.auth.signOut();
}

const STATUS: Record<string, string> = {
  baseline: "基線",
  planning: "規劃中",
  locked: "已鎖定",
  in_progress: "進行中",
  ended: "已結束",
  archived: "已封存",
};

export interface TripSummary {
  id: string;
  name: string;
  destination: string | null;
  status: string;
  dates: string | null;
}

// 首頁：本人是成員的行程（RLS）
export async function loadTrips(): Promise<TripSummary[] | null> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return null;
  const { data } = await session
    .from("trips")
    .select("id, name, destination, status, start_date, end_date")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((t) => ({
    id: String(t.id),
    name: String(t.name),
    destination: (t.destination as string | null) ?? null,
    status: STATUS[String(t.status)] ?? String(t.status),
    dates: t.start_date ? `${String(t.start_date)}–${String(t.end_date ?? t.start_date)}` : null,
  }));
}
