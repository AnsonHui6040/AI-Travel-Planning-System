import type { PostTripReport } from "@atps/core";
import { describe, expect, it } from "vitest";
import {
  decideProposalAction,
  deleteMemoryAction,
  generateProposalsAction,
  MemoryStoreError,
  saveMemoryAction,
  type MemoryDeps,
} from "./memories-core";

// T41：記憶管理（MEM-01、MEM-03、MEM-06、MEM-07）與旅後提案（MEM-04）的 Server Action

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const MEM = "a0000000-0000-4000-8000-000000000001";

const report: PostTripReport = {
  stayDifferences: [{ date: "2026-11-20", itemId: "a", name_zh: "淺草寺", plannedMinutes: 90, actualMinutes: 120, diffMinutes: 30 }],
  transportDifferences: [],
  backupsUsed: [],
  crowdedSlots: [],
  unreliableRecommendations: [],
  favoriteActivityTypes: [],
};

function deps(over: Partial<MemoryDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const d: MemoryDeps = {
    getUser: async () => ({ id: "me" }),
    checkRateLimit: async () => true,
    isTripMember: async () => true,
    save: async (row) => {
      calls.push(["save", row]);
    },
    remove: async (id) => {
      calls.push(["remove", id]);
    },
    decide: async (id, approve) => {
      calls.push(["decide", id, approve]);
    },
    loadPostTrip: async () => ({ tripStatus: "ended", report }),
    createProposals: async (tripId, drafts) => {
      calls.push(["proposals", tripId, drafts.length]);
      return drafts.length;
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs };
}

describe("saveMemoryAction", () => {
  it("新增清單內的限制：單位由清單決定", async () => {
    const { d, calls } = deps();
    const result = await saveMemoryAction(d, { layer: "personal", kind: "constraint", item: "每日步行上限", value: "8", unit: "英里" });
    expect(result).toEqual({ ok: true, message: "已儲存" });
    expect(calls).toEqual([["save", { id: null, layer: "personal", kind: "constraint", item: "每日步行上限", value: "8", unit: "公里", tripId: null }]]);
  });

  it("清單內的數值與時間須可判讀", async () => {
    const { d, calls } = deps();
    expect((await saveMemoryAction(d, { layer: "personal", kind: "constraint", item: "每日步行上限", value: "很多", unit: "" })).message).toBe("「每日步行上限」須填數字");
    expect((await saveMemoryAction(d, { layer: "personal", kind: "constraint", item: "最早出發", value: "九點", unit: "" })).message).toBe("「最早出發」須填 HH:MM");
    expect((await saveMemoryAction(d, { layer: "personal", kind: "constraint", item: "每日預算上限", value: "20000", unit: "" })).message).toBe("「每日預算上限」須填幣別（例如 JPY）");
    expect(calls).toEqual([]);
  });

  it("身分與聯絡資料不寫入（MEM-07）", async () => {
    const { d, calls } = deps();
    expect((await saveMemoryAction(d, { layer: "personal", kind: "preference", item: "聯絡", value: "a@example.com", unit: "" })).ok).toBe(false);
    expect((await saveMemoryAction(d, { layer: "personal", kind: "preference", item: "備註", value: "0912-345-678", unit: "" })).message).toBe("電話不寫入記憶");
    expect(calls).toEqual([]);
  });

  it("本趟 context 須指定自己所在的行程", async () => {
    expect((await saveMemoryAction(deps().d, { layer: "trip_context", kind: "preference", item: "想吃", value: "章魚燒", unit: "" })).message).toBe("參數不正確");
    expect(
      (await saveMemoryAction(deps({ isTripMember: async () => false }).d, { layer: "trip_context", kind: "preference", item: "想吃", value: "章魚燒", unit: "", tripId: TRIP })).message,
    ).toBe("找不到這個行程，或你不是成員。");
    const { d, calls } = deps();
    await saveMemoryAction(d, { layer: "trip_context", kind: "preference", item: "想吃", value: "章魚燒", unit: "", tripId: TRIP });
    expect(calls[0]?.[1]).toMatchObject({ layer: "trip_context", tripId: TRIP, unit: null });
  });

  it("修改既有記憶（MEM-06）", async () => {
    const { d, calls } = deps();
    await saveMemoryAction(d, { id: MEM, layer: "personal", kind: "constraint", item: "每日轉乘上限", value: "2", unit: "" });
    expect(calls[0]?.[1]).toMatchObject({ id: MEM, value: "2", unit: "次" });
  });

  it("資料庫拒絕身分資料時回傳訊息；需要登入", async () => {
    const rejected = deps({ save: async () => Promise.reject(new MemoryStoreError("invalid")) });
    expect((await saveMemoryAction(rejected.d, { layer: "personal", kind: "preference", item: "x", value: "y", unit: "" })).message).toBe("身分與聯絡資料不寫入記憶");
    expect((await saveMemoryAction(deps({ getUser: async () => null }).d, {})).message).toBe("需要登入");
  });
});

describe("deleteMemoryAction、decideProposalAction", () => {
  it("刪除與批准、否決", async () => {
    const { d, calls } = deps();
    expect(await deleteMemoryAction(d, MEM)).toEqual({ ok: true, message: "已刪除" });
    expect(await decideProposalAction(d, MEM, "approve")).toEqual({ ok: true, message: "已批准，寫入記憶" });
    expect(await decideProposalAction(d, MEM, "reject")).toEqual({ ok: true, message: "已否決" });
    expect(calls).toEqual([
      ["remove", MEM],
      ["decide", MEM, true],
      ["decide", MEM, false],
    ]);
    expect((await decideProposalAction(d, MEM, "maybe")).message).toBe("參數不正確");
  });
});

describe("generateProposalsAction（MEM-04）", () => {
  it("依比較報告為本人建立待批准提案，不直接寫入記憶", async () => {
    const { d, calls } = deps();
    expect(await generateProposalsAction(d, TRIP)).toEqual({ ok: true, message: "已建立 1 個旅後記憶提案，請到「記憶」批准或否決" });
    expect(calls).toEqual([["proposals", TRIP, 1]]);
  });

  it("行程未結束不可建立；沒有可提的內容時說明", async () => {
    expect((await generateProposalsAction(deps({ loadPostTrip: async () => ({ tripStatus: "in_progress", report }) }).d, TRIP)).message).toBe("行程結束後才能產生旅後記憶提案");
    const empty = { ...report, stayDifferences: [] };
    const { d, calls } = deps({ loadPostTrip: async () => ({ tripStatus: "ended", report: empty }) });
    expect((await generateProposalsAction(d, TRIP)).message).toBe("這趟旅行沒有足以提出的差異");
    expect(calls).toEqual([]);
  });
});
