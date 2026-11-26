import type { ActualTimeline, TimelineRow } from "./actual-timeline";

// T40：旅後狀態與 MEM-04 比較報告。純函式：輸入為各日保存的 Planned vs Actual（T39）、項目的旅後狀態與交通估算（T28）。
// 報告是 T41 旅後記憶提案的依據；本身不寫入記憶（MEM-03）。

export type PostTripStatus = "completed" | "skipped" | "cancelled" | "revisit" | "not_recommended";

export const POST_TRIP_STATUS_LABELS: Record<PostTripStatus, string> = {
  completed: "完成",
  skipped: "略過",
  cancelled: "取消",
  revisit: "想再去",
  not_recommended: "不推薦",
};

// 與資料庫 set_post_trip_status 相同：實際去過（最後一筆紀錄為完成）才可標為完成或不推薦
export function allowedPostTripStatuses(visited: boolean): PostTripStatus[] {
  return visited ? ["completed", "revisit", "not_recommended"] : ["skipped", "cancelled", "revisit"];
}

export interface PostTripItem {
  id: string;
  name_zh: string;
  type: string;
  post_trip_status: PostTripStatus | null;
  generated_by: { provider: string; model: string } | null;
  // Backup 或 Morning Check 提升的 Standby
  backup: boolean;
}

export interface PostTripReport {
  stayDifferences: Array<{ date: string; itemId: string; name_zh: string; plannedMinutes: number; actualMinutes: number; diffMinutes: number }>;
  transportDifferences: Array<{
    date: string;
    fromItemId: string;
    toItemId: string;
    fromName: string;
    toName: string;
    estimatedMinutes: number;
    actualMinutes: number;
    diffMinutes: number;
  }>;
  backupsUsed: Array<{ date: string; itemId: string; name_zh: string; backup: boolean }>;
  crowdedSlots: Array<{ date: string; from: string; until: string; itemIds: string[]; reasons: string[] }>;
  unreliableRecommendations: Array<{ itemId: string; name_zh: string; provider: string | null; model: string | null; reason: string }>;
  favoriteActivityTypes: Array<{ type: string; score: number; count: number }>;
}

export const POST_TRIP_REPORT_FIELDS = [
  "stayDifferences",
  "transportDifferences",
  "backupsUsed",
  "crowdedSlots",
  "unreliableRecommendations",
  "favoriteActivityTypes",
] as const satisfies ReadonlyArray<keyof PostTripReport>;

export interface PostTripReportInput {
  days: readonly ActualTimeline[];
  items: readonly PostTripItem[];
  // 採用的交通估算（門到門分鐘）
  segments: ReadonlyArray<{ from: string; to: string; minutes: number }>;
}

const LATE_MINUTES = 30;
const SCORE: Partial<Record<PostTripStatus, number>> = { revisit: 2, completed: 1, not_recommended: -1 };

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

function stay(row: TimelineRow): { planned: number; actual: number } | null {
  if (!row.planned || !row.actual?.arrived || !row.actual.departed) return null;
  return { planned: minutes(row.planned.end) - minutes(row.planned.start), actual: minutes(row.actual.departed) - minutes(row.actual.arrived) };
}

function pressure(row: TimelineRow): string[] {
  if (!row.planned) return [];
  const reasons: string[] = [];
  if (row.arrivalDeltaMinutes !== null && row.arrivalDeltaMinutes >= LATE_MINUTES) reasons.push(`晚到 ${row.arrivalDeltaMinutes} 分鐘`);
  if (row.outcome === "partial") reasons.push("部分完成");
  const s = stay(row);
  if (s && s.actual * 2 < s.planned) reasons.push("停留不到排定的一半");
  return reasons;
}

export function postTripReport(input: PostTripReportInput): PostTripReport {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const estimate = new Map(input.segments.map((s) => [`${s.from}>${s.to}`, s.minutes]));
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const report: PostTripReport = {
    stayDifferences: [],
    transportDifferences: [],
    backupsUsed: [],
    crowdedSlots: [],
    unreliableRecommendations: [],
    favoriteActivityTypes: [],
  };

  for (const day of days) {
    for (const row of day.rows) {
      const s = stay(row);
      if (s) report.stayDifferences.push({ date: day.date, itemId: row.itemId, name_zh: row.name_zh, plannedMinutes: s.planned, actualMinutes: s.actual, diffMinutes: s.actual - s.planned });
      if (row.unplanned && row.visited) report.backupsUsed.push({ date: day.date, itemId: row.itemId, name_zh: row.name_zh, backup: byId.get(row.itemId)?.backup ?? false });
    }

    // 有實際時間的地點依到達先後；相鄰兩站以前一站離開到下一站到達計算
    const present = day.rows
      .filter((r) => r.actual?.arrived)
      .sort((a, b) => minutes(a.actual?.arrived ?? "00:00") - minutes(b.actual?.arrived ?? "00:00"));
    for (let i = 1; i < present.length; i++) {
      const prev = present[i - 1] as TimelineRow;
      const next = present[i] as TimelineRow;
      const est = estimate.get(`${prev.itemId}>${next.itemId}`);
      if (est === undefined || !prev.actual?.departed || !next.actual?.arrived) continue;
      const actual = minutes(next.actual.arrived) - minutes(prev.actual.departed);
      report.transportDifferences.push({
        date: day.date,
        fromItemId: prev.itemId,
        toItemId: next.itemId,
        fromName: prev.name_zh,
        toName: next.name_zh,
        estimatedMinutes: est,
        actualMinutes: actual,
        diffMinutes: actual - est,
      });
    }

    // 過密時段：相鄰的排定項目都有壓力時合併為一段
    const planned = day.rows.filter((r) => r.planned).sort((a, b) => minutes(a.planned?.start ?? "00:00") - minutes(b.planned?.start ?? "00:00"));
    let open: PostTripReport["crowdedSlots"][number] | null = null;
    for (const row of planned) {
      const reasons = pressure(row);
      if (reasons.length === 0) {
        open = null;
        continue;
      }
      if (!open) {
        open = { date: day.date, from: row.planned?.start ?? "", until: row.planned?.end ?? "", itemIds: [], reasons: [] };
        report.crowdedSlots.push(open);
      }
      open.until = row.planned?.end ?? open.until;
      open.itemIds.push(row.itemId);
      for (const r of reasons) if (!open.reasons.includes(r)) open.reasons.push(r);
    }
  }

  for (const item of input.items) {
    if (item.post_trip_status === "not_recommended") {
      report.unreliableRecommendations.push({
        itemId: item.id,
        name_zh: item.name_zh,
        provider: item.generated_by?.provider ?? null,
        model: item.generated_by?.model ?? null,
        reason: "旅後標示不推薦",
      });
    }
  }

  const types = new Map<string, { score: number; count: number }>();
  for (const item of input.items) {
    const score = item.post_trip_status ? SCORE[item.post_trip_status] : undefined;
    if (score === undefined) continue;
    const t = types.get(item.type) ?? { score: 0, count: 0 };
    types.set(item.type, { score: t.score + score, count: t.count + 1 });
  }
  report.favoriteActivityTypes = [...types]
    .filter(([, v]) => v.score > 0)
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.type.localeCompare(b.type));
  return report;
}
