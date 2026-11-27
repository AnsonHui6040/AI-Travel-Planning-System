import type { Row } from "@atps/schemas";

// 第 2.5 節與第 2.8 節的狀態機；時點依 docs/decisions/0003-state-timing.md。
// 純函式：時間由呼叫端傳入（Clock port），core 不讀取系統時間。

type Item = Row<"itinerary_items">;
export type LifecycleStatus = Item["lifecycle_status"];
export type VerificationStatus = Item["verification_status"];
export type ModelRef = NonNullable<Item["generated_by"]>;
export type TripStatus = Row<"trips">["status"];
export type DayStatus = Row<"days">["status"];
type ProposalStatus = Row<"proposals">["status"];

export const LIFECYCLE_TRANSITIONS: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  candidate: ["pending_verification"],
  pending_verification: ["verified", "rejected"],
  verified: ["draft", "pending_verification"],
  draft: ["approved", "candidate"],
  approved: ["locked"],
  locked: ["change_proposed", "completed", "cancelled"],
  change_proposed: ["locked", "modified"],
  modified: ["locked"],
  rejected: [],
  completed: [],
  cancelled: [],
};

const TRIP_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  baseline: ["planning"],
  planning: ["locked"],
  locked: ["planning", "in_progress"],
  in_progress: ["ended"],
  ended: ["archived"],
  archived: [],
};

const DAY_TRANSITIONS: Record<DayStatus, readonly DayStatus[]> = {
  draft: ["approved"],
  approved: ["draft", "day_ready", "in_progress"],
  day_ready: ["draft", "in_progress"],
  in_progress: ["completed"],
  completed: [],
};

export const canTransitionLifecycle = (from: LifecycleStatus, to: LifecycleStatus) =>
  LIFECYCLE_TRANSITIONS[from].includes(to);
export const canTransitionTrip = (from: TripStatus, to: TripStatus) => TRIP_TRANSITIONS[from].includes(to);
export const canTransitionDay = (from: DayStatus, to: DayStatus) => DAY_TRANSITIONS[from].includes(to);

// D07：Unverified 與 Conflict 不得進入行程草案。決策 0010：成員自行新增的項目（使用者確認）可以排入
export const canEnterDraft = (status: VerificationStatus) =>
  status === "verified" || status === "partially_verified" || status === "user_confirmed";

export const needsPartialBadge = (status: VerificationStatus) => status === "partially_verified";

// D07：Research 與 Verification 為同一家時，上限為 Partially Verified
export function applyVerificationCap(
  status: VerificationStatus,
  generatedBy: ModelRef | null,
  verifiedBy: ModelRef | null,
): VerificationStatus {
  if (status !== "verified" || !generatedBy || !verifiedBy) return status;
  return generatedBy.provider === verifiedBy.provider ? "partially_verified" : status;
}

export const canSetPostTripStatus = (tripStatus: TripStatus) => tripStatus === "ended";

// 時區 -------------------------------------------------------------------

function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - instant) / 60_000;
}

// 指定日期與時間（目的地時區）對應的 UTC 時刻
export function zonedTime(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let instant = wall - offsetMinutes(wall, timeZone) * 60_000;
  instant = wall - offsetMinutes(instant, timeZone) * 60_000;
  return new Date(instant);
}

export const zonedMidnight = (date: string, timeZone: string) => zonedTime(date, "00:00", timeZone);

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 行程 -------------------------------------------------------------------

export interface TripContext {
  timezone: string;
  startDate: string;
  endDate: string;
  baselineConfirmed: boolean;
  dayStatuses: readonly DayStatus[];
  lastDayTimelineProduced: boolean;
  allItemsHavePostTripStatus: boolean;
}

const ENDED_GRACE_MS = 24 * 60 * 60 * 1000;

export function evaluateTripStatus(current: TripStatus, ctx: TripContext, now: Date): TripStatus {
  const allApproved = ctx.dayStatuses.length > 0 && ctx.dayStatuses.every((s) => s !== "draft");
  switch (current) {
    case "baseline":
      return ctx.baselineConfirmed ? "planning" : current;
    case "planning":
      return allApproved ? "locked" : current;
    case "locked":
      if (!allApproved) return "planning";
      return now >= zonedMidnight(ctx.startDate, ctx.timezone) ? "in_progress" : current;
    case "in_progress": {
      const lastDayEnd = zonedMidnight(addDays(ctx.endDate, 1), ctx.timezone).getTime();
      const expired = now.getTime() >= lastDayEnd + ENDED_GRACE_MS;
      return ctx.lastDayTimelineProduced || expired ? "ended" : current;
    }
    case "ended":
      return ctx.allItemsHavePostTripStatus ? "archived" : current;
    case "archived":
      return current;
  }
}

// 每日 -------------------------------------------------------------------

export interface DayContext {
  timezone: string;
  date: string;
  morningCheckPassed: boolean;
  firstScheduledStart: string | null;
  firstCompletionAt: Date | null;
  timelineProduced: boolean;
}

function dayStarted(ctx: DayContext, now: Date): boolean {
  const scheduled = ctx.firstScheduledStart ? zonedTime(ctx.date, ctx.firstScheduledStart, ctx.timezone) : null;
  const starts = [scheduled, ctx.firstCompletionAt].filter((d): d is Date => d !== null);
  if (starts.length === 0) return false;
  const earliest = Math.min(...starts.map((d) => d.getTime()));
  return now.getTime() >= earliest;
}

export function evaluateDayStatus(current: DayStatus, ctx: DayContext, now: Date): DayStatus {
  switch (current) {
    case "draft":
      return current;
    case "approved":
      if (dayStarted(ctx, now)) return "in_progress";
      return ctx.morningCheckPassed ? "day_ready" : current;
    case "day_ready":
      return dayStarted(ctx, now) ? "in_progress" : current;
    case "in_progress":
      return ctx.timelineProduced ? "completed" : current;
    case "completed":
      return current;
  }
}

// 提案 -------------------------------------------------------------------

export function decideApproval(
  proposal: { status: ProposalStatus; base_version: number },
  currentVersion: number,
): "applied" | "invalidated" {
  if (proposal.status !== "pending") throw new Error("只有待批准的提案可以批准");
  return proposal.base_version === currentVersion ? "applied" : "invalidated";
}

export function siblingsToInvalidate(
  proposals: ReadonlyArray<{ id: string; status: ProposalStatus; live_branch_id: string | null }>,
  appliedId: string,
): string[] {
  const branch = proposals.find((p) => p.id === appliedId)?.live_branch_id;
  if (!branch) return [];
  return proposals
    .filter((p) => p.id !== appliedId && p.status === "pending" && p.live_branch_id === branch)
    .map((p) => p.id);
}
