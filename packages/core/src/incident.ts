import type { ChangeKind, ChangeOperation, ChangePayload, Row, TripBaselineData } from "@atps/schemas";
import { classifyDelay, classifyIncident, type IncidentLevel } from "./approval";
import { availabilityOn, FIXED_ACTIVITY_BUFFER_MINUTES } from "./feasibility";
import { DAY_END, DEFAULT_TRAVEL_MINUTES, MEAL_WINDOWS } from "./schedule";
import { zonedMidnight } from "./states";
import { comparePlans, type StoredMobilityEstimate, type TransportMode } from "./transport";
import { classifyVersionKind } from "./versions";

// T38：Incident Mode（第 2.6、2.9 節，D10）。純函式：只計算，不寫入。
// 1. 分級（決策 0004）與 Current State Snapshot。
// 2. 只計算至下一個 Hard Constraint（最遲到達時間＝開始前 15 分鐘）；依第 2.6 節判定局部、全日或整趟重算。
// 3. 替代方案依同區域、鄰近區域、交換今日順序、使用另一日候選、刪減活動的次序產生，最多三個；
//    同一個即時分支的提案以同一 base version 建立，套用其一後其餘失效（第 2.9 節，資料庫 commit_proposal）。
// 4. 每個方案附推薦、最快、最便宜、最舒適交通與比較表；寫入只在使用者批准後經 approve_proposal。

type Item = Row<"itinerary_items">;
type Level3 = Item["weather_dependency"];

export interface IncidentItem {
  id: string;
  name_zh: string;
  type: Item["type"];
  zone_id: string | null;
  scheduled_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  // Hard Constraint（限制類別或固定活動，例如已付款活動）
  hard: boolean;
  priority: number;
  weather_dependency: Level3;
  suggested_stay_minutes: number;
  availability: Item["availability"];
  verification_status: Item["verification_status"];
  standby: boolean;
  cost: { amount: number; currency: string } | null;
  // 同分時的穩定排序
  order: number;
}

export type IncidentTrigger =
  | { type: "delay"; minutes: number }
  | { type: "long_queue"; itemId: string }
  | { type: "attraction_closed"; itemId: string }
  | { type: "rail_disruption"; itemId: string }
  | { type: "heavy_rain"; until: string | null }
  | { type: "extreme_weather" }
  | { type: "early_finish" }
  | { type: "slot_cancelled"; itemId: string }
  | { type: "flight_shift"; newFirstDate: string; newLastDate: string };

export const INCIDENT_TRIGGER_LABELS: Record<IncidentTrigger["type"], string> = {
  delay: "延誤",
  long_queue: "排隊過長",
  attraction_closed: "景點休館",
  rail_disruption: "鐵路中斷",
  heavy_rain: "大雨",
  extreme_weather: "極端天氣",
  early_finish: "提早完成",
  slot_cancelled: "取消時段",
  flight_shift: "航班改期",
};

export type CompanionStatus = "ok" | "tired" | "injured";
export type LuggageStatus = "none" | "light" | "heavy";

export interface IncidentPlanInput {
  tripDates: readonly string[];
  date: string;
  timezone: string;
  now: Date;
  trigger: IncidentTrigger;
  // 行程所有項目（已排入與候選）
  items: readonly IncidentItem[];
  // 基線的固定活動（沒有對應項目的 Hard Constraint）
  fixedActivities: ReadonlyArray<{ name: string; date: string; start: string; end: string | null }>;
  location: { lat: number; lng: number } | null;
  companions: CompanionStatus;
  luggage: LuggageStatus;
  weather: string | null;
  liveTransit: string | null;
  // 交通估算（T28，含緩衝）；沒有資料時為空陣列。from 為 null 表示目前位置
  travel: (fromId: string | null, toId: string) => readonly StoredMobilityEstimate[];
  transportPreferences: TripBaselineData["transport_preferences"];
}

export interface IncidentSnapshot {
  date: string;
  time: string;
  location: { lat: number; lng: number } | null;
  currentItem: string | null;
  companions: CompanionStatus;
  luggage: LuggageStatus;
  weather: string | null;
  liveTransit: string | null;
  completed: string[];
  nextFixed: { name: string; start: string } | null;
  latestArrival: string | null;
}

