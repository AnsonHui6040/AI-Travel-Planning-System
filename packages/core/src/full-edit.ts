import type { ChangeOperation, UserItemFields } from "@atps/schemas";
import type { Placement } from "./item-edit";
import { DEFAULT_TRAVEL_MINUTES } from "./schedule";
import { segmentBuffer } from "./transport";

// 決策 0011：完整的行程編輯（純函式）。清單內編輯模式的自動順延、拖曳後的時段、批次內容、整天交換與行程日期。

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const LAST_MINUTE = 23 * 60 + 59;

export const TRAVEL_MODES = ["walk", "train", "bus", "taxi", "car"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

// 兩站之間的交通：使用者輸入（門到門分鐘）、AI 交通估算（T28，已含緩衝）或沒有資料
export type Leg = { source: "user"; minutes: number } | { source: "estimate"; minutes: number } | null;

// 排程用的間隔：使用者輸入的分鐘依 withBuffer 規則加每段固定緩衝（不知道轉乘次數，以 0 次計）；估算已含緩衝；沒有資料用預設
export function legGapMinutes(leg: Leg): number {
  if (!leg) return DEFAULT_TRAVEL_MINUTES;
  return leg.source === "user" ? leg.minutes + segmentBuffer(0) : leg.minutes;
}

export interface ShiftItem {
  itemId: string;
  // 期望的開始時間（使用者輸入或原本的時間）
  start: string;
  stayMinutes: number;
}

export interface ShiftInput {
  // 依當天順序
  items: readonly ShiftItem[];
  // 固定活動與預訂（Hard Constraint，不會移動）
  fixed: ReadonlyArray<{ name: string; start: string; end: string }>;
  travel: (from: string, to: string) => number;
  // 第一個有變更的位置：之前的項目不重算
  from: number;
  // false 為「不要順延」：每項照期望的時間，重疊由 checkDay 提示
  shift: boolean;
}

export interface ShiftResult {
  placements: Placement[];
  // 被順延的項目
  moved: string[];
  // 順延後超過當天，排不下
  overflow: string[];
}

// 自動順延：from 之後的每一項開始時間為 max(期望時間, 前一項結束＋交通)，遇到固定活動時排到其後；只往後移、不往前拉
export function shiftDay(input: ShiftInput): ShiftResult {
  const placements: Placement[] = [];
  const moved: string[] = [];
  const overflow: string[] = [];
  let previous: Placement | null = null;
  input.items.forEach((item, index) => {
    let start = toMin(item.start);
    if (input.shift && index > input.from && previous) {
      start = Math.max(start, toMin(previous.end) + input.travel(previous.itemId, item.itemId));
    }
    if (input.shift && index > input.from) {
      for (let changed = true; changed; ) {
        changed = false;
        for (const f of input.fixed) {
          if (start < toMin(f.end) && start + item.stayMinutes > toMin(f.start) && start !== toMin(f.end)) {
            start = toMin(f.end);
            changed = true;
          }
        }
      }
    }
    const end = start + item.stayMinutes;
    if (end > LAST_MINUTE) {
      overflow.push(item.itemId);
      return;
    }
    if (start !== toMin(item.start)) moved.push(item.itemId);
    const placement = { itemId: item.itemId, start: toHhmm(start), end: toHhmm(end) };
    placements.push(placement);
    previous = placement;
  });
  return { placements, moved, overflow };
}

// 拖曳後：每個位置沿用原本該位置的開始時間（保留午休等空檔），停留時間跟著項目；from 為第一個順序改變的位置
export function reorderDesired(original: readonly Placement[], order: readonly string[]): { items: ShiftItem[]; from: number } {
  const sorted = [...original].sort((a, b) => a.start.localeCompare(b.start));
  const byId = new Map(sorted.map((p) => [p.itemId, p]));
  const items = order.flatMap((id, index) => {
    const own = byId.get(id);
    const slot = sorted[index] ?? own;
    if (!own || !slot) return [];
    return [{ itemId: id, start: slot.start, stayMinutes: toMin(own.end) - toMin(own.start) }];
  });
  const changed = order.findIndex((id, index) => sorted[index]?.itemId !== id);
  return { items, from: changed < 0 ? order.length : changed };
}

export interface AddedItem {
  itemId: string;
  item: UserItemFields;
  start: string;
  end: string;
}

// 編輯模式「完成」：一個批次的變更（刪除、新增、時段有變的項目）
export function batchOperations(input: {
  date: string;
  before: readonly Placement[];
  after: readonly Placement[];
  removed: readonly string[];
  added: readonly AddedItem[];
}): ChangeOperation[] {
  const removed: ChangeOperation[] = input.removed.map((itemId) => ({ op: "remove_item", itemId }));
  const added: ChangeOperation[] = input.added.map((a) => ({ op: "add_item", itemId: a.itemId, item: a.item, date: input.date, start: a.start, end: a.end }));
  const addedIds = new Set(input.added.map((a) => a.itemId));
  const scheduled: ChangeOperation[] = input.after
    .filter((p) => !addedIds.has(p.itemId))
    .filter((p) => {
      const old = input.before.find((b) => b.itemId === p.itemId);
      return !old || old.start !== p.start || old.end !== p.end;
    })
    .map((p) => ({ op: "schedule_item", itemId: p.itemId, date: input.date, start: p.start, end: p.end }));
  return [...removed, ...added, ...scheduled];
}

// 整天交換：兩天的項目互換日期、時間不變（固定活動與預訂屬於日期，不跟著交換）
export function swapDaySlots(a: { date: string; placements: readonly Placement[] }, b: { date: string; placements: readonly Placement[] }): ChangeOperation[] {
  const move = (placements: readonly Placement[], date: string): ChangeOperation[] =>
    placements.map((p) => ({ op: "schedule_item", itemId: p.itemId, date, start: p.start, end: p.end }));
  return [...move(a.placements, b.date), ...move(b.placements, a.date)];
}

const datesBetween = (start: string, end: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

// 修改行程日期：新增與移除的日期，以及排在移除日期、要移回候選清單的項目
export function tripDateChange(
  before: { start: string; end: string },
  after: { start: string; end: string },
  scheduled: ReadonlyArray<{ itemId: string; date: string }>,
): { added: string[]; removed: string[]; unschedule: string[] } {
  const old = datesBetween(before.start, before.end);
  const next = datesBetween(after.start, after.end);
  const removed = old.filter((d) => !next.includes(d));
  return {
    added: next.filter((d) => !old.includes(d)),
    removed,
    unschedule: scheduled.filter((s) => removed.includes(s.date)).map((s) => s.itemId),
  };
}
