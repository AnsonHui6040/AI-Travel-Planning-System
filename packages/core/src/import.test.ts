import type { ImportOutput } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { gateImportOutput, importPreviewRows } from "./import";

// 決策 0010 I：匯入的輸出檢查與預覽列（純函式；AI 輸出只是預覽，S-01）

const output: ImportOutput = {
  bookings: [
    {
      kind: "flight",
      title: "去程 JL802",
      start_date: "2026-12-20",
      start_time: "08:30",
      end_date: null,
      end_time: "12:45",
      timezone: "Asia/Taipei",
      location: "桃園機場第二航廈",
      confirmation_code: "ABC123",
      note: null,
    },
    {
      kind: "restaurant",
      title: "銀座壽司",
      start_date: "2026-12-21",
      start_time: null,
      end_date: null,
      end_time: null,
      timezone: null,
      location: null,
      confirmation_code: null,
      note: null,
    },
  ],
  places: [
    { name: "淺草寺", type: "attraction", date: "2026-12-21", start_time: "09:00", note: null },
    { name: "築地場外市場", type: "restaurant", date: "2027-01-05", start_time: "07:00", note: "早餐" },
    { name: "代官山蔦屋", type: "shopping", date: null, start_time: null, note: null },
  ],
};

const trip = { timezone: "Asia/Tokyo", dates: ["2026-12-20", "2026-12-21", "2026-12-22"] };

describe("gateImportOutput", () => {
  it("合格的輸出通過", () => {
    expect(gateImportOutput(output, { forbiddenValues: [] })).toMatchObject({ ok: true });
  });

  it("不符 schema、含圖片網址或含不可提供的值時拒絕，訊息不含輸出內容", () => {
    expect(gateImportOutput({ bookings: [{ title: "x" }], places: [] }, { forbiddenValues: [] })).toEqual({ ok: false, reason: "schema", detail: "匯入輸出不符格式" });
    const image = { ...output, places: [{ ...output.places[0], note: "見 https://cdn.example.com/a.jpg" }] };
    expect(gateImportOutput(image, { forbiddenValues: [] })).toMatchObject({ ok: false, reason: "image_url" });
    const leak = gateImportOutput({ ...output, places: [{ ...output.places[0], note: "聯絡 王小明" }] }, { forbiddenValues: ["王小明"] });
    expect(leak).toMatchObject({ ok: false, reason: "leak" });
    expect(JSON.stringify(leak)).not.toContain("王小明");
  });
});

describe("importPreviewRows", () => {
  it("每列預設勾選；預訂沒有時區時用行程時區，沒有時間時待補且不勾選", () => {
    const rows = importPreviewRows(output, trip);
    expect(rows.bookings).toHaveLength(2);
    expect(rows.bookings[0]).toMatchObject({
      key: "b1",
      selected: true,
      kind: "flight",
      title: "去程 JL802",
      startDate: "2026-12-20",
      startTime: "08:30",
      endDate: "",
      endTime: "12:45",
      timezone: "Asia/Taipei",
      location: "桃園機場第二航廈",
      confirmationCode: "ABC123",
      note: "",
      issue: null,
    });
    expect(rows.bookings[1]).toMatchObject({ key: "b2", selected: false, timezone: "Asia/Tokyo", startTime: "", issue: "請補上開始時間" });
  });

  it("地點預設停留 60 分鐘；日期不在行程期間內時改放候選清單並提示", () => {
    const rows = importPreviewRows(output, trip);
    expect(rows.places.map((p) => [p.key, p.name, p.date, p.start, p.stayMinutes, p.selected, p.issue])).toEqual([
      ["p1", "淺草寺", "2026-12-21", "09:00", 60, true, null],
      ["p2", "築地場外市場", "", "", 60, true, "日期不在行程期間內，先放進候選清單"],
      ["p3", "代官山蔦屋", "", "", 60, true, null],
    ]);
  });

  it("只有日期沒有時間的地點放進候選清單（新增地點要日期與時間一起填）", () => {
    const rows = importPreviewRows({ bookings: [], places: [{ name: "明治神宮", type: "attraction", date: "2026-12-22", start_time: null, note: null }] }, trip);
    expect(rows.places[0]).toMatchObject({ date: "", start: "", issue: "沒有時間，先放進候選清單" });
  });
});
