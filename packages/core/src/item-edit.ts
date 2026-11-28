import type { ChangeOperation, ChangePayload } from "@atps/schemas";
import type { DayDraft, DraftEntry } from "./schedule";
import type { DayStatus, TripStatus } from "./states";
import { classifyVersionKind } from "./versions";

// 決策 0010 E：行程編輯。純函式：生效方式、時段計算、手動排程的每日行程、鎖定後的提案內容。
// 鎖定前（且影響的日期都是草案）經資料庫函式直接寫入；鎖定後或該日已批准時成為待批准提案，批准規則不變。

export type EditMode = "direct" | "applied" | "proposal" | "closed";

// 決策 0011：鎖定前且影響的日期都是草案時 Owner、Companion 直接寫入（direct）；
// 鎖定後或該日已批准時 Owner 直接套用並留下 Change Log 與通知（applied），Companion 成為待批准提案（proposal）
export function editMode(tripStatus: TripStatus, affectedDays: readonly DayStatus[], role: "owner" | "companion"): EditMode {
  switch (tripStatus) {
    case "baseline":
    case "planning":
      if (affectedDays.every((d) => d === "draft")) return "direct";
      return role === "owner" ? "applied" : "proposal";
    case "locked":
    case "in_progress":
      return role === "owner" ? "applied" : "proposal";
    case "ended":
    case "archived":
      return "closed";
  }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const LAST_MINUTE = 23 * 60 + 59;

// 開始時間加停留分鐘；超過當天 23:59 時為 null
export function endFor(start: string, stayMinutes: number): string | null {
  const end = toMin(start) + stayMinutes;
  return end > LAST_MINUTE ? null : toHhmm(end);
}

export interface Placement {
  itemId: string;
  start: string;
  end: string;
}

// 與相鄰項目交換順序：兩項佔用的時間範圍不變，各自保留停留時間與中間的空檔
export function reorderSlots(placements: readonly Placement[], itemId: string, direction: "up" | "down"): Placement[] | null {
  const sorted = [...placements].sort((a, b) => a.start.localeCompare(b.start) || a.itemId.localeCompare(b.itemId));
  const index = sorted.findIndex((p) => p.itemId === itemId);
  if (index < 0) return null;
  const otherIndex = direction === "up" ? index - 1 : index + 1;
  const first = sorted[Math.min(index, otherIndex)];
  const second = sorted[Math.max(index, otherIndex)];
  if (otherIndex < 0 || !first || !second) return null;
  const gap = toMin(second.start) - toMin(first.end);
  const secondStay = toMin(second.end) - toMin(second.start);
  const firstStay = toMin(first.end) - toMin(first.start);
  const movedStart = toMin(first.start);
  const followStart = movedStart + secondStay + Math.max(0, gap);
  return [
    { itemId: second.itemId, start: toHhmm(movedStart), end: toHhmm(movedStart + secondStay) },
    { itemId: first.itemId, start: toHhmm(followStart), end: toHhmm(followStart + firstStay) },
  ];
}

export interface FixedActivity {
  date: string;
  name: string;
  start: string;
  end: string | null;
}

// 手動排程的日期：固定活動與成員排入的項目，依時間排序。可直接交給 checkDay 檢查
export function manualDayDraft(date: string, fixedActivities: readonly FixedActivity[], placements: readonly Placement[]): DayDraft {
  const fixed: DraftEntry[] = fixedActivities
    .filter((a) => a.date === date)
    .map((a) => ({ kind: "fixed", name: a.name, start: a.start, end: a.end ?? a.start }));
  const placed: DraftEntry[] = placements.map((p) => ({
    kind: "item",
    item_id: p.itemId,
    category: "flexible",
    start: p.start,
    end: p.end,
    travel_minutes_before: 0,
    movable_from: p.start,
    movable_to: p.start,
  }));
  return { date, zone_ids: [], entries: [...fixed, ...placed].sort((a, b) => a.start.localeCompare(b.start)), backups: [], unplaced: [] };
}

// 第一次手動編輯時，把自動草案的時段寫入資料庫，之後以資料庫中的排程為準
export const draftPlacements = (day: DayDraft) =>
  day.entries.flatMap((e) => (e.kind === "item" ? [{ itemId: e.item_id, date: day.date, start: e.start, end: e.end }] : []));

const short = (date: string) => date.slice(5).replace("-", "/");

function describe(op: ChangeOperation, nameOf: (id: string) => string): string {
  switch (op.op) {
    case "add_item":
      return `新增${op.item.name_zh}`;
    case "update_item":
      return `修改${nameOf(op.itemId)}`;
    case "remove_item":
      return `刪除${nameOf(op.itemId)}`;
    case "schedule_item":
      return op.date === null ? `${nameOf(op.itemId)}移回候選清單` : `${nameOf(op.itemId)}移到 ${short(op.date)} ${op.start ?? ""}`.trim();
    case "set_at_risk":
      return `${nameOf(op.itemId)}${op.atRisk ? "標示 At Risk" : "取消 At Risk"}`;
  }
}

// 鎖定後成員編輯的提案：依第 2.7 節判定版本類型，Major 為 major_version，其餘為 minor_non_incident（都需批准）
export function memberChange(
  operations: readonly ChangeOperation[],
  items: ReadonlyArray<{ id: string; scheduled_date: string | null; name_zh: string }>,
  summary?: string,
): ChangePayload {
  const versionKind = classifyVersionKind(operations, items);
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name_zh ?? "項目";
  const text = summary ?? [...new Set(operations.map((op) => describe(op, nameOf)))].join("、");
  return {
    changeKind: versionKind === "major" ? "major_version" : "minor_non_incident",
    versionKind,
    summary: text.slice(0, 500),
    operations: [...operations],
  };
}
