import type { TripBaselineData } from "@atps/schemas";

// 決策 0010 B：預訂（航班、住宿、餐廳、票券、交通、其他）。當天的預訂視為固定活動（Hard Constraint）：
// withBookings 把預訂換算為行程時區的固定活動、航班與住宿，交給 draftDays、checkDay、planFeasibleDays、morningCheck、planIncident。
// 純函式（只用 Intl 換算時區）。不含預約碼：預約碼只在成員畫面顯示，不進入任何計算、不送 AI。
// - 住宿不佔用時段，只在入住與退房日列出，並計入搬運行李的日子
// - 跨日的預訂分成開始日與結束日兩段，中間的日期不佔用
// - 有關聯項目、且項目已排入同一天時，以項目代表（不重複列出）；行程內以 bookedItemIds 視為已預約

export const BOOKING_KINDS = ["flight", "lodging", "restaurant", "ticket", "transport", "other"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

export interface BookingConstraint {
  id: string;
  kind: BookingKind;
  title: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string | null;
  item_id: string | null;
}

type FixedActivity = TripBaselineData["fixed_activities"][number];

// 沒有結束時間時的長度，與 draftDays 對沒有結束時間的固定活動相同
export const BOOKING_DEFAULT_MINUTES = 60;
const AREA_MAX = 80;
const DAY_LAST = "23:59";

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// 某個時間點在指定時區的日期與時間（HH:MM）
export function bookingLocal(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function bookingFixedActivities(
  bookings: readonly BookingConstraint[],
  tripTimezone: string,
  scheduledOn?: (itemId: string) => string | null,
): FixedActivity[] {
  const out: FixedActivity[] = [];
  for (const b of bookings) {
    if (b.kind === "lodging") continue;
    const start = bookingLocal(b.starts_at, tripTimezone);
    const end = b.ends_at ? bookingLocal(b.ends_at, tripTimezone) : null;
    const area = b.location ? b.location.slice(0, AREA_MAX) : null;
    const segments: Array<{ date: string; start: string; end: string }> = [];
    if (!end) {
      segments.push({ date: start.date, start: start.time, end: toHhmm(Math.min(toMin(start.time) + BOOKING_DEFAULT_MINUTES, toMin(DAY_LAST))) });
    } else if (end.date === start.date) {
      segments.push({ date: start.date, start: start.time, end: end.time });
    } else {
      segments.push({ date: start.date, start: start.time, end: DAY_LAST });
      segments.push({ date: end.date, start: "00:00", end: end.time });
    }
    for (const s of segments) {
      if (b.item_id && scheduledOn?.(b.item_id) === s.date) continue;
      out.push({ name: b.title, area, date: s.date, start: s.start, end: s.end, paid: true });
    }
  }
  return out;
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

export function withBookings(
  baseline: TripBaselineData,
  bookings: readonly BookingConstraint[],
  scheduledOn?: (itemId: string) => string | null,
): TripBaselineData {
  if (bookings.length === 0) return baseline;
  const tz = baseline.timezone;
  const fixed = bookingFixedActivities(bookings, tz, scheduledOn).filter(
    (a) => !baseline.fixed_activities.some((f) => f.date === a.date && f.start === a.start && f.name === a.name),
  );
  const flights = bookings
    .filter((b) => b.kind === "flight")
    .filter((b) => !baseline.flights.some((f) => sameInstant(f.departs_at, b.starts_at)))
    .map((b) => ({ label: b.title, departs_at: b.starts_at, arrives_at: b.ends_at ?? b.starts_at }));
  const lodgings = bookings
    .filter((b) => b.kind === "lodging")
    .map((b) => {
      const checkIn = bookingLocal(b.starts_at, tz);
      return {
        name: b.title,
        area: b.location ? b.location.slice(0, AREA_MAX) : null,
        check_in: checkIn.date,
        check_out: b.ends_at ? bookingLocal(b.ends_at, tz).date : checkIn.date,
        check_in_time: checkIn.time,
      };
    })
    .filter((l) => !baseline.lodgings.some((x) => x.check_in === l.check_in && x.check_out === l.check_out));
  return {
    ...baseline,
    fixed_activities: [...baseline.fixed_activities, ...fixed].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
    flights: [...baseline.flights, ...flights],
    lodgings: [...baseline.lodgings, ...lodgings],
  };
}

// 某一天（行程時區）的預訂：開始或結束在這一天；依開始時間排序
export function bookingsOn<T extends BookingConstraint>(bookings: readonly T[], date: string, tripTimezone: string): T[] {
  return bookings
    .filter((b) => bookingLocal(b.starts_at, tripTimezone).date === date || (b.ends_at !== null && bookingLocal(b.ends_at, tripTimezone).date === date))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
}

// 已有預訂的項目（可行性與 Morning Check 不再提醒確認預約；Incident Mode 視為 Hard Constraint）
export function bookedItemIds(bookings: readonly Pick<BookingConstraint, "item_id">[]): Set<string> {
  return new Set(bookings.flatMap((b) => (b.item_id ? [b.item_id] : [])));
}
