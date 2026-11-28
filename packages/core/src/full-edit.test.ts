import { describe, expect, it } from "vitest";
import { batchOperations, editMode, legGapMinutes, reorderDesired, shiftDay, swapDaySlots, tripDateChange } from "./index";

// 決策 0011：完整的行程編輯。鎖定後 Owner 直接套用、Companion 成為提案；自動順延；整天交換；行程日期

describe("編輯的生效方式（決策 0011）", () => {
  it("鎖定前影響的日期都是草案：Owner 與 Companion 都直接寫入", () => {
    expect(editMode("planning", ["draft"], "owner")).toBe("direct");
    expect(editMode("planning", ["draft"], "companion")).toBe("direct");
  });

  it("鎖定後或該日已批准：Owner 直接套用（留 Change Log），Companion 成為提案", () => {
    expect(editMode("locked", ["approved"], "owner")).toBe("applied");
    expect(editMode("in_progress", [], "owner")).toBe("applied");
    expect(editMode("planning", ["approved"], "owner")).toBe("applied");
    expect(editMode("locked", ["approved"], "companion")).toBe("proposal");
    expect(editMode("planning", ["draft", "approved"], "companion")).toBe("proposal");
  });

  it("旅後不可編輯", () => {
    expect(editMode("ended", [], "owner")).toBe("closed");
    expect(editMode("archived", [], "companion")).toBe("closed");
  });
});

describe("交通間隔", () => {
  it("使用者輸入的分鐘加固定緩衝（每段 10 分鐘，同 withBuffer）", () => {
    expect(legGapMinutes({ source: "user", minutes: 15 })).toBe(25);
  });
  it("估算已含緩衝；沒有資料用預設", () => {
    expect(legGapMinutes({ source: "estimate", minutes: 40 })).toBe(40);
    expect(legGapMinutes(null)).toBe(30);
  });
});

const travel = () => 20;

describe("自動順延", () => {
  const a = { itemId: "a", start: "09:00", stayMinutes: 60 };
  const b = { itemId: "b", start: "10:30", stayMinutes: 60 };
  const c = { itemId: "c", start: "13:00", stayMinutes: 60 };

  it("延長第一項：後面重疊的項目往後順延（停留加交通），沒有重疊的保留原時間", () => {
    const result = shiftDay({ items: [{ ...a, stayMinutes: 120 }, b, c], fixed: [], travel, from: 0, shift: true });
    expect(result.placements).toEqual([
      { itemId: "a", start: "09:00", end: "11:00" },
      { itemId: "b", start: "11:20", end: "12:20" },
      { itemId: "c", start: "13:00", end: "14:00" },
    ]);
    expect(result.moved).toEqual(["b"]);
    expect(result.overflow).toEqual([]);
  });

  it("不要順延：只改這一項，後面不動（由 checkDay 提示重疊）", () => {
    const result = shiftDay({ items: [{ ...a, stayMinutes: 120 }, b, c], fixed: [], travel, from: 0, shift: false });
    expect(result.placements[1]).toEqual({ itemId: "b", start: "10:30", end: "11:30" });
    expect(result.moved).toEqual([]);
  });

  it("固定活動不移動：順延的項目跳到固定活動之後", () => {
    const result = shiftDay({
      items: [{ ...a, stayMinutes: 150 }, b],
      fixed: [{ name: "午餐預約", start: "11:40", end: "12:40" }],
      travel,
      from: 0,
      shift: true,
    });
    expect(result.placements[1]).toEqual({ itemId: "b", start: "12:40", end: "13:40" });
  });

  it("順延超過當天：列為排不下", () => {
    const result = shiftDay({
      items: [{ itemId: "a", start: "21:00", stayMinutes: 120 }, { itemId: "b", start: "22:00", stayMinutes: 90 }],
      fixed: [],
      travel,
      from: 0,
      shift: true,
    });
    expect(result.overflow).toEqual(["b"]);
    expect(result.placements.map((p) => p.itemId)).toEqual(["a"]);
  });

  it("from 之前的項目不重算", () => {
    const result = shiftDay({ items: [{ itemId: "a", start: "09:00", stayMinutes: 600 }, b], fixed: [], travel, from: 1, shift: true });
    expect(result.placements[1]).toEqual({ itemId: "b", start: "10:30", end: "11:30" });
  });
});

describe("拖曳後的時段", () => {
  it("每個位置沿用原本該位置的開始時間，停留跟著項目", () => {
    const original = [
      { itemId: "a", start: "09:00", end: "10:00" },
      { itemId: "b", start: "10:30", end: "12:00" },
      { itemId: "c", start: "13:00", end: "13:30" },
    ];
    expect(reorderDesired(original, ["b", "a", "c"])).toEqual({
      items: [
        { itemId: "b", start: "09:00", stayMinutes: 90 },
        { itemId: "a", start: "10:30", stayMinutes: 60 },
        { itemId: "c", start: "13:00", stayMinutes: 30 },
      ],
      from: 0,
    });
  });
});

describe("批次內容", () => {
  it("只列出有變更的時段、刪除與新增", () => {
    const ops = batchOperations({
      date: "2026-12-01",
      before: [
        { itemId: "a", start: "09:00", end: "10:00" },
        { itemId: "b", start: "10:30", end: "11:30" },
      ],
      after: [{ itemId: "a", start: "09:00", end: "10:00" }],
      removed: ["b"],
      added: [{ itemId: "n", item: { name_zh: "咖啡", type: "restaurant", address: null, suggested_stay_minutes: 30, note: null, place_id: null }, start: "10:20", end: "10:50" }],
    });
    expect(ops).toEqual([
      { op: "remove_item", itemId: "b" },
      {
        op: "add_item",
        itemId: "n",
        item: { name_zh: "咖啡", type: "restaurant", address: null, suggested_stay_minutes: 30, note: null, place_id: null },
        date: "2026-12-01",
        start: "10:20",
        end: "10:50",
      },
    ]);
  });
});

describe("整天交換", () => {
  it("兩天的項目互換日期，時間不變", () => {
    expect(
      swapDaySlots({ date: "2026-12-01", placements: [{ itemId: "a", start: "09:00", end: "10:00" }] }, { date: "2026-12-02", placements: [{ itemId: "b", start: "14:00", end: "15:00" }] }),
    ).toEqual([
      { op: "schedule_item", itemId: "a", date: "2026-12-02", start: "09:00", end: "10:00" },
      { op: "schedule_item", itemId: "b", date: "2026-12-01", start: "14:00", end: "15:00" },
    ]);
  });
});

describe("修改行程日期", () => {
  it("縮短：移除的日期與要移回候選清單的項目", () => {
    expect(
      tripDateChange({ start: "2026-12-01", end: "2026-12-03" }, { start: "2026-12-01", end: "2026-12-02" }, [
        { itemId: "a", date: "2026-12-03" },
        { itemId: "b", date: "2026-12-01" },
      ]),
    ).toEqual({ added: [], removed: ["2026-12-03"], unschedule: ["a"] });
  });
  it("延長：新增的日期", () => {
    expect(tripDateChange({ start: "2026-12-01", end: "2026-12-01" }, { start: "2026-11-30", end: "2026-12-02" }, [])).toEqual({
      added: ["2026-11-30", "2026-12-02"],
      removed: [],
      unschedule: [],
    });
  });
});