export interface IncidentScope {
  kind: "local" | "whole_day" | "whole_trip";
  date: string;
  from: string;
  until: string;
  // 需要替換或調整的項目
  itemIds: string[];
}

export const ALTERNATIVE_TIERS = ["compress", "same_zone", "nearby_zone", "swap_order", "other_day", "drop", "whole_trip"] as const;
export type AlternativeTier = (typeof ALTERNATIVE_TIERS)[number];

export const ALTERNATIVE_TIER_LABELS: Record<AlternativeTier, string> = {
  compress: "壓縮緩衝",
  same_zone: "同區域",
  nearby_zone: "鄰近區域",
  swap_order: "交換今日順序",
  other_day: "使用另一日候選",
  drop: "刪減活動",
  whole_trip: "整趟重算",
};

export interface TransportChoice {
  mode: TransportMode | null;
  minutes: number;
  price: { amount: number; currency: string } | null;
  walkMinutes: number | null;
  transfers: number | null;
  luggage: Level3 | null;
}

export interface TransportOptions {
  // 沒有交通估算時以預設時間計算
  estimated: boolean;
  recommended: TransportChoice;
  fastest: TransportChoice;
  cheapest: TransportChoice;
  comfortable: TransportChoice;
}

export interface ComparisonRow {
  newActivity: string[];
  arrival: string | null;
  // 最遲離開新活動的時間（趕上下一個項目或 Hard Constraint）
  leaveBy: string | null;
  cost: { amount: number; currency: string; complete: boolean };
  walkMinutes: number | null;
  transfers: number | null;
  luggageFit: Level3 | null;
  weatherRisk: Level3;
  affectsDinner: boolean;
  affectsTomorrow: boolean;
  experienceLoss: Level3;
  // 1–5
  score: number;
  recommended: boolean;
}

export interface IncidentAlternative {
  tier: AlternativeTier;
  change: ChangePayload;
  impactScope: { dates: string[]; from: string; until: string };
  transport: TransportOptions | null;
  comparison: ComparisonRow;
}

export interface IncidentPlan {
  level: IncidentLevel | "none";
  snapshot: IncidentSnapshot;
  scope: IncidentScope;
  alternatives: IncidentAlternative[];
  warnings: string[];
}

export const MAX_ALTERNATIVES = 3;
const ROUND_TO_MINUTES = 5;
const MIN_STAY_MINUTES = 30;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => {
  const day = Math.max(0, Math.min(1439, Math.round(m)));
  return `${String(Math.floor(day / 60)).padStart(2, "0")}:${String(day % 60).padStart(2, "0")}`;
};
const roundUp = (m: number) => Math.ceil(m / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;
const LEVEL: Record<Level3, number> = { low: 0, medium: 1, high: 2 };
const LEVELS: readonly Level3[] = ["low", "medium", "high"];
const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface Slotted extends IncidentItem {
  scheduled_date: string;
  scheduled_start: string;
  scheduled_end: string;
}

const isSlotted = (i: IncidentItem): i is Slotted => i.scheduled_date !== null && i.scheduled_start !== null && i.scheduled_end !== null;

interface Ctx {
  input: IncidentPlanInput;
  nowMin: number;
  today: Slotted[];
  current: Slotted | null;
  // 最遲到達下一個 Hard Constraint 的分鐘數；沒有時為當日結束
  untilMin: number;
  nextHard: { name: string; start: string } | null;
  rainUntil: number | null;
  avoidOutdoor: boolean;
}

function context(input: IncidentPlanInput): Ctx {
  const nowMin = Math.round((input.now.getTime() - zonedMidnight(input.date, input.timezone).getTime()) / 60_000);
  const today = input.items
    .filter(isSlotted)
    .filter((i) => i.scheduled_date === input.date)
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start) || a.order - b.order);
  const containing = today.find((i) => toMin(i.scheduled_start) <= nowMin && nowMin < toMin(i.scheduled_end));
  const ended = today.filter((i) => toMin(i.scheduled_end) <= nowMin);
  const hard = [
    ...today.filter((i) => i.hard).map((i) => ({ name: i.name_zh, start: i.scheduled_start })),
    ...input.fixedActivities.filter((f) => f.date === input.date).map((f) => ({ name: f.name, start: f.start })),
  ]
    .filter((h) => toMin(h.start) >= nowMin)
    .sort((a, b) => a.start.localeCompare(b.start));
  const nextHard = hard[0] ?? null;
  const t = input.trigger;
  return {
    input,
    nowMin,
    today,
    current: containing ?? ended.at(-1) ?? null,
    untilMin: nextHard ? toMin(nextHard.start) - FIXED_ACTIVITY_BUFFER_MINUTES : toMin(DAY_END),
    nextHard,
    rainUntil: t.type === "heavy_rain" && t.until ? toMin(t.until) : null,
    avoidOutdoor: t.type === "heavy_rain" || t.type === "extreme_weather",
  };
}

