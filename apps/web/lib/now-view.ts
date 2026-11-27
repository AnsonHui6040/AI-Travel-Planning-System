import { isPackDay, leaveCountdown, type DayPack } from "@atps/offline";

// 「現在」分頁的畫面計算（docs/verification/ux-logic-2026-11-27.md 第 5、6 節）。純函式，瀏覽器與伺服器共用；時間由呼叫端傳入

export type TripPhase = "planning" | "trip" | "post";

// 行程狀態決定「現在」顯示規劃步驟、旅行中的下一站，或旅後標記
export function tripPhase(status: string): TripPhase {
  if (status === "ended" || status === "archived") return "post";
  if (status === "locked" || status === "in_progress") return "trip";
  return "planning";
}

export type RowState = "done" | "current" | "next" | "upcoming";

export interface NowRow {
  kind: "item" | "fixed";
  itemId: string | null;
  name: string;
  start: string;
  end: string;
  atRisk: boolean;
  state: RowState;
}

export interface NextStop {
  kind: "item" | "fixed";
  itemId: string | null;
  name: string;
  start: string;
  // 由目前所在項目出發的最遲離開時間；第一站或上一站是固定活動時為 null
  leaveBy: string | null;
  travelMinutes: number | null;
}

export interface NowStopView {
  isToday: boolean;
  next: NextStop | null;
  countdownMinutes: number | null;
  // 離開前檢查的對象（pack.entries 的索引）
  departureIndex: number | null;
  rows: NowRow[];
}

function localHhmm(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export function nowStop(pack: DayPack, now: Date): NowStopView {
  const rows: NowRow[] = [
    ...pack.entries.map((e) => ({ kind: "item" as const, itemId: e.itemId, name: e.name, start: e.start, end: e.end, atRisk: e.atRisk, state: "upcoming" as RowState })),
    ...pack.fixed.map((f) => ({ kind: "fixed" as const, itemId: null, name: f.name, start: f.start, end: f.end, atRisk: false, state: "upcoming" as RowState })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const isToday = isPackDay(pack, now);
  if (!isToday) {
    const first = rows[0];
    return {
      isToday,
      next: first ? { kind: first.kind, itemId: first.itemId, name: first.name, start: first.start, leaveBy: null, travelMinutes: null } : null,
      countdownMinutes: null,
      departureIndex: null,
      rows,
    };
  }

  const time = localHhmm(now, pack.timezone);
  // 最後一個已開始的站：離開前都算「目前」
  let current = -1;
  rows.forEach((r, i) => {
    if (r.start <= time) current = i;
  });
  const last = rows.length - 1;
  const finished = current === last && current >= 0 && (rows[current]?.end ?? "") <= time;
  rows.forEach((r, i) => {
    if (i < current || (finished && i === current)) r.state = "done";
    else if (i === current) r.state = "current";
    else if (i === current + 1) r.state = "next";
  });

  const nextRow = finished ? undefined : rows[current + 1];
  const currentRow = current >= 0 ? rows[current] : undefined;
  const currentEntryIndex = currentRow?.kind === "item" ? pack.entries.findIndex((e) => e.itemId === currentRow.itemId) : -1;
  const currentEntry = currentEntryIndex >= 0 ? pack.entries[currentEntryIndex] : undefined;
  const next: NextStop | null = nextRow
    ? {
        kind: nextRow.kind,
        itemId: nextRow.itemId,
        name: nextRow.name,
        start: nextRow.start,
        leaveBy: currentEntry?.leaveBy ?? null,
        travelMinutes: currentEntry?.travelToNextMinutes ?? null,
      }
    : null;
  return {
    isToday,
    next,
    countdownMinutes: next?.leaveBy ? leaveCountdown(pack, { leaveBy: next.leaveBy }, now) : null,
    departureIndex: next && currentEntryIndex >= 0 ? currentEntryIndex : null,
    rows,
  };
}

// ---- 規劃中：基線、研究、候選、每日、批准 ----------------------------------------

export type StepKey = "baseline" | "research" | "candidates" | "days" | "approve";

export const STEP_LABELS: Record<StepKey, string> = {
  baseline: "基線",
  research: "研究",
  candidates: "候選",
  days: "每日",
  approve: "批准",
};

export interface PlanningInput {
  tripStatus: string;
  candidates: number;
  // Verified 與 Partially Verified（可以排入每日）
  usable: number;
  // 尚未核實（Conflict 不算，已有結果）
  unverified: number;
  researchRunning: boolean;
  days: ReadonlyArray<{ date: string; status: string; placed: number; blocked: boolean }>;
}

export interface PlanningSteps {
  current: StepKey;
  steps: Array<{ key: StepKey; label: string; state: "done" | "current" | "todo" }>;
  // 每日、批准步驟要開啟的日期
  focusDate: string | null;
}

export function planningSteps(input: PlanningInput): PlanningSteps {
  const anyApproved = input.days.some((d) => d.status !== "draft");
  const drafts = input.days.filter((d) => d.status === "draft");
  const approvable = (d: PlanningInput["days"][number]) => d.placed > 0 && !d.blocked;

  const done: Record<StepKey, boolean> = { baseline: false, research: false, candidates: false, days: false, approve: false };
  done.baseline = input.tripStatus !== "baseline";
  done.research = done.baseline && (input.candidates > 0 || anyApproved);
  done.candidates = done.research && (anyApproved || (input.usable > 0 && input.unverified === 0 && !input.researchRunning));
  done.days = done.candidates && input.days.length > 0 && drafts.every(approvable);

  const order: StepKey[] = ["baseline", "research", "candidates", "days", "approve"];
  const current = order.find((k) => !done[k]) ?? "approve";
  const focusDate = current === "days" ? (drafts.find((d) => !approvable(d))?.date ?? null) : current === "approve" ? (drafts[0]?.date ?? null) : null;
  return {
    current,
    focusDate,
    steps: order.map((key) => ({ key, label: STEP_LABELS[key], state: done[key] ? "done" : key === current ? "current" : "todo" })),
  };
}
