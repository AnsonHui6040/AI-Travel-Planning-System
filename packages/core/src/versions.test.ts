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