function snapshotOf(ctx: Ctx): IncidentSnapshot {
  const { input } = ctx;
  return {
    date: input.date,
    time: toHhmm(ctx.nowMin),
    location: input.location ? { lat: round3(input.location.lat), lng: round3(input.location.lng) } : null,
    currentItem: ctx.current?.name_zh ?? null,
    companions: input.companions,
    luggage: input.luggage,
    weather: input.weather,
    liveTransit: input.liveTransit,
    completed: ctx.today.filter((i) => toMin(i.scheduled_end) <= ctx.nowMin).map((i) => i.name_zh),
    nextFixed: ctx.nextHard,
    latestArrival: ctx.nextHard ? toHhmm(ctx.untilMin) : null,
  };
}

// 在下一個 Hard Constraint 之前、尚未結束、可調整的項目
const windowItems = (ctx: Ctx, untilMin = ctx.untilMin) =>
  ctx.today.filter((i) => !i.hard && toMin(i.scheduled_end) > ctx.nowMin && toMin(i.scheduled_start) < untilMin);

function todayItem(ctx: Ctx, id: string): Slotted {
  const found = ctx.today.find((i) => i.id === id);
  if (!found) throw new Error("觸發事件的項目不在當天行程中");
  if (found.hard) throw new Error("Hard Constraint 不在 Incident Mode 調整範圍");
  return found;
}

function targetsOf(ctx: Ctx): { kind: IncidentScope["kind"]; untilMin: number; targets: Slotted[] } {
  const t = ctx.input.trigger;
  const upcoming = windowItems(ctx).filter((i) => toMin(i.scheduled_start) >= ctx.nowMin);
  switch (t.type) {
    case "delay":
      // 第 2.6 節：景點延誤影響之後 1–2 個活動
      return { kind: "local", untilMin: ctx.untilMin, targets: upcoming.slice(0, 2) };
    case "long_queue":
    case "attraction_closed":
    case "rail_disruption":
    case "slot_cancelled":
      return { kind: "local", untilMin: ctx.untilMin, targets: [todayItem(ctx, t.itemId)] };
    case "heavy_rain": {
      const rainEnd = ctx.rainUntil ?? ctx.untilMin;
      return {
        kind: "local",
        untilMin: ctx.untilMin,
        targets: windowItems(ctx).filter((i) => i.weather_dependency !== "low" && toMin(i.scheduled_start) < rainEnd),
      };
    }
    case "extreme_weather": {
      // L4：重排整日；Hard Constraint 仍保留
      const end = toMin(DAY_END);
      return { kind: "whole_day", untilMin: end, targets: windowItems(ctx, end).filter((i) => i.weather_dependency !== "low") };
    }
    case "early_finish":
      return { kind: "local", untilMin: ctx.untilMin, targets: [] };
    case "flight_shift":
      return { kind: "whole_trip", untilMin: ctx.untilMin, targets: [] };
  }
}

