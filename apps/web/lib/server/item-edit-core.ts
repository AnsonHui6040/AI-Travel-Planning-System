import { z } from "zod";
import { batchOperations, editMode, endFor, memberChange, reorderSlots, swapDaySlots, type AddedItem, type DayStatus, type Placement, type TripStatus } from "@atps/core";
import { hhmm, isoDate, userItemFields, uuid, type ChangeOperation, type ChangePayload, type UserItemFields } from "@atps/schemas";

// 決策 0010 E、決策 0011：行程編輯的 Server Action 邏輯。
// 決策 0011：鎖定後或該日已批准時，Owner 的編輯以 apply_owner_change 直接套用（Change Log、通知），Companion 照舊建立提案。
// 行程鎖定前且影響的日期都是草案：經資料庫函式直接寫入（Owner、Companion，資料庫再檢查一次）；
// 鎖定後或該日已批准：同一個編輯畫面建立待批准提案（批准規則不變）。直接寫入後以 checkDay 的結果提示，不阻擋。

export type EditRequest =
  | { kind: "add"; item: UserItemFields; slot: { date: string; start: string } | null }
  | { kind: "update"; itemId: string; fields: Partial<UserItemFields> }
  | { kind: "delete"; itemId: string }
  | { kind: "move"; itemId: string; date: string; start: string; end?: string }
  | { kind: "duplicate"; itemId: string; item: UserItemFields }
  | { kind: "swap"; date: string; other: string }
  | { kind: "unschedule"; itemId: string }
  | { kind: "reorder"; itemId: string; direction: "up" | "down" };

export interface Slot {
  itemId: string;
  date: string | null;
  start: string | null;
  end: string | null;
}

export interface EditContext {
  tripStatus: TripStatus;
  baseVersion: number;
  canEdit: boolean;
  role: "owner" | "companion" | null;
  manualSchedule: boolean;
  dates: string[];
  // 畫面上的每日行程（草案日為自動草案或手動排程，其他為資料庫中的時段）
  days: Array<{ date: string; status: DayStatus; placements: Placement[] }>;
  // 資料庫中的排程（提案的版本類型依此判定，與批准時 applyChange 相同）
  items: Array<{ id: string; name_zh: string; scheduled_date: string | null; suggested_stay_minutes: number }>;
}

export interface EditDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  load: (tripId: string) => Promise<EditContext | null>;
  newId: () => string;
  addItem: (tripId: string, item: UserItemFields, slot: { date: string; start: string; end: string } | null, draft: Slot[]) => Promise<string>;
  updateItem: (itemId: string, fields: Partial<UserItemFields>) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  scheduleItems: (tripId: string, slots: Slot[], draft: Slot[]) => Promise<void>;
  propose: (tripId: string, baseVersion: number, change: ChangePayload, dates: string[]) => Promise<void>;
  // 決策 0011：Owner 直接套用；行程版本已變更時為 invalidated（SH-04）
  applyOwner: (tripId: string, baseVersion: number, change: ChangePayload, dates: string[]) => Promise<"applied" | "invalidated">;
  // 決策 0011：鎖定前的批次（一個交易）
  editBatch: (tripId: string, operations: ChangeOperation[], draft: Slot[]) => Promise<void>;
  // 寫入後重新計算這些日期的 checkDay，回傳提醒文字
  warnings: (tripId: string, dates: string[]) => Promise<string[]>;
  logError: (message: string) => void;
}

export class EditStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`編輯失敗（${reason}）`);
  }
}

export type EditResult =
  | { ok: true; mode: "direct" | "applied" | "proposal"; message: string; itemId: string | null; warnings: string[] }
  | { ok: false; message: string };

const RATE = { endpoint: "item.edit", limit: 60, windowSeconds: 60 } as const;
const fail = (message: string): EditResult => ({ ok: false, message });

function locate(ctx: EditContext, itemId: string): { date: string; placement: Placement } | null {
  for (const day of ctx.days) {
    const placement = day.placements.find((p) => p.itemId === itemId);
    if (placement) return { date: day.date, placement };
  }
  return null;
}

// 第一次手動排程時寫入畫面上的自動草案，之後以資料庫中的排程為準
const draftSlots = (ctx: EditContext): Slot[] =>
  ctx.manualSchedule
    ? []
    : ctx.days.filter((d) => d.status === "draft").flatMap((d) => d.placements.map((p) => ({ itemId: p.itemId, date: d.date, start: p.start, end: p.end })));

interface Planned {
  dates: string[];
  slots?: Slot[];
  operations: ChangeOperation[];
  summary?: string;
  run: (draft: Slot[]) => Promise<string | null>;
}

