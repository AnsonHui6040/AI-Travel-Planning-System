import type { TripBaselineData } from "@atps/schemas";
import { zonedTime } from "./states";

// T23：旅行基線的三類限制分類（第 2.4 節：Hard Constraint、Strong Preference、Flexible）與矛盾檢查（E5）。
// 矛盾（conflict）必須先處理才能確認 Trip Baseline v1；提醒（warning）只顯示。

export type ConstraintCategory = "hard" | "strong_preference" | "flexible";

export const CONSTRAINT_CATEGORY_LABELS: Record<ConstraintCategory, string> = {
  hard: "Hard Constraint",
  strong_preference: "Strong Preference",
  flexible: "Flexible",
};

export type BaselineConstraintKind =
  | "trip_dates"
  | "flight"
  | "lodging"
  | "fixed_activity"
  | "paid_item"
  | "excluded"
  | "must_visit"
  | "stamina"
  | "budget"
  | "transport"
  | "photography";

export interface BaselineConstraint {
  category: ConstraintCategory;
  kind: BaselineConstraintKind;
  label: string;
}

export interface BaselineIssue {
  severity: "conflict" | "warning";
  code:
    | "flight_times_invalid"
    | "flight_outside_trip"
    | "lodging_dates_invalid"
    | "lodging_outside_trip"
    | "lodgings_overlap"
    | "night_without_lodging"
    | "activity_outside_trip"
    | "activity_end_before_start"
    | "activities_overlap"
    | "activity_during_flight"
    | "check_in_too_close"
    | "check_in_area_unknown"
    | "must_visit_excluded";
  message: string;
}

// 入住後到另一區活動至少需要的時間；沒有結束時間的活動以 60 分鐘計算
export const MIN_CHECK_IN_TO_OTHER_AREA_MINUTES = 60;
export const DEFAULT_ACTIVITY_MINUTES = 60;
// 航班可以比旅行日期早一天或晚一天（例如前一晚出發的紅眼班機）
const FLIGHT_DATE_SLACK_DAYS = 1;

const TRANSPORT_LABELS: Record<TripBaselineData["transport_preferences"][number], string> = {
  walk: "步行",
  rail: "鐵路",
  bus: "公車",
  taxi: "計程車",
  drive: "自駕",
};

