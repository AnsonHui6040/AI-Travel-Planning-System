import type { ChangePayload, Row } from "@atps/schemas";
import { availabilityOn } from "./feasibility";
import type { TripStatus, VerificationStatus } from "./states";
import { classifyVersionKind } from "./versions";

// T31：旅前自動再核實（D25、C-12）。Owner 開啟排程後，出發前 7 天與前 1 天各以 Owner 的 key 執行 Verification。
// 純函式：時間由呼叫端傳入；日期以目的地時區判斷。
// 再核實不改動行程的核實狀態；資料可能已變動的項目以 approved_fact_invalidated 提案標示 At Risk（第 2.6 節自動套用）。

export const REVERIFY_KINDS = ["T-7", "T-1"] as const;
export type ReverifyKind = (typeof REVERIFY_KINDS)[number];

export interface ReverifyTrip {
  start_date: string;
  timezone: string;
  status: TripStatus;
  reverify_enabled: boolean;
}

const REVERIFY_STATUSES: readonly TripStatus[] = ["planning", "locked"];
const DAY_MS = 24 * 60 * 60 * 1000;

function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// 現在應執行的再核實；未開啟排程、行程不在規劃中或已鎖定、或已執行過時為 null。
// T-7 在出發前 7 天到前 2 天之間補跑一次；T-1 只在出發前 1 天
export function dueReverification(trip: ReverifyTrip, ran: readonly ReverifyKind[], now: Date): ReverifyKind | null {
  if (!trip.reverify_enabled || !REVERIFY_STATUSES.includes(trip.status)) return null;
  const before = daysBetween(localDate(now, trip.timezone), trip.start_date);
  if (before >= 2 && before <= 7 && !ran.includes("T-7")) return "T-7";
  if (before === 1 && !ran.includes("T-1")) return "T-1";
  return null;
}

type Item = Row<"itinerary_items">;

export interface ReverifyItem {
  id: string;
  scheduled_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  at_risk: boolean;
}

export interface ReverifyResult {
  item_id: string;
  // 交叉核查後的狀態
  status: VerificationStatus;
  availability: Item["availability"];
}

function risky(item: ReverifyItem, result: ReverifyResult): boolean {
  if (result.status === "conflict" || result.status === "unverified") return true;
  if (!item.scheduled_date || result.availability.length === 0) return false;
  const windows = availabilityOn({ availability: result.availability }, item.scheduled_date);
  if (windows === null) return false;
  const start = item.scheduled_start?.slice(0, 5) ?? "";
  const end = item.scheduled_end?.slice(0, 5) ?? "";
  return !windows.some(([from, to]) => from <= start && end <= to);
}

// 資料可能已變動、尚未標示的項目 → 一個 At Risk 提案；沒有時為 null
export function reverifyAtRisk(items: readonly ReverifyItem[], results: readonly ReverifyResult[]): ChangePayload | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ids = results.flatMap((r) => {
    const item = byId.get(r.item_id);
    return item && !item.at_risk && risky(item, r) ? [item.id] : [];
  });
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;
  const operations = unique.map((itemId) => ({ op: "set_at_risk" as const, itemId, atRisk: true }));
  return {
    changeKind: "approved_fact_invalidated",
    versionKind: classifyVersionKind(operations, items),
    summary: `旅前再核實：${unique.length} 個項目的資料可能已有變動，標示為 At Risk`,
    operations,
  };
}