function plan(deps: EditDeps, ctx: EditContext, tripId: string, request: EditRequest): Planned | string {
  const nameOf = (id: string) => ctx.items.find((i) => i.id === id)?.name_zh;
  if (request.kind === "add") {
    let slot: { date: string; start: string; end: string } | null = null;
    if (request.slot) {
      if (!ctx.dates.includes(request.slot.date)) return "日期不在行程期間內";
      const end = endFor(request.slot.start, request.item.suggested_stay_minutes);
      if (!end) return "停留時間超過當天，請提早開始時間";
      slot = { ...request.slot, end };
    }
    const id = deps.newId();
    return {
      dates: slot ? [slot.date] : [],
      operations: [{ op: "add_item", itemId: id, item: request.item, date: slot?.date ?? null, start: slot?.start ?? null, end: slot?.end ?? null }],
      run: (draft) => deps.addItem(tripId, request.item, slot, slot ? draft : []),
    };
  }

  if (request.kind === "swap") {
    const a = ctx.days.find((d) => d.date === request.date);
    const b = ctx.days.find((d) => d.date === request.other);
    if (!a || !b || a.date === b.date) return "請選擇另一天";
    const operations = swapDaySlots(a, b);
    if (operations.length === 0) return "兩天都沒有項目";
    const slots = operations.flatMap((op) => (op.op === "schedule_item" ? [{ itemId: op.itemId, date: op.date, start: op.start, end: op.end }] : []));
    return { ...scheduled(deps, tripId, [a.date, b.date], slots), summary: `交換 ${a.date.slice(5).replace("-", "/")} 與 ${b.date.slice(5).replace("-", "/")}` };
  }

  const item = ctx.items.find((i) => i.id === request.itemId);
  if (!item) return "找不到這個項目";
  const at = locate(ctx, request.itemId);
  const from = at ? [at.date] : [];

  switch (request.kind) {
    case "update":
      return {
        dates: from,
        operations: [{ op: "update_item", itemId: item.id, fields: request.fields }],
        run: async () => {
          await deps.updateItem(item.id, request.fields);
          return item.id;
        },
      };
    case "delete":
      return {
        dates: from,
        operations: [{ op: "remove_item", itemId: item.id }],
        run: async () => {
          await deps.deleteItem(item.id);
          return null;
        },
      };
    case "duplicate": {
      const id = deps.newId();
      const start = at?.placement.end ?? null;
      const end = start ? endFor(start, request.item.suggested_stay_minutes) : null;
      const slot = at && start && end ? { date: at.date, start, end } : null;
      return {
        dates: slot ? [slot.date] : [],
        operations: [{ op: "add_item", itemId: id, item: request.item, date: slot?.date ?? null, start: slot?.start ?? null, end: slot?.end ?? null }],
        summary: `複製${item.name_zh}`,
        run: (draft) => deps.addItem(tripId, request.item, slot, slot ? draft : []),
      };
    }
    case "move": {
      if (!ctx.dates.includes(request.date)) return "日期不在行程期間內";
      const end = request.end ?? endFor(request.start, item.suggested_stay_minutes);
      if (!end) return "停留時間超過當天，請提早開始時間";
      if (end <= request.start) return "結束時間要晚於開始時間";
      const slots: Slot[] = [{ itemId: item.id, date: request.date, start: request.start, end }];
      return scheduled(deps, tripId, [...new Set([...from, request.date])], slots);
    }
    case "unschedule":
      if (!at && item.scheduled_date === null) return "這個項目已在候選清單";
      return scheduled(deps, tripId, from, [{ itemId: item.id, date: null, start: null, end: null }]);
    case "reorder": {
      const day = at ? ctx.days.find((d) => d.date === at.date) : undefined;
      const swapped = day ? reorderSlots(day.placements, item.id, request.direction) : null;
      if (!day || !swapped) return request.direction === "up" ? "已是當天第一項" : "已是當天最後一項";
      const slots = swapped.map((p) => ({ ...p, date: day.date }));
      return { ...scheduled(deps, tripId, [day.date], slots), summary: `調整${nameOf(item.id) ?? "項目"}的順序` };
    }
  }
}

function scheduled(deps: EditDeps, tripId: string, dates: string[], slots: Slot[]): Planned {
  return {
    dates,
    slots,
    operations: slots.map((s) => ({ op: "schedule_item", itemId: s.itemId, date: s.date, start: s.start, end: s.end })),
    run: async (draft) => {
      await deps.scheduleItems(tripId, slots, draft);
      return slots[0]?.itemId ?? null;
    },
  };
}

