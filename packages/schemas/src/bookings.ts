import { z } from "zod";
import { ianaTimezone, offsetDateTime, text, uuid } from "./common";
import { bookingKind, checklistKind } from "./enums";

// 決策 0010 B：預訂與清單的資料表。鍵名與 migration 20261128300000_b_bookings_lists.sql 的欄位一致
// （tooling/schema-migration-consistency.test.ts）。預約碼只有行程成員可見，不送 AI、不出現在唯讀連結。

export const BOOKING_LIMITS = { title: 80, location: 200, code: 60, note: 500, listTitle: 40, itemText: 120 } as const;

export const bookingRow = z
  .strictObject({
    id: uuid,
    trip_id: uuid,
    kind: bookingKind,
    title: text(BOOKING_LIMITS.title),
    starts_at: offsetDateTime,
    ends_at: offsetDateTime.nullable(),
    timezone: ianaTimezone,
    location: text(BOOKING_LIMITS.location).nullable(),
    confirmation_code: text(BOOKING_LIMITS.code).nullable(),
    note: text(BOOKING_LIMITS.note).nullable(),
    item_id: uuid.nullable(),
    created_by: uuid,
    created_at: offsetDateTime,
    updated_at: offsetDateTime,
  })
  .refine((b) => b.ends_at === null || Date.parse(b.ends_at) >= Date.parse(b.starts_at), "結束不可早於開始");

export const checklistRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  kind: checklistKind,
  title: text(BOOKING_LIMITS.listTitle),
  created_by: uuid,
  created_at: offsetDateTime,
});

export const checklistItemRow = z.strictObject({
  id: uuid,
  list_id: uuid,
  trip_id: uuid,
  text: text(BOOKING_LIMITS.itemText),
  assignee: uuid.nullable(),
  checked: z.boolean(),
  checked_by: uuid.nullable(),
  checked_at: offsetDateTime.nullable(),
  created_by: uuid,
  created_at: offsetDateTime,
});
