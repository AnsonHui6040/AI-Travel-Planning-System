import { describe, expect, it } from "vitest";
import { draftPlacements, editMode, endFor, manualDayDraft, memberChange, reorderSlots, type DayDraft } from "./index";

// 決策 0010 E：行程編輯。鎖定前直接寫入，鎖定後（或該日已批准）成為待批准提案

describe("編輯的生效方式", () => {
  it("基線與規劃中、影響的日期都是草案：直接寫入", () => {
    expect(editMode("baseline", [])).toBe("direct");
    expect(editMode("planning", ["draft"])).toBe("direct");
    expect(editMode("planning", [])).toBe("direct");
  });

  it("規劃中但影響已批准的日期：成為提案", () => {
    expect(editMode("planning", ["draft", "approved"])).toBe("proposal");
  });

  it("鎖定與旅行中一律成為提案；旅後不可編輯", () => {
    expect(editMode("locked", ["draft"])).toBe("proposal");
    expect(editMode("in_progress", [])).toBe("proposal");
    expect(editMode("ended", [])).toBe("closed");
    expect(editMode("archived", [])).toBe("closed");
  });
});

describe("結束時間", () => {
  it("開始時間加停留分鐘", () => {
    expect(endFor("10:00", 90)).toBe("11:30");
    expect(endFor("23:00", 59)).toBe("23:59");
  });

  it("超過當天 23:59 時為 null", () => {
    expect(endFor("23:30", 60)).toBeNull();
  });
});

describe("當日內上移、下移", () => {
  const placements = [
    { itemId: "a", start: "09:00", end: "10:00" },
    { itemId: "b", start: "10:30", end: "12:00" },
    { itemId: "c", start: "13:00", end: "13:30" },
  ];

  it("下移：與下一項交換順序，保留各自停留時間與中間的空檔", () => {
    expect(reorderSlots(placements, "a", "down")).toEqual([
      { itemId: "b", start: "09:00", end: "10:30" },
      { itemId: "a", start: "11:00", end: "12:00" },
    ]);
  });

  it("上移：與上一項交換", () => {
    expect(reorderSlots(placements, "c", "up")).toEqual([
      { itemId: "c", start: "10:30", end: "11:00" },
      { itemId: "b", start: "12:00", end: "13:30" },
    ]);
  });

  it("第一項不能上移、最後一項不能下移、不在當天時為 null", () => {
    expect(reorderSlots(placements, "a", "up")).toBeNull();
    expect(reorderSlots(placements, "c", "down")).toBeNull();
    expect(reorderSlots(placements, "x", "down")).toBeNull();
  });

  it("輸入順序不影響結果（依開始時間排序）", () => {
    expect(reorderSlots([...placements].reverse(), "a", "down")).toEqual(reorderSlots(placements, "a", "down"));
  });
});

describe("手動排程的每日行程", () => {
  it("固定活動與成員排入的項目依時間排序；可交給 checkDay 檢查", () => {
    const day = manualDayDraft(
      "2026-12-01",
      [{ date: "2026-12-01", name: "teamLab", start: "15:00", end: "17:00" }, { date: "2026-12-02", name: "別天", start: "09:00", end: null }],
      [
        { itemId: "b", start: "11:00", end: "12:00" },
        { itemId: "a", start: "09:00", end: "10:00" },
      ],
    );
    expect(day.entries.map((e) => (e.kind === "fixed" ? e.name : e.item_id))).toEqual(["a", "b", "teamLab"]);
    expect(day.entries[0]).toMatchObject({ kind: "item", movable_from: "09:00", movable_to: "09:00", travel_minutes_before: 0 });
    expect(day.backups).toEqual([]);
    expect(day.unplaced).toEqual([]);
  });

  it("自動草案轉為手動排程：取出每個項目的時段", () => {
    const draft: DayDraft = {
      date: "2026-12-01",
      zone_ids: [],
      backups: ["z"],
      unplaced: [],
      entries: [
        { kind: "fixed", name: "teamLab", start: "15:00", end: "17:00" },
        { kind: "item", item_id: "a", category: "flexible", start: "09:00", end: "10:00", travel_minutes_before: 0, movable_from: "09:00", movable_to: "09:30" },
      ],
    };
    expect(draftPlacements(draft)).toEqual([{ itemId: "a", date: "2026-12-01", start: "09:00", end: "10:00" }]);
  });
});

describe("鎖定後的編輯提案", () => {
  const items = [
    { id: "a", scheduled_date: "2026-12-01", name_zh: "淺草寺" },
    { id: "b", scheduled_date: "2026-12-02", name_zh: "上野公園" },
  ];

  it("同一天內為 Minor（minor_non_incident），摘要列出項目", () => {
    const change = memberChange([{ op: "update_item", itemId: "a", fields: { suggested_stay_minutes: 30 } }], items);
    expect(change).toMatchObject({ changeKind: "minor_non_incident", versionKind: "minor", summary: "修改淺草寺" });
  });

  it("移到另一天為 Major（major_version）", () => {
    const change = memberChange([{ op: "schedule_item", itemId: "a", date: "2026-12-02", start: "10:00", end: "11:00" }], items);
    expect(change).toMatchObject({ changeKind: "major_version", versionKind: "major", summary: "淺草寺移到 12/02 10:00" });
  });

  it("新增、刪除與移回候選清單的摘要", () => {
    const item = { name_zh: "藏前咖啡", type: "restaurant" as const, address: null, suggested_stay_minutes: 60, note: null, place_id: null };
    expect(memberChange([{ op: "add_item", itemId: "n", item, date: null, start: null, end: null }], items).summary).toBe("新增藏前咖啡");
    expect(memberChange([{ op: "remove_item", itemId: "b" }], items).summary).toBe("刪除上野公園");
    expect(memberChange([{ op: "schedule_item", itemId: "b", date: null, start: null, end: null }], items).summary).toBe("上野公園移回候選清單");
  });

  it("兩項交換順序的摘要只寫一次", () => {
    const change = memberChange(
      [
        { op: "schedule_item", itemId: "a", date: "2026-12-01", start: "11:00", end: "12:00" },
        { op: "schedule_item", itemId: "a", date: "2026-12-01", start: "11:00", end: "12:00" },
      ],
      items,
      "調整淺草寺的順序",
    );
    expect(change.summary).toBe("調整淺草寺的順序");
  });
});
