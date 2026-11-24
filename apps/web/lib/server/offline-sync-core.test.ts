import { describe, expect, it } from "vitest";
import { syncOfflineChange, type OfflineSyncDeps } from "./offline-sync-core";

// T35（SH-05）：離線排入佇列的修改於恢復網路時送出，一律成為待批准提案，保留排入佇列時的 base version；
// 批准時依 SH-04 檢查版本。項目名稱由伺服器讀取，不採用瀏覽器送來的文字

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const ITEM = "3b1e9c2d-7f4a-4c8b-a2d1-0f9e8d7c6b5a";
const body = { itemId: ITEM, date: "2026-12-10", start: "09:30", end: "10:30", baseVersion: 3 };

function deps(over: Partial<OfflineSyncDeps> = {}) {
  const created: unknown[] = [];
  const d: OfflineSyncDeps = {
    canEdit: async () => true,
    loadItem: async () => ({ name_zh: "淺草寺", scheduled_date: "2026-12-10" }),
    createProposal: async (input) => {
      created.push(input);
    },
    ...over,
  };
  return { d, created };
}

describe("syncOfflineChange", () => {
  it("建立待批准提案：成員本人為提出者，base version 為排入佇列時的版本", async () => {
    const { d, created } = deps();
    expect(await syncOfflineChange(d, { userId: "me", tripId: TRIP, body })).toEqual({ status: 201, message: "已建立提案" });
    expect(created).toEqual([
      {
        tripId: TRIP,
        memberId: "me",
        baseVersion: 3,
        change: {
          changeKind: "minor_non_incident",
          versionKind: "minor",
          summary: "離線修改：淺草寺改為 09:30–10:30",
          operations: [{ op: "schedule_item", itemId: ITEM, date: "2026-12-10", start: "09:30", end: "10:30" }],
        },
        impactScope: { dates: ["2026-12-10"] },
      },
    ]);
  });

  it("格式不正確、結束早於開始、多餘欄位時拒絕", async () => {
    const { d, created } = deps();
    expect((await syncOfflineChange(d, { userId: "me", tripId: TRIP, body: { ...body, start: "25:00" } })).status).toBe(400);
    expect((await syncOfflineChange(d, { userId: "me", tripId: TRIP, body: { ...body, end: "09:00" } })).status).toBe(400);
    expect((await syncOfflineChange(d, { userId: "me", tripId: TRIP, body: { ...body, itemName: "<script>" } })).status).toBe(400);
    expect((await syncOfflineChange(d, { userId: "me", tripId: "x", body })).status).toBe(400);
    expect(created).toEqual([]);
  });

  it("Viewer 不可提出修改；項目不屬於此行程或不在當天時拒絕", async () => {
    expect((await syncOfflineChange(deps({ canEdit: async () => false }).d, { userId: "me", tripId: TRIP, body })).status).toBe(403);
    expect((await syncOfflineChange(deps({ loadItem: async () => null }).d, { userId: "me", tripId: TRIP, body })).status).toBe(404);
    const moved = deps({ loadItem: async () => ({ name_zh: "淺草寺", scheduled_date: "2026-12-11" }) });
    expect(await syncOfflineChange(moved.d, { userId: "me", tripId: TRIP, body })).toEqual({ status: 409, message: "項目已不在這一天，請重新整理" });
  });
});
