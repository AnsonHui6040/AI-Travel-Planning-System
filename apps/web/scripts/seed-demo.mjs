// 本機示範資料：為指定電子郵件的使用者建立一個「東京三日（示範）」行程，方便在瀏覽器檢視各頁面。
// 只寫入本機 Supabase（網址不是 localhost 或 127.0.0.1 時拒絕執行）。使用者須先以該電子郵件登入一次。
// 用法：pnpm --filter @atps/web demo:seed 你的電子郵件 [--phase=trip|planning|post]
// - trip（預設）：旅行中，第一天是今天
// - planning：規劃中，基線已確認、有候選、每日尚未批准（「現在」顯示步驟）
// - post：已結束，三天都在過去、尚未標記旅後狀態
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const phase = phaseArg ? phaseArg.slice("--phase=".length) : "trip";
if (!email.includes("@") || !["trip", "planning", "post"].includes(phase)) {
  console.error("用法：pnpm --filter @atps/web demo:seed 你的電子郵件 [--phase=trip|planning|post]");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(path.resolve(import.meta.dirname, "../.env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("apps/web/.env.local 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const host = new URL(url).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error("只可寫入本機 Supabase");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

async function findUser() {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("讀取使用者失敗");
    const user = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (user) return user.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const must = (result, label) => {
  if (result.error) throw new Error(`${label}失敗：${result.error.message}`);
  return result.data;
};

const tokyoDate = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

const userId = await findUser();
if (!userId) {
  console.error("找不到這個電子郵件的使用者，請先在 App 以這個電子郵件登入一次");
  process.exit(1);
}

// 規劃中為 30 天後出發；旅後為三天前到昨天
const offset = phase === "planning" ? 30 : phase === "post" ? -3 : 0;
const days = [tokyoDate(offset), tokyoDate(offset + 1), tokyoDate(offset + 2)];
const TRIP_STATUS = { trip: "in_progress", planning: "planning", post: "ended" };
const trip = must(
  await admin
    .from("trips")
    .insert({ name: "東京三日（示範）", destination: "東京", owner_id: userId, start_date: days[0], end_date: days[2], timezone: "Asia/Tokyo", status: TRIP_STATUS[phase], current_version: 1 })
    .select("id")
    .single(),
  "建立行程",
);
const tripId = trip.id;

must(
  await admin.from("trip_baselines").insert({
    trip_id: tripId,
    version: 1,
    confirmed_at: new Date().toISOString(),
    data: {
      start_date: days[0],
      end_date: days[2],
      timezone: "Asia/Tokyo",
      flights: [],
      lodgings: [],
      companions: 2,
      stamina_note: null,
      budget: null,
      fixed_activities: [{ name: "晚餐（已付款）", area: "新宿", date: days[0], start: "19:00", end: "21:00", paid: true }],
      paid_items: [],
      must_visit: [],
      excluded: [],
      transport_preferences: [],
      photography_needs: null,
    },
  }),
  "建立基線",
);

const base = {
  trip_id: tripId,
  suggested_stay_minutes: 90,
  priority: 3,
  weather_dependency: "low",
  recommendation_reason: "示範資料",
  score_personal_value: 3,
  score_uniqueness: 3,
  score_geographic_fit: 3,
  score_time_cost: 3,
  score_transport_cost: 3,
  score_weather_dependency: 3,
  score_time_slot_dependency: 3,
  score_substitutability: 3,
  verification_status: "verified",
};
const scheduled = [
  ["淺草寺", "attraction", 0, "09:00", "10:30"],
  ["晴空塔", "attraction", 0, "11:00", "12:30"],
  ["上野公園", "photography", 0, "14:00", "15:30"],
  ["築地場外市場", "restaurant", 1, "08:30", "10:00"],
  ["東京國立博物館", "attraction", 1, "11:00", "13:00"],
  ["明治神宮", "attraction", 2, "09:30", "11:00"],
];
const items = must(
  await admin
    .from("itinerary_items")
    .insert(
      scheduled.map(([name, type, day, start, end]) =>
        phase === "planning"
          ? { ...base, name_zh: name, type, lifecycle_status: "verified", availability: [{ start: "08:00", end: "20:00" }] }
          : { ...base, name_zh: name, type, lifecycle_status: "locked", scheduled_date: days[day], scheduled_start: start, scheduled_end: end },
      ),
    )
    .select("id, name_zh"),
  "建立行程項目",
);
must(
  await admin.from("itinerary_items").insert([
    { ...base, name_zh: "藏前咖啡廳", type: "restaurant", lifecycle_status: "verified", candidate_role: "backup" },
    { ...base, name_zh: "江戶東京博物館", type: "attraction", lifecycle_status: "verified", candidate_role: "backup" },
    { ...base, name_zh: "谷中銀座", type: "shopping", lifecycle_status: "candidate", verification_status: "unverified", candidate_role: "primary" },
  ]),
  "建立候選",
);
if (phase !== "planning") {
  must(await admin.from("days").insert(days.map((date) => ({ trip_id: tripId, date, status: phase === "post" ? "completed" : "approved" }))), "建立每日");
}

// 旅行中：一個待批准的提案
if (phase === "trip") {
  const tower = items.find((i) => i.name_zh === "晴空塔");
  must(
    await admin.from("proposals").insert({
      trip_id: tripId,
      proposer_member_id: userId,
      base_version: 1,
      change: {
        changeKind: "minor_non_incident",
        versionKind: "minor",
        summary: "晴空塔延後半小時，避開排隊",
        operations: [{ op: "schedule_item", itemId: tower.id, date: days[0], start: "11:30", end: "13:00" }],
      },
      impact_scope: { dates: [days[0]] },
    }),
    "建立提案",
  );
}

console.log(`已建立示範行程：/trips/${tripId}/today`);
