import { DEFAULT_TRAVEL_MINUTES, FIXED_ACTIVITY_BUFFER_MINUTES, zonedTime } from "@atps/core";
import type { ChangePayload } from "@atps/schemas";

// T35：離線當日包與修改佇列（D11、SH-05）。純函式，不存取 IndexedDB 或網路；
// 儲存由 apps/web 的瀏覽器端模組處理。時間由呼叫端傳入。

export interface DayPackItem {
  id: string;
  name_zh: string;
  name_local: string | null;
  address: string | null;
  scheduled_start: string;
  scheduled_end: string;
  at_risk: boolean;
  verification_status: string;
}

export interface DayPackInput {
  tripId: string;
  date: string;
  timezone: string;
  baseVersion: number;
  generatedAt: string;
  items: readonly DayPackItem[];
  fixed: ReadonlyArray<{ name: string; start: string; end: string }>;
  // 含緩衝的交通分鐘數；沒有估算時為 null
  travelMinutes: (fromId: string, toId: string) => number | null;
  backups: ReadonlyArray<{ id: string; name_zh: string; standby: boolean }>;
  photos: ReadonlyArray<{ item_id: string; url: string; credit: string }>;
}

export interface PackEntry {
  itemId: string;
  name: string;
  nameLocal: string | null;
  address: string | null;
  start: string;
  end: string;
  atRisk: boolean;
  verificationStatus: string;
  // 最遲離開時間：下一站開始前扣掉交通（下一站為固定活動時另扣緩衝）；最後一站為 null
  leaveBy: string | null;
  nextName: string | null;
  travelToNextMinutes: number | null;
}

export interface DayPack {
  format: 1;
  tripId: string;
  date: string;
  timezone: string;
  baseVersion: number;
  generatedAt: string;
  entries: PackEntry[];
  fixed: Array<{ name: string; start: string; end: string }>;
  // T36：Standby（Morning Check 提升）排在前面
  backups: Array<{ id: string; name: string; standby: boolean }>;
  photos: Array<{ itemId: string; url: string; credit: string }>;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function buildDayPack(input: DayPackInput): DayPack {
  const items = [...input.items].sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  const fixed = [...input.fixed].sort((a, b) => a.start.localeCompare(b.start));
  type Stop = { kind: "item"; item: DayPackItem } | { kind: "fixed"; name: string; start: string };
  const timeline: Stop[] = [
    ...items.map((item) => ({ kind: "item" as const, item })),
    ...fixed.map((f) => ({ kind: "fixed" as const, name: f.name, start: f.start })),
  ].sort((a, b) => (a.kind === "item" ? a.item.scheduled_start : a.start).localeCompare(b.kind === "item" ? b.item.scheduled_start : b.start));

  const entries: PackEntry[] = items.map((item) => {
    const index = timeline.findIndex((s) => s.kind === "item" && s.item.id === item.id);
    const next = timeline[index + 1];
    let leaveBy: string | null = null;
    let nextName: string | null = null;
    let travel: number | null = null;
    if (next?.kind === "item") {
      travel = input.travelMinutes(item.id, next.item.id) ?? DEFAULT_TRAVEL_MINUTES;
      leaveBy = toHhmm(Math.max(0, toMin(next.item.scheduled_start) - travel));
      nextName = next.item.name_zh;
    } else if (next?.kind === "fixed") {
      travel = DEFAULT_TRAVEL_MINUTES;
      leaveBy = toHhmm(Math.max(0, toMin(next.start) - travel - FIXED_ACTIVITY_BUFFER_MINUTES));
      nextName = next.name;
    }
    return {
      itemId: item.id,
      name: item.name_zh,
      nameLocal: item.name_local,
      address: item.address,
      start: item.scheduled_start,
      end: item.scheduled_end,
      atRisk: item.at_risk,
      verificationStatus: item.verification_status,
      leaveBy,
      nextName,
      travelToNextMinutes: travel,
    };
  });

  return {
    format: 1,
    tripId: input.tripId,
    date: input.date,
    timezone: input.timezone,
    baseVersion: input.baseVersion,
    generatedAt: input.generatedAt,
    entries,
    fixed: fixed.map((f) => ({ name: f.name, start: f.start, end: f.end })),
    backups: [...input.backups]
      .sort((a, b) => Number(b.standby) - Number(a.standby))
      .map((b) => ({ id: b.id, name: b.name_zh, standby: b.standby })),
    // 只保存站內的照片網址（經 /api/photos 同源提供，S-09）
    photos: input.photos.filter((p) => p.url.startsWith("/api/photos/")).map((p) => ({ itemId: p.item_id, url: p.url, credit: p.credit })),
  };
}

// 距最遲離開時間的分鐘數（目的地時區）；已過時為負數；沒有最遲離開時間時為 null
export function leaveCountdown(pack: Pick<DayPack, "date" | "timezone">, entry: Pick<PackEntry, "leaveBy">, now: Date): number | null {
  if (!entry.leaveBy) return null;
  const leave = zonedTime(pack.date, entry.leaveBy, pack.timezone);
  return Math.round((leave.getTime() - now.getTime()) / 60_000);
}

// 現在是否為當日包的那一天（目的地時區）；不是當天時不顯示倒數
export function isPackDay(pack: Pick<DayPack, "date" | "timezone">, now: Date): boolean {
  return new Intl.DateTimeFormat("en-CA", { timeZone: pack.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now) === pack.date;
}

// ---- 離線修改佇列（SH-05）--------------------------------------------------------------

export interface QueuedChange {
  id: string;
  tripId: string;
  itemId: string;
  itemName: string;
  date: string;
  start: string;
  end: string;
  // 排入佇列時的行程版本；同步後依 SH-04 檢查
  baseVersion: number;
  queuedAt: string;
}

// 同一個項目只保留最新的修改
export function enqueue(queue: readonly QueuedChange[], change: QueuedChange): QueuedChange[] {
  return [...queue.filter((c) => !(c.tripId === change.tripId && c.itemId === change.itemId)), change];
}

export function queuedToProposal(change: QueuedChange): { baseVersion: number; change: ChangePayload } {
  return {
    baseVersion: change.baseVersion,
    change: {
      changeKind: "minor_non_incident",
      versionKind: "minor",
      summary: `離線修改：${change.itemName}改為 ${change.start}–${change.end}`,
      operations: [{ op: "schedule_item", itemId: change.itemId, date: change.date, start: change.start, end: change.end }],
    },
  };
}

export type SendOutcome = "sent" | "rejected" | "failed";

// 依序送出：網路失敗時停止並保留其餘；伺服器拒絕（格式或權限）的修改移除
export async function drainQueue(
  queue: readonly QueuedChange[],
  send: (change: QueuedChange) => Promise<SendOutcome>,
): Promise<{ sent: number; rejected: number; remaining: QueuedChange[] }> {
  let sent = 0;
  let rejected = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const change = queue[i] as QueuedChange;
    const outcome = await send(change);
    if (outcome === "failed") return { sent, rejected, remaining: queue.slice(i) };
    if (outcome === "sent") sent += 1;
    else rejected += 1;
  }
  return { sent, rejected, remaining: [] };
}