function levelOf(ctx: Ctx): IncidentLevel | "none" {
  const t = ctx.input.trigger;
  if (t.type === "early_finish" || t.type === "slot_cancelled") return "none";
  if (t.type === "delay") {
    const lastEnd = Math.max(ctx.nowMin, ...windowItems(ctx).map((i) => toMin(i.scheduled_end)));
    const buffer = ctx.untilMin - (lastEnd + t.minutes);
    const level = classifyDelay({
      delayMinutes: t.minutes,
      bufferAfterCompressionMinutes: ctx.nextHard ? buffer : Number.POSITIVE_INFINITY,
      hardConstraintMissed: ctx.nextHard !== null && ctx.nowMin + t.minutes > ctx.untilMin,
    });
    return level;
  }
  return classifyIncident({ type: t.type });
}

function changeKindOf(level: IncidentLevel | "none", trigger: IncidentTrigger): ChangeKind {
  if (trigger.type === "flight_shift") return "major_version";
  if (trigger.type === "early_finish") return "add_candidate_to_gap";
  if (level === "none") return "minor_non_incident";
  return `incident_${level}`;
}

// 交通 -------------------------------------------------------------------

const choiceOf = (e: StoredMobilityEstimate): TransportChoice => ({
  mode: e.mode,
  minutes: e.total_minutes,
  price: e.price ? { amount: e.price.amount, currency: e.price.currency } : e.mode === "walk" ? { amount: 0, currency: "JPY" } : null,
  walkMinutes: e.walk_minutes,
  transfers: e.transfers,
  luggage: e.luggage_friendliness,
});

const DEFAULT_CHOICE: TransportChoice = { mode: null, minutes: DEFAULT_TRAVEL_MINUTES, price: null, walkMinutes: null, transfers: null, luggage: null };

function transportTo(ctx: Ctx, toId: string): TransportOptions {
  const estimates = ctx.input.travel(ctx.current?.id ?? null, toId);
  if (estimates.length === 0) {
    return { estimated: true, recommended: DEFAULT_CHOICE, fastest: DEFAULT_CHOICE, cheapest: DEFAULT_CHOICE, comfortable: DEFAULT_CHOICE };
  }
  const plans = comparePlans(estimates, ctx.input.transportPreferences);
  const find = (mode: TransportMode) => choiceOf(estimates.find((e) => e.mode === mode) ?? (estimates[0] as StoredMobilityEstimate));
  return {
    estimated: false,
    recommended: find(plans.recommended),
    fastest: find(plans.fastest),
    cheapest: find(plans.cheapest),
    comfortable: find(plans.comfortable),
  };
}

// 候選 -------------------------------------------------------------------

function openDuring(item: IncidentItem, date: string, start: number, end: number): boolean {
  const slots = availabilityOn(item, date);
  if (slots === null) return true;
  return slots.some(([s, e]) => toMin(s) <= start && end <= toMin(e));
}

function candidatePool(ctx: Ctx): IncidentItem[] {
  return ctx.input.items
    .filter((i) => i.scheduled_date === null && !i.hard)
    .filter((i) => i.verification_status === "verified" || i.verification_status === "partially_verified")
    .filter((i) => !ctx.avoidOutdoor || i.weather_dependency === "low")
    .sort((a, b) => Number(b.standby) - Number(a.standby) || b.priority - a.priority || a.order - b.order);
}

function zoneSets(ctx: Ctx, anchorZone: string | null) {
  const todayZones = new Set(ctx.today.map((i) => i.zone_id).filter((z): z is string => z !== null));
  return {
    same: (i: IncidentItem) => anchorZone !== null && i.zone_id === anchorZone,
    nearby: (i: IncidentItem) => i.zone_id !== null && i.zone_id !== anchorZone && todayZones.has(i.zone_id),
    other: (i: IncidentItem) => i.zone_id === null || !todayZones.has(i.zone_id),
  };
}

interface Placement {
  item: IncidentItem;
  start: number;
  end: number;
}

