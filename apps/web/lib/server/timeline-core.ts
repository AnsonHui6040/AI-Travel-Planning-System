import { actualTimeline, zonedTime, type ActualTimeline, type TimelineEntry, type TimelinePlanned } from "@atps/core";
import { hhmm as clock, isoDate, uuid } from "@atps/schemas";
import { z } from "zod";

// T39：Actual Timeline 的 Server Action 邏輯（第 2.8、2.9 節）。只記錄實際發生的事。
// 記錄以使用者本人 session 寫入 actual_timeline_entries（RLS 限 Owner、Companion，資料庫再檢查項目與時間）；
// 產生時以 core 的 actualTimeline 計算 Planned vs Actual，經 produce_actual_timeline 寫入，
// 資料庫再確認「已去過」只包含最後一筆紀錄為完成的項目。

export class TimelineStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`Actual Timeline 寫入失敗（${reason}）`);
  }
}

export interface TimelineContext {
  canEdit: boolean;
  dayStatus: string | null;
  timezone: string;
  planned: TimelinePlanned[];
  unplanned: Array<{ id: string; name_zh: string }>;
  entries: TimelineEntry[];
}

export interface TimelineRecord {
  tripId: string;
  itemId: string;
  completion: TimelineEntry["completion"];
  arrivedAt: string | null;
  departedAt: string | null;
}

export interface TimelineDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  loadContext: (tripId: string, date: string) => Promise<TimelineContext | null>;
  record: (entry: TimelineRecord) => Promise<void>;
  produce: (tripId: string, date: string, timeline: ActualTimeline) => Promise<{ tripStatus: string }>;
  logError: (message: string) => void;
}

export interface TimelineActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "timeline.write", limit: 30, windowSeconds: 60 } as const;
const OPEN_DAY = new Set(["approved", "day_ready", "in_progress"]);
const hhmm = z.union([z.literal(""), clock]);
const recordForm = z.object({
  tripId: uuid,
  date: isoDate,
  itemId: uuid,
  completion: z.enum(["completed", "partial", "skipped"]),
  arrived: hhmm,
  departed: hhmm,
});

async function guard(deps: TimelineDeps): Promise<TimelineActionResult | null> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  return null;
}

export async function recordEntryAction(deps: TimelineDeps, fields: Record<string, unknown>): Promise<TimelineActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  const parsed = recordForm.safeParse(fields);
  if (!parsed.success) return { ok: false, message: "參數不正確" };
  const f = parsed.data;
  if (f.arrived && f.departed && f.departed < f.arrived) return { ok: false, message: "離開時間不可早於到達時間" };

  const context = await deps.loadContext(f.tripId, f.date);
  if (!context) return { ok: false, message: "找不到這個行程" };
  if (!context.canEdit) return { ok: false, message: "只有 Owner 與 Companion 可以記錄" };
  if (context.dayStatus === "completed") return { ok: false, message: "這天的 Actual Timeline 已產生" };
  if (!context.dayStatus || !OPEN_DAY.has(context.dayStatus)) return { ok: false, message: "這天尚未批准" };
  const known = context.planned.some((p) => p.id === f.itemId) || context.unplanned.some((u) => u.id === f.itemId);
  if (!known) return { ok: false, message: "只能記錄這天排定的項目" };

  const at = (time: string) => (time ? zonedTime(f.date, time, context.timezone).toISOString() : null);
  try {
    await deps.record({ tripId: f.tripId, itemId: f.itemId, completion: f.completion, arrivedAt: at(f.arrived), departedAt: at(f.departed) });
  } catch (error) {
    if (error instanceof TimelineStoreError && error.reason === "forbidden") return { ok: false, message: "只有 Owner 與 Companion 可以記錄" };
    if (error instanceof TimelineStoreError && error.reason === "state") return { ok: false, message: "這天的 Actual Timeline 已產生" };
    if (error instanceof TimelineStoreError && error.reason === "invalid") return { ok: false, message: "實際時間不可晚於現在" };
    deps.logError("Actual Timeline 紀錄寫入失敗");
    return { ok: false, message: "記錄失敗，請稍後再試" };
  }
  return { ok: true, message: "已記錄" };
}

export async function produceTimelineAction(deps: TimelineDeps, tripIdRaw: unknown, dateRaw: unknown): Promise<TimelineActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  const tripId = uuid.safeParse(tripIdRaw);
  const date = isoDate.safeParse(dateRaw);
  if (!tripId.success || !date.success) return { ok: false, message: "參數不正確" };

  const context = await deps.loadContext(tripId.data, date.data);
  if (!context) return { ok: false, message: "找不到這個行程" };
  if (!context.canEdit) return { ok: false, message: "只有 Owner 與 Companion 可以產生 Actual Timeline" };
  if (!context.dayStatus || !OPEN_DAY.has(context.dayStatus)) return { ok: false, message: "這天尚未批准，或 Actual Timeline 已產生" };

  const timeline = actualTimeline({ date: date.data, timezone: context.timezone, planned: context.planned, unplanned: context.unplanned, entries: context.entries });
  let tripStatus: string;
  try {
    ({ tripStatus } = await deps.produce(tripId.data, date.data, timeline));
  } catch (error) {
    if (error instanceof TimelineStoreError && error.reason === "forbidden") return { ok: false, message: "只有 Owner 與 Companion 可以產生 Actual Timeline" };
    if (error instanceof TimelineStoreError && error.reason === "state") return { ok: false, message: "這天尚未批准，或 Actual Timeline 已產生" };
    deps.logError("Actual Timeline 寫入失敗");
    return { ok: false, message: "產生失敗，請稍後再試" };
  }
  const s = timeline.summary;
  const tail = tripStatus === "ended" ? "。這是最後一日，行程已結束" : "";
  return {
    ok: true,
    message: `已產生 Actual Timeline：排定 ${s.planned} 項，完成 ${s.completed} 項，部分完成 ${s.partial} 項，略過 ${s.skipped} 項，沒有紀錄 ${s.notRecorded} 項${tail}`,
  };
}
