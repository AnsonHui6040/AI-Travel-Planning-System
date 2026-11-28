import { BOOKING_KINDS } from "@atps/core";
import { IMPORT_LIMITS, enums, uuid } from "@atps/schemas";
import { z } from "zod";
import type { BookingActionResult } from "./bookings-core";
import type { EditResult } from "./item-edit-core";

// 決策 0010 I：匯入的確認。只有勾選的列，以本人 session 經預訂（saveBookingAction）與新增地點（parseEditForm＋submitEdit）的寫入路徑寫入；
// 鎖定後的地點依行程編輯的規則成為待批准提案。這個模組不呼叫 AI（預覽在 import-core.ts）

const CONFIRM_RATE = { endpoint: "import.confirm", limit: 20, windowSeconds: 60 } as const;

export interface ImportConfirmDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  // 預訂的寫入路徑（saveBookingAction：本人 session、RLS 限 Owner、Companion）
  saveBooking: (raw: Record<string, unknown>) => Promise<BookingActionResult>;
  // 新增地點的寫入路徑（parseEditForm＋submitEdit：鎖定前直接寫入，鎖定後成為提案）
  addPlace: (tripId: string, form: FormData) => Promise<EditResult>;
}

export interface ImportConfirmResult {
  ok: boolean;
  message: string;
  failures: Array<{ key: string; label: string; message: string }>;
}

const cell = (max: number) => z.string().max(max);
const bookingRow = z.strictObject({
  key: cell(8),
  kind: z.enum(BOOKING_KINDS),
  title: cell(200),
  startDate: cell(10),
  startTime: cell(5),
  endDate: cell(10),
  endTime: cell(5),
  timezone: cell(64),
  location: cell(400),
  confirmationCode: cell(120),
  note: cell(1000),
});
const placeRow = z.strictObject({
  key: cell(8),
  name: cell(200),
  type: enums.itemType,
  date: cell(10),
  start: cell(5),
  stayMinutes: z.int().min(0).max(10_000),
  note: cell(1000),
});
const confirmForm = z.strictObject({
  tripId: uuid,
  bookings: z.array(bookingRow).max(IMPORT_LIMITS.bookings),
  places: z.array(placeRow).max(IMPORT_LIMITS.places),
});

export type ImportConfirmInput = z.infer<typeof confirmForm>;

function summary(bookings: number, places: number, proposed: number, failed: number): string {
  const done = [bookings > 0 ? `${bookings} 筆預訂` : "", places > 0 ? `${places} 個地點` : ""].filter(Boolean).join("、");
  const parts = [done ? `已加入 ${done}` : "", proposed > 0 ? `已送出 ${proposed} 個地點的提案，批准後生效` : "", failed > 0 ? `${failed} 項沒有加入` : ""];
  return parts.filter(Boolean).join("；");
}

export async function confirmImport(deps: ImportConfirmDeps, raw: unknown): Promise<ImportConfirmResult> {
  const fail = (message: string): ImportConfirmResult => ({ ok: false, message, failures: [] });
  if (!(await deps.getUser())) return fail("需要登入");
  if (!(await deps.checkRateLimit(CONFIRM_RATE.endpoint, CONFIRM_RATE.limit, CONFIRM_RATE.windowSeconds))) return fail("操作過於頻繁，請稍後再試");
  const parsed = confirmForm.safeParse(raw);
  if (!parsed.success) return fail("資料不正確，請重新匯入");
  const { tripId, bookings, places } = parsed.data;
  if (bookings.length + places.length === 0) return fail("請至少勾選一項");

  const failures: ImportConfirmResult["failures"] = [];
  let savedBookings = 0;
  let addedPlaces = 0;
  let proposedPlaces = 0;
  for (const { key, ...row } of bookings) {
    const result = await deps.saveBooking({ tripId, bookingId: null, ...row, itemId: null });
    if (result.ok) savedBookings += 1;
    else failures.push({ key, label: row.title, message: result.message });
  }
  for (const row of places) {
    const form = new FormData();
    const fields: Record<string, string> = {
      kind: "add",
      name_zh: row.name,
      type: row.type,
      address: "",
      suggested_stay_minutes: String(row.stayMinutes),
      note: row.note,
      // 決策 0010 I：匯入的地點不帶 place_id（D28：只有使用者以搜尋選定時才保存）
      place_id: "",
      date: row.date,
      start: row.start,
    };
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const result = await deps.addPlace(tripId, form);
    if (!result.ok) failures.push({ key: row.key, label: row.name, message: result.message });
    else if (result.mode === "proposal") proposedPlaces += 1;
    else addedPlaces += 1;
  }
  return { ok: failures.length === 0, message: summary(savedBookings, addedPlaces, proposedPlaces, failures.length), failures };
}