// 把候選放進時段：最早在抵達之後開始，至少停留 30 分鐘（或建議停留的一半）
function place(ctx: Ctx, item: IncidentItem, slotStart: number, slotEnd: number, arrival: number): Placement | null {
  const start = Math.max(slotStart, roundUp(arrival));
  const end = Math.min(slotEnd, start + item.suggested_stay_minutes);
  if (end - start < Math.min(item.suggested_stay_minutes, Math.max(MIN_STAY_MINUTES, Math.ceil(item.suggested_stay_minutes / 2)))) return null;
  if (!openDuring(item, ctx.input.date, start, end)) return null;
  return { item, start, end };
}

const scheduleOp = (itemId: string, date: string | null, start: number | null, end: number | null): ChangeOperation => ({
  op: "schedule_item",
  itemId,
  date,
  start: start === null ? null : toHhmm(start),
  end: end === null ? null : toHhmm(end),
});
const unscheduleOp = (itemId: string) => scheduleOp(itemId, null, null, null);

interface Draft {
  tier: AlternativeTier;
  operations: ChangeOperation[];
  added: Placement[];
  dropped: Slotted[];
  transport: TransportOptions | null;
}

function replacementDraft(ctx: Ctx, tier: AlternativeTier, targets: readonly Slotted[], pool: readonly IncidentItem[]): Draft | null {
  const used = new Set<string>();
  const operations: ChangeOperation[] = [];
  const added: Placement[] = [];
  const dropped: Slotted[] = [];
  let transport: TransportOptions | null = null;
  for (const target of targets) {
    operations.push(unscheduleOp(target.id));
    let placed: Placement | null = null;
    for (const candidate of pool) {
      if (used.has(candidate.id)) continue;
      const options = added.length === 0 ? transportTo(ctx, candidate.id) : null;
      const arrival = options ? ctx.nowMin + options.recommended.minutes : 0;
      placed = place(ctx, candidate, toMin(target.scheduled_start), toMin(target.scheduled_end), arrival);
      if (placed) {
        if (options) transport = options;
        break;
      }
    }
    if (placed) {
      used.add(placed.item.id);
      added.push(placed);
      operations.push(scheduleOp(placed.item.id, ctx.input.date, placed.start, placed.end));
    } else dropped.push(target);
  }
  return added.length > 0 ? { tier, operations, added, dropped, transport } : null;
}

// 交換今日順序：時段內其他可調整的項目與受影響項目互換時段；受影響項目換到的時段仍不適合時移回候選清單
function swapDraft(ctx: Ctx, targets: readonly Slotted[], untilMin: number): Draft | null {
  const t = ctx.input.trigger;
  const targetIds = new Set(targets.map((i) => i.id));
  const later = windowItems(ctx, untilMin).filter(
    (i) => !targetIds.has(i.id) && toMin(i.scheduled_start) >= ctx.nowMin && (!ctx.avoidOutdoor || i.weather_dependency === "low"),
  );
  const targetCanMove = (target: Slotted, slotStart: number) =>
    t.type === "delay" || t.type === "long_queue" || (t.type === "heavy_rain" && ctx.rainUntil !== null && slotStart >= ctx.rainUntil) ? target : null;
  const operations: ChangeOperation[] = [];
  const added: Placement[] = [];
  const dropped: Slotted[] = [];
  const remaining = [...targets].reverse();
  for (const swapIn of later) {
    const target = remaining.find((r) => toMin(swapIn.scheduled_start) > toMin(r.scheduled_start));
    if (!target) continue;
    const moved = targetCanMove(target, toMin(swapIn.scheduled_start));
    // 天氣：受影響項目換到的時段仍在下雨時不交換
    if (!moved && ctx.avoidOutdoor) continue;
    remaining.splice(remaining.indexOf(target), 1);
    operations.push(
      moved ? scheduleOp(target.id, ctx.input.date, toMin(swapIn.scheduled_start), toMin(swapIn.scheduled_end)) : unscheduleOp(target.id),
      scheduleOp(swapIn.id, ctx.input.date, toMin(target.scheduled_start), toMin(target.scheduled_end)),
    );
    if (!moved) dropped.push(target);
    added.push({ item: swapIn, start: toMin(target.scheduled_start), end: toMin(target.scheduled_end) });
  }
  for (const r of remaining) {
    operations.push(unscheduleOp(r.id));
    dropped.push(r);
  }
  if (added.length === 0) return null;
  added.sort((a, b) => a.start - b.start);
  const first = added[0] as Placement;
  return { tier: "swap_order", operations, added, dropped, transport: transportTo(ctx, first.item.id) };
}

