import { BOOKING_KINDS, zonedTime, type BookingKind } from "@atps/core";
import { BOOKING_LIMITS, enums, hhmm, ianaTimezone, isoDate, uuid } from "@atps/schemas";
import { z } from "zod";

// 決策 0010 B：預訂與清單的 Server Action 邏輯。以使用者本人的 session 寫入（Viewer 與非成員由資料庫的 RLS 拒絕）；
// 開始與結束以使用者選的時區換算為時間點。預約碼只存資料庫、只給成員看，不送 AI、不寫入 log。

export class BookingStoreError extends Error {
  constructor(readonly reason: "forbidden" | "invalid" | "limit" | "unknown") {
    super(`預訂或清單寫入失敗（${reason}）`);
  }
}

export interface BookingWrite {
  kind: BookingKind;
  title: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string | null;
  confirmation_code: string | null;
  note: string | null;
  item_id: string | null;
}

export type ChecklistKind = z.infer<typeof enums.checklistKind>;

export interface BookingDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  saveBooking: (tripId: string, bookingId: string | null, data: BookingWrite) => Promise<string>;
  deleteBooking: (tripId: string, bookingId: string) => Promise<number>;
  createList: (tripId: string, kind: ChecklistKind, title: string) => Promise<string>;
  deleteList: (tripId: string, listId: string) => Promise<number>;
  addListItem: (tripId: string, listId: string, text: string, assignee: string | null) => Promise<string>;
  updateListItem: (tripId: string, itemId: string, fields: { checked?: boolean; assignee?: string | null }) => Promise<number>;
  deleteListItem: (tripId: string, itemId: string) => Promise<number>;
  logError: (message: string) => void;
}

export interface BookingActionResult {
  ok: boolean;
  message: string;
  id?: string;
}

const RATE = { endpoint: "booking.write", limit: 120, windowSeconds: 60 } as const;
const INVALID = "資料不正確，請重新檢查";
export const LIST_TITLES: Record<ChecklistKind, string> = { packing: "打包", todo: "待辦" };

async function guard(deps: BookingDeps): Promise<BookingActionResult | null> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  return null;
}

// 錯誤只記錄種類，不含輸入內容（預約碼不寫入 log，S-10）
function storeMessage(error: unknown, deps: BookingDeps): BookingActionResult {
  if (error instanceof BookingStoreError && error.reason === "forbidden") return { ok: false, message: "只有 Owner 與 Companion 可以修改" };
  if (error instanceof BookingStoreError && error.reason === "invalid") return { ok: false, message: INVALID };
  if (error instanceof BookingStoreError && error.reason === "limit") return { ok: false, message: "已達筆數上限" };
  deps.logError("預訂或清單寫入失敗");
  return { ok: false, message: "儲存失敗，請稍後再試" };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optionalId = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), uuid.nullable());
const MAX_SPAN_MS = 60 * 24 * 60 * 60 * 1000;

const bookingForm = z.object({
  tripId: uuid,
  bookingId: optionalId,
  kind: z.unknown(),
  title: z.unknown(),
  startDate: z.unknown(),
  startTime: z.unknown(),
  endDate: z.unknown(),
  endTime: z.unknown(),
  timezone: z.unknown(),
  location: z.unknown(),
  confirmationCode: z.unknown(),
  note: z.unknown(),
  itemId: optionalId,
});

function parseBooking(raw: unknown): { tripId: string; bookingId: string | null; data: BookingWrite } | string {
  const parsed = bookingForm.safeParse(raw);
  if (!parsed.success) return INVALID;
  const f = parsed.data;
  const kind = str(f.kind);
  if (!(BOOKING_KINDS as readonly string[]).includes(kind)) return "請選擇類型";
  const title = str(f.title);
  if (title === "") return "請輸入標題";
  if ([...title].length > BOOKING_LIMITS.title) return `標題最多 ${BOOKING_LIMITS.title} 字`;
  const timezone = str(f.timezone);
  if (!ianaTimezone.safeParse(timezone).success) return "時區不正確";
  const startDate = str(f.startDate);
  const startTime = str(f.startTime);
  if (!isoDate.safeParse(startDate).success || !hhmm.safeParse(startTime).success) return "請輸入開始日期與時間";
  const start = zonedTime(startDate, startTime, timezone);
  const endDateText = str(f.endDate);
  const endTime = str(f.endTime);
  let end: Date | null = null;
  if (endDateText !== "" || endTime !== "") {
    if (endTime === "" || !hhmm.safeParse(endTime).success) return "結束請填時間";
    const endDate = endDateText === "" ? startDate : endDateText;
    if (!isoDate.safeParse(endDate).success) return "結束日期不正確";
    end = zonedTime(endDate, endTime, timezone);
    if (end.getTime() < start.getTime()) return "結束不可早於開始";
    if (end.getTime() - start.getTime() > MAX_SPAN_MS) return "預訂最長 60 天";
  }
  const location = str(f.location);
  if ([...location].length > BOOKING_LIMITS.location) return `地點最多 ${BOOKING_LIMITS.location} 字`;
  const code = str(f.confirmationCode);
  if ([...code].length > BOOKING_LIMITS.code) return `預約碼最多 ${BOOKING_LIMITS.code} 字`;
  const note = str(f.note);
  if ([...note].length > BOOKING_LIMITS.note) return `備註最多 ${BOOKING_LIMITS.note} 字`;
  return {
    tripId: f.tripId,
    bookingId: f.bookingId,
    data: {
      kind: kind as BookingKind,
      title,
      starts_at: start.toISOString(),
      ends_at: end ? end.toISOString() : null,
      timezone,
      location: location || null,
      confirmation_code: code || null,
      note: note || null,
      item_id: f.itemId,
    },
  };
}

