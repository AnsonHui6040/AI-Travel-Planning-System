// 第 2.6 節批准規則、Incident 分級、重算範圍。分級邊界見 docs/decisions/0004-delay-levels.md。

import type { ChangeKind } from "@atps/schemas";

export type { ChangeKind };

export interface ApprovalRule {
  apply: "auto" | "approval";
  notify: boolean;
  log: boolean;
  markAtRisk: boolean;
  prompt: boolean;
}

const rule = (apply: ApprovalRule["apply"], flags: Partial<Omit<ApprovalRule, "apply">> = {}): ApprovalRule => ({
  apply,
  notify: false,
  log: false,
  markAtRisk: false,
  prompt: false,
  ...flags,
});

const needsApproval = rule("approval", { notify: true, log: true });

// D10、決策 0005：行程與事實資料的改動一律需使用者確認；只有不改動行程內容的三類自動
const APPROVAL_RULES: Record<ChangeKind, ApprovalRule> = {
  new_candidate: rule("auto"),
  candidate_verification_update: rule("auto"),
  fact_correction: needsApproval,
  approved_fact_invalidated: rule("auto", { notify: true, log: true, markAtRisk: true }),
  reschedule_after_invalidation: needsApproval,
  incident_L1: needsApproval,
  incident_L2: needsApproval,
  incident_L3: needsApproval,
  incident_L4: needsApproval,
  major_version: needsApproval,
  minor_non_incident: needsApproval,
  add_candidate_to_gap: rule("approval", { log: true, prompt: true }),
};

export const approvalRule = (kind: ChangeKind): ApprovalRule => APPROVAL_RULES[kind];

// Incident 分級 -------------------------------------------------------------

export type IncidentLevel = "L1" | "L2" | "L3" | "L4";
export const L1_MIN_BUFFER_MINUTES = 15;

export interface DelayInput {
  delayMinutes: number;
  bufferAfterCompressionMinutes: number;
  hardConstraintMissed: boolean;
}

export function classifyDelay(input: DelayInput): IncidentLevel | "none" {
  if (input.delayMinutes < 0) throw new Error("延誤分鐘數不可為負數");
  if (input.hardConstraintMissed) return "L3";
  if (input.delayMinutes <= 9) return "none";
  if (input.delayMinutes <= 20) {
    return input.bufferAfterCompressionMinutes < L1_MIN_BUFFER_MINUTES ? "L2" : "L1";
  }
  if (input.delayMinutes <= 60) return "L2";
  return "L3";
}

export type IncidentInput =
  | ({ type: "delay" } & DelayInput)
  | { type: "long_queue" }
  | { type: "attraction_closed" }
  | { type: "rail_disruption" }
  | { type: "flight_cancelled" }
  | { type: "extreme_weather" };

export function classifyIncident(incident: IncidentInput): IncidentLevel | "none" {
  switch (incident.type) {
    case "delay":
      return classifyDelay(incident);
    case "long_queue":
      return "L2";
    case "attraction_closed":
    case "rail_disruption":
      return "L3";
    case "flight_cancelled":
    case "extreme_weather":
      return "L4";
  }
}

// 重算範圍 ---------------------------------------------------------------

export interface ScheduledEntry {
  id: string;
  date: string;
  start: string;
  area: string;
  mealSlot: "breakfast" | "lunch" | "dinner" | null;
  weatherDependency: "low" | "medium" | "high";
  routes: readonly string[];
  touchesLodging: boolean;
}

export type RecomputeEvent =
  | { type: "attraction_delay"; itemId: string }
  | { type: "restaurant_full"; itemId: string }
  | { type: "attraction_closed"; itemId: string }
  | { type: "rain"; date?: string }
  | { type: "rail_partial_suspension"; routeId: string }
  | { type: "fixed_activity_reschedule"; fromDate: string; toDate: string }
  | { type: "hotel_change" }
  | { type: "flight_shift" }
  | { type: "companion_limited"; fromDate: string; fromTime: string };

const NEXT_ACTIVITIES_AFTER_DELAY = 2;
const NOON = "12:00";

const byTime = (a: ScheduledEntry, b: ScheduledEntry) =>
  a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date);

const isAfternoon = (entry: ScheduledEntry) => entry.start >= NOON;

// 回傳受影響的行程項目編號，依時間排序
export function recomputeScope(event: RecomputeEvent, entries: readonly ScheduledEntry[]): string[] {
  const sorted = [...entries].sort(byTime);
  const pick = (predicate: (e: ScheduledEntry) => boolean) => sorted.filter(predicate).map((e) => e.id);

  if ("itemId" in event) {
    const target = sorted.find((e) => e.id === event.itemId);
    if (!target) throw new Error("找不到觸發事件的行程項目");
    switch (event.type) {
      case "attraction_delay": {
        const later = sorted.filter((e) => e.date === target.date && e.start > target.start);
        return later.slice(0, NEXT_ACTIVITIES_AFTER_DELAY).map((e) => e.id);
      }
      case "restaurant_full":
        return pick((e) => e.date === target.date && e.mealSlot !== null && e.mealSlot === target.mealSlot);
      case "attraction_closed":
        return pick((e) => e.date === target.date && e.area === target.area && isAfternoon(e) === isAfternoon(target));
    }
  }

  switch (event.type) {
    case "rain":
      return pick((e) => e.weatherDependency !== "low" && (!event.date || e.date === event.date));
    case "rail_partial_suspension":
      return pick((e) => e.routes.includes(event.routeId));
    case "fixed_activity_reschedule":
      return pick((e) => e.date === event.fromDate || e.date === event.toDate);
    case "hotel_change":
      return pick((e) => e.touchesLodging);
    case "flight_shift":
      return pick(() => true);
    case "companion_limited":
      return pick((e) => e.date > event.fromDate || (e.date === event.fromDate && e.start >= event.fromTime));
  }
}