// 延誤：受影響項目延後開始、保留結束時間（停留不到一半時改為刪減）
function compressDraft(ctx: Ctx, targets: readonly Slotted[], delay: number): Draft | null {
  const operations: ChangeOperation[] = [];
  let shiftEnd = ctx.nowMin;
  for (const target of targets) {
    const start = toMin(target.scheduled_start);
    const end = toMin(target.scheduled_end);
    const newStart = Math.max(start, roundUp(Math.max(start + (operations.length === 0 ? delay : 0), shiftEnd)));
    if (newStart === start) break;
    if (end - newStart < Math.ceil((end - start) / 2)) return null;
    operations.push(scheduleOp(target.id, ctx.input.date, newStart, end));
    shiftEnd = end;
  }
  return operations.length > 0 ? { tier: "compress", operations, added: [], dropped: [], transport: null } : null;
}

function earlyFinishDrafts(ctx: Ctx): Draft[] {
  const nextItem = ctx.today.find((i) => toMin(i.scheduled_start) > ctx.nowMin);
  const sets = zoneSets(ctx, ctx.current?.zone_id ?? null);
  const pool = candidatePool(ctx);
  const drafts: Draft[] = [];
  for (const [tier, belongs] of [
    ["same_zone", sets.same],
    ["nearby_zone", sets.nearby],
    ["other_day", sets.other],
  ] as const) {
    for (const candidate of pool.filter(belongs)) {
      const transport = transportTo(ctx, candidate.id);
      const leaveBy = leaveByFor(ctx, candidate.id, nextItem ?? null);
      const placed = place(ctx, candidate, ctx.nowMin, leaveBy, ctx.nowMin + transport.recommended.minutes);
      if (!placed) continue;
      drafts.push({
        tier,
        operations: [scheduleOp(candidate.id, ctx.input.date, placed.start, placed.end)],
        added: [placed],
        dropped: [],
        transport,
      });
      break;
    }
  }
  return drafts;
}

// 由新活動出發、趕上下一個項目（是 Hard Constraint 時另扣 15 分鐘）的最遲離開時間
function leaveByFor(ctx: Ctx, fromId: string, next: Slotted | null): number {
  if (!next) return ctx.untilMin - DEFAULT_TRAVEL_MINUTES;
  const estimates = ctx.input.travel(fromId, next.id);
  const minutes = estimates.length > 0 ? Math.min(...estimates.map((e) => e.total_minutes)) : DEFAULT_TRAVEL_MINUTES;
  return toMin(next.scheduled_start) - minutes - (next.hard ? FIXED_ACTIVITY_BUFFER_MINUTES : 0);
}

// 比較表 -----------------------------------------------------------------

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart;
const DINNER = MEAL_WINDOWS[1] ?? ["17:30", "19:30"];

