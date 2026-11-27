// 本機一鍵登入連結：為指定電子郵件產生只可用一次的登入連結，在任何瀏覽器開啟即登入，不經登入頁與信箱。
// 只可用於本機 Supabase（網址不是 localhost 或 127.0.0.1 時拒絕）。使用者不存在時建立。
// 有行程時連結直接進入最新的行程。
// 用法：pnpm --filter @atps/web demo:link 電子郵件
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email.includes("@")) {
  console.error("用法：pnpm --filter @atps/web demo:link 電子郵件");
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
const local = (u) => ["localhost", "127.0.0.1"].includes(new URL(u).hostname);
const site = env.SITE_URL || "http://localhost:3100";
if (!local(url) || !local(site)) {
  console.error("只可用於本機");
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

let userId = await findUser();
if (!userId) {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("建立使用者失敗");
  userId = created.data.user.id;
}

const trips = await admin.from("trip_members").select("trip_id, trips(created_at)").eq("user_id", userId);
const latest = (trips.data ?? []).sort((a, b) => String(b.trips?.created_at ?? "").localeCompare(String(a.trips?.created_at ?? "")))[0];
const next = latest ? `/trips/${latest.trip_id}` : "/";

const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (link.error || !link.data.properties?.hashed_token) throw new Error("產生登入連結失敗");

const target = new URL("/auth/callback", site);
target.searchParams.set("token_hash", link.data.properties.hashed_token);
target.searchParams.set("type", "magiclink");
target.searchParams.set("next", next);
console.log(`登入連結（只可用一次）：${target.toString()}`);