export async function submitEdit(deps: EditDeps, tripIdRaw: unknown, request: EditRequest): Promise<EditResult> {
  if (!(await deps.getUser())) return fail("需要登入");
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return fail("操作過於頻繁，請稍後再試");
  const tripId = uuid.safeParse(tripIdRaw);
  if (!tripId.success) return fail("行程不正確");
  const ctx = await deps.load(tripId.data);
  if (!ctx) return fail("找不到這個行程");
  if (!ctx.canEdit) return fail("只有 Owner 與 Companion 可以編輯");

  const planned = plan(deps, ctx, tripId.data, request);
  if (typeof planned === "string") return fail(planned);
  return write(deps, ctx, tripId.data, planned);
}

async function write(deps: EditDeps, ctx: EditContext, tripId: string, planned: Planned): Promise<EditResult> {
  const statusOf = (date: string) => ctx.days.find((d) => d.date === date)?.status ?? "draft";
  const mode = editMode(ctx.tripStatus, planned.dates.map(statusOf), ctx.role === "owner" ? "owner" : "companion");
  if (mode === "closed") return fail("行程已結束，不能再編輯");

  try {
    if (mode === "proposal" || mode === "applied") {
      const change = memberChange(planned.operations, ctx.items, planned.summary);
      if (mode === "proposal") {
        await deps.propose(tripId, ctx.baseVersion, change, planned.dates);
        return { ok: true, mode, message: "已送出提案，批准後生效", itemId: null, warnings: [] };
      }
      const outcome = await deps.applyOwner(tripId, ctx.baseVersion, change, planned.dates);
      if (outcome === "invalidated") return fail("行程剛被修改，請重新整理後再試");
      const warnings = planned.dates.length > 0 ? await deps.warnings(tripId, planned.dates) : [];
      const added = planned.operations.find((op) => op.op === "add_item");
      return { ok: true, mode, message: "已套用，其他成員會收到通知", itemId: added?.op === "add_item" ? added.itemId : null, warnings };
    }
    const itemId = await planned.run(draftSlots(ctx));
    const warnings = planned.dates.length > 0 ? await deps.warnings(tripId, planned.dates) : [];
    return { ok: true, mode, message: "已儲存", itemId, warnings };
  } catch (error) {
    if (error instanceof EditStoreError) {
      if (error.reason === "forbidden") return fail("沒有編輯權限");
      if (error.reason === "state") return fail("行程或這天已批准，請重新整理後再試");
      if (error.reason === "invalid") return fail("內容不正確，請檢查後再試");
    }
    deps.logError("編輯行程失敗");
    return fail("儲存失敗，請稍後再試");
  }
}

// 決策 0011：清單內編輯模式「完成」。一個批次：鎖定前一個交易、Owner 一筆 Change Log、Companion 一個提案

const placementSchema = z.strictObject({ itemId: uuid, start: hhmm, end: hhmm }).refine((p) => p.end > p.start, "結束時間要晚於開始時間");
export const dayBatch = z.strictObject({
  date: isoDate,
  placements: z.array(placementSchema).max(50),
  removed: z.array(uuid).max(50),
  added: z.array(z.strictObject({ itemId: uuid, item: userItemFields, start: hhmm, end: hhmm }).refine((p) => p.end > p.start)).max(20),
});
export type DayBatch = z.infer<typeof dayBatch>;

export function parseBatchForm(form: FormData): { ok: true; batch: DayBatch } | { ok: false; message: string } {
  const raw = form.get("batch");
  if (typeof raw !== "string" || raw.length > 50_000) return { ok: false, message: "內容不正確" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, message: "內容不正確" };
  }
  const parsed = dayBatch.safeParse(json);
  return parsed.success ? { ok: true, batch: parsed.data } : { ok: false, message: "時間或內容不正確，請檢查後再試" };
}

export async function submitBatch(deps: EditDeps, tripIdRaw: unknown, batch: DayBatch): Promise<EditResult> {
  if (!(await deps.getUser())) return fail("需要登入");
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return fail("操作過於頻繁，請稍後再試");
  const tripId = uuid.safeParse(tripIdRaw);
  if (!tripId.success) return fail("行程不正確");
  const ctx = await deps.load(tripId.data);
  if (!ctx) return fail("找不到這個行程");
  if (!ctx.canEdit) return fail("只有 Owner 與 Companion 可以編輯");
  const day = ctx.days.find((d) => d.date === batch.date);
  if (!day) return fail("日期不在行程期間內");

  const onDay = new Set(day.placements.map((p) => p.itemId));
  if (batch.removed.some((id) => !onDay.has(id)) || batch.placements.some((p) => !onDay.has(p.itemId))) return fail("清單已變更，請重新整理後再試");
  // 新增的項目由伺服器產生編號
  const added: AddedItem[] = batch.added.map((a) => ({ ...a, itemId: deps.newId() }));
  const all = [...batch.placements, ...added].sort((a, b) => a.start.localeCompare(b.start));
  if (all.some((p, k) => k > 0 && p.start < (all[k - 1]?.end ?? ""))) return fail("時段重疊，請調整時間或使用自動順延");

  const operations = batchOperations({ date: day.date, before: day.placements, after: batch.placements, removed: batch.removed, added });
  if (operations.length === 0) return fail("沒有變更");
  const slots = operations.flatMap((op) => (op.op === "schedule_item" ? [{ itemId: op.itemId, date: op.date, start: op.start, end: op.end }] : []));
  return write(deps, ctx, tripId.data, {
    dates: [day.date],
    slots,
    operations,
    summary: `調整 ${day.date.slice(5).replace("-", "/")} 的行程`,
    run: async (draft) => {
      await deps.editBatch(tripId.data, operations, draft);
      return null;
    },
  });
}

