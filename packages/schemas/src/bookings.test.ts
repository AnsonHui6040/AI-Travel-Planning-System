import { describe, expect, it } from "vitest";
import { bookingRow, checklistItemRow, checklistRow, tableSchemas } from "./index";

// 決策 0010 B：預訂與清單的 row schema（與 migration 20261128300000_b_bookings_lists.sql 的 check constraint 相同）
const id = "00000000-0000-4000-8000-000000000001";
const at = "2027-01-10T19:00:00+09:00";
const booking = {
  id,
  trip_id: id,
  kind: "restaurant",
  title: "壽司晚餐",
  starts_at: at,
  ends_at: "2027-01-10T20:30:00+09:00",
  timezone: "Asia/Tokyo",
  location: "銀座",
  confirmation_code: "ZX9QK2",
  note: null,
  item_id: null,
  created_by: id,
  created_at: at,
  updated_at: at,
};

describe("預訂與清單 row schema", () => {
  it("三張資料表都登記在 tableSchemas", () => {
    expect(Object.keys(tableSchemas)).toEqual(expect.arrayContaining(["bookings", "checklists", "checklist_items"]));
  });

  it("預訂：六種類型、標題 1–80 字、預約碼最多 60 字、結束不早於開始", () => {
    expect(bookingRow.safeParse(booking).success).toBe(true);
    expect(bookingRow.safeParse({ ...booking, kind: "boat" }).success).toBe(false);
    expect(bookingRow.safeParse({ ...booking, title: "" }).success).toBe(false);
    expect(bookingRow.safeParse({ ...booking, title: "長".repeat(81) }).success).toBe(false);
    expect(bookingRow.safeParse({ ...booking, confirmation_code: "A".repeat(61) }).success).toBe(false);
    expect(bookingRow.safeParse({ ...booking, ends_at: "2027-01-10T18:00:00+09:00" }).success).toBe(false);
    expect(bookingRow.safeParse({ ...booking, ends_at: null }).success).toBe(true);
    expect(bookingRow.safeParse({ ...booking, timezone: "Mars/Base" }).success).toBe(false);
    expect(bookingRow.safeParse({ ...booking, extra: 1 }).success).toBe(false);
  });

  it("清單與清單項目", () => {
    expect(checklistRow.safeParse({ id, trip_id: id, kind: "packing", title: "打包", created_by: id, created_at: at }).success).toBe(true);
    expect(checklistRow.safeParse({ id, trip_id: id, kind: "shopping", title: "買", created_by: id, created_at: at }).success).toBe(false);
    const item = { id, list_id: id, trip_id: id, text: "護照", assignee: null, checked: false, checked_by: null, checked_at: null, created_by: id, created_at: at };
    expect(checklistItemRow.safeParse(item).success).toBe(true);
    expect(checklistItemRow.safeParse({ ...item, text: "長".repeat(121) }).success).toBe(false);
  });
});
