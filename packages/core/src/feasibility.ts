import type { Row, TripBaselineData } from "@atps/schemas";
import { DEFAULT_TRAVEL_MINUTES, MEAL_WINDOWS, draftDays, type DayDraft, type DraftItem } from "./schedule";

// T30：可行性驗證。核查營業時間、休館日、預約時間、交通時間、首末班車、餐飲時段、步行量、行李、
// 同行者體力、天氣依賴、固定活動間緩衝。不符合的項目回到地理分區（留在 Candidate List）。
// 只計算，不寫入；批准經資料庫函式 approve_day。會擋下的條件在排入時即遵守，排不進去的項目回到地理分區。

type Item = Row<"itinerary_items">;

export const FEASIBILITY_CHECKS = [
  "opening_hours",
  "closed_day",
  "reservation",
  "travel_time",
  "first_last_train",
  "meal_time",
  "walking",
  "luggage",
  "stamina",
  "weather",
  "fixed_buffer",
] as const;
export type FeasibilityCheck = (typeof FEASIBILITY_CHECKS)[number];

export const BLOCKING_CHECKS: ReadonlySet<FeasibilityCheck> = new Set(["opening_hours", "closed_day", "travel_time", "fixed_buffer"]);

export const FEASIBILITY_LABELS: Record<FeasibilityCheck, string> = {
  opening_hours: "不在營業時間內",
  closed_day: "當天休館或公休",
  reservation: "需要預約，批准前確認預約時間",
  travel_time: "與前一站之間不足交通時間",
  first_last_train: "超出首班車或末班車時間，請確認回程交通",
  meal_time: "不在午餐或晚餐時段",
  walking: "當天步行量偏高",
  luggage: "搬運行李的日子，這段交通不便攜帶行李",
  stamina: "當天活動時間偏長，留意同行者體力",
  weather: "受天氣影響大，Morning Check 再確認",
  fixed_buffer: "與固定活動之間不足交通加緩衝",
};

export const FIXED_ACTIVITY_BUFFER_MINUTES = 15;
export const FIRST_TRAIN = "05:30";
export const LAST_TRAIN = "23:30";
export const WALK_LIMIT_MINUTES = 90;
export const STAMINA_LIMIT_MINUTES = 480;
// 基線有體力備註（例如長輩同行）時採用較低的上限
export const STAMINA_LIMIT_WITH_NOTE_MINUTES = 360;

export interface FeasibilityItem extends DraftItem {
  availability: Item["availability"];
  reservation_requirement: Item["reservation_requirement"];
  weather_dependency: Item["weather_dependency"];
}

export interface SegmentInfo {
  // 含緩衝的門到門分鐘數
  minutes: number;
  walk_minutes: number;
  luggage: "low" | "medium" | "high";
}

export interface FeasibilityInput {
  baseline: TripBaselineData;
  items: readonly FeasibilityItem[];
  segment: (fromId: string, toId: string) => SegmentInfo | null;
  dates?: readonly string[];
}

export interface FeasibilityIssue {
  check: FeasibilityCheck;
  date: string;
  item_id: string | null;
  blocking: boolean;
}

export interface ReturnedItem {
  item_id: string;
  date: string;
  checks: FeasibilityCheck[];
}

