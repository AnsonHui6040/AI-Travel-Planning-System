// 首頁的行程排序（docs/verification/ux-logic-2026-11-27.md 第 5 節：目前行程在最上）。
// 目前行程：進行中；沒有時為日期涵蓋今天的行程；再來是最近要出發的行程。其餘維持原順序（最新建立在前）

export interface OrderableTrip {
  id: string;
  rawStatus: string;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
}

const localDate = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export function currentTripId(trips: readonly OrderableTrip[], now: Date): string | null {
  const active = trips.filter((t) => t.rawStatus !== "ended" && t.rawStatus !== "archived");
  const running = active.find((t) => t.rawStatus === "in_progress");
  if (running) return running.id;
  const today = active.find((t) => t.startDate && t.startDate <= localDate(now, t.timezone) && localDate(now, t.timezone) <= (t.endDate ?? t.startDate));
  if (today) return today.id;
  const upcoming = active
    .filter((t) => t.startDate && t.startDate > localDate(now, t.timezone))
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))[0];
  return upcoming?.id ?? active[0]?.id ?? null;
}

export function orderTrips<T extends OrderableTrip>(trips: readonly T[], now: Date): T[] {
  const current = currentTripId(trips, now);
  return [...trips].sort((a, b) => Number(b.id === current) - Number(a.id === current));
}
