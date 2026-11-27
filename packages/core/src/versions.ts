// 第 2.7 節版本：Major 與 Minor、版本號

import type { ChangeOperation, StructuralChange } from "@atps/schemas";

export type VersionKind = "major" | "minor";

export interface VersionNumber {
  major: number;
  minor: number;
}

export function nextVersion(previous: VersionNumber | null, kind: VersionKind): VersionNumber {
  if (!previous) return { major: 1, minor: 0 };
  return kind === "major" ? { major: previous.major + 1, minor: 0 } : { major: previous.major, minor: previous.minor + 1 };
}

export const formatVersion = (v: VersionNumber) => `v${v.major}.${v.minor}`;

// Major：結構變更、把項目移到另一天、同時影響兩天以上；其餘為 Minor。
// 候選清單沒有日期：候選排入某一天或項目移回候選清單屬同一天內的單一景點改變（T38）
export function classifyVersionKind(
  operations: readonly ChangeOperation[],
  items: ReadonlyArray<{ id: string; scheduled_date: string | null }>,
  structural: readonly StructuralChange[] = [],
): VersionKind {
  if (structural.length > 0) return "major";
  const dates = new Set<string>();
  for (const op of operations) {
    // 決策 0010：新增的項目還不在行程中，只看排入的日期
    if (op.op === "add_item") {
      if (op.date !== null) dates.add(op.date);
      continue;
    }
    const item = items.find((i) => i.id === op.itemId);
    if (!item) throw new Error("變更的項目不在此行程中");
    if (item.scheduled_date !== null) dates.add(item.scheduled_date);
    if (op.op === "schedule_item" && op.date !== null) {
      if (item.scheduled_date !== null && op.date !== item.scheduled_date) return "major";
      dates.add(op.date);
    }
  }
  return dates.size > 1 ? "major" : "minor";
}