export interface FeasibilityPlan {
  days: DayDraft[];
  issues: FeasibilityIssue[];
  returned: ReturnedItem[];
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

// 當天的營業時段：沒有營業資料時為 null（未知）；指定日期的時段優先於星期；沒有適用時段為休館（空陣列）
export function availabilityOn(item: Pick<FeasibilityItem, "availability">, date: string): Array<[string, string]> | null {
  if (item.availability.length === 0) return null;
  const special = item.availability.filter((s) => s.date === date);
  const slots = special.length > 0 ? special : item.availability.filter((s) => s.date === undefined && s.weekday === weekdayOf(date));
  return slots.map((s) => [s.start, s.end] as [string, string]).sort((a, b) => a[0].localeCompare(b[0]));
}

// 搬運行李的日子：入住、退房、航班抵達或出發
function luggageDay(baseline: TripBaselineData, date: string): boolean {
  return (
    baseline.lodgings.some((l) => l.check_in === date || l.check_out === date) ||
    baseline.flights.some((f) => f.arrives_at.slice(0, 10) === date || f.departs_at.slice(0, 10) === date)
  );
}

export function checkDay(day: DayDraft, input: FeasibilityInput): FeasibilityIssue[] {
  const { date } = day;
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const issues: FeasibilityIssue[] = [];
  const add = (check: FeasibilityCheck, itemId: string | null) => {
    if (issues.some((x) => x.check === check && x.item_id === itemId)) return;
    issues.push({ check, date, item_id: itemId, blocking: itemId !== null && BLOCKING_CHECKS.has(check) });
  };
  const entries = [...day.entries].sort((a, b) => a.start.localeCompare(b.start));

  for (const entry of entries) {
    if (entry.kind !== "item") continue;
    const item = byId.get(entry.item_id);
    if (!item) continue;
    const windows = availabilityOn(item, date);
    if (windows !== null && windows.length === 0) add("closed_day", item.id);
    else if (windows !== null && !windows.some(([from, to]) => from <= entry.start && entry.end <= to)) add("opening_hours", item.id);
    if (item.reservation_requirement === "required") add("reservation", item.id);
    if (item.type === "restaurant" && !MEAL_WINDOWS.some(([from, to]) => from <= entry.start && entry.start <= to)) add("meal_time", item.id);
    if (item.weather_dependency === "high") add("weather", item.id);
  }

  let walk = 0;
  entries.forEach((entry, k) => {
    const next = entries[k + 1];
    if (!next) return;
    const prevId = entry.kind === "item" ? entry.item_id : null;
    const nextId = next.kind === "item" ? next.item_id : null;
    const seg = prevId && nextId ? input.segment(prevId, nextId) : null;
    const travel = seg?.minutes ?? DEFAULT_TRAVEL_MINUTES;
    const touchesFixed = prevId === null || nextId === null;
    const needed = travel + (touchesFixed ? FIXED_ACTIVITY_BUFFER_MINUTES : 0);
    if (toMin(next.start) - toMin(entry.end) < needed) add(touchesFixed ? "fixed_buffer" : "travel_time", nextId ?? prevId);
    walk += seg?.walk_minutes ?? 0;
    if (seg?.luggage === "low" && luggageDay(input.baseline, date)) add("luggage", nextId);
  });

  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first && last) {
    const early = toMin(first.start) - DEFAULT_TRAVEL_MINUTES < toMin(FIRST_TRAIN);
    const late = toMin(last.end) + DEFAULT_TRAVEL_MINUTES > toMin(LAST_TRAIN);
    if (early || late) add("first_last_train", null);
  }
  if (walk > WALK_LIMIT_MINUTES) add("walking", null);
  const active = entries.reduce((sum, e) => sum + (e.kind === "item" ? toMin(e.end) - toMin(e.start) : 0), 0);
  const limit = input.baseline.stamina_note ? STAMINA_LIMIT_WITH_NOTE_MINUTES : STAMINA_LIMIT_MINUTES;
  if (active > limit) add("stamina", null);
  return issues;
}

// 排入時即遵守會擋下的條件（營業時段、交通時間、固定活動前後的緩衝），排入後再逐日驗證。
// 放不下的項目回到地理分區、留在 Candidate List；仍有會擋下的問題時該日不可批准（blocked）
export function planFeasibleDays(input: FeasibilityInput): FeasibilityPlan {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const days = draftDays({
    baseline: input.baseline,
    items: input.items,
    travelMinutes: (from, to) => input.segment(from, to)?.minutes ?? null,
    openWindows: (id, date) => {
      const item = byId.get(id);
      return item ? availabilityOn(item, date) : null;
    },
    ...(input.dates ? { dates: input.dates } : {}),
    fixedBuffer: FIXED_ACTIVITY_BUFFER_MINUTES,
  });
  const issues = days.flatMap((d) => checkDay(d, input));

  const returned: ReturnedItem[] = [];
  for (const day of days) {
    for (const id of day.unplaced) {
      const item = byId.get(id);
      const windows = item ? availabilityOn(item, day.date) : null;
      const checks: FeasibilityCheck[] =
        windows === null ? [] : windows.length === 0 ? ["closed_day"] : windows.some(([from, to]) => toMin(to) - toMin(from) >= (item?.suggested_stay_minutes ?? 0)) ? [] : ["opening_hours"];
      returned.push({ item_id: id, date: day.date, checks });
    }
  }
  return { days: days.map((d) => ({ ...d, unplaced: [] })), issues, returned };
}

// 該日仍有會擋下的問題時不可批准
export const isDayBlocked = (issues: readonly FeasibilityIssue[], date: string) => issues.some((i) => i.date === date && i.blocking);

export interface ApprovalEntry {
  item_id: string;
  start: string;
  end: string;
  movable_from: string;
  movable_to: string;
}

// 批准一天時送給 approve_day 的內容；固定活動來自基線，不另外送出
export const dayApprovalEntries = (day: DayDraft): ApprovalEntry[] =>
  day.entries.flatMap((e) =>
    e.kind === "item" ? [{ item_id: e.item_id, start: e.start, end: e.end, movable_from: e.movable_from, movable_to: e.movable_to }] : [],
  );
