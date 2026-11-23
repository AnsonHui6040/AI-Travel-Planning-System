import { describe, expect, it } from "vitest";
import { CHANGE_KINDS, changePayload } from "./index";

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
