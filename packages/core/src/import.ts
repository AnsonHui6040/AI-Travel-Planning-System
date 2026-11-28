import { importOutput, type ImportOutput } from "@atps/schemas";
import type { BookingKind } from "./bookings";
import { leaks } from "./output-gate";
import { containsImageUrl } from "./research";

// 決策 0010 I：行程匯入。AI 輸出只是預覽（S-01）：經 gateImportOutput 檢查後轉成預覽列，使用者逐項修改、取消勾選或確認，
// 確認的列才以本人 session 經預訂與行程編輯的寫入路徑寫入。純函式。

export type ImportRejection = "schema" | "image_url" | "leak";

export type ImportGateResult = { ok: true; output: ImportOutput } | { ok: false; reason: ImportRejection; detail: string };

// 與 gateRoleOutput 相同的檢查：schema、圖片網址（S-16）、API key 與敏感欄位值（訊息不含輸出內容，S-02、S-10）
export function gateImportOutput(output: unknown, ctx: { forbiddenValues: readonly string[] }): ImportGateResult {
  const parsed = importOutput.safeParse(output);
  if (!parsed.success) return { ok: false, reason: "schema", detail: "匯入輸出不符格式" };
  if (containsImageUrl(parsed.data)) return { ok: false, reason: "image_url", detail: "輸出含有圖片網址" };
  if (leaks(parsed.data, ctx.forbiddenValues)) return { ok: false, reason: "leak", detail: "輸出含有不可提供的資料" };
  return { ok: true, output: parsed.data };
}

// 預覽列：欄位名稱與預訂表單、新增地點表單相同，空值為空字串
export interface ImportBookingRow {
  key: string;
  selected: boolean;
  kind: BookingKind;
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  location: string;
  confirmationCode: string;
  note: string;
  issue: string | null;
}

export interface ImportPlaceRow {
  key: string;
  selected: boolean;
  name: string;
  type: ImportOutput["places"][number]["type"];
  date: string;
  start: string;
  stayMinutes: number;
  note: string;
  issue: string | null;
}

export interface ImportPreview {
  bookings: ImportBookingRow[];
  places: ImportPlaceRow[];
}

// 與行程編輯的新增地點預設相同
export const IMPORT_DEFAULT_STAY_MINUTES = 60;

export function importPreviewRows(output: ImportOutput, trip: { timezone: string; dates: readonly string[] }): ImportPreview {
  const bookings = output.bookings.map((b, i): ImportBookingRow => {
    const issue = b.start_time === null ? "請補上開始時間" : null;
    return {
      key: `b${i + 1}`,
      selected: issue === null,
      kind: b.kind,
      title: b.title,
      startDate: b.start_date,
      startTime: b.start_time ?? "",
      endDate: b.end_date ?? "",
      endTime: b.end_time ?? "",
      timezone: b.timezone ?? trip.timezone,
      location: b.location ?? "",
      confirmationCode: b.confirmation_code ?? "",
      note: b.note ?? "",
      issue,
    };
  });
  const places = output.places.map((p, i): ImportPlaceRow => {
    let issue: string | null = null;
    let slot = { date: "", start: "" };
    if (p.date !== null && !trip.dates.includes(p.date)) issue = "日期不在行程期間內，先放進候選清單";
    else if (p.date !== null && p.start_time === null) issue = "沒有時間，先放進候選清單";
    else if (p.date !== null && p.start_time !== null) slot = { date: p.date, start: p.start_time };
    return {
      key: `p${i + 1}`,
      selected: true,
      name: p.name,
      type: p.type,
      ...slot,
      stayMinutes: IMPORT_DEFAULT_STAY_MINUTES,
      note: p.note ?? "",
      issue,
    };
  });
  return { bookings, places };
}
