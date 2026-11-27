import { enums } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_TRANSITIONS,
  applyVerificationCap,
  canEnterDraft,
  canSetPostTripStatus,
  canTransitionDay,
  canTransitionLifecycle,
  canTransitionTrip,
  decideApproval,
  evaluateDayStatus,
  evaluateTripStatus,
  needsPartialBadge,
  siblingsToInvalidate,
  zonedMidnight,
} from "./index";

const lifecycle = enums.lifecycleStatus.options;

describe("第 2.5 節生命週期", () => {
  const pairs = lifecycle.flatMap((from) => lifecycle.map((to) => [from, to] as const));
  it.each(pairs)("%s → %s 依轉換表判定", (from, to) => {
    const allowed = (LIFECYCLE_TRANSITIONS[from] as readonly string[]).includes(to);
    expect(canTransitionLifecycle(from, to)).toBe(allowed);
  });

  it("轉換表與計畫一致", () => {
    expect(LIFECYCLE_TRANSITIONS).toEqual({
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
    });
  });
});

describe("核實狀態（D07）", () => {
  it.each([
    ["verified", true],
    ["partially_verified", true],
    ["unverified", false],
    ["conflict", false],
    // 決策 0010：成員自行新增的項目（使用者確認）可以排入
    ["user_confirmed", true],
  ] as const)("%s 進入行程草案：%s", (status, allowed) => {
    expect(canEnterDraft(status)).toBe(allowed);
  });

  it("Partially Verified 在行程 Card 標示，其他狀態不標示", () => {
    expect(needsPartialBadge("partially_verified")).toBe(true);
    expect(needsPartialBadge("verified")).toBe(false);
  });

  it("Research 與 Verification 為同一家時，上限為 Partially Verified", () => {
    const research = { provider: "anthropic", model: "claude-opus-5-5" } as const;
    const sameVendor = { provider: "anthropic", model: "claude-sonnet-5-5" } as const;
    const otherVendor = { provider: "openai", model: "gpt-6" } as const;
    expect(applyVerificationCap("verified", research, sameVendor)).toBe("partially_verified");
    expect(applyVerificationCap("verified", research, otherVendor)).toBe("verified");
    expect(applyVerificationCap("conflict", research, sameVendor)).toBe("conflict");
    expect(applyVerificationCap("verified", null, sameVendor)).toBe("verified");
  });
});

describe("旅後狀態", () => {
  it.each(enums.tripStatus.options)("行程為 %s 時可否標示旅後狀態", (status) => {
    expect(canSetPostTripStatus(status)).toBe(status === "ended");
  });
});

