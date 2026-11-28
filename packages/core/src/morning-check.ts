import type { Row, TripBaselineData } from "@atps/schemas";
import { availabilityOn } from "./feasibility";

// T36：Morning Check（第 2.8 節 Day Ready）。核查天氣、官方警報、交通、固定活動、預約、營業、第一段交通、行李、同行者、Backup。
// 純函式：天氣、警報、交通等觀測資料由呼叫端傳入；沒有資料的項目標示「無資料」，不當作通過。
// 結果：資料可能已不適合的項目標示 At Risk（下雨的戶外項目、警報時的戶外項目、當天休館），
// 下雨或警報時同區的室內候選提升為 Standby（每個項目最多 2 個）。寫入經資料庫函式 complete_morning_check。

type Item = Row<"itinerary_items">;

export const MORNING_CHECKS = [
  "weather",
  "warnings",
  "transit",
  "fixed_activities",
  "reservation",
  "opening",
  "first_leg",
  "luggage",
  "companions",
  "backups",
] as const;
export type MorningCheckName = (typeof MORNING_CHECKS)[number];
export type MorningCheckStatus = "ok" | "attention" | "no_data";

export const MORNING_CHECK_LABELS: Record<MorningCheckName, string> = {
  weather: "天氣",
  warnings: "官方警報",
  transit: "交通",
  fixed_activities: "固定活動",
  reservation: "預約",
  opening: "營業",
  first_leg: "第一段交通",
  luggage: "行李",
  companions: "同行者",
  backups: "Backup",
};

// 每小時降雨量（mm）或降雨機率（%）達到其一即視為有雨
export const RAIN_MM = 1;
export const RAIN_PROBABILITY = 60;
// 氣象廳等級：30 以上為警報
export const WARNING_LEVEL = 30;
export const STANDBY_PER_ITEM = 2;

export interface MorningItem {
  id: string;
  name_zh: string;
  type: Item["type"];
  zone_id: string | null;
  weather_dependency: Item["weather_dependency"];
  scheduled_start: string;
  scheduled_end: string;
  reservation_requirement: Item["reservation_requirement"];
  availability: Item["availability"];
  at_risk: boolean;
}

export interface MorningCandidate {
  id: string;
  name_zh: string;
  zone_id: string | null;
  weather_dependency: Item["weather_dependency"];
  verification_status: Item["verification_status"];
  standby: boolean;
}

export interface MorningInput {
  date: string;
  baseline: TripBaselineData;
  items: readonly MorningItem[];
  // 尚未排入行程的候選（含 Backup）
  candidates: readonly MorningCandidate[];
  // 目的地當地時間的逐時預報（YYYY-MM-DDTHH:MM）；沒有資料時為 null
  weather: ReadonlyArray<{
    time: string;
    precipitationProbability: number | null;
    precipitationMm: number | null;
  }> | null;
  warnings: { maxLevel: number; names: readonly string[] } | null;
  transit: ReadonlyArray<{ route: string; abnormal: boolean }> | null;
  // 由住宿到第一站的交通分鐘數；沒有估算時為 null
  firstLegMinutes: number | null;
  // 決策 0010 B：今天的預訂（行程時區的開始時間）；有關聯項目的預訂視為該項目已預約
  bookings?: ReadonlyArray<{ title: string; start: string; item_id: string | null }>;
}

export interface MorningCheckEntry {
  check: MorningCheckName;
  status: MorningCheckStatus;
  detail: string;
}

export interface MorningResult {
  checks: MorningCheckEntry[];
  atRisk: Array<{ itemId: string; reason: "rain" | "warning" | "closed" }>;
  standby: string[];
}

const toMin = (hhmm: string) =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function rainyHours(input: MorningInput): number[] {
  if (!input.weather) return [];
  return input.weather
    .filter((h) => h.time.slice(0, 10) === input.date)
    .filter(
      (h) =>
        (h.precipitationMm ?? 0) >= RAIN_MM ||
        (h.precipitationProbability ?? 0) >= RAIN_PROBABILITY,
    )
    .map((h) => Number(h.time.slice(11, 13)))
    .sort((a, b) => a - b);
}

// 連續的下雨時段，例如 [13, 14, 15] → 13:00–16:00
function rainRanges(hours: number[]): string {
  const ranges: Array<[number, number]> = [];
  for (const h of hours) {
    const last = ranges.at(-1);
    if (last && last[1] === h) last[1] = h + 1;
    else ranges.push([h, h + 1]);
  }
  return ranges
    .map(([a, b]) => `${toHhmm(a * 60)}–${toHhmm(b * 60)}`)
    .join("、");
}

const overlapsRain = (item: MorningItem, hours: number[]) =>
  hours.some(
    (h) =>
      h * 60 < toMin(item.scheduled_end) &&
      (h + 1) * 60 > toMin(item.scheduled_start),
  );

