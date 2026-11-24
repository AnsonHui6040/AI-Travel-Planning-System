import type { ApprovalEntry } from "@atps/core";
import { isoDate, uuid } from "@atps/schemas";

// T30：批准一天的 Server Action 邏輯。草案由伺服器以 planFeasibleDays 重新計算（不採用瀏覽器送來的時段），
// 權限（Owner、Companion）、狀態與 base version 由資料庫函式 approve_day 檢查，呼叫者取自 session。

export class DayApprovalStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`批准失敗（${reason}）`);
  }
}

export interface DayPlan {
  baseVersion: number;
  days: Array<{
    date: string;
    status: "draft" | "approved" | "day_ready" | "in_progress" | "completed";
    entries: ApprovalEntry[];
    // 仍有會擋下的可行性問題
    blocked: boolean;
  }>;
}

export interface DayApprovalDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  // 以使用者 session 讀取（RLS）並重新計算可行性草案
  loadPlan: (tripId: string) => Promise<DayPlan | null>;
  approve: (tripId: string, date: string, entries: ApprovalEntry[], baseVersion: number) => Promise<{ outcome: "approved" | "invalidated"; locked: boolean }>;
  logError: (message: string) => void;
}

export interface DayApprovalResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "day.approve", limit: 30, windowSeconds: 60 } as const;

export async function approveDayAction(deps: DayApprovalDeps, tripIdRaw: unknown, dateRaw: unknown, versionRaw: unknown): Promise<DayApprovalResult> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  const tripId = uuid.safeParse(tripIdRaw);
  if (!tripId.success) return { ok: false, message: "行程不正確" };
  const date = isoDate.safeParse(dateRaw);
  if (!date.success) return { ok: false, message: "日期不正確" };
  const version = typeof versionRaw === "string" && /^\d{1,9}$/.test(versionRaw) ? Number(versionRaw) : null;
  if (version === null) return { ok: false, message: "版本不正確" };

  const plan = await deps.loadPlan(tripId.data);
  if (!plan) return { ok: false, message: "找不到這個行程" };
  const day = plan.days.find((d) => d.date === date.data);
  if (!day) return { ok: false, message: "日期不在行程期間內" };
  if (day.status !== "draft") return { ok: false, message: "這天已經批准" };
  if (day.entries.length === 0) return { ok: false, message: "這天沒有可批准的項目" };
  if (day.blocked) return { ok: false, message: "這天仍有未通過的可行性檢查，無法批准" };

  try {
    const result = await deps.approve(tripId.data, date.data, day.entries, version);
    if (result.outcome === "invalidated") return { ok: false, message: "行程已有其他更新，請重新整理後再批准" };
    return { ok: true, message: result.locked ? `已批准 ${date.data}，所有日期都已批准，行程已鎖定` : `已批准 ${date.data}` };
  } catch (error) {
    if (error instanceof DayApprovalStoreError) {
      if (error.reason === "forbidden") return { ok: false, message: "沒有批准權限" };
      if (error.reason === "state") return { ok: false, message: "這天已批准或行程已鎖定" };
      if (error.reason === "invalid") return { ok: false, message: "每日行程內容不正確，請重新整理" };
    }
    deps.logError("批准每日行程失敗");
    return { ok: false, message: "批准失敗，請稍後再試" };
  }
}
