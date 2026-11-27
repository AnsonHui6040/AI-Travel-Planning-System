import { describe, expect, it } from "vitest";
import { classifyVersionKind, formatVersion, nextVersion } from "./index";

describe("第 2.7 節版本號", () => {
  it("第一個版本為 v1.0", () => {
    expect(nextVersion(null, "major")).toEqual({ major: 1, minor: 0 });
    expect(nextVersion(null, "minor")).toEqual({ major: 1, minor: 0 });
  });

  it("Minor 更新：v2.1 → v2.2", () => {
    expect(nextVersion({ major: 2, minor: 1 }, "minor")).toEqual({ major: 2, minor: 2 });
  });

  it("Major 更新：v2.1 → v3.0", () => {
    expect(nextVersion({ major: 2, minor: 1 }, "major")).toEqual({ major: 3, minor: 0 });
  });

  it("格式為 v主版號.次版號", () => {
    expect(formatVersion({ major: 2, minor: 1 })).toBe("v2.1");
  });
});

describe("第 2.7 節 Major 與 Minor 判定", () => {
  const items = [
    { id: "a", scheduled_date: "2026-12-01" },
    { id: "b", scheduled_date: "2026-12-01" },
    { id: "c", scheduled_date: "2026-12-02" },
  ];

  it("同一天內改時間或順序為 Minor", () => {
    expect(
      classifyVersionKind(
        [
          { op: "schedule_item", itemId: "a", date: "2026-12-01", start: "14:00", end: "15:00" },
          { op: "schedule_item", itemId: "b", date: "2026-12-01", start: "10:00", end: "11:00" },
        ],
        items,
      ),
    ).toBe("minor");
  });

  it("單一景點標示 At Risk 為 Minor", () => {
    expect(classifyVersionKind([{ op: "set_at_risk", itemId: "a", atRisk: true }], items)).toBe("minor");
  });

  it("把項目移到另一天為 Major", () => {
    expect(
      classifyVersionKind([{ op: "schedule_item", itemId: "a", date: "2026-12-02", start: "10:00", end: "11:00" }], items),
    ).toBe("major");
  });

  // T38：候選清單沒有日期；把候選排入某一天或把項目移回候選清單屬同一天內的單一景點改變
  it("候選排入某一天、項目移回候選清單為 Minor", () => {
    const withCandidate = [...items, { id: "x", scheduled_date: null }];
    expect(
      classifyVersionKind(
        [
          { op: "schedule_item", itemId: "a", date: null, start: null, end: null },
          { op: "schedule_item", itemId: "x", date: "2026-12-01", start: "10:00", end: "11:00" },
        ],
        withCandidate,
      ),
    ).toBe("minor");
  });

  it("同時影響兩天以上為 Major", () => {
    expect(
      classifyVersionKind(
        [
          { op: "set_at_risk", itemId: "a", atRisk: true },
          { op: "set_at_risk", itemId: "c", atRisk: true },
        ],
        items,
      ),
    ).toBe("major");
  });

  it.each(["hotel", "flight_date", "cancel_day"] as const)("結構變更 %s 為 Major", (structural) => {
    expect(classifyVersionKind([{ op: "set_at_risk", itemId: "a", atRisk: true }], items, [structural])).toBe("major");
  });

  it("操作的項目不在行程中時拋出錯誤", () => {
    expect(() => classifyVersionKind([{ op: "set_at_risk", itemId: "z", atRisk: true }], items)).toThrow();
  });
});

// 決策 0010：成員的新增、修改、刪除提案
describe("成員編輯提案的 Major 與 Minor", () => {
  const items = [
    { id: "a", scheduled_date: "2026-12-01" },
    { id: "b", scheduled_date: null },
  ];
  const fields = { name_zh: "藏前咖啡", type: "restaurant" as const, address: null, suggested_stay_minutes: 60, note: null, place_id: null };

  it("新增到某一天為 Minor；新增的項目不必已在行程中", () => {
    expect(classifyVersionKind([{ op: "add_item", itemId: "n", item: fields, date: "2026-12-01", start: "10:00", end: "11:00" }], items)).toBe("minor");
    expect(classifyVersionKind([{ op: "add_item", itemId: "n", item: fields, date: null, start: null, end: null }], items)).toBe("minor");
  });

  it("修改或刪除單一項目為 Minor；同時影響兩天為 Major", () => {
    expect(classifyVersionKind([{ op: "update_item", itemId: "a", fields: { note: "排隊" } }], items)).toBe("minor");
    expect(classifyVersionKind([{ op: "remove_item", itemId: "a" }], items)).toBe("minor");
    expect(
      classifyVersionKind(
        [
          { op: "remove_item", itemId: "a" },
          { op: "add_item", itemId: "n", item: fields, date: "2026-12-02", start: "10:00", end: "11:00" },
        ],
        items,
      ),
    ).toBe("major");
  });

  it("修改或刪除不在行程中的項目時拒絕", () => {
    expect(() => classifyVersionKind([{ op: "remove_item", itemId: "x" }], items)).toThrow();
  });
});