function comparisonOf(ctx: Ctx, draft: Draft, targets: readonly Slotted[]): ComparisonRow {
  const byId = new Map(ctx.input.items.map((i) => [i.id, i]));
  const first = [...draft.added].sort((a, b) => a.start - b.start)[0];
  const costs = draft.added.map((a) => a.item.cost);
  const known = costs.filter((c): c is { amount: number; currency: string } => c !== null);
  const currency = known[0]?.currency ?? "JPY";
  const cost = {
    amount: known.filter((c) => c.currency === currency).reduce((sum, c) => sum + c.amount, 0),
    currency,
    complete: known.length === costs.length && known.every((c) => c.currency === currency),
  };

  const dinner = [toMin(DINNER[0]), toMin(DINNER[1])] as const;
  const affectsDinner = draft.operations.some((op) => {
    if (op.op !== "schedule_item") return false;
    const before = byId.get(op.itemId);
    const slots: Array<[number, number]> = [];
    if (before?.scheduled_date === ctx.input.date && before.scheduled_start && before.scheduled_end) slots.push([toMin(before.scheduled_start), toMin(before.scheduled_end)]);
    if (op.date === ctx.input.date && op.start && op.end) slots.push([toMin(op.start), toMin(op.end)]);
    return slots.some(([s, e]) => overlaps(s, e, dinner[0], dinner[1]) && (before?.type === "restaurant" || e > dinner[0]));
  });
  const affectsTomorrow = draft.operations.some((op) => {
    const before = byId.get(op.itemId);
    return (before?.scheduled_date ?? "") > ctx.input.date || (op.op === "schedule_item" && (op.date ?? "") > ctx.input.date);
  });

  const weatherRisk = LEVELS[Math.max(0, ...draft.added.map((a) => LEVEL[a.item.weather_dependency]))] ?? "low";

  // 體驗損失：移回候選清單的項目優先級，加上替換後優先級的減少
  const dropped = draft.dropped.reduce((sum, d) => sum + d.priority, 0);
  const replaced = targets.filter((t) => !draft.dropped.includes(t)).reduce((sum, t) => sum + t.priority, 0);
  const added = draft.added.reduce((sum, a) => sum + a.item.priority, 0);
  const replacing = draft.tier === "same_zone" || draft.tier === "nearby_zone" || draft.tier === "other_day";
  const delta = dropped + (replacing ? replaced - added : 0);
  const experienceLoss: Level3 =
    draft.tier !== "compress" && draft.added.length === 0 ? "high" : delta <= 0 ? "low" : delta <= 2 ? "medium" : "high";

  const travelMinutes = draft.transport?.recommended.minutes ?? 0;
  const score =
    5 -
    LEVEL[experienceLoss] -
    (ctx.avoidOutdoor ? LEVEL[weatherRisk] : 0) -
    (affectsDinner ? 1 : 0) -
    (affectsTomorrow ? 1 : 0) -
    (travelMinutes > DEFAULT_TRAVEL_MINUTES ? 1 : 0);

  const last = [...draft.added].sort((a, b) => a.start - b.start).at(-1);
  const nextAfter = last ? ctx.today.find((i) => toMin(i.scheduled_start) >= last.end && !draft.operations.some((o) => o.itemId === i.id)) : undefined;
  return {
    newActivity: [...draft.added].sort((a, b) => a.start - b.start).map((a) => a.item.name_zh),
    arrival: first ? toHhmm(first.start) : null,
    leaveBy: last ? toHhmm(leaveByFor(ctx, last.item.id, nextAfter ?? null)) : null,
    cost,
    walkMinutes: draft.transport?.recommended.walkMinutes ?? null,
    transfers: draft.transport?.recommended.transfers ?? null,
    luggageFit: draft.transport?.recommended.luggage ?? null,
    weatherRisk,
    affectsDinner,
    affectsTomorrow,
    experienceLoss,
    score: Math.max(1, Math.min(5, score)),
    recommended: false,
  };
}

function summaryOf(draft: Draft, comparison: ComparisonRow, trigger: IncidentTrigger): string {
  const label = ALTERNATIVE_TIER_LABELS[draft.tier];
  if (draft.tier === "compress") return `${label}：延後開始，保留結束時間`;
  if (draft.tier === "whole_trip") return `${label}：取消日期的項目移回候選清單`;
  const names = comparison.newActivity.join("、");
  const dropped = draft.dropped.map((d) => d.name_zh).join("、");
  const parts = [names ? `改為${names}` : "", dropped ? `${dropped}移回候選清單` : ""].filter(Boolean);
  return `${INCIDENT_TRIGGER_LABELS[trigger.type]}，${label}：${parts.join("；") || "留空"}`.slice(0, 500);
}