export function classifyBaseline(data: TripBaselineData): BaselineConstraint[] {
  const hard: BaselineConstraint[] = [];
  const strong: BaselineConstraint[] = [];
  const flexible: BaselineConstraint[] = [];
  const add = (list: BaselineConstraint[], category: ConstraintCategory, kind: BaselineConstraintKind, label: string) =>
    list.push({ category, kind, label });

  add(hard, "hard", "trip_dates", `旅行日期 ${data.start_date} 至 ${data.end_date}`);
  for (const f of data.flights) add(hard, "hard", "flight", `航班：${f.label}`);
  for (const l of data.lodgings) add(hard, "hard", "lodging", `住宿：${l.name}（${l.check_in} 至 ${l.check_out}）`);
  for (const a of data.fixed_activities) {
    const when = `${a.date} ${a.start}`;
    if (a.paid) add(hard, "hard", "fixed_activity", `已付款固定活動：${a.name}（${when}）`);
    else add(strong, "strong_preference", "fixed_activity", `固定活動：${a.name}（${when}）`);
  }
  for (const p of data.paid_items) add(hard, "hard", "paid_item", `已付款項目：${p}`);
  for (const e of data.excluded) add(hard, "hard", "excluded", `排除地點：${e}`);
  for (const m of data.must_visit) add(strong, "strong_preference", "must_visit", `必去地點：${m}`);
  if (data.stamina_note) add(strong, "strong_preference", "stamina", `體力限制：${data.stamina_note}`);
  if (data.budget) add(strong, "strong_preference", "budget", `預算：${data.budget.amount} ${data.budget.currency}`);
  if (data.transport_preferences.length > 0) {
    add(flexible, "flexible", "transport", `交通偏好：${data.transport_preferences.map((t) => TRANSPORT_LABELS[t]).join("、")}`);
  }
  if (data.photography_needs) add(flexible, "flexible", "photography", `攝影需求：${data.photography_needs}`);
  return [...hard, ...strong, ...flexible];
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function localDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

type Activity = TripBaselineData["fixed_activities"][number];

function activityWindow(a: Activity): [number, number] {
  const start = toMinutes(a.start);
  return [start, a.end !== null ? toMinutes(a.end) : start + DEFAULT_ACTIVITY_MINUTES];
}

function pairs<T>(list: readonly T[]): Array<[T, T]> {
  return list.flatMap((a, i) => list.slice(i + 1).map((b): [T, T] => [a, b]));
}

const normalize = (s: string) => s.trim().normalize("NFKC").toLowerCase();

export function checkBaseline(data: TripBaselineData): BaselineIssue[] {
  const issues: BaselineIssue[] = [];
  const conflict = (code: BaselineIssue["code"], message: string) => issues.push({ severity: "conflict", code, message });
  const warning = (code: BaselineIssue["code"], message: string) => issues.push({ severity: "warning", code, message });
  const inTrip = (date: string) => date >= data.start_date && date <= data.end_date;

  // 航班
  const flightWindows: Array<{ label: string; from: number; to: number }> = [];
  for (const f of data.flights) {
    const from = Date.parse(f.departs_at);
    const to = Date.parse(f.arrives_at);
    if (to <= from) {
      conflict("flight_times_invalid", `航班 ${f.label} 的抵達時間不晚於出發時間`);
      continue;
    }
    flightWindows.push({ label: f.label, from, to });
    const dep = localDate(f.departs_at, data.timezone);
    const arr = localDate(f.arrives_at, data.timezone);
    const earliest = addDays(data.start_date, -FLIGHT_DATE_SLACK_DAYS);
    const latest = addDays(data.end_date, FLIGHT_DATE_SLACK_DAYS);
    if (arr < earliest || dep > latest) warning("flight_outside_trip", `航班 ${f.label} 的日期離旅行日期超過 ${FLIGHT_DATE_SLACK_DAYS} 天`);
  }

  // 住宿
  const validLodgings = data.lodgings.filter((l) => {
    if (l.check_out <= l.check_in) {
      conflict("lodging_dates_invalid", `${l.name} 的退房日期不晚於入住日期`);
      return false;
    }
    if (l.check_in < data.start_date || l.check_out > data.end_date) conflict("lodging_outside_trip", `${l.name} 的住宿日期超出旅行日期`);
    return true;
  });
  for (const [a, b] of pairs(validLodgings)) {
    if (a.check_in < b.check_out && b.check_in < a.check_out) conflict("lodgings_overlap", `${a.name} 與 ${b.name} 的住宿夜晚重疊`);
  }
  const uncovered: string[] = [];
  for (let night = data.start_date; night < data.end_date; night = addDays(night, 1)) {
    if (!validLodgings.some((l) => l.check_in <= night && night < l.check_out)) uncovered.push(night);
  }
  if (uncovered.length > 0) warning("night_without_lodging", `${uncovered.join("、")} 晚上沒有住宿`);

  // 固定活動
  const validActivities = data.fixed_activities.filter((a) => {
    if (!inTrip(a.date)) {
      conflict("activity_outside_trip", `${a.name}（${a.date}）不在旅行日期內`);
      return false;
    }
    if (a.end !== null && a.end <= a.start) {
      conflict("activity_end_before_start", `${a.name} 的結束時間不晚於開始時間`);
      return false;
    }
    return true;
  });
  for (const [a, b] of pairs(validActivities)) {
    if (a.date !== b.date) continue;
    const [as, ae] = activityWindow(a);
    const [bs, be] = activityWindow(b);
    if (as < be && bs < ae) conflict("activities_overlap", `${a.date} ${a.name} 與 ${b.name} 時間重疊`);
  }
  for (const a of validActivities) {
    const [s, e] = activityWindow(a);
    const from = zonedTime(a.date, a.start, data.timezone).getTime();
    const to = from + (e - s) * 60_000;
    for (const f of flightWindows) {
      if (from < f.to && f.from < to) conflict("activity_during_flight", `${a.date} ${a.name} 與航班 ${f.label} 的時間重疊`);
    }
  }

  // 入住後趕往另一區（E5）
  for (const l of validLodgings) {
    if (l.check_in_time === null) continue;
    const checkIn = toMinutes(l.check_in_time);
    for (const a of validActivities) {
      if (a.date !== l.check_in) continue;
      const gap = toMinutes(a.start) - checkIn;
      if (gap < 0 || gap >= MIN_CHECK_IN_TO_OTHER_AREA_MINUTES) continue;
      if (l.area === null || a.area === null) {
        warning("check_in_area_unknown", `${a.date} ${l.check_in_time} 入住${l.name}，${a.start} 有${a.name}，地區未填，請確認時間是否足夠`);
      } else if (normalize(l.area) !== normalize(a.area)) {
        conflict(
          "check_in_too_close",
          `${a.date} ${l.check_in_time} 在${l.area}入住${l.name}，${a.start} 要在${a.area}參加${a.name}，不同地區之間只有 ${gap} 分鐘`,
        );
      }
    }
  }

  // 必去與排除
  const excluded = new Set(data.excluded.map(normalize));
  for (const m of data.must_visit) {
    if (excluded.has(normalize(m))) conflict("must_visit_excluded", `${m.trim()}同時列為必去與排除`);
  }
  return issues;
}

export const canConfirmBaseline = (data: TripBaselineData): boolean => checkBaseline(data).every((i) => i.severity !== "conflict");
