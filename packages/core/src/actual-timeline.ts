// T39：Actual Timeline（第 2.8、2.9 節）。每日結束產生 Planned vs Actual，只記錄實際發生的事。
// 純函式：同一項目以最後一筆紀錄為準；只有完成的項目為「已去過」，部分完成、略過、沒有紀錄的項目不算。
// 沒有排定、但實際時間落在當天（目的地時區）的項目列為計畫外。

export type TimelineCompletion = "completed" | "partial" | "skipped";
export type TimelineOutcome = TimelineCompletion | "not_recorded";

export interface TimelinePlanned {
  id: string;
  name_zh: string;
  scheduled_start: string | null; // HH:MM
  scheduled_end: string | null;
}

export interface TimelineEntry {
  item_id: string;
  arrived_at: string | null; // ISO 8601
  departed_at: string | null;
  completion: TimelineCompletion;
  recorded_by: string;
  created_at: string;
}

export interface TimelineRow {
  itemId: string;
  name_zh: string;
  planned: { start: string; end: string } | null;
  actual: { arrived: string | null; departed: string | null } | null;
  outcome: TimelineOutcome;
  visited: boolean;
  unplanned: boolean;
  recordedBy: string | null;
  arrivalDeltaMinutes: number | null;
}

export interface ActualTimeline {
  date: string;
  rows: TimelineRow[];
  visitedItemIds: string[];
  summary: { planned: number; completed: number; partial: number; skipped: number; notRecorded: number; unplanned: number };
}

export interface ActualTimelineInput {
  date: string;
  timezone: string;
  planned: readonly TimelinePlanned[];
  // 沒有排定在這天、但有紀錄的項目名稱
  unplanned: ReadonlyArray<{ id: string; name_zh: string }>;
  entries: readonly TimelineEntry[];
}

export const TIMELINE_OUTCOME_LABELS: Record<TimelineOutcome, string> = {
  completed: "已完成",
  partial: "部分完成",
  skipped: "略過",
  not_recorded: "沒有紀錄",
};

function localParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

function latestByItem(entries: readonly TimelineEntry[]): Map<string, TimelineEntry> {
  const latest = new Map<string, TimelineEntry>();
  for (const e of entries) {
    const prev = latest.get(e.item_id);
    if (!prev || Date.parse(e.created_at) >= Date.parse(prev.created_at)) latest.set(e.item_id, e);
  }
  return latest;
}

export function actualTimeline(input: ActualTimelineInput): ActualTimeline {
  const latest = latestByItem(input.entries);
  const local = (iso: string | null) => (iso ? localParts(iso, input.timezone) : null);

  const build = (id: string, name: string, planned: TimelineRow["planned"], unplanned: boolean): TimelineRow => {
    const e = latest.get(id);
    const arrived = local(e?.arrived_at ?? null);
    const departed = local(e?.departed_at ?? null);
    const actual = arrived || departed ? { arrived: arrived?.time ?? null, departed: departed?.time ?? null } : null;
    const outcome: TimelineOutcome = e ? e.completion : "not_recorded";
    return {
      itemId: id,
      name_zh: name,
      planned,
      actual,
      outcome,
      visited: outcome === "completed",
      unplanned,
      recordedBy: e?.recorded_by ?? null,
      arrivalDeltaMinutes: planned && arrived ? toMinutes(arrived.time) - toMinutes(planned.start) : null,
    };
  };

  const plannedIds = new Set(input.planned.map((p) => p.id));
  const plannedRows = input.planned.map((p) =>
    build(p.id, p.name_zh, p.scheduled_start && p.scheduled_end ? { start: p.scheduled_start, end: p.scheduled_end } : null, false),
  );
  const unplannedRows = input.unplanned
    .filter((u) => !plannedIds.has(u.id))
    .filter((u) => {
      const e = latest.get(u.id);
      const when = local(e?.arrived_at ?? e?.departed_at ?? null);
      return when?.date === input.date;
    })
    .map((u) => build(u.id, u.name_zh, null, true));

  const sortKey = (r: TimelineRow) => toMinutes(r.planned?.start ?? r.actual?.arrived ?? r.actual?.departed ?? "23:59");
  const rows = [...plannedRows, ...unplannedRows].sort((a, b) => sortKey(a) - sortKey(b));
  const count = (o: TimelineOutcome) => plannedRows.filter((r) => r.outcome === o).length;
  return {
    date: input.date,
    rows,
    visitedItemIds: rows.filter((r) => r.visited).map((r) => r.itemId),
    summary: {
      planned: plannedRows.length,
      completed: count("completed"),
      partial: count("partial"),
      skipped: count("skipped"),
      notRecorded: count("not_recorded"),
      unplanned: unplannedRows.length,
    },
  };
}
