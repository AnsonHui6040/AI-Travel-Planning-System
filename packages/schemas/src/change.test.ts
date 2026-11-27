import { describe, expect, it } from "vitest";
import { CHANGE_KINDS, MEMBER_ONLY_OPERATIONS, aiChangePayload, changePayload, restoreResult, roleOutputs, scheduleSnapshot, userItemFields } from "./index";

const itemId = "30000000-0000-4000-8000-000000000001";

const valid = {
  changeKind: "minor_non_incident",
  versionKind: "minor",
  summary: "淺草寺改到下午",
  operations: [{ op: "schedule_item", itemId, date: "2026-12-01", start: "14:00", end: "15:00" }],
};

describe("變更提案內容（S-01）", () => {
  it("接受合法的提案", () => {
    expect(changePayload.parse(valid)).toMatchObject(valid);
  });

  it("接受標示 At Risk 的操作與結構變更標記", () => {
    expect(() =>
      changePayload.parse({
        ...valid,
        changeKind: "major_version",
        versionKind: "major",
        structural: ["hotel"],
        operations: [{ op: "set_at_risk", itemId, atRisk: true }],
      }),
    ).not.toThrow();
  });

  it("變更種類涵蓋第 2.6 節批准規則表的 12 種", () => {
    expect(CHANGE_KINDS).toHaveLength(12);
  });

  it.each([
    ["未知欄位", { ...valid, extra: 1 }],
    ["未知變更種類", { ...valid, changeKind: "delete_trip" }],
    ["沒有操作", { ...valid, operations: [] }],
    ["未知操作", { ...valid, operations: [{ op: "drop_table", itemId }] }],
    ["操作含未知欄位", { ...valid, operations: [{ op: "set_at_risk", itemId, atRisk: true, sql: "x" }] }],
    ["項目編號不是 UUID", { ...valid, operations: [{ op: "set_at_risk", itemId: "1", atRisk: true }] }],
    ["時間格式錯誤", { ...valid, operations: [{ op: "schedule_item", itemId, date: null, start: "25:00", end: null }] }],
    ["結束早於開始", { ...valid, operations: [{ op: "schedule_item", itemId, date: "2026-12-01", start: "15:00", end: "14:00" }] }],
    ["摘要過長", { ...valid, summary: "字".repeat(501) }],
    ["操作超過 50 個", { ...valid, operations: Array.from({ length: 51 }, () => valid.operations[0]) }],
  ])("拒絕%s", (_label, payload) => {
    expect(changePayload.safeParse(payload).success).toBe(false);
  });
});

describe("版本快照與復原結果（T10A）", () => {
  it("快照列出每個項目的日期與時間，未排程為 null", () => {
    const snapshot = [
      { itemId, date: "2026-12-01", start: "10:00", end: "11:30" },
      { itemId: "30000000-0000-4000-8000-000000000002", date: null, start: null, end: null },
    ];
    expect(scheduleSnapshot.parse(snapshot)).toEqual(snapshot);
  });

  it("快照拒絕多餘欄位與錯誤時間格式", () => {
    expect(() => scheduleSnapshot.parse([{ itemId, date: "2026-12-01", start: "10:00", end: "11:30", atRisk: true }])).toThrow();
    expect(() => scheduleSnapshot.parse([{ itemId, date: "2026-12-01", start: "10:00:00", end: "11:30" }])).toThrow();
  });

  it("復原結果包含新版本號與版本編號", () => {
    const result = { outcome: "restored", major: 2, minor: 0, version_id: "50000000-0000-4000-8000-000000000001" };
    expect(restoreResult.parse(result)).toEqual(result);
    expect(() => restoreResult.parse({ outcome: "restored", major: 2 })).toThrow();
  });
});

// 決策 0010：成員的新增、修改、刪除提案；AI 的提案不可含這三種操作
describe("成員編輯的提案操作（決策 0010）", () => {
  const item = { name_zh: "藏前咖啡", type: "restaurant", address: null, suggested_stay_minutes: 60, note: null, place_id: null };

  it("接受新增、修改、刪除", () => {
    const parsed = changePayload.parse({
      ...valid,
      operations: [
        { op: "add_item", itemId, item, date: "2026-12-01", start: "10:00", end: "11:00" },
        { op: "update_item", itemId, fields: { note: "要排隊" } },
        { op: "remove_item", itemId },
      ],
    });
    expect(parsed.operations.map((o) => o.op)).toEqual(["add_item", "update_item", "remove_item"]);
  });

  it("新增到候選清單時日期與時間都是空值；只填日期不接受", () => {
    expect(() => changePayload.parse({ ...valid, operations: [{ op: "add_item", itemId, item, date: null, start: null, end: null }] })).not.toThrow();
    expect(() => changePayload.parse({ ...valid, operations: [{ op: "add_item", itemId, item, date: "2026-12-01", start: null, end: null }] })).toThrow();
    expect(() => changePayload.parse({ ...valid, operations: [{ op: "add_item", itemId, item, date: "2026-12-01", start: "11:00", end: "10:00" }] })).toThrow();
  });

  it("修改至少一個欄位；不接受未知欄位（例如核實狀態）", () => {
    expect(() => changePayload.parse({ ...valid, operations: [{ op: "update_item", itemId, fields: {} }] })).toThrow();
    expect(() =>
      changePayload.parse({ ...valid, operations: [{ op: "update_item", itemId, fields: { verification_status: "verified" } }] }),
    ).toThrow();
  });

  it("place_id 只接受 Google 的格式", () => {
    expect(userItemFields.safeParse({ ...item, place_id: "ChIJ51cu8IcbXWARiRtXIothAS4" }).success).toBe(true);
    expect(userItemFields.safeParse({ ...item, place_id: "<script>" }).success).toBe(false);
  });

  it("AI 的提案只能含排程與 At Risk", () => {
    expect(aiChangePayload.safeParse(valid).success).toBe(true);
    expect(aiChangePayload.safeParse({ ...valid, operations: [{ op: "remove_item", itemId }] }).success).toBe(false);
    expect(roleOutputs.master_planner.safeParse({ proposals: [{ ...valid, operations: [{ op: "add_item", itemId, item, date: null, start: null, end: null }] }] }).success).toBe(false);
    expect(MEMBER_ONLY_OPERATIONS).toEqual(["add_item", "update_item", "remove_item"]);
  });
});