export function morningCheck(input: MorningInput): MorningResult {
  const { date, baseline } = input;
  const items = [...input.items].sort((a, b) =>
    a.scheduled_start.localeCompare(b.scheduled_start),
  );
  const outdoor = (i: MorningItem) => i.weather_dependency === "high";
  const rain = rainyHours(input);
  const atRisk: MorningResult["atRisk"] = [];
  const flag = (
    itemId: string,
    reason: MorningResult["atRisk"][number]["reason"],
  ) => {
    const item = items.find((i) => i.id === itemId);
    if (item && !item.at_risk && !atRisk.some((r) => r.itemId === itemId))
      atRisk.push({ itemId, reason });
  };

  // 營業
  const closed = items.filter((i) => {
    const windows = availabilityOn(i, date);
    return (
      windows !== null &&
      !windows.some(
        ([from, to]) => from <= i.scheduled_start && i.scheduled_end <= to,
      )
    );
  });
  for (const i of closed) flag(i.id, "closed");
  // 天氣與警報
  for (const i of items.filter(outdoor))
    if (overlapsRain(i, rain)) flag(i.id, "rain");
  const alarmed =
    input.warnings !== null && input.warnings.maxLevel >= WARNING_LEVEL;
  if (alarmed) for (const i of items.filter(outdoor)) flag(i.id, "warning");

  // Standby：下雨或警報的項目，同區室內、已核實、尚未排入的候選
  const standby: string[] = [];
  for (const risk of atRisk.filter((r) => r.reason !== "closed")) {
    const item = items.find((i) => i.id === risk.itemId);
    const picks = input.candidates
      .filter(
        (c) => c.zone_id === item?.zone_id && c.weather_dependency === "low",
      )
      .filter(
        (c) =>
          c.verification_status === "verified" ||
          c.verification_status === "partially_verified",
      )
      .filter((c) => !c.standby && !standby.includes(c.id))
      .sort(
        (a, b) =>
          a.name_zh.localeCompare(b.name_zh) || a.id.localeCompare(b.id),
      )
      .slice(0, STANDBY_PER_ITEM);
    standby.push(...picks.map((c) => c.id));
  }

  const fixed = baseline.fixed_activities
    .filter((a) => a.date === date)
    .sort((a, b) => a.start.localeCompare(b.start));
  const booked = new Set((input.bookings ?? []).flatMap((b) => (b.item_id ? [b.item_id] : [])));
  const reserve = items.filter((i) => i.reservation_requirement === "required" && !booked.has(i.id));
  const bookingText =
    (input.bookings ?? []).length > 0
      ? `已預訂：${[...(input.bookings ?? [])]
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((b) => `${b.start} ${b.title}`)
          .join("、")}`
      : null;
  const first = items[0];
  const luggageDay =
    baseline.lodgings.some(
      (l) => l.check_in === date || l.check_out === date,
    ) ||
    baseline.flights.some(
      (f) =>
        f.arrives_at.slice(0, 10) === date ||
        f.departs_at.slice(0, 10) === date,
    );
  const zones = [
    ...new Set(
      items.map((i) => i.zone_id).filter((z): z is string => z !== null),
    ),
  ].sort();
  const noBackup = zones.filter(
    (z) => !input.candidates.some((c) => c.zone_id === z),
  );
  const abnormal = input.transit?.filter((t) => t.abnormal) ?? [];

  const checks: MorningCheckEntry[] = [
    input.weather === null
      ? {
          check: "weather",
          status: "no_data",
          detail: "沒有天氣資料（需要地點座標）",
        }
      : rain.length > 0
        ? {
            check: "weather",
            status: "attention",
            detail: `${rainRanges(rain)} 預報有雨`,
          }
        : { check: "weather", status: "ok", detail: "沒有降雨預報" },
    input.warnings === null
      ? { check: "warnings", status: "no_data", detail: "沒有官方警報資料" }
      : input.warnings.names.length > 0
        ? {
            check: "warnings",
            status: "attention",
            detail: input.warnings.names.join("、"),
          }
        : { check: "warnings", status: "ok", detail: "沒有生效中的警報" },
    input.transit === null
      ? { check: "transit", status: "no_data", detail: "沒有即時交通資料" }
      : abnormal.length > 0
        ? {
            check: "transit",
            status: "attention",
            detail: `${abnormal.map((t) => t.route).join("、")}運行異常`,
          }
        : { check: "transit", status: "ok", detail: "沒有運行異常" },
    {
      check: "fixed_activities",
      status: "ok",
      detail:
        fixed.length > 0
          ? fixed.map((f) => `${f.start} ${f.name}`).join("、")
          : "今天沒有固定活動",
    },
    reserve.length > 0
      ? {
          check: "reservation",
          status: "attention",
          detail: [`需確認預約：${reserve.map((i) => i.name_zh).join("、")}`, bookingText].filter(Boolean).join("；"),
        }
      : { check: "reservation", status: "ok", detail: bookingText ?? "沒有需要預約的項目" },
    closed.length > 0
      ? {
          check: "opening",
          status: "attention",
          detail: `當天休館或不在營業時間內：${closed.map((i) => i.name_zh).join("、")}`,
        }
      : { check: "opening", status: "ok", detail: "營業時間符合" },
    input.firstLegMinutes === null || !first
      ? {
          check: "first_leg",
          status: "no_data",
          detail: "沒有由住宿到第一站的交通估算",
        }
      : {
          check: "first_leg",
          status: "ok",
          detail: `第一站 ${first.scheduled_start}，約需 ${input.firstLegMinutes} 分鐘，${toHhmm(Math.max(0, toMin(first.scheduled_start) - input.firstLegMinutes))} 前出發`,
        },
    luggageDay
      ? {
          check: "luggage",
          status: "attention",
          detail: "今天要搬運行李，確認寄放或配送",
        }
      : { check: "luggage", status: "ok", detail: "今天不用搬運行李" },
    baseline.stamina_note
      ? {
          check: "companions",
          status: "attention",
          detail: baseline.stamina_note,
        }
      : {
          check: "companions",
          status: "ok",
          detail: `同行 ${baseline.companions} 人`,
        },
    input.candidates.length === 0
      ? { check: "backups", status: "attention", detail: "沒有 Backup" }
      : noBackup.length > 0
        ? {
            check: "backups",
            status: "attention",
            detail: `沒有 Backup 的區域：${noBackup.join("、")}`,
          }
        : { check: "backups", status: "ok", detail: "每個區域都有 Backup" },
  ];

  return { checks, atRisk, standby: standby.sort() };
}
