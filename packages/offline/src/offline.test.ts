import { changePayload } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { buildDayPack, drainQueue, enqueue, isPackDay, leaveCountdown, queuedToProposal, type DayPackInput, type QueuedChange } from "./index";

// T35：離線當日包與修改佇列（D11、SH-05）。純函式：時間由呼叫端傳入

const input: DayPackInput = {
  tripId: "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab",
  date: "2026-12-10",
  timezone: "Asia/Tokyo",
  baseVersion: 4,
  generatedAt: "2026-12-10T07:00:00+09:00",
  items: [
    { id: "b", name_zh: "雷門", name_local: "雷門", address: null, scheduled_start: "11:00", scheduled_end: "11:30", at_risk: false, verification_status: "verified" },
    { id: "a", name_zh: "淺草寺", name_local: "浅草寺", address: "台東區淺草 2-3-1", scheduled_start: "09:00", scheduled_end: "10:00", at_risk: true, verification_status: "partially_verified" },
  ],
  fixed: [{ name: "和服體驗", start: "13:00", end: "15:00" }],
  travelMinutes: (from, to) => (from === "a" && to === "b" ? 20 : null),
  backups: [
    { id: "x", name_zh: "淺草文化觀光中心", standby: false },
    { id: "y", name_zh: "淺草演藝廳", standby: true },
  ],
  photos: [{ item_id: "a", url: "/api/photos/trip/a.jpg", credit: "使用者" }],
};

describe("buildDayPack", () => {
  it("依時間排序，計算最遲離開時間與下一站（含固定活動）", () => {
    const pack = buildDayPack(input);
    expect(pack.entries.map((e) => [e.itemId, e.start, e.leaveBy, e.nextName, e.travelToNextMinutes])).toEqual([
      ["a", "09:00", "10:40", "雷門", 20],
      // 下一站是固定活動：沒有估算時以 30 分鐘計，另加固定活動前 15 分鐘緩衝
      ["b", "11:00", "12:15", "和服體驗", 30],
    ]);
    expect(pack.entries[0]).toMatchObject({ name: "淺草寺", nameLocal: "浅草寺", address: "台東區淺草 2-3-1", atRisk: true, verificationStatus: "partially_verified" });
    expect(pack.fixed).toEqual([{ name: "和服體驗", start: "13:00", end: "15:00" }]);
    // T36：Morning Check 提升的 Standby 排在前面
    expect(pack.backups).toEqual([
      { id: "y", name: "淺草演藝廳", standby: true },
      { id: "x", name: "淺草文化觀光中心", standby: false },
    ]);
    expect(pack.photos).toEqual([{ itemId: "a", url: "/api/photos/trip/a.jpg", credit: "使用者" }]);
    expect(pack).toMatchObject({ format: 1, tripId: input.tripId, date: "2026-12-10", baseVersion: 4, generatedAt: input.generatedAt });
  });

  it("決策 0010 B：當天的預訂（含預約碼，只給成員）與清單離線可讀；沒有時為空陣列", () => {
    expect(buildDayPack(input)).toMatchObject({ bookings: [], lists: [] });
    const pack = buildDayPack({
      ...input,
      bookings: [
        { kind: "restaurant", title: "壽司晚餐", start: "19:00", end: "20:30", location: "銀座", confirmation_code: "ZX9QK2" },
        { kind: "ticket", title: "美術館", start: "10:00", end: null, location: null, confirmation_code: null },
      ],
      lists: [
        {
          title: "打包",
          kind: "packing",
          items: [
            { text: "雨傘", checked: true, assignee: null },
            { text: "護照", checked: false, assignee: "小安" },
          ],
        },
      ],
    });
    expect(pack.bookings.map((b) => `${b.start} ${b.title}`)).toEqual(["10:00 美術館", "19:00 壽司晚餐"]);
    expect(pack.bookings[1]).toMatchObject({ confirmationCode: "ZX9QK2", location: "銀座", end: "20:30" });
    // 未完成的項目排在前面
    expect(pack.lists).toEqual([
      { title: "打包", kind: "packing", items: [{ text: "護照", checked: false, assignee: "小安" }, { text: "雨傘", checked: true, assignee: null }] },
    ]);
  });

  it("最後一站沒有最遲離開時間", () => {
    const pack = buildDayPack({ ...input, fixed: [] });
    expect(pack.entries.at(-1)).toMatchObject({ itemId: "b", leaveBy: null, nextName: null, travelToNextMinutes: null });
  });

  it("只接受站內的照片網址", () => {
    const pack = buildDayPack({ ...input, photos: [...input.photos, { item_id: "b", url: "https://evil.example/x.jpg", credit: "x" }] });
    expect(pack.photos.map((p) => p.url)).toEqual(["/api/photos/trip/a.jpg"]);
  });
});

