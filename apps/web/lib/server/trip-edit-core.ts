import { checkBaseline, tripDateChange } from "@atps/core";
import { isoDate, travelLegMode, uuid, type TravelLegMode, type TripBaselineData } from "@atps/schemas";

// 決策 0011：行程設定（只限 Owner）與兩站之間的交通（Owner、Companion）的 Server Action 邏輯。
// 日期同步寫入 Trip Baseline v1：改日期前以 core 的 checkBaseline 比較，產生新的矛盾（例如住宿超出日期）時不送出。

export type TripEditResult = { ok: true; message: string } | { ok: false; message: string };

const fail = (message: string): TripEditResult => ({ ok: false, message });
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

export interface SettingsInput {
  name: string;
  destination: string | null;
  start: string | null;
  end: string | null;
}

export function parseSettingsForm(form: FormData): { ok: true; input: SettingsInput } | { ok: false; message: string } {
  const name = text(form, "name");
  const destination = text(form, "destination");
  if (name.length < 1 || name.length > 120) return { ok: false, message: "請填寫行程名稱（120 字以內）" };
  if (destination.length > 120) return { ok: false, message: "目的地太長（120 字以內）" };
  const start = text(form, "start");
  const end = text(form, "end");
  if ((start === "") !== (end === "")) return { ok: false, message: "開始與結束日期要一起填寫" };
  if (start !== "" && (!isoDate.safeParse(start).success || !isoDate.safeParse(end).success || end < start)) {
    return { ok: false, message: "結束日期不可早於開始日期" };
  }
  return { ok: true, input: { name, destination: destination || null, start: start || null, end: end || null } };
}

export interface SettingsContext {
  isOwner: boolean;
  tripStatus: string;
  baseline: TripBaselineData | null;
  scheduled: Array<{ itemId: string; date: string }>;
}

export interface SettingsDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  load: (tripId: string) => Promise<SettingsContext | null>;
  save: (tripId: string, input: SettingsInput) => Promise<{ movedToCandidates: number }>;
  logError: (message: string) => void;
}

const RATE = { endpoint: "trip.settings", limit: 20, windowSeconds: 60 } as const;

export async function submitSettings(deps: SettingsDeps, tripIdRaw: unknown, input: SettingsInput, confirmedRemoval: boolean): Promise<TripEditResult> {
  if (!(await deps.getUser())) return fail("需要登入");
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return fail("操作過於頻繁，請稍後再試");
  const tripId = uuid.safeParse(tripIdRaw);
  if (!tripId.success) return fail("行程不正確");
  const ctx = await deps.load(tripId.data);
  if (!ctx) return fail("找不到這個行程");
  if (!ctx.isOwner) return fail("只有 Owner 可以修改行程設定");
  if (ctx.tripStatus === "ended" || ctx.tripStatus === "archived") return fail("行程已結束，不能再修改");

  let dates = input.start && input.end ? { start: input.start, end: input.end } : null;
  if (dates && ctx.baseline && dates.start === ctx.baseline.start_date && dates.end === ctx.baseline.end_date) dates = null;
  if (dates) {
    if (!ctx.baseline) return fail("確認旅行基線後才能修改日期");
    const before = new Set(checkBaseline(ctx.baseline).filter((i) => i.severity === "conflict").map((i) => i.message));
    const after = checkBaseline({ ...ctx.baseline, start_date: dates.start, end_date: dates.end }).filter((i) => i.severity === "conflict" && !before.has(i.message));
    if (after.length > 0) return fail(`請先修改旅行基線：${after.map((i) => i.message).join("、")}`);
    const change = tripDateChange({ start: ctx.baseline.start_date, end: ctx.baseline.end_date }, dates, ctx.scheduled);
    if (change.removed.length > 0 && !confirmedRemoval) return fail("移除日期需要確認");
  }

  try {
    const result = await deps.save(tripId.data, { ...input, start: dates?.start ?? null, end: dates?.end ?? null });
    return { ok: true, message: result.movedToCandidates > 0 ? `已儲存，${result.movedToCandidates} 個項目移回候選清單` : "已儲存" };
  } catch {
    deps.logError("修改行程設定失敗");
    return fail("儲存失敗，請稍後再試");
  }
}

// 兩站之間的交通 ----------------------------------------------------------------------------------

export interface LegInput {
  from: string;
  to: string;
  mode: TravelLegMode;
  minutes: number;
}

export function parseLegForm(form: FormData): { ok: true; input: LegInput } | { ok: false; message: string } {
  const from = uuid.safeParse(text(form, "from"));
  const to = uuid.safeParse(text(form, "to"));
  const mode = travelLegMode.safeParse(text(form, "mode"));
  const minutesText = text(form, "minutes");
  const minutes = /^\d{1,3}$/.test(minutesText) ? Number(minutesText) : NaN;
  if (!from.success || !to.success || from.data === to.data) return { ok: false, message: "項目不正確" };
  if (!mode.success) return { ok: false, message: "請選擇交通方式" };
  if (!(minutes >= 0 && minutes <= 600)) return { ok: false, message: "分鐘要在 0 到 600 之間" };
  return { ok: true, input: { from: from.data, to: to.data, mode: mode.data, minutes } };
}

export interface LegDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  canEdit: (tripId: string) => Promise<boolean>;
  save: (tripId: string, input: LegInput) => Promise<void>;
  logError: (message: string) => void;
}

export async function submitLeg(deps: LegDeps, tripIdRaw: unknown, input: LegInput): Promise<TripEditResult> {
  if (!(await deps.getUser())) return fail("需要登入");
  if (!(await deps.checkRateLimit("trip.travel", 60, 60))) return fail("操作過於頻繁，請稍後再試");
  const tripId = uuid.safeParse(tripIdRaw);
  if (!tripId.success) return fail("行程不正確");
  if (!(await deps.canEdit(tripId.data))) return fail("只有 Owner 與 Companion 可以編輯");
  try {
    await deps.save(tripId.data, input);
    return { ok: true, message: "已儲存交通" };
  } catch {
    deps.logError("儲存交通失敗");
    return fail("儲存失敗，請稍後再試");
  }
}
