import { bookingLocal, type BookingKind } from "@atps/core";

// 決策 0010 B：預訂與清單的顯示文字。時間以預訂自己的時區顯示（與確認信相同）；與行程時區不同時標出時區

export const KIND_LABELS: Record<BookingKind, string> = {
  flight: "航班",
  lodging: "住宿",
  restaurant: "餐廳",
  ticket: "票券",
  transport: "交通",
  other: "其他",
};

export const LIST_KIND_LABELS = { packing: "打包", todo: "待辦" } as const;

const TIMEZONE_NAMES: Record<string, string> = {
  "Asia/Taipei": "台北",
  "Asia/Tokyo": "東京",
  "Asia/Seoul": "首爾",
  "Asia/Hong_Kong": "香港",
  "Asia/Shanghai": "上海",
  "Asia/Bangkok": "曼谷",
  "Asia/Singapore": "新加坡",
  "Europe/London": "倫敦",
  "Europe/Paris": "巴黎",
  "America/Los_Angeles": "洛杉磯",
  "America/New_York": "紐約",
  UTC: "UTC",
};

export const timezoneLabel = (tz: string) => TIMEZONE_NAMES[tz] ?? tz;

// 表單的時區選項：行程時區在最前面，接著常用時區與目前的值
export function timezoneOptions(tripTimezone: string, current: string | null): string[] {
  return [...new Set([tripTimezone, ...(current ? [current] : []), ...Object.keys(TIMEZONE_NAMES)])];
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function shortWhen(iso: string, timeZone: string): { date: string; time: string } {
  const local = bookingLocal(iso, timeZone);
  return { date: md(local.date), time: local.time };
}

export interface RangeInput {
  kind: BookingKind;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
}

// 例如「1/10 19:00–20:30」「1/10 23:00 至 1/12 06:00」「1/10 15:00 入住，1/12 退房」
export function bookingRange(b: RangeInput, tripTimezone: string): string {
  const start = bookingLocal(b.starts_at, b.timezone);
  const end = b.ends_at ? bookingLocal(b.ends_at, b.timezone) : null;
  let text: string;
  if (b.kind === "lodging") text = `${md(start.date)} ${start.time} 入住${end ? `，${md(end.date)} ${end.time} 退房` : ""}`;
  else if (!end) text = `${md(start.date)} ${start.time}`;
  else if (end.date === start.date) text = `${md(start.date)} ${start.time}–${end.time}`;
  else text = `${md(start.date)} ${start.time} 至 ${md(end.date)} ${end.time}`;
  return b.timezone === tripTimezone ? text : `${text}（${timezoneLabel(b.timezone)}時間）`;
}

// 表單的初始值（預訂時區的日期與時間）
export function formParts(iso: string | null, timeZone: string): { date: string; time: string } {
  return iso ? bookingLocal(iso, timeZone) : { date: "", time: "" };
}
