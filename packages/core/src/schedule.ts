import type { Row, TripBaselineData } from "@atps/schemas";
import { canEnterDraft } from "./states";

// T29：每日時段草案。排程順序：固定活動、時段敏感活動、高優先景點、餐飲、彈性活動、Backup。
// 只排入 Verified 與 Partially Verified（D07）；Backup 列在當天的 Backup 清單，不排入時段。
// 每個分區排在同一天；項目之間加入交通時間（有 T28 估算時採用，否則以 30 分鐘計）。
// 草案只是計算結果，不寫入行程；批准與鎖定於 T30。

type Item = Row<"itinerary_items">;

export const DAY_START = "09:00";
export const DAY_END = "21:00";
export const DEFAULT_TRAVEL_MINUTES = 30;
export const MEAL_WINDOWS: readonly [string, string][] = [
  ["11:30", "13:30"],
  ["17:30", "19:30"],
];

export const SCHEDULE_ORDER = ["fixed", "time_sensitive", "high_priority", "meal", "flexible", "backup"] as const;
export type ScheduleCategory = (typeof SCHEDULE_ORDER)[number];

export interface DraftItem {
  id: string;
  name_zh: string;
  type: Item["type"];
  suggested_stay_minutes: number;
  priority: number;
  candidate_role: Item["candidate_role"];
  verification_status: Item["verification_status"];
  zone_id: string | null;
  score_time_slot_dependency: number;
}

export type DraftEntry =
  | { kind: "fixed"; name: string; start: string; end: string }
  | {
      kind: "item";
      item_id: string;
      category: Exclude<ScheduleCategory, "fixed" | "backup">;
      start: string;
      end: string;
      travel_minutes_before: number;
      movable_from: string;
      movable_to: string;
    };

export interface DayDraft {
  date: string;
  zone_ids: string[];
  entries: DraftEntry[];
  backups: string[];
  unplaced: string[];
}

export function categorizeForSchedule(item: DraftItem): Exclude<ScheduleCategory, "fixed"> {
  if (item.candidate_role === "backup") return "backup";
  if (item.score_time_slot_dependency <= 2 || item.type === "photography") return "time_sensitive";
  if (item.priority >= 4) return "high_priority";
  if (item.type === "restaurant") return "meal";
  return "flexible";
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function dates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

interface Slot {
  id: string;
  start: number;
  end: number;
}

export interface DraftInput {
  baseline: TripBaselineData;
  items: readonly DraftItem[];
  // 由 from 到 to 的交通分鐘數（含緩衝）；沒有估算時回傳 null
  travelMinutes: (fromId: string, toId: string) => number | null;
}

export function draftDays(input: DraftInput): DayDraft[] {
  const { baseline } = input;
  const days = dates(baseline.start_date, baseline.end_date);
  const eligible = input.items.filter((i) => canEnterDraft(i.verification_status));
  const primary = eligible.filter((i) => i.candidate_role !== "backup");

  // 分區依候選數排序，輪流分配到每一天
  const groups = new Map<string, DraftItem[]>();
  for (const i of primary) groups.set(i.zone_id ?? "", [...(groups.get(i.zone_id ?? "") ?? []), i]);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const zonesOf = days.map(() => [] as string[]);
  ordered.forEach(([zone], i) => zonesOf[i % days.length]?.push(zone));

  const rank = (i: DraftItem) => SCHEDULE_ORDER.indexOf(categorizeForSchedule(i));
  const dayStart = toMin(DAY_START);
  const dayEnd = toMin(DAY_END);

  return days.map((date, dayIndex) => {
    const zones = zonesOf[dayIndex] ?? [];
    const fixed: Slot[] = baseline.fixed_activities
      .filter((a) => a.date === date)
      .map((a, k) => ({ id: `fixed:${k}`, start: toMin(a.start), end: a.end ? toMin(a.end) : toMin(a.start) + 60 }));
    const fixedNames = new Map(baseline.fixed_activities.filter((a) => a.date === date).map((a, k) => [`fixed:${k}`, a.name]));
    const timeline: Slot[] = [...fixed];
    const placed = new Map<string, { item: DraftItem; travel: number }>();
    const unplaced: string[] = [];

    const todays = primary
      .filter((i) => zones.includes(i.zone_id ?? ""))
      .sort((a, b) => rank(a) - rank(b) || b.priority - a.priority || a.name_zh.localeCompare(b.name_zh) || a.id.localeCompare(b.id));

    for (const item of todays) {
      const stay = item.suggested_stay_minutes;
      const sorted = [...timeline].sort((a, b) => a.start - b.start);
      // 每個空檔的最早開始時間：一天開始，或前一個項目結束加交通
      const options = [
        { start: dayStart, travel: 0, limit: sorted[0]?.start ?? dayEnd },
        ...sorted.map((slot, k) => {
          const travel = input.travelMinutes(slot.id, item.id) ?? DEFAULT_TRAVEL_MINUTES;
          return { start: slot.end + travel, travel, limit: sorted[k + 1]?.start ?? dayEnd };
        }),
      ];
      const fits = (start: number, limit: number) => start >= dayStart && start + stay <= Math.min(limit, dayEnd);
      let chosen: { start: number; travel: number } | null = null;
      if (item.type === "restaurant") {
        for (const [from, to] of MEAL_WINDOWS) {
          for (const o of options) {
            const start = Math.max(o.start, toMin(from));
            if (start <= toMin(to) && fits(start, o.limit)) {
              chosen = { start, travel: o.travel };
              break;
            }
          }
          if (chosen) break;
        }
      }
      if (!chosen) {
        const o = options.find((x) => fits(x.start, x.limit));
        if (o) chosen = { start: o.start, travel: o.travel };
      }
      if (!chosen) {
        unplaced.push(item.id);
        continue;
      }
      timeline.push({ id: item.id, start: chosen.start, end: chosen.start + stay });
      placed.set(item.id, { item, travel: chosen.travel });
    }

    const sorted = [...timeline].sort((a, b) => a.start - b.start);
    const entries: DraftEntry[] = sorted.map((slot, k) => {
      const name = fixedNames.get(slot.id);
      if (name !== undefined) return { kind: "fixed", name, start: toHhmm(slot.start), end: toHhmm(slot.end) };
      const info = placed.get(slot.id);
      const prev = sorted[k - 1];
      const next = sorted[k + 1];
      const stay = slot.end - slot.start;
      const earliest = prev ? prev.end + (input.travelMinutes(prev.id, slot.id) ?? DEFAULT_TRAVEL_MINUTES) : dayStart;
      // 最晚開始：下一個項目開始前，扣掉停留與到下一站的交通
      const latest = next ? next.start - (input.travelMinutes(slot.id, next.id) ?? DEFAULT_TRAVEL_MINUTES) - stay : dayEnd - stay;
      return {
        kind: "item",
        item_id: slot.id,
        category: categorizeForSchedule(info?.item as DraftItem) as Exclude<ScheduleCategory, "fixed" | "backup">,
        start: toHhmm(slot.start),
        end: toHhmm(slot.end),
        travel_minutes_before: info?.travel ?? 0,
        movable_from: toHhmm(Math.min(earliest, slot.start)),
        movable_to: toHhmm(Math.max(latest, slot.start)),
      };
    });

    const backups = eligible
      .filter((i) => i.candidate_role === "backup")
      .filter((i) => (zones.includes(i.zone_id ?? "") ? true : dayIndex === 0 && !zonesOf.some((z) => z.includes(i.zone_id ?? ""))))
      .map((i) => i.id);
    return { date, zone_ids: zones, entries, backups, unplaced };
  });
}
