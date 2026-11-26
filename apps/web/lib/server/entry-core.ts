import { z } from "zod";
import { safeRedirectPath } from "./redirect";

// 進入 App：Email magic link 登入（D05）與建立行程。
// 登入連結的回呼固定為站內 /auth/callback，next 只允許站內路徑；寄送頻率由 Supabase Auth 限制。
// 建立行程以使用者本人的 session 寫入（RLS：只能以本人為 Owner 建立），Owner 成員由資料庫 trigger 加入。

export interface EntryDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  origin: string;
  sendMagicLink: (email: string, redirectTo: string) => Promise<void>;
  createTrip: (trip: { ownerId: string; name: string; destination: string | null }) => Promise<string>;
  logError: (message: string) => void;
}

export interface EntryActionResult {
  ok: boolean;
  message: string;
  tripId?: string;
}

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const tripForm = z.object({
  name: z.string().trim().min(1).max(120),
  destination: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(120).nullable().default(null)),
});
const RATE = { endpoint: "trip.create", limit: 10, windowSeconds: 600 } as const;

export async function sendMagicLinkAction(deps: EntryDeps, fields: { email?: unknown; next?: unknown }): Promise<EntryActionResult> {
  const parsed = email.safeParse(fields.email);
  if (!parsed.success) return { ok: false, message: "請輸入正確的電子郵件" };
  const next = safeRedirectPath(typeof fields.next === "string" ? fields.next : null, deps.origin);
  const redirectTo = `${deps.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  try {
    await deps.sendMagicLink(parsed.data, redirectTo);
  } catch {
    deps.logError("登入連結寄送失敗");
    return { ok: false, message: "寄送失敗，請稍後再試" };
  }
  return { ok: true, message: "已寄出登入連結，請到信箱開啟" };
}

export async function createTripAction(deps: EntryDeps, fields: { name?: unknown; destination?: unknown }): Promise<EntryActionResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  const parsed = tripForm.safeParse(fields);
  if (!parsed.success) return { ok: false, message: "請輸入行程名稱（120 字以內）" };
  try {
    const tripId = await deps.createTrip({ ownerId: user.id, name: parsed.data.name, destination: parsed.data.destination });
    return { ok: true, message: "已建立行程", tripId };
  } catch {
    deps.logError("建立行程失敗");
    return { ok: false, message: "建立失敗，請稍後再試" };
  }
}
