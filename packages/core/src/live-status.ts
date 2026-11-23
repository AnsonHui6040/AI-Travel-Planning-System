import { transitCondition, type ChangePayload } from "@atps/schemas";
import { classifyVersionKind } from "./versions";

// T22、D30：路線的即時運行狀態。來源為 ODPT（基本ライセンス、CC 授權）或 Verification 核實的官方運行情報頁；
// 沒有來源或資料逾期的路線一律顯示「無即時資料」。異常營運讓使用該路線的已排定項目轉為 At Risk（第 2.6 節）。

export const TRANSIT_CONDITIONS = transitCondition.options;
export type TransitCondition = (typeof TRANSIT_CONDITIONS)[number];

export const NO_LIVE_DATA_LABEL = "無即時資料";

const LABELS: Record<TransitCondition, string> = {
  normal: "正常運行",
  delayed: "延誤",
  suspended: "停駛",
  other_abnormal: "運行異常",
};

export interface RouteStatus {
  routeId: string;
  condition: TransitCondition;
  // 營運商提供的原文
  text: string | null;
  cause: string | null;
  resumeEstimate: string | null;
  observedAt: string;
  // 超過此時間即不再使用；null 表示來源沒有提供
  validUntil: string | null;
  source: { name: string; url: string };
}

export type RouteLiveView =
  | { routeId: string; condition: TransitCondition; label: string; status: RouteStatus }
  | { routeId: string; condition: "no_data"; label: typeof NO_LIVE_DATA_LABEL; status: null };

// 沒有 validUntil 的資料，自觀測時間起最多使用 15 分鐘
// changePayload 每個提案最多 50 項操作
const MAX_OPERATIONS = 50;
const DEFAULT_VALID_MS = 15 * 60 * 1000;

export const isAbnormal = (condition: TransitCondition): boolean => condition !== "normal";

function isCurrent(status: RouteStatus, now: Date): boolean {
  const until = status.validUntil !== null ? Date.parse(status.validUntil) : Date.parse(status.observedAt) + DEFAULT_VALID_MS;
  return Number.isFinite(until) && until >= now.getTime();
}

function currentStatuses(statuses: readonly RouteStatus[], now: Date): Map<string, RouteStatus> {
  const map = new Map<string, RouteStatus>();
  for (const s of statuses) {
    if (!isCurrent(s, now)) continue;
    const prev = map.get(s.routeId);
    if (!prev || Date.parse(s.observedAt) > Date.parse(prev.observedAt)) map.set(s.routeId, s);
  }
  return map;
}

export function routeLiveView(routeIds: readonly string[], statuses: readonly RouteStatus[], now: Date): RouteLiveView[] {
  const current = currentStatuses(statuses, now);
  return routeIds.map((routeId) => {
    const status = current.get(routeId);
    if (!status) return { routeId, condition: "no_data", label: NO_LIVE_DATA_LABEL, status: null };
    return { routeId, condition: status.condition, label: LABELS[status.condition], status };
  });
}

export interface TransitRiskEntry {
  id: string;
  date: string | null;
  routes: readonly string[];
  atRisk: boolean;
}

// 已批准項目的事實失效（approved_fact_invalidated）：自動標示 At Risk 並通知；重排另需批准。
// 同一天的項目合成一個提案，跨日會被判為 Major（第 2.7 節），所以每天各自一個 Minor 提案
export function transitAtRiskChanges(entries: readonly TransitRiskEntry[], statuses: readonly RouteStatus[], now: Date): ChangePayload[] {
  const current = currentStatuses(statuses, now);
  const byDate = new Map<string, { ids: string[]; labels: Set<string> }>();
  for (const entry of entries) {
    if (entry.atRisk || entry.date === null) continue;
    const abnormal = entry.routes.map((r) => current.get(r)).filter((s): s is RouteStatus => s !== undefined && isAbnormal(s.condition));
    if (abnormal.length === 0) continue;
    const group = byDate.get(entry.date) ?? { ids: [], labels: new Set<string>() };
    group.ids.push(entry.id);
    for (const s of abnormal) group.labels.add(`${s.routeId}${LABELS[s.condition]}`);
    byDate.set(entry.date, group);
  }
  const items = entries.map((e) => ({ id: e.id, scheduled_date: e.date }));
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, group]) => {
      const labels = [...group.labels].join("、");
      const chunks: string[][] = [];
      for (let i = 0; i < group.ids.length; i += MAX_OPERATIONS) chunks.push(group.ids.slice(i, i + MAX_OPERATIONS));
      return chunks.map((ids) => {
        const operations = ids.map((itemId) => ({ op: "set_at_risk" as const, itemId, atRisk: true }));
        const summary = `${date} 使用的路線運行異常（${labels}），${ids.length} 個項目標示為 At Risk`;
        return {
          changeKind: "approved_fact_invalidated" as const,
          versionKind: classifyVersionKind(operations, items),
          summary: summary.length > 500 ? `${summary.slice(0, 499)}…` : summary,
          operations,
        };
      });
    });
}
