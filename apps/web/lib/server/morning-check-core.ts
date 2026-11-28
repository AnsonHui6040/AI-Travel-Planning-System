import { bookingLocal, bookingsOn, morningCheck, withBookings, type BookingConstraint, type MorningCandidate, type MorningInput, type MorningItem, type MorningResult } from "@atps/core";
import { isoDate, uuid, type TripBaselineData } from "@atps/schemas";

// T36：Morning Check 的 Server Action 邏輯（第 2.8 節 Day Ready）。
// 以使用者 session 讀取當天行程與候選，取得天氣（Open-Meteo，座標只送小數第二位）；
// 官方警報與即時交通需要地區代碼與 ODPT 路線對應，尚未設定時為「無資料」。
// 由 core 的 morningCheck 計算，經 complete_morning_check 寫入（權限與狀態由資料庫再檢查）。

export class MorningCheckStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`Morning Check 寫入失敗（${reason}）`);
  }
}

export interface MorningContext {
  canEdit: boolean;
  dayStatus: string | null;
  timezone: string;
  baseline: TripBaselineData;
  // 當天第一個有座標的項目（D28：30 日內的座標）；沒有時為 null
  coords: { lat: number; lng: number } | null;
  firstLegMinutes: number | null;
  items: MorningItem[];
  candidates: MorningCandidate[];
  // 決策 0010 B：行程的預訂（不含預約碼）；當天的預訂視為固定活動
  bookings?: BookingConstraint[];
}

export interface MorningCheckDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  loadContext: (tripId: string, date: string) => Promise<MorningContext | null>;
  fetchWeather: (coords: { lat: number; lng: number }, timezone: string) => Promise<MorningInput["weather"]>;
  complete: (tripId: string, date: string, result: { checks: MorningResult["checks"] }, atRisk: string[], standby: string[]) => Promise<void>;
  logError: (message: string) => void;
}

export interface MorningCheckActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "morning.check", limit: 10, windowSeconds: 60 } as const;

export async function runMorningCheckAction(deps: MorningCheckDeps, tripIdRaw: unknown, dateRaw: unknown): Promise<MorningCheckActionResult> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  const tripId = uuid.safeParse(tripIdRaw);
  const date = isoDate.safeParse(dateRaw);
  if (!tripId.success || !date.success) return { ok: false, message: "參數不正確" };

  const context = await deps.loadContext(tripId.data, date.data);
  if (!context) return { ok: false, message: "找不到這個行程" };
  if (!context.canEdit) return { ok: false, message: "只有 Owner 與 Companion 可以執行 Morning Check" };
  if (context.dayStatus !== "approved" && context.dayStatus !== "day_ready") return { ok: false, message: "這天尚未批准，請先批准每日行程" };

  let weather: MorningInput["weather"] = null;
  if (context.coords) {
    try {
      weather = await deps.fetchWeather(context.coords, context.timezone);
    } catch {
      deps.logError("Morning Check 天氣資料取得失敗");
    }
  }

  // 有關聯項目、且項目排在當天的預訂以項目代表；其餘當天的預訂成為固定活動
  const bookings = context.bookings ?? [];
  const scheduledToday = new Set(context.items.map((i) => i.id));
  const baseline = withBookings(context.baseline, bookings, (itemId) => (scheduledToday.has(itemId) ? date.data : null));
  const todays = bookingsOn(bookings, date.data, context.baseline.timezone)
    .filter((b) => b.kind !== "lodging")
    .map((b) => ({ title: b.title, start: bookingLocal(b.starts_at, context.baseline.timezone).time, item_id: b.item_id }));
  const result = morningCheck({
    date: date.data,
    baseline,
    bookings: todays,
    items: context.items,
    candidates: context.candidates,
    weather,
    warnings: null,
    transit: null,
    firstLegMinutes: context.firstLegMinutes,
  });
  try {
    await deps.complete(
      tripId.data,
      date.data,
      { checks: result.checks },
      result.atRisk.map((r) => r.itemId),
      result.standby,
    );
  } catch (error) {
    if (error instanceof MorningCheckStoreError && error.reason === "forbidden") return { ok: false, message: "只有 Owner 與 Companion 可以執行 Morning Check" };
    if (error instanceof MorningCheckStoreError && error.reason === "state") return { ok: false, message: "這天尚未批准，請先批准每日行程" };
    deps.logError("Morning Check 寫入失敗");
    return { ok: false, message: "Morning Check 失敗，請稍後再試" };
  }
  return {
    ok: true,
    message: `Morning Check 完成，已標示 Day Ready。${result.atRisk.length} 個項目標示 At Risk，${result.standby.length} 個候選提升為 Standby`,
  };
}
