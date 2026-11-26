import { describe, expect, it } from "vitest";
import { InboxStoreError, markAllReadAction, notificationLabel, setReverifyAction, type InboxDeps } from "./inbox-core";

// T31：Owner 開關旅前再核實排程；成員開啟 App 時看到未讀通知與 At Risk 項目（SH-06）

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";

function deps(over: Partial<InboxDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const d: InboxDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => true,
    setReverify: async (...args) => {
      calls.push(["setReverify", ...args]);
    },
    markAllRead: async () => {
      calls.push(["markAllRead"]);
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs };
}

describe("setReverifyAction", () => {
  it("Owner 開啟或關閉排程", async () => {
    const on = deps();
    expect(await setReverifyAction(on.d, TRIP, "on")).toEqual({ ok: true, message: "已開啟旅前自動再核實" });
    expect(on.calls).toEqual([["setReverify", TRIP, true]]);
    const off = deps();
    expect(await setReverifyAction(off.d, TRIP, "off")).toEqual({ ok: true, message: "已關閉旅前自動再核實" });
    expect(off.calls).toEqual([["setReverify", TRIP, false]]);
  });

  it("未登入、速率限制、參數不正確時不呼叫資料庫", async () => {
    expect((await setReverifyAction(deps({ getUser: async () => null }).d, TRIP, "on")).message).toBe("需要登入");
    expect((await setReverifyAction(deps({ checkRateLimit: async () => false }).d, TRIP, "on")).message).toBe("操作過於頻繁，請稍後再試");
    const { d, calls } = deps();
    expect((await setReverifyAction(d, "x", "on")).message).toBe("行程不正確");
    expect((await setReverifyAction(d, TRIP, "yes")).message).toBe("設定不正確");
    expect(calls).toEqual([]);
  });

  it("不是 Owner 時拒絕；其他錯誤只記錄", async () => {
    const forbidden = deps({
      setReverify: async () => {
        throw new InboxStoreError("forbidden");
      },
    });
    expect((await setReverifyAction(forbidden.d, TRIP, "on")).message).toBe("只有 Owner 可以設定旅前自動再核實");
    const unknown = deps({
      setReverify: async () => {
        throw new InboxStoreError("unknown");
      },
    });
    expect((await setReverifyAction(unknown.d, TRIP, "on")).message).toBe("設定失敗，請稍後再試");
    expect(unknown.logs).toEqual(["設定旅前再核實失敗"]);
  });
});

describe("markAllReadAction", () => {
  it("把本人的未讀通知標為已讀", async () => {
    const { d, calls } = deps();
    expect(await markAllReadAction(d)).toEqual({ ok: true, message: "已全部標為已讀" });
    expect(calls).toEqual([["markAllRead"]]);
    expect((await markAllReadAction(deps({ getUser: async () => null }).d)).message).toBe("需要登入");
  });
});

describe("notificationLabel", () => {
  it("顯示通知種類；未知種類顯示通用文字", () => {
    expect(notificationLabel("proposal_applied")).toBe("行程已更新");
    expect(notificationLabel("trip_locked")).toBe("行程已鎖定");
    expect(notificationLabel("incident_started")).toBe("進入 Incident Mode，有替代方案待批准");
    expect(notificationLabel("something_else")).toBe("行程有新消息");
  });
});
