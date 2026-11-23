import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// E2E 登入：以本機 Supabase 建立測試使用者，用 @supabase/ssr 登入後把 session cookie 放入瀏覽器
// 需要 supabase start 與 apps/web/.env.local（含本機的 SUPABASE_SERVICE_ROLE_KEY）

function loadEnv(): Record<string, string> {
  const file = readFileSync(path.resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of file.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1]) env[match[1]] = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

function requireValue(env: Record<string, string>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`apps/web/.env.local 缺少 ${name}`);
  return value;
}

export async function signInAsNewUser(context: BrowserContext, baseURL: string): Promise<{ email: string; userId: string }> {
  const env = loadEnv();
  const url = requireValue(env, "NEXT_PUBLIC_SUPABASE_URL");
  const anon = requireValue(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = requireValue(env, "SUPABASE_SERVICE_ROLE_KEY");

  const email = `e2e-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("建立測試使用者失敗");
  const userId = created.data.user.id;

  const jar: { name: string; value: string }[] = [];
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => jar,
      setAll: (items) => {
        for (const { name, value } of items) {
          const index = jar.findIndex((c) => c.name === name);
          if (index >= 0) jar.splice(index, 1);
          if (value) jar.push({ name, value });
        }
      },
    },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error("測試使用者登入失敗");

  const { hostname } = new URL(baseURL);
  await context.addCookies(jar.map((c) => ({ ...c, domain: hostname, path: "/", httpOnly: false, sameSite: "Lax" })));
  return { email, userId };
}

function adminClient() {
  const env = loadEnv();
  return createClient(requireValue(env, "NEXT_PUBLIC_SUPABASE_URL"), requireValue(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

// 建立行程（觸發器把擁有者加入成員），可再加入其他成員
export async function createTrip(ownerId: string, name: string, members: { userId: string; role: "companion" | "viewer" }[] = []): Promise<string> {
  const admin = adminClient();
  const trip = await admin.from("trips").insert({ name, owner_id: ownerId }).select("id").single();
  if (trip.error) throw new Error("建立測試行程失敗");
  const tripId = String(trip.data.id);
  if (members.length > 0) {
    const added = await admin.from("trip_members").insert(members.map((m) => ({ trip_id: tripId, user_id: m.userId, role: m.role })));
    if (added.error) throw new Error("加入測試成員失敗");
  }
  return tripId;
}

export async function setDisplayName(userId: string, displayName: string): Promise<void> {
  const result = await adminClient().from("profiles").update({ display_name: displayName }).eq("id", userId);
  if (result.error) throw new Error("設定顯示名稱失敗");
}

export async function createItem(tripId: string, item: { name_zh: string; name_local?: string | null; address?: string | null }): Promise<string> {
  const result = await adminClient()
    .from("itinerary_items")
    .insert({
      trip_id: tripId,
      name_zh: item.name_zh,
      name_local: item.name_local ?? null,
      address: item.address ?? null,
      type: "attraction",
      suggested_stay_minutes: 60,
      recommendation_reason: "測試",
      priority: 3,
      weather_dependency: "low",
      score_personal_value: 3,
      score_uniqueness: 3,
      score_geographic_fit: 3,
      score_time_cost: 3,
      score_transport_cost: 3,
      score_weather_dependency: 3,
      score_time_slot_dependency: 3,
      score_substitutability: 3,
    })
    .select("id")
    .single();
  if (result.error) throw new Error("建立測試項目失敗");
  return String(result.data.id);
}

// 下載 Storage 物件（檢查上傳結果用）
export async function downloadStoredPhoto(tripId: string): Promise<Buffer> {
  const admin = adminClient();
  const list = await admin.storage.from("trip-photos").list(tripId);
  const name = list.data?.[0]?.name;
  if (list.error || !name) throw new Error("找不到上傳的照片");
  const file = await admin.storage.from("trip-photos").download(`${tripId}/${name}`);
  if (file.error) throw new Error("下載照片失敗");
  return Buffer.from(await file.data.arrayBuffer());
}

// 以伺服器的 save_api_key 直接存入 key（E2E 不連外部 API，所以略過儲存前測試呼叫）
export async function saveApiKeyAsAdmin(userId: string, provider: "anthropic" | "google_ai" | "openai" | "google_maps" | "odpt", secret: string): Promise<void> {
  const result = await adminClient().rpc("save_api_key", { p_owner: userId, p_provider: provider, p_secret: secret, p_tested_at: new Date().toISOString() });
  if (result.error) throw new Error("存入測試 key 失敗");
}

// 以 service role 直接存入基線草稿（Viewer 檢視測試用）
export async function saveBaselineAsAdmin(tripId: string, data: Record<string, unknown>): Promise<void> {
  const result = await adminClient().from("trip_baselines").insert({ trip_id: tripId, version: 1, data });
  if (result.error) throw new Error("存入測試基線失敗");
}
