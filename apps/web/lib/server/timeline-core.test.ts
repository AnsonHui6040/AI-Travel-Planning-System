import { describe, expect, it } from "vitest";
import { produceTimelineAction, recordEntryAction, TimelineStoreError, type TimelineContext, type TimelineDeps } from "./timeline-core";

// T39：Actual Timeline 的 Server Action。記錄以本人 session 寫入；產生時由 core 的 actualTimeline 計算後經
// produce_actual_timeline 寫入，資料庫再確認只有最後一筆為完成的項目成為已去過

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";

function deps(over: Partial<TimelineDeps> = {}, ctx: Partial<TimelineContext> = {}) {
  const records: unknown[] = [];
  const produced: unknown[] = [];
  const logs: string[] = [];
  const d: TimelineDeps = {
    getUser: async () => ({ id: "me" }),
    checkRateLimit: async () => true,
    loadContext: async () => ({
      canEdit: true,
      dayStatus: "day_ready",
      timezone: "Asia/Tokyo",
      planned: [
        { id: A, name_zh: "淺草寺", scheduled_start: "09:00", scheduled_end: "10:30" },
        { id: B, name_zh: "晴空塔", scheduled_start: "11:00", scheduled_end: "12:30" },
      ],
      unplanned: [],
      entries: [
        { item_id: A, arrived_at: "2026-11-20T00:10:00Z", departed_at: "2026-11-20T01:30:00Z", completion: "completed", recorded_by: "me", created_at: "2026-11-20T01:30:00Z" },
        { item_id: B, arrived_at: null, departed_at: null, completion: "partial", recorded_by: "me", created_at: "2026-11-20T03:00:00Z" },
      ],
      ...ctx,
    }),
    record: async (entry) => {
      records.push(entry);
    },
    produce: async (tripId, date, timeline) => {
      produced.push({ tripId, date, timeline });
      return { tripStatus: "in_progress" };
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, records, produced, logs };
}

const form = (fields: Record<string, string>) => fields;

describe("recordEntryAction", () => {
  it("以目的地時區把當地時間換成 UTC 後寫入", async () => {
    const { d, records } = deps();
    const result = await recordEntryAction(d, form({ tripId: TRIP, date: "2026-11-20", itemId: A, completion: "completed", arrived: "09:10", departed: "10:30" }));
    expect(result.ok).toBe(true);
    expect(records).toEqual([
      { tripId: TRIP, itemId: A, completion: "completed", arrivedAt: "2026-11-20T00:10:00.000Z", departedAt: "2026-11-20T01:30:00.000Z" },
    ]);
  });

  it("時間可留空（略過時沒有到達與離開）", async () => {
    const { d, records } = deps();
    const result = await recordEntryAction(d, form({ tripId: TRIP, date: "2026-11-20", itemId: B, completion: "skipped", arrived: "", departed: "" }));
    expect(result.ok).toBe(true);
    expect(records).toEqual([{ tripId: TRIP, itemId: B, completion: "skipped", arrivedAt: null, departedAt: null }]);
  });

  it("離開早於到達時不寫入", async () => {
    const { d, records } = deps();
    const result = await recordEntryAction(d, form({ tripId: TRIP, date: "2026-11-20", itemId: A, completion: "completed", arrived: "10:00", departed: "09:00" }));
    expect(result).toEqual({ ok: false, message: "離開時間不可早於到達時間" });
    expect(records).toEqual([]);
  });

  it("不接受未知的完成狀態、格式錯誤的時間或不屬於這天的項目", async () => {
    const { d, records } = deps();
    expect((await recordEntryAction(d, form({ tripId: TRIP, date: "2026-11-20", itemId: A, completion: "visited", arrived: "", departed: "" }))).ok).toBe(false);
    expect((await recordEntryAction(d, form({ tripId: TRIP, date: "2026-11-20", itemId: A, completion: "completed", arrived: "25:00", departed: "" }))).ok).toBe(false);
    const other = "a0000000-0000-4000-8000-000000000099";
    expect(await recordEntryAction(d, form({ tripId: TRIP, date: "2026-11-20", itemId: other, completion: "completed", arrived: "", departed: "" }))).toEqual({
      ok: false,
      message: "只能記錄這天排定的項目",
    });
    expect(records).toEqual([]);
  });

  it("Viewer 不可記錄；已完成的日期不可記錄", async () => {
    expect((await recordEntryAction(deps({}, { canEdit: false }).d, form({ tripId: TRIP, date: "2026-11-20", itemId: A, completion: "completed", arrived: "", departed: "" }))).message).toBe(
      "只有 Owner 與 Companion 可以記錄",
    );
    expect((await recordEntryAction(deps({}, { dayStatus: "completed" }).d, form({ tripId: TRIP, date: "2026-11-20", itemId: A, completion: "completed", arrived: "", departed: "" }))).message).toBe(
      "這天的 Actual Timeline 已產生",
    );
  });

  it("需要登入並受速率限制", async () => {
    expect((await recordEntryAction(deps({ getUser: async () => null }).d, form({ tripId: TRIP }))).message).toBe("需要登入");
    expect((await recordEntryAction(deps({ checkRateLimit: async () => false }).d, form({ tripId: TRIP }))).message).toBe("操作過於頻繁，請稍後再試");
  });
});

describe("produceTimelineAction", () => {
  it("只把完成的項目標為已去過後送出", async () => {
    const { d, produced } = deps();
    const result = await produceTimelineAction(d, TRIP, "2026-11-20");
    expect(result.ok).toBe(true);
    const sent = produced[0] as { timeline: { rows: Array<{ itemId: string; visited: boolean; outcome: string }> } };
    expect(sent.timeline.rows.map((r) => [r.itemId, r.outcome, r.visited])).toEqual([
      [A, "completed", true],
      [B, "partial", false],
    ]);
    expect(result.message).toBe("已產生 Actual Timeline：排定 2 項，完成 1 項，部分完成 1 項，略過 0 項，沒有紀錄 0 項");
  });

  it("最後一日產生後說明行程已結束", async () => {
    const { d } = deps({ produce: async () => ({ tripStatus: "ended" }) });
    expect((await produceTimelineAction(d, TRIP, "2026-11-20")).message).toContain("行程已結束");
  });

  it("資料庫拒絕時回傳對應訊息，其他錯誤不外洩細節", async () => {
    const state = deps({ produce: async () => Promise.reject(new TimelineStoreError("state")) });
    expect((await produceTimelineAction(state.d, TRIP, "2026-11-20")).message).toBe("這天尚未批准，或 Actual Timeline 已產生");
    const unknown = deps({ produce: async () => Promise.reject(new Error("db down")) });
    expect(await produceTimelineAction(unknown.d, TRIP, "2026-11-20")).toEqual({ ok: false, message: "產生失敗，請稍後再試" });
    expect(unknown.logs).toEqual(["Actual Timeline 寫入失敗"]);
  });

  it("Viewer 不可產生；參數不正確時不讀取", async () => {
    expect((await produceTimelineAction(deps({}, { canEdit: false }).d, TRIP, "2026-11-20")).message).toBe("只有 Owner 與 Companion 可以產生 Actual Timeline");
    expect((await produceTimelineAction(deps().d, "x", "2026-11-20")).message).toBe("參數不正確");
  });
});