// 航班改期：新日期範圍以外的項目移回候選清單（整趟重算，Major）
function flightShiftPlan(ctx: Ctx, trigger: Extract<IncidentTrigger, { type: "flight_shift" }>): { alternatives: IncidentAlternative[]; warnings: string[] } {
  const outside = ctx.input.items
    .filter(isSlotted)
    .filter((i) => i.scheduled_date < trigger.newFirstDate || i.scheduled_date > trigger.newLastDate)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.scheduled_start.localeCompare(b.scheduled_start));
  const warnings = outside.filter((i) => i.hard).map((i) => `${i.name_zh}（${i.scheduled_date}）是 Hard Constraint，需另行處理預約或退款`);
  if (outside.length === 0) return { alternatives: [], warnings: ["新日期範圍內沒有需要移除的項目；新增的日期請由候選清單安排"] };
  const operations = outside.map((i) => unscheduleOp(i.id));
  const draft: Draft = { tier: "whole_trip", operations, added: [], dropped: outside, transport: null };
  const comparison = comparisonOf(ctx, draft, outside);
  const structural = ["flight_date" as const];
  return {
    alternatives: [
      {
        tier: "whole_trip",
        change: {
          changeKind: "major_version",
          versionKind: classifyVersionKind(operations, ctx.input.items, structural),
          summary: `航班改期（${trigger.newFirstDate} 至 ${trigger.newLastDate}）：${outside.length} 個項目移回候選清單`,
          reason: INCIDENT_TRIGGER_LABELS.flight_shift,
          structural,
          operations,
        },
        impactScope: { dates: [...ctx.input.tripDates], from: "00:00", until: "23:59" },
        transport: null,
        comparison: { ...comparison, recommended: true },
      },
    ],
    warnings,
  };
}

export function planIncident(input: IncidentPlanInput): IncidentPlan {
  const ctx = context(input);
  const snapshot = snapshotOf(ctx);
  const { kind, untilMin, targets } = targetsOf(ctx);
  const level = levelOf(ctx);
  const scope: IncidentScope = {
    kind,
    date: input.date,
    from: toHhmm(ctx.nowMin),
    until: toHhmm(untilMin),
    itemIds: targets.map((t) => t.id),
  };

  if (input.trigger.type === "flight_shift") {
    const { alternatives, warnings } = flightShiftPlan(ctx, input.trigger);
    return { level, snapshot, scope, alternatives, warnings };
  }

  let drafts: Draft[] = [];
  if (input.trigger.type === "early_finish") {
    drafts = earlyFinishDrafts(ctx);
  } else if (targets.length > 0) {
    const anchor = targets[0]?.zone_id ?? null;
    const sets = zoneSets(ctx, anchor);
    const pool = candidatePool(ctx);
    const candidates = [
      input.trigger.type === "delay" ? compressDraft(ctx, targets, input.trigger.minutes) : null,
      replacementDraft(ctx, "same_zone", targets, pool.filter(sets.same)),
      replacementDraft(ctx, "nearby_zone", targets, pool.filter(sets.nearby)),
      swapDraft(ctx, targets, untilMin),
      replacementDraft(ctx, "other_day", targets, pool.filter(sets.other)),
    ].filter((d): d is Draft => d !== null);
    drafts = candidates.slice(0, MAX_ALTERNATIVES);
    if (drafts.length < MAX_ALTERNATIVES) drafts.push({ tier: "drop", operations: targets.map((t) => unscheduleOp(t.id)), added: [], dropped: [...targets], transport: null });
  }

  const changeKind = changeKindOf(level, input.trigger);
  const alternatives: IncidentAlternative[] = drafts.map((draft) => {
    const comparison = comparisonOf(ctx, draft, targets);
    return {
      tier: draft.tier,
      change: {
        changeKind,
        versionKind: classifyVersionKind(draft.operations, input.items),
        summary: summaryOf(draft, comparison, input.trigger),
        reason: INCIDENT_TRIGGER_LABELS[input.trigger.type],
        operations: draft.operations,
      },
      impactScope: { dates: [input.date], from: scope.from, until: scope.until },
      transport: draft.transport,
      comparison,
    };
  });
  const best = alternatives.reduce<IncidentAlternative | null>((top, a) => (top === null || a.comparison.score > top.comparison.score ? a : top), null);
  if (best) best.comparison.recommended = true;
  return { level, snapshot, scope, alternatives, warnings: [] };
}