export async function saveBookingAction(deps: BookingDeps, raw: unknown): Promise<BookingActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  const parsed = parseBooking(raw);
  if (typeof parsed === "string") return { ok: false, message: parsed };
  try {
    const id = await deps.saveBooking(parsed.tripId, parsed.bookingId, parsed.data);
    return { ok: true, message: "已儲存預訂", id };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

const ids = (...values: unknown[]) => values.every((v) => uuid.safeParse(v).success);

async function remove(deps: BookingDeps, run: () => Promise<number>, done: string, missing: string): Promise<BookingActionResult> {
  try {
    return (await run()) > 0 ? { ok: true, message: done } : { ok: false, message: missing };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

export async function deleteBookingAction(deps: BookingDeps, tripId: unknown, bookingId: unknown): Promise<BookingActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!ids(tripId, bookingId)) return { ok: false, message: INVALID };
  return remove(deps, () => deps.deleteBooking(String(tripId), String(bookingId)), "已刪除預訂", "找不到這筆預訂，或你沒有權限");
}

export async function createListAction(deps: BookingDeps, raw: unknown): Promise<BookingActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  const f = z.object({ tripId: uuid, kind: z.unknown(), title: z.unknown() }).safeParse(raw);
  if (!f.success) return { ok: false, message: INVALID };
  const kind = enums.checklistKind.safeParse(str(f.data.kind));
  if (!kind.success) return { ok: false, message: "請選擇類型" };
  const title = str(f.data.title) || LIST_TITLES[kind.data];
  if ([...title].length > BOOKING_LIMITS.listTitle) return { ok: false, message: `名稱最多 ${BOOKING_LIMITS.listTitle} 字` };
  try {
    return { ok: true, message: "已新增清單", id: await deps.createList(f.data.tripId, kind.data, title) };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

export async function deleteListAction(deps: BookingDeps, tripId: unknown, listId: unknown): Promise<BookingActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!ids(tripId, listId)) return { ok: false, message: INVALID };
  return remove(deps, () => deps.deleteList(String(tripId), String(listId)), "已刪除清單", "找不到這份清單，或你沒有權限");
}

export async function addListItemAction(deps: BookingDeps, raw: unknown): Promise<BookingActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  const f = z.object({ tripId: uuid, listId: uuid, text: z.unknown(), assignee: optionalId }).safeParse(raw);
  if (!f.success) return { ok: false, message: INVALID };
  const text = str(f.data.text);
  if (text === "") return { ok: false, message: "請輸入項目" };
  if ([...text].length > BOOKING_LIMITS.itemText) return { ok: false, message: `項目最多 ${BOOKING_LIMITS.itemText} 字` };
  try {
    return { ok: true, message: "已新增", id: await deps.addListItem(f.data.tripId, f.data.listId, text, f.data.assignee) };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

async function update(deps: BookingDeps, tripId: unknown, itemId: unknown, fields: { checked?: boolean; assignee?: string | null }, done: string) {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!ids(tripId, itemId)) return { ok: false, message: INVALID };
  return remove(deps, () => deps.updateListItem(String(tripId), String(itemId), fields), done, "找不到這個項目，或你沒有權限");
}

export async function setListItemCheckedAction(deps: BookingDeps, tripId: unknown, itemId: unknown, checked: unknown): Promise<BookingActionResult> {
  if (typeof checked !== "boolean") return { ok: false, message: INVALID };
  return update(deps, tripId, itemId, { checked }, checked ? "已完成" : "已取消完成");
}

export async function setListItemAssigneeAction(deps: BookingDeps, tripId: unknown, itemId: unknown, assignee: unknown): Promise<BookingActionResult> {
  const parsed = optionalId.safeParse(assignee);
  if (!parsed.success) return { ok: false, message: INVALID };
  return update(deps, tripId, itemId, { assignee: parsed.data }, "已更新負責成員");
}

export async function deleteListItemAction(deps: BookingDeps, tripId: unknown, itemId: unknown): Promise<BookingActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!ids(tripId, itemId)) return { ok: false, message: INVALID };
  return remove(deps, () => deps.deleteListItem(String(tripId), String(itemId)), "已刪除", "找不到這個項目，或你沒有權限");
}