describe("時區", () => {
  it("目的地時區的 00:00 換算為 UTC", () => {
    expect(zonedMidnight("2026-12-01", "Asia/Tokyo").toISOString()).toBe("2026-11-30T15:00:00.000Z");
    expect(zonedMidnight("2026-07-01", "Europe/London").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(zonedMidnight("2026-01-15", "Europe/London").toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
});

describe("第 2.8 節行程狀態（決策 0003）", () => {
  const trips = enums.tripStatus.options;
  const legal: Record<string, string[]> = {
    baseline: ["planning"],
    planning: ["locked"],
    locked: ["planning", "in_progress"],
    in_progress: ["ended"],
    ended: ["archived"],
    archived: [],
  };
  const pairs = trips.flatMap((from) => trips.map((to) => [from, to] as const));
  it.each(pairs)("%s → %s 依轉換表判定", (from, to) => {
    expect(canTransitionTrip(from, to)).toBe(legal[from]?.includes(to) ?? false);
  });

  const base = {
    timezone: "Asia/Tokyo",
    startDate: "2026-12-01",
    endDate: "2026-12-05",
    baselineConfirmed: true,
    dayStatuses: ["approved", "approved"] as const,
    lastDayTimelineProduced: false,
    allItemsHavePostTripStatus: false,
  };

  it("基線確認後進入規劃中", () => {
    expect(evaluateTripStatus("baseline", { ...base, baselineConfirmed: false }, new Date("2026-11-01T00:00:00Z"))).toBe("baseline");
    expect(evaluateTripStatus("baseline", base, new Date("2026-11-01T00:00:00Z"))).toBe("planning");
  });

  it("所有日期已批准才鎖定；任一日改回草案則回到規劃中", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(evaluateTripStatus("planning", base, now)).toBe("locked");
    expect(evaluateTripStatus("planning", { ...base, dayStatuses: ["approved", "draft"] }, now)).toBe("planning");
    expect(evaluateTripStatus("planning", { ...base, dayStatuses: [] }, now)).toBe("planning");
    expect(evaluateTripStatus("locked", { ...base, dayStatuses: ["approved", "draft"] }, now)).toBe("planning");
  });

  it("第一日 00:00（目的地時區）進入進行中", () => {
    expect(evaluateTripStatus("locked", base, new Date("2026-11-30T14:59:59Z"))).toBe("locked");
    expect(evaluateTripStatus("locked", base, new Date("2026-11-30T15:00:00Z"))).toBe("in_progress");
  });

  it("最後一日 Actual Timeline 產生後，或最後一日結束後 24 小時，進入已結束", () => {
    expect(evaluateTripStatus("in_progress", base, new Date("2026-12-05T12:00:00Z"))).toBe("in_progress");
    expect(evaluateTripStatus("in_progress", { ...base, lastDayTimelineProduced: true }, new Date("2026-12-05T12:00:00Z"))).toBe("ended");
    // 最後一日結束為 12/06 00:00 東京時間（12/05 15:00Z），再加 24 小時
    expect(evaluateTripStatus("in_progress", base, new Date("2026-12-06T14:59:59Z"))).toBe("in_progress");
    expect(evaluateTripStatus("in_progress", base, new Date("2026-12-06T15:00:00Z"))).toBe("ended");
  });

  it("所有項目標好旅後狀態後封存", () => {
    const now = new Date("2026-12-10T00:00:00Z");
    expect(evaluateTripStatus("ended", base, now)).toBe("ended");
    expect(evaluateTripStatus("ended", { ...base, allItemsHavePostTripStatus: true }, now)).toBe("archived");
  });
});

describe("第 2.8 節每日狀態（決策 0003）", () => {
  const days = enums.dayStatus.options;
  const legal: Record<string, string[]> = {
    draft: ["approved"],
    approved: ["draft", "day_ready", "in_progress"],
    day_ready: ["draft", "in_progress"],
    in_progress: ["completed"],
    completed: [],
  };
  const pairs = days.flatMap((from) => days.map((to) => [from, to] as const));
  it.each(pairs)("%s → %s 依轉換表判定", (from, to) => {
    expect(canTransitionDay(from, to)).toBe(legal[from]?.includes(to) ?? false);
  });

  const day = {
    timezone: "Asia/Tokyo",
    date: "2026-12-01",
    morningCheckPassed: false,
    firstScheduledStart: "09:00",
    firstCompletionAt: null as Date | null,
    timelineProduced: false,
  };

  it("Day Ready 須 Morning Check 通過且已批准", () => {
    const now = new Date("2026-11-30T22:00:00Z"); // 東京 07:00
    expect(evaluateDayStatus("approved", day, now)).toBe("approved");
    expect(evaluateDayStatus("approved", { ...day, morningCheckPassed: true }, now)).toBe("day_ready");
    expect(evaluateDayStatus("draft", { ...day, morningCheckPassed: true }, now)).toBe("draft");
  });

  it("第一個活動排定開始時間，或第一個完成記錄，取較早者進入進行中", () => {
    expect(evaluateDayStatus("day_ready", day, new Date("2026-11-30T23:59:59Z"))).toBe("day_ready");
    expect(evaluateDayStatus("day_ready", day, new Date("2026-12-01T00:00:00Z"))).toBe("in_progress");
    const early = { ...day, firstCompletionAt: new Date("2026-11-30T23:30:00Z") };
    expect(evaluateDayStatus("approved", early, new Date("2026-11-30T23:31:00Z"))).toBe("in_progress");
  });

  it("當日 Actual Timeline 產生後完成", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    expect(evaluateDayStatus("in_progress", day, now)).toBe("in_progress");
    expect(evaluateDayStatus("in_progress", { ...day, timelineProduced: true }, now)).toBe("completed");
  });
});

describe("第 2.8 節提案狀態", () => {
  it("批准時 base version 等於目前版本才套用，否則失效", () => {
    expect(decideApproval({ status: "pending", base_version: 3 }, 3)).toBe("applied");
    expect(decideApproval({ status: "pending", base_version: 2 }, 3)).toBe("invalidated");
  });

  it("非待批准的提案不可再批准", () => {
    for (const status of ["applied", "rejected", "invalidated"] as const) {
      expect(() => decideApproval({ status, base_version: 3 }, 3)).toThrow();
    }
  });

  it("同一即時分支套用其一後，其餘待批准提案失效", () => {
    const proposals = [
      { id: "a", status: "applied", live_branch_id: "b1" },
      { id: "b", status: "pending", live_branch_id: "b1" },
      { id: "c", status: "pending", live_branch_id: "b2" },
      { id: "d", status: "rejected", live_branch_id: "b1" },
      { id: "e", status: "pending", live_branch_id: null },
    ] as const;
    expect(siblingsToInvalidate(proposals, "a")).toEqual(["b"]);
  });
});
