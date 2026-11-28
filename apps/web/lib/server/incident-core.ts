import { bookedItemIds, planIncident, withBookings, type BookingConstraint, type IncidentItem, type IncidentPlan, type IncidentTrigger, type StoredMobilityEstimate } from "@atps/core";
import { isoDate, uuid, type TripBaselineData } from "@atps/schemas";
import { z } from "zod";

// T38：進入 Incident Mode 的 Server Action 邏輯（第 2.6、2.9 節，D10）。
// 只接受使用者輸入的事件與現況（事件種類、項目、位置、同行者、行李）；行程、候選與交通估算由伺服器以使用者 session 讀取（RLS），
// 以 core 的 planIncident 計算，經 start_incident 建立即時分支（待批准提案，不改動行程；權限與內容由資料庫再檢查）。

export class IncidentStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`Incident Mode 寫入失敗（${reason}）`);
  }
}

export interface IncidentContext {
  canEdit: boolean;
  tripStatus: string;
  timezone: string;
  baseline: TripBaselineData;
  items: IncidentItem[];
  // 「出發項目>目的項目」→ 交通估算（T28，含緩衝）
  segments: ReadonlyMap<string, readonly StoredMobilityEstimate[]>;
  // 當天 Morning Check 的天氣說明；沒有時為 null
  weather: string | null;
  // 決策 0010 B：行程的預訂（不含預約碼）；當天的預訂與有關聯預訂的項目是 Hard Constraint
  bookings?: BookingConstraint[];
}

export interface IncidentDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  loadContext: (tripId: string, date: string) => Promise<IncidentContext | null>;
  start: (
    tripId: string,
    level: IncidentPlan["level"],
    snapshot: Record<string, unknown>,
    availableMinutes: number | null,
    alternatives: IncidentPlan["alternatives"],
  ) => Promise<{ incidentId: string }>;
  now: () => Date;
  logError: (message: string) => void;
}

export interface IncidentActionResult {
  ok: boolean;
  message: string;
  incidentId?: string;
}

const RATE = { endpoint: "incident.start", limit: 10, windowSeconds: 60 } as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

const form = z.strictObject({
  tripId: uuid,
  date: isoDate,
  trigger: z.enum(["delay", "long_queue", "attraction_closed", "rail_disruption", "heavy_rain", "extreme_weather", "early_finish", "slot_cancelled", "flight_shift"]),
  itemId: optional(uuid),
  minutes: optional(z.coerce.number().int().min(1).max(600)),
  rainUntil: optional(hhmm),
  newFirstDate: optional(isoDate),
  newLastDate: optional(isoDate),
  companions: z.enum(["ok", "tired", "injured"]),
  luggage: z.enum(["none", "light", "heavy"]),
  lat: optional(z.coerce.number().min(-90).max(90)),
  lng: optional(z.coerce.number().min(-180).max(180)),
});
export type IncidentForm = z.input<typeof form>;

function tripDates(baseline: TripBaselineData): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${baseline.end_date}T00:00:00Z`);
  for (let t = Date.parse(`${baseline.start_date}T00:00:00Z`); t <= end && dates.length < 60; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function triggerOf(f: z.infer<typeof form>): IncidentTrigger | string {
  switch (f.trigger) {
    case "delay":
      return f.minutes ? { type: "delay", minutes: f.minutes } : "請輸入延誤分鐘數";
    case "long_queue":
    case "attraction_closed":
    case "rail_disruption":
    case "slot_cancelled":
      return f.itemId ? { type: f.trigger, itemId: f.itemId } : "請選擇受影響的項目";
    case "heavy_rain":
      return { type: "heavy_rain", until: f.rainUntil ?? null };
    case "extreme_weather":
      return { type: "extreme_weather" };
    case "early_finish":
      return { type: "early_finish" };
    case "flight_shift":
      return f.newFirstDate && f.newLastDate && f.newFirstDate <= f.newLastDate
        ? { type: "flight_shift", newFirstDate: f.newFirstDate, newLastDate: f.newLastDate }
        : "請輸入新的第一天與最後一天";
  }
}

export async function startIncidentAction(deps: IncidentDeps, raw: Record<string, unknown>): Promise<IncidentActionResult> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  const parsed = form.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "輸入內容不正確" };
  const f = parsed.data;
  const trigger = triggerOf(f);
  if (typeof trigger === "string") return { ok: false, message: trigger };

  const context = await deps.loadContext(f.tripId, f.date);
  if (!context) return { ok: false, message: "找不到這個行程" };
  if (!context.canEdit) return { ok: false, message: "只有 Owner 與 Companion 可以進入 Incident Mode" };
  if (context.tripStatus !== "locked" && context.tripStatus !== "in_progress") return { ok: false, message: "行程尚未鎖定" };
  const dates = tripDates(context.baseline);
  if (!dates.includes(f.date)) return { ok: false, message: "日期不在行程內" };

  const bookings = context.bookings ?? [];
  const booked = bookedItemIds(bookings);
  const scheduled = new Map(context.items.filter((i) => i.scheduled_date).map((i) => [i.id, i.scheduled_date]));
  const baseline = withBookings(context.baseline, bookings, (itemId) => scheduled.get(itemId) ?? null);
  const items = context.items.map((i) => (booked.has(i.id) ? { ...i, hard: true } : i));

  let plan: IncidentPlan;
  try {
    plan = planIncident({
      tripDates: dates,
      date: f.date,
      timezone: context.timezone,
      now: deps.now(),
      trigger,
      items,
      fixedActivities: baseline.fixed_activities.map((a) => ({ name: a.name, date: a.date, start: a.start, end: a.end ?? null })),
      location: f.lat !== undefined && f.lng !== undefined ? { lat: f.lat, lng: f.lng } : null,
      companions: f.companions,
      luggage: f.luggage,
      weather: context.weather,
      liveTransit: null,
      travel: (from, to) => context.segments.get(`${from ?? ""}>${to}`) ?? [],
      transportPreferences: context.baseline.transport_preferences,
    });
  } catch {
    return { ok: false, message: "受影響的項目不在當天行程中，或是 Hard Constraint" };
  }
  if (plan.alternatives.length === 0) return { ok: false, message: plan.warnings[0] ?? "沒有需要調整的項目，也沒有可放入的候選" };

  const available = plan.snapshot.time <= plan.scope.until ? minutesBetween(plan.snapshot.time, plan.scope.until) : 0;
  try {
    const { incidentId } = await deps.start(
      f.tripId,
      plan.level,
      { trigger, level: plan.level, scope: plan.scope, snapshot: plan.snapshot, warnings: plan.warnings },
      plan.scope.kind === "whole_trip" ? null : available,
      plan.alternatives,
    );
    return { ok: true, message: `已建立 ${plan.alternatives.length} 個替代方案，批准前行程不會改動`, incidentId };
  } catch (error) {
    if (error instanceof IncidentStoreError && error.reason === "forbidden") return { ok: false, message: "只有 Owner 與 Companion 可以進入 Incident Mode" };
    if (error instanceof IncidentStoreError && error.reason === "state") return { ok: false, message: "行程尚未鎖定" };
    deps.logError("Incident Mode 寫入失敗");
    return { ok: false, message: "進入 Incident Mode 失敗，請稍後再試" };
  }
}

const minutesBetween = (a: string, b: string) => Number(b.slice(0, 2)) * 60 + Number(b.slice(3, 5)) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5)));