describe("leaveCountdown", () => {
  it("以目的地時區計算距最遲離開時間的分鐘數；已過時為負數", () => {
    const pack = buildDayPack(input);
    const first = pack.entries[0];
    if (!first) throw new Error("沒有項目");
    expect(leaveCountdown(pack, first, new Date("2026-12-10T10:00:00+09:00"))).toBe(40);
    expect(leaveCountdown(pack, first, new Date("2026-12-10T10:50:00+09:00"))).toBe(-10);
    expect(leaveCountdown(pack, { ...first, leaveBy: null }, new Date())).toBeNull();
  });
});

describe("isPackDay", () => {
  it("只在目的地時區的當天顯示倒數", () => {
    const pack = buildDayPack(input);
    expect(isPackDay(pack, new Date("2026-12-10T08:00:00+09:00"))).toBe(true);
    // 台北 2026-12-09 23:30 = 東京 2026-12-10 00:30
    expect(isPackDay(pack, new Date("2026-12-09T23:30:00+08:00"))).toBe(true);
    expect(isPackDay(pack, new Date("2026-12-09T22:00:00+09:00"))).toBe(false);
  });
});

const change = (over: Partial<QueuedChange> = {}): QueuedChange => ({
  id: "q1",
  tripId: input.tripId,
  itemId: "11111111-1111-4111-8111-111111111111",
  itemName: "淺草寺",
  date: "2026-12-10",
  start: "09:30",
  end: "10:30",
  baseVersion: 4,
  queuedAt: "2026-12-10T08:00:00+09:00",
  ...over,
});

describe("離線修改佇列", () => {
  it("同一項目的新修改取代舊修改", () => {
    const queue = enqueue(enqueue([], change()), change({ id: "q2", start: "09:45", end: "10:45" }));
    expect(queue.map((c) => [c.id, c.start])).toEqual([["q2", "09:45"]]);
    expect(enqueue(queue, change({ id: "q3", itemId: "22222222-2222-4222-8222-222222222222" }))).toHaveLength(2);
  });

  it("轉為需要批准的提案，保留排入佇列時的 base version（SH-05）", () => {
    const proposal = queuedToProposal(change());
    expect(proposal).toEqual({
      baseVersion: 4,
      change: {
        changeKind: "minor_non_incident",
        versionKind: "minor",
        summary: "離線修改：淺草寺改為 09:30–10:30",
        operations: [{ op: "schedule_item", itemId: change().itemId, date: "2026-12-10", start: "09:30", end: "10:30" }],
      },
    });
    expect(changePayload.safeParse(proposal.change).success).toBe(true);
  });

  it("依序送出；網路失敗時停止並保留其餘，伺服器拒絕的修改移除", async () => {
    const queue = [change({ id: "q1" }), change({ id: "q2", itemId: "22222222-2222-4222-8222-222222222222" }), change({ id: "q3", itemId: "33333333-3333-4333-8333-333333333333" })];
    const sent: string[] = [];
    const result = await drainQueue(queue, async (c) => {
      sent.push(c.id);
      if (c.id === "q1") return "rejected";
      if (c.id === "q2") return "sent";
      return "failed";
    });
    expect(sent).toEqual(["q1", "q2", "q3"]);
    expect(result).toEqual({ sent: 1, rejected: 1, remaining: [queue[2]] });
  });
});
