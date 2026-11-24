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

// T24：把行程設為已確認基線（規劃中），再以研究 job 經 add_research_candidates 寫入候選
export async function confirmTripAsAdmin(tripId: string): Promise<void> {
  const admin = adminClient();
  const result = await admin.from("trips").update({ status: "planning" }).eq("id", tripId);
  if (result.error) throw new Error("設定行程狀態失敗");
}

export async function seedResearchCandidates(
  tripId: string,
  initiatorId: string,
  track: "A" | "B" | "C" | "D",
  candidates: Record<string, unknown>[],
): Promise<void> {
  const admin = adminClient();
  const job = await admin
    .from("background_jobs")
    .insert({ kind: "research", initiator_id: initiatorId, trip_id: tripId, status: "running" })
    .select("id")
    .single();
  if (job.error) throw new Error("建立測試研究 job 失敗");
  const added = await admin.rpc("add_research_candidates", { p_job: job.data.id, p_track: track, p_candidates: candidates });
  if (added.error) throw new Error("寫入測試候選失敗");
  const done = await admin.from("background_jobs").update({ status: "completed" }).eq("id", job.data.id);
  if (done.error) throw new Error("更新測試研究 job 失敗");
}

// T25：以研究 job 經 apply_verification 寫入核實結果
export async function verifyCandidateAsAdmin(
  tripId: string,
  initiatorId: string,
  itemName: string,
  write: { status: string; facts: unknown[]; claims: unknown[]; sources: unknown[]; verifiedBy: { provider: string; model: string } },
): Promise<void> {
  const admin = adminClient();
  const item = await admin.from("itinerary_items").select("id").eq("trip_id", tripId).eq("name_zh", itemName).single();
  if (item.error) throw new Error("找不到測試候選");
  const job = await admin
    .from("background_jobs")
    .insert({ kind: "research", initiator_id: initiatorId, trip_id: tripId, status: "running" })
    .select("id")
    .single();
  if (job.error) throw new Error("建立測試研究 job 失敗");
  const applied = await admin.rpc("apply_verification", {
    p_job: job.data.id,
    p_item: item.data.id,
    p_status: write.status,
    p_facts: write.facts,
    p_claims: write.claims,
    p_sources: write.sources,
    p_verified_by: write.verifiedBy,
  });
  if (applied.error) throw new Error("寫入測試核實結果失敗");
  const done = await admin.from("background_jobs").update({ status: "completed" }).eq("id", job.data.id);
  if (done.error) throw new Error("更新測試研究 job 失敗");
}

// T26：以研究 job 經 apply_candidate_scores 寫入評分（依名稱指定）
const DIMENSIONS = [
  "personal_value",
  "uniqueness",
  "geographic_fit",
  "time_cost",
  "transport_cost",
  "weather_dependency",
  "time_slot_dependency",
  "substitutability",
] as const;

export async function applyScoresAsAdmin(
  tripId: string,
  initiatorId: string,
  byName: Record<string, { role: "primary" | "backup"; scores: number[] }>,
): Promise<void> {
  const admin = adminClient();
  const items = await admin.from("itinerary_items").select("id, name_zh").eq("trip_id", tripId);
  if (items.error) throw new Error("讀取測試候選失敗");
  const payload = (items.data ?? []).flatMap((row) => {
    const entry = byName[String(row.name_zh)];
    if (!entry) return [];
    return [
      {
        item_id: row.id,
        candidate_role: entry.role,
        priority: 3,
        weather_dependency: "medium",
        scores: Object.fromEntries(DIMENSIONS.map((d, i) => [d, entry.scores[i] ?? 0])),
      },
    ];
  });
  const job = await admin
    .from("background_jobs")
    .insert({ kind: "research", initiator_id: initiatorId, trip_id: tripId, status: "running" })
    .select("id")
    .single();
  if (job.error) throw new Error("建立測試研究 job 失敗");
  const applied = await admin.rpc("apply_candidate_scores", { p_job: job.data.id, p_scores: payload });
  if (applied.error) throw new Error("寫入測試評分失敗");
  const done = await admin.from("background_jobs").update({ status: "completed" }).eq("id", job.data.id);
  if (done.error) throw new Error("更新測試研究 job 失敗");
}

// T27：以研究 job 經 apply_zoning 寫入分區（依名稱指定項目）
export async function applyZoningAsAdmin(
  tripId: string,
  initiatorId: string,
  zones: { name: string; base_area: string | null; items: { name: string; transfers: number; minutes: number }[] }[],
  backups: string[] = [],
): Promise<void> {
  const admin = adminClient();
  const items = await admin.from("itinerary_items").select("id, name_zh").eq("trip_id", tripId);
  if (items.error) throw new Error("讀取測試候選失敗");
  const idOf = (name: string) => {
    const row = (items.data ?? []).find((r) => r.name_zh === name);
    if (!row) throw new Error("找不到測試候選");
    return String(row.id);
  };
  const payload = zones.map((z) => ({
    name: z.name,
    base_area: z.base_area,
    rationale: "測試分區",
    sources: [],
    items: z.items.map((i) => ({ item_id: idOf(i.name), transfers_from_base: i.transfers, minutes_from_base: i.minutes })),
  }));
  const job = await admin
    .from("background_jobs")
    .insert({ kind: "research", initiator_id: initiatorId, trip_id: tripId, status: "running" })
    .select("id")
    .single();
  if (job.error) throw new Error("建立測試研究 job 失敗");
  const roles = backups.map((name) => ({ item_id: idOf(name), candidate_role: "backup" }));
  const applied = await admin.rpc("apply_zoning", { p_job: job.data.id, p_zones: payload, p_roles: roles });
  if (applied.error) throw new Error("寫入測試分區失敗");
  const done = await admin.from("background_jobs").update({ status: "completed" }).eq("id", job.data.id);
  if (done.error) throw new Error("更新測試研究 job 失敗");
}

