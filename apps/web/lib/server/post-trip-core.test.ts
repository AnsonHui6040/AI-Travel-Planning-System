import { describe, expect, it } from "vitest";
import { PostTripStoreError, setPostTripStatusAction, type PostTripDeps } from "./post-trip-core";

// T40：旅後狀態標記的 Server Action。資料庫 set_post_trip_status 再檢查權限、行程狀態與實際紀錄

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const VISITED = "a0000000-0000-4000-8000-000000000001";
const MISSED = "a0000000-0000-4000-8000-000000000002";

function deps(over: Partial<PostTripDeps> = {}, ctx: { canEdit?: boolean; tripStatus?: string } = {}) {
  const writes: unknown[] = [];
  const logs: string[] = [];
  const d: PostTripDeps = {
    getUser: async () => ({ id: "me" }),
    checkRateLimit: async () => true,
    loadContext: async () => ({
      canEdit: ctx.canEdit ?? true,
      tripStatus: ctx.tripStatus ?? "ended",
      items: [
        { id: VISITED, visited: true },
        { id: MISSED, visited: false },
      ],
    }),
    setStatus: async (tripId, itemId, status) => {
      writes.push([tripId, itemId, status]);
      return { tripStatus: "ended", remaining: 1 };
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, writes, logs };
}

describe("setPostTripStatusAction", () => {
  it("寫入並回報尚未標記的項目數", async () => {
    const { d, writes } = deps();
    expect(await setPostTripStatusAction(d, { tripId: TRIP, itemId: VISITED, status: "revisit" })).toEqual({ ok: true, message: "已儲存，還有 1 個項目未標記" });
    expect(writes).toEqual([[TRIP, VISITED, "revisit"]]);
  });

  it("全部標記後說明行程已封存", async () => {
    const { d } = deps({ setStatus: async () => ({ tripStatus: "archived", remaining: 0 }) });
    expect((await setPostTripStatusAction(d, { tripId: TRIP, itemId: VISITED, status: "completed" })).message).toBe("已儲存。所有項目都已標記，行程已封存");
  });

  it("沒有去過的項目不可標為完成或不推薦；去過的不可標為略過或取消", async () => {
    const { d, writes } = deps();
    for (const [itemId, status] of [
      [MISSED, "completed"],
      [MISSED, "not_recommended"],
      [VISITED, "skipped"],
      [VISITED, "cancelled"],
    ] as const) {
      expect(await setPostTripStatusAction(d, { tripId: TRIP, itemId, status })).toEqual({ ok: false, message: "旅後狀態與實際紀錄不符" });
    }
    expect(writes).toEqual([]);
  });

  it("不需標記的項目、未知狀態、錯誤參數不寫入", async () => {
    const { d, writes } = deps();
    expect((await setPostTripStatusAction(d, { tripId: TRIP, itemId: "a0000000-0000-4000-8000-000000000099", status: "skipped" })).message).toBe("這個項目不需標記");
    expect((await setPostTripStatusAction(d, { tripId: TRIP, itemId: VISITED, status: "loved" })).message).toBe("參數不正確");
    expect((await setPostTripStatusAction(d, { tripId: "x", itemId: VISITED, status: "completed" })).message).toBe("參數不正確");
    expect(writes).toEqual([]);
  });

  it("Viewer 不可標記；行程未結束或已封存時不可標記", async () => {
    expect((await setPostTripStatusAction(deps({}, { canEdit: false }).d, { tripId: TRIP, itemId: VISITED, status: "completed" })).message).toBe("只有 Owner 與 Companion 可以標記旅後狀態");
    expect((await setPostTripStatusAction(deps({}, { tripStatus: "in_progress" }).d, { tripId: TRIP, itemId: VISITED, status: "completed" })).message).toBe("行程結束後才能標記旅後狀態");
    expect((await setPostTripStatusAction(deps({}, { tripStatus: "archived" }).d, { tripId: TRIP, itemId: VISITED, status: "completed" })).message).toBe("行程已封存，不能再修改");
  });

  it("資料庫拒絕時回傳對應訊息，其他錯誤不外洩細節", async () => {
    const state = deps({ setStatus: async () => Promise.reject(new PostTripStoreError("state")) });
    expect((await setPostTripStatusAction(state.d, { tripId: TRIP, itemId: VISITED, status: "completed" })).message).toBe("行程結束後才能標記旅後狀態");
    const other = deps({ setStatus: async () => Promise.reject(new Error("db")) });
    expect(await setPostTripStatusAction(other.d, { tripId: TRIP, itemId: VISITED, status: "completed" })).toEqual({ ok: false, message: "儲存失敗，請稍後再試" });
    expect(other.logs).toEqual(["旅後狀態寫入失敗"]);
  });

  it("需要登入並受速率限制", async () => {
    expect((await setPostTripStatusAction(deps({ getUser: async () => null }).d, {})).message).toBe("需要登入");
    expect((await setPostTripStatusAction(deps({ checkRateLimit: async () => false }).d, {})).message).toBe("操作過於頻繁，請稍後再試");
  });
});