// 表單 -----------------------------------------------------------------------------------------

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (v: string) => (v === "" ? null : v);

function readItem(form: FormData) {
  const stay = text(form, "suggested_stay_minutes");
  return userItemFields.safeParse({
    name_zh: text(form, "name_zh"),
    type: text(form, "type"),
    address: orNull(text(form, "address")),
    suggested_stay_minutes: /^\d{1,3}$/.test(stay) ? Number(stay) : NaN,
    note: orNull(text(form, "note")),
    place_id: orNull(text(form, "place_id")),
  });
}

export function parseEditForm(
  form: FormData,
  current?: Pick<UserItemFields, "name_zh" | "type" | "address" | "suggested_stay_minutes" | "note"> & { place_id?: string | null },
): { ok: true; request: EditRequest } | { ok: false; message: string } {
  const kind = text(form, "kind");
  if (kind === "swap") {
    const date = isoDate.safeParse(text(form, "date"));
    const other = isoDate.safeParse(text(form, "other"));
    if (!date.success || !other.success || date.data === other.data) return { ok: false, message: "請選擇另一天" };
    return { ok: true, request: { kind: "swap", date: date.data, other: other.data } };
  }
  const itemId = uuid.safeParse(text(form, "itemId"));
  if (kind === "add") {
    const item = readItem(form);
    if (!item.success) return { ok: false, message: "請填寫名稱、類型與停留時間（5 到 600 分鐘）" };
    const date = orNull(text(form, "date"));
    const start = orNull(text(form, "start"));
    if ((date === null) !== (start === null)) return { ok: false, message: "日期與開始時間要一起填寫，或都留空放進候選清單" };
    if (date !== null && start !== null && (!isoDate.safeParse(date).success || !hhmm.safeParse(start).success)) {
      return { ok: false, message: "日期或時間格式不正確" };
    }
    return { ok: true, request: { kind: "add", item: item.data, slot: date !== null && start !== null ? { date, start } : null } };
  }
  if (!itemId.success) return { ok: false, message: "項目不正確" };
  switch (kind) {
    case "update": {
      const item = readItem(form);
      if (!item.success) return { ok: false, message: "請填寫名稱、類型與停留時間（5 到 600 分鐘）" };
      const next = item.data;
      const fields: Partial<UserItemFields> = {};
      for (const key of ["name_zh", "type", "address", "suggested_stay_minutes", "note"] as const) {
        if (!current) {
          Object.assign(fields, { [key]: next[key] });
          continue;
        }
        if (next[key] !== current[key]) Object.assign(fields, { [key]: next[key] });
      }
      if (Object.keys(fields).length === 0) return { ok: false, message: "沒有變更" };
      return { ok: true, request: { kind: "update", itemId: itemId.data, fields } };
    }
    case "delete":
      return { ok: true, request: { kind: "delete", itemId: itemId.data } };
    case "unschedule":
      return { ok: true, request: { kind: "unschedule", itemId: itemId.data } };
    case "up":
    case "down":
      return { ok: true, request: { kind: "reorder", itemId: itemId.data, direction: kind } };
    case "move": {
      const date = isoDate.safeParse(text(form, "date"));
      const start = hhmm.safeParse(text(form, "start"));
      if (!date.success || !start.success) return { ok: false, message: "請選擇日期與開始時間" };
      const endText = text(form, "end");
      if (endText === "") return { ok: true, request: { kind: "move", itemId: itemId.data, date: date.data, start: start.data } };
      const end = hhmm.safeParse(endText);
      if (!end.success) return { ok: false, message: "結束時間格式不正確" };
      return { ok: true, request: { kind: "move", itemId: itemId.data, date: date.data, start: start.data, end: end.data } };
    }
    case "duplicate": {
      if (!current) return { ok: false, message: "找不到這個項目" };
      const copy = userItemFields.safeParse({ ...current, place_id: current.place_id ?? null });
      if (!copy.success) return { ok: false, message: "這個項目不能複製" };
      return { ok: true, request: { kind: "duplicate", itemId: itemId.data, item: copy.data } };
    }
    default:
      return { ok: false, message: "不支援的操作" };
  }
}
