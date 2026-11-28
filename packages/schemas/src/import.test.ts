import { describe, expect, it } from "vitest";
import { IMPORT_LIMITS, importOutput } from "./import";

// 決策 0010 I：行程匯入的 AI 輸出（只是預覽，使用者確認後才寫入）

const booking = {
  kind: "lodging",
  title: "新宿華盛頓飯店",
  start_date: "2026-12-20",
  start_time: "15:00",
  end_date: "2026-12-23",
  end_time: "11:00",
  timezone: "Asia/Tokyo",
  location: "東京都新宿區",
  confirmation_code: "HTL-55821",
  note: null,
};
const place = { name: "淺草寺", type: "attraction", date: "2026-12-21", start_time: "09:00", note: "早上人少" };

describe("importOutput", () => {
  it("接受預訂與地點，時間與時區可空", () => {
    expect(importOutput.safeParse({ bookings: [booking], places: [place] }).success).toBe(true);
    const loose = { ...booking, start_time: null, end_date: null, end_time: null, timezone: null, location: null, confirmation_code: null };
    expect(importOutput.safeParse({ bookings: [loose], places: [{ ...place, date: null, start_time: null, note: null }] }).success).toBe(true);
  });

  it("可以兩個都是空陣列（畫面顯示沒有辨識到）", () => {
    expect(importOutput.safeParse({ bookings: [], places: [] }).success).toBe(true);
  });

  it("拒絕未知欄位、錯誤的類型、時間與時區", () => {
    expect(importOutput.safeParse({ bookings: [{ ...booking, image_url: "https://x.example/a.jpg" }], places: [] }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [{ ...booking, kind: "car" }], places: [] }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [{ ...booking, start_time: "25:00" }], places: [] }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [{ ...booking, timezone: "Tokyo" }], places: [] }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [], places: [{ ...place, type: "hotel" }] }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [], places: [], members: [] }).success).toBe(false);
  });

  it("筆數與長度有上限", () => {
    expect(importOutput.safeParse({ bookings: Array(IMPORT_LIMITS.bookings + 1).fill(booking), places: [] }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [], places: Array(IMPORT_LIMITS.places + 1).fill(place) }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [{ ...booking, confirmation_code: "X".repeat(61) }], places: [] }).success).toBe(false);
    expect(importOutput.safeParse({ bookings: [], places: [{ ...place, name: "名".repeat(81) }] }).success).toBe(false);
  });
});
