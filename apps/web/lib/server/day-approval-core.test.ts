import { describe, expect, it } from "vitest";
import { approveDayAction, DayApprovalStoreError, type DayApprovalDeps, type DayPlan } from "./day-approval-core";

// T30：批准一天。伺服器重新計算可行性草案後才送出；權限、狀態與版本由資料庫函式 approve_day 檢查

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const ITEM = "3b1e9c2d-7f4a-4c8b-a2d1-0f9e8d7c6b5a";
const entry = { item_id: ITEM, start: "09:00", end: "10:00", movable_from: "09:00", movable_to: "09:30" };

function deps(plan: DayPlan | null, over: Partial<DayApprovalDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const d: DayApprovalDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => true,
    loadPlan: async () => plan,
    approve: async (...args) => {
      calls.push(args);
      return { outcome: "approved", locked: false };
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs };
}

const draftDay: DayPlan["days"][number] = { date: "2026-12-01", status: "draft", entries: [entry], blocked: false };
const plan: DayPlan = { baseVersion: 3, days: [draftDay] };

describe("approveDayAction", () => {
  it("以伺服器重新計算的草案與畫面上的版本批准", async () => {
    const { d, calls } = deps(plan);
    expect(await approveDayAction(d, TRIP, "2026-12-01", "3")).toEqual({ ok: true, message: "已批准 2026-12-01" });
    expect(calls).toEqual([[TRIP, "2026-12-01", [entry], 3]]);
  });

  it("最後一天批准後告知已鎖定", async () => {
    const { d } = deps(plan, { approve: async () => ({ outcome: "approved", locked: true }) });
    expect((await approveDayAction(d, TRIP, "2026-12-01", "3")).message).toBe("已批准 2026-12-01，所有日期都已批准，行程已鎖定");
  });

  it("版本已變更時不寫入，請使用者重新整理", async () => {
    const { d } = deps(plan, { approve: async () => ({ outcome: "invalidated", locked: false }) });
    expect(await approveDayAction(d, TRIP, "2026-12-01", "2")).toEqual({ ok: false, message: "行程已有其他更新，請重新整理後再批准" });
  });

  it("未登入、速率限制、參數不正確時不呼叫資料庫", async () => {
    expect((await approveDayAction(deps(plan, { getUser: async () => null }).d, TRIP, "2026-12-01", "3")).message).toBe("需要登入");
    expect((await approveDayAction(deps(plan, { checkRateLimit: async () => false }).d, TRIP, "2026-12-01", "3")).message).toBe(
      "操作過於頻繁，請稍後再試",
    );
    const { d, calls } = deps(plan);
    expect((await approveDayAction(d, "x", "2026-12-01", "3")).message).toBe("行程不正確");
    expect((await approveDayAction(d, TRIP, "12/01", "3")).message).toBe("日期不正確");
    expect((await approveDayAction(d, TRIP, "2026-12-01", "-1")).message).toBe("版本不正確");
    expect(calls).toEqual([]);
  });

  it("找不到行程、日期已批准或沒有項目時不送出", async () => {
    expect((await approveDayAction(deps(null).d, TRIP, "2026-12-01", "3")).message).toBe("找不到這個行程");
    const approved = { ...plan, days: [{ ...draftDay, status: "approved" as const }] };
    expect((await approveDayAction(deps(approved).d, TRIP, "2026-12-01", "3")).message).toBe("這天已經批准");
    const empty = { ...plan, days: [{ ...draftDay, entries: [] }] };
    expect((await approveDayAction(deps(empty).d, TRIP, "2026-12-01", "3")).message).toBe("這天沒有可批准的項目");
    expect((await approveDayAction(deps(plan).d, TRIP, "2026-12-09", "3")).message).toBe("日期不在行程期間內");
    const blocked = { ...plan, days: [{ ...draftDay, blocked: true }] };
    expect((await approveDayAction(deps(blocked).d, TRIP, "2026-12-01", "3")).message).toBe("這天仍有未通過的可行性檢查，無法批准");
  });

  it("資料庫拒絕時回傳對應訊息；其他錯誤只記錄、不外洩", async () => {
    const reject = (reason: "forbidden" | "state" | "invalid" | "unknown") =>
      deps(plan, {
        approve: async () => {
          throw new DayApprovalStoreError(reason);
        },
      });
    expect((await approveDayAction(reject("forbidden").d, TRIP, "2026-12-01", "3")).message).toBe("沒有批准權限");
    expect((await approveDayAction(reject("state").d, TRIP, "2026-12-01", "3")).message).toBe("這天已批准或行程已鎖定");
    expect((await approveDayAction(reject("invalid").d, TRIP, "2026-12-01", "3")).message).toBe("每日行程內容不正確，請重新整理");
    const unknown = reject("unknown");
    expect((await approveDayAction(unknown.d, TRIP, "2026-12-01", "3")).message).toBe("批准失敗，請稍後再試");
    expect(unknown.logs).toEqual(["批准每日行程失敗"]);
  });
});
