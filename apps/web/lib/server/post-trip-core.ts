import { allowedPostTripStatuses, type PostTripStatus } from "@atps/core";
import { uuid } from "@atps/schemas";
import { z } from "zod";

// T40：旅後狀態標記的 Server Action 邏輯（第 2.5、2.8 節）。以使用者 session 讀取需要標記的項目與實際紀錄，
// 經 set_post_trip_status 寫入（權限、行程狀態與實際紀錄由資料庫再檢查）；全部標記後行程進入已封存

export class PostTripStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`旅後狀態寫入失敗（${reason}）`);
  }
}

export interface PostTripContext {
  canEdit: boolean;
  tripStatus: string;
  // 需要標記的項目；visited 為最後一筆紀錄是否為完成
  items: Array<{ id: string; visited: boolean }>;
}

export interface PostTripDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  loadContext: (tripId: string) => Promise<PostTripContext | null>;
  setStatus: (tripId: string, itemId: string, status: PostTripStatus) => Promise<{ tripStatus: string; remaining: number }>;
  logError: (message: string) => void;
}

export interface PostTripActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "post_trip.status", limit: 60, windowSeconds: 60 } as const;
const form = z.object({
  tripId: uuid,
  itemId: uuid,
  status: z.enum(["completed", "skipped", "cancelled", "revisit", "not_recommended"]),
});

export async function setPostTripStatusAction(deps: PostTripDeps, fields: Record<string, unknown>): Promise<PostTripActionResult> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  const parsed = form.safeParse(fields);
  if (!parsed.success) return { ok: false, message: "參數不正確" };
  const { tripId, itemId, status } = parsed.data;

  const context = await deps.loadContext(tripId);
  if (!context) return { ok: false, message: "找不到這個行程" };
  if (!context.canEdit) return { ok: false, message: "只有 Owner 與 Companion 可以標記旅後狀態" };
  if (context.tripStatus === "archived") return { ok: false, message: "行程已封存，不能再修改" };
  if (context.tripStatus !== "ended") return { ok: false, message: "行程結束後才能標記旅後狀態" };
  const item = context.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, message: "這個項目不需標記" };
  if (!allowedPostTripStatuses(item.visited).includes(status)) return { ok: false, message: "旅後狀態與實際紀錄不符" };

  let result: { tripStatus: string; remaining: number };
  try {
    result = await deps.setStatus(tripId, itemId, status);
  } catch (error) {
    if (error instanceof PostTripStoreError && error.reason === "forbidden") return { ok: false, message: "只有 Owner 與 Companion 可以標記旅後狀態" };
    if (error instanceof PostTripStoreError && error.reason === "state") return { ok: false, message: "行程結束後才能標記旅後狀態" };
    if (error instanceof PostTripStoreError && error.reason === "invalid") return { ok: false, message: "旅後狀態與實際紀錄不符" };
    deps.logError("旅後狀態寫入失敗");
    return { ok: false, message: "儲存失敗，請稍後再試" };
  }
  if (result.tripStatus === "archived") return { ok: true, message: "已儲存。所有項目都已標記，行程已封存" };
  return { ok: true, message: `已儲存，還有 ${result.remaining} 個項目未標記` };
}
