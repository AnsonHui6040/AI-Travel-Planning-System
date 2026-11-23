// T10A：復原任何舊版本（D10、決策 0005）。復原建立內容相同的新版本，原有版本紀錄不變。
// 只復原排程（日期與時間）；At Risk 屬事實資料，復原不清除，避免蓋掉已知的休館或停駛。

import { scheduleSnapshot } from "@atps/schemas";
import type { ItineraryItem, RestoreResult, VersionRestorer, VersionRow } from "./ports";
import type { VersionKind } from "./versions";

export interface Slot {
  date: string | null;
  start: string | null;
  end: string | null;
}

export interface RestoreChange {
  itemId: string;
  from: Slot;
  to: Slot;
}

export interface RestorePreview {
  changes: RestoreChange[];
  versionKind: VersionKind;
}

type ScheduledItem = Pick<ItineraryItem, "id" | "scheduled_date" | "scheduled_start" | "scheduled_end">;

const UNSCHEDULED: Slot = { date: null, start: null, end: null };

const sameSlot = (a: Slot, b: Slot) => a.date === b.date && a.start === b.start && a.end === b.end;

// 供確認畫面列出復原會改動哪些項目；判定版本類型與第 2.7 節相同（換日或影響兩天以上為 Major）
export function restorePreview(snapshot: unknown, items: readonly ScheduledItem[]): RestorePreview {
  const target = new Map(scheduleSnapshot.parse(snapshot).map((s) => [s.itemId, s] as const));
  const changes: RestoreChange[] = [];
  for (const item of items) {
    const from: Slot = { date: item.scheduled_date, start: item.scheduled_start, end: item.scheduled_end };
    const saved = target.get(item.id);
    // 所選版本之後才加入的項目，在該版本未排程
    const to: Slot = saved ? { date: saved.date, start: saved.start, end: saved.end } : UNSCHEDULED;
    if (!sameSlot(from, to)) changes.push({ itemId: item.id, from, to });
  }

  const dates = new Set(changes.map((c) => c.from.date));
  const movesDay = changes.some((c) => c.from.date !== c.to.date);
  return { changes, versionKind: movesDay || dates.size > 1 ? "major" : "minor" };
}

export interface RestoreVersionInput {
  version: Pick<VersionRow, "id" | "snapshot">;
  items: readonly ScheduledItem[];
  // 使用者看到確認畫面時的行程版本；資料庫比對不符即失敗（SH-04）
  baseVersion: number;
}

export async function restoreVersion(
  deps: { restorer: VersionRestorer },
  input: RestoreVersionInput,
): Promise<RestoreResult> {
  if (input.version.snapshot === null) throw new Error("此版本沒有完整行程紀錄");
  const preview = restorePreview(input.version.snapshot, input.items);
  if (preview.changes.length === 0) throw new Error("目前行程已與此版本相同");
  return deps.restorer.restore({ versionId: input.version.id, baseVersion: input.baseVersion });
}
