// 決策 0010 I：E2E 用的錄製 AI 回應（E2E_AI_FIXTURE=1，不連 AI 供應商；Vercel 上一律關閉）。
// 內容與 evals/import/E10.json 相同，日期改為貼上文字中的第一個日期起算（示範行程的日期依執行當天而定）

const plus = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function importFixtureOutput(input: string): unknown {
  if (input.includes("E2E-空白")) return { bookings: [], places: [] };
  if (input.includes("E2E-無法辨識")) return { result: "無法整理" };
  const day1 = /\d{4}-\d{2}-\d{2}/.exec(input)?.[0] ?? "2026-12-20";
  return {
    bookings: [
      {
        kind: "lodging",
        title: "新宿華盛頓飯店",
        start_date: day1,
        start_time: "15:00",
        end_date: plus(day1, 2),
        end_time: "11:00",
        timezone: "Asia/Tokyo",
        location: "東京都新宿區西新宿 3-2-9",
        confirmation_code: "HTL-55821",
        note: null,
      },
      {
        kind: "flight",
        title: "JL802 台北桃園 → 東京成田",
        start_date: day1,
        start_time: "08:30",
        end_date: null,
        end_time: null,
        timezone: "Asia/Taipei",
        location: "台北桃園機場",
        confirmation_code: "Q7XK2P",
        note: "12:45 抵達成田（東京時間）",
      },
    ],
    places: [
      { name: "淺草寺", type: "attraction", date: plus(day1, 1), start_time: "09:00", note: null },
      { name: "晴空塔", type: "attraction", date: null, start_time: null, note: null },
      { name: "築地場外市場", type: "restaurant", date: null, start_time: null, note: "吃早餐" },
      { name: "銀座壽司", type: "restaurant", date: plus(day1, 1), start_time: null, note: "還沒訂位" },
    ],
  };
}
