import { z } from "zod";
import { BOOKING_LIMITS } from "./bookings";
import { LIMITS, hhmm, ianaTimezone, isoDate, text } from "./common";
import { bookingKind, itemType } from "./enums";

// 決策 0010 I：行程匯入的 AI 輸出。只是預覽（S-01：AI 不寫入）；使用者逐項確認後，
// 預訂經 bookings 的寫入路徑、地點經行程編輯的新增路徑以本人 session 寫入。一律 strictObject：拒絕未知欄位（S-16）。
// 時間、時區、地點等辨識不到時為 null，由使用者在預覽補上。

export const IMPORT_LIMITS = { bookings: 20, places: 30 } as const;

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

export const importBooking = z.strictObject({
  kind: bookingKind,
  title: text(BOOKING_LIMITS.title),
  start_date: isoDate,
  start_time: nullable(hhmm),
  end_date: nullable(isoDate),
  end_time: nullable(hhmm),
  timezone: nullable(ianaTimezone),
  location: nullable(text(BOOKING_LIMITS.location)),
  confirmation_code: nullable(text(BOOKING_LIMITS.code)),
  note: nullable(text(BOOKING_LIMITS.note)),
});

export const importPlace = z.strictObject({
  name: text(LIMITS.nameZh),
  type: itemType,
  date: nullable(isoDate),
  start_time: nullable(hhmm),
  note: nullable(text(LIMITS.itemNote)),
});

export const importOutput = z.strictObject({
  bookings: z.array(importBooking).max(IMPORT_LIMITS.bookings),
  places: z.array(importPlace).max(IMPORT_LIMITS.places),
});

export type ImportBooking = z.infer<typeof importBooking>;
export type ImportPlace = z.infer<typeof importPlace>;
export type ImportOutput = z.infer<typeof importOutput>;