// T28：以研究 job 經 apply_mobility_segments 寫入交通估算（依名稱指定起點與終點）
export async function applySegmentAsAdmin(tripId: string, initiatorId: string, from: string, to: string, segment: Record<string, unknown>): Promise<void> {
  const admin = adminClient();
  const items = await admin.from("itinerary_items").select("id, name_zh").eq("trip_id", tripId);
  if (items.error) throw new Error("讀取測試候選失敗");
  const idOf = (name: string) => String((items.data ?? []).find((r) => r.name_zh === name)?.id ?? "");
  const job = await admin
    .from("background_jobs")
    .insert({ kind: "research", initiator_id: initiatorId, trip_id: tripId, status: "running" })
    .select("id")
    .single();
  if (job.error) throw new Error("建立測試研究 job 失敗");
  const applied = await admin.rpc("apply_mobility_segments", {
    p_job: job.data.id,
    p_segments: [{ ...segment, from_item_id: idOf(from), to_item_id: idOf(to) }],
  });
  if (applied.error) throw new Error("寫入測試交通估算失敗");
  const done = await admin.from("background_jobs").update({ status: "completed" }).eq("id", job.data.id);
  if (done.error) throw new Error("更新測試研究 job 失敗");
}

// T29：把已存入的基線標為已確認
export async function markBaselineConfirmedAsAdmin(tripId: string): Promise<void> {
  const result = await adminClient().from("trip_baselines").update({ confirmed_at: new Date().toISOString() }).eq("trip_id", tripId);
  if (result.error) throw new Error("確認測試基線失敗");
}

// T30：以研究 job 經 set_item_availability 寫入營業時段（依名稱指定）
export async function setAvailabilityAsAdmin(
  tripId: string,
  initiatorId: string,
  itemName: string,
  availability: Array<{ weekday?: number; date?: string; start: string; end: string }>,
): Promise<void> {
  const admin = adminClient();
  const item = await admin.from("itinerary_items").select("id").eq("trip_id", tripId).eq("name_zh", itemName).single();
  if (item.error) throw new Error("找不到測試候選");
  const job = await admin
    .from("background_jobs")
    .insert({ kind: "research", initiator_id: initiatorId, trip_id: tripId, status: "running" })
    .select("id")
    .single();
  if (job.error) throw new Error("建立測試研究 job 失敗");
  const applied = await admin.rpc("set_item_availability", { p_job: job.data.id, p_item: item.data.id, p_availability: availability, p_reservation: "none" });
  if (applied.error) throw new Error("寫入測試營業時段失敗");
  const done = await admin.from("background_jobs").update({ status: "completed" }).eq("id", job.data.id);
  if (done.error) throw new Error("更新測試研究 job 失敗");
}

// T31：把項目設為已排入並鎖定的行程項目
export async function lockItemAsAdmin(tripId: string, itemId: string, date: string): Promise<void> {
  const admin = adminClient();
  const item = await admin
    .from("itinerary_items")
    .update({ verification_status: "verified", lifecycle_status: "locked", scheduled_date: date, scheduled_start: "13:00", scheduled_end: "14:00" })
    .eq("id", itemId);
  if (item.error) throw new Error("設定測試項目失敗");
  const trip = await admin.from("trips").update({ status: "locked" }).eq("id", tripId);
  if (trip.error) throw new Error("設定行程狀態失敗");
}

// T31：模擬排程端點建立 T-7 job，並以 job 送出 At Risk 標示（AI 回應不在 E2E 範圍）。回傳是否建立 job
export async function simulateReverifyAsAdmin(tripId: string, itemId: string): Promise<boolean> {
  const admin = adminClient();
  const job = await admin.rpc("start_reverification", { p_trip: tripId, p_kind: "T-7" });
  if (job.error) throw new Error("建立測試再核實 job 失敗");
  if (typeof job.data !== "string") return false;
  const change = {
    changeKind: "approved_fact_invalidated",
    versionKind: "minor",
    summary: "旅前再核實：1 個項目的資料可能已有變動，標示為 At Risk",
    operations: [{ op: "set_at_risk", itemId, atRisk: true }],
  };
  const submitted = await admin.rpc("submit_reverify_at_risk", { p_job: job.data, p_change: change, p_by: { provider: "google", model: "gemini-model" } });
  if (submitted.error) throw new Error("送出測試 At Risk 失敗");
  return true;
}

// T32：成員在行程中的資料（行程記憶、通知），用來確認移除後依 SH-07 刪除
export async function seedMemberDataAsAdmin(tripId: string, userId: string): Promise<void> {
  const admin = adminClient();
  const memory = await admin
    .from("memories")
    .insert({ owner_id: userId, layer: "trip_context", trip_id: tripId, kind: "preference", item: "步行", value: "少走路", source: "manual" });
  if (memory.error) throw new Error("建立測試記憶失敗");
  const notice = await admin.from("notifications").insert({ recipient_id: userId, trip_id: tripId, kind: "proposal_applied" });
  if (notice.error) throw new Error("建立測試通知失敗");
}

export async function countMemberDataAsAdmin(tripId: string, userId: string): Promise<number> {
  const admin = adminClient();
  const memories = await admin.from("memories").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("trip_id", tripId);
  const notices = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", userId).eq("trip_id", tripId);
  if (memories.error || notices.error) throw new Error("讀取測試資料失敗");
  return (memories.count ?? 0) + (notices.count ?? 0);
}
