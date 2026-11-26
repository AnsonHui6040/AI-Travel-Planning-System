import { describe, expect, it } from "vitest";
import type { ActualTimeline, TimelineRow } from "./actual-timeline";
import { allowedPostTripStatuses, postTripReport, POST_TRIP_REPORT_FIELDS, type PostTripItem } from "./post-trip";

// T40：旅後狀態標記與 MEM-04 比較報告（Planned vs Actual：停留時間差異、交通估算差異、實際用上的 Backup、
// 過密時段、證實不可靠的建議（provider 與模型）、最喜歡的活動類型）

const row = (over: Partial<TimelineRow> & Pick<TimelineRow, "itemId" | "name_zh">): TimelineRow => ({
  planned: null,
  actual: null,
  outcome: "completed",
  visited: true,
  unplanned: false,
  recordedBy: "u1",
  arrivalDeltaMinutes: null,
  ...over,
});

const day1: ActualTimeline = {
  date: "2026-11-20",
  rows: [
    row({ itemId: "temple", name_zh: "淺草寺", planned: { start: "09:00", end: "10:30" }, actual: { arrived: "09:10", departed: "11:10" }, arrivalDeltaMinutes: 10 }),
    row({ itemId: "tower", name_zh: "晴空塔", planned: { start: "11:00", end: "12:30" }, actual: { arrived: "11:50", departed: "12:40" }, arrivalDeltaMinutes: 50, outcome: "partial", visited: false }),
    row({ itemId: "cafe", name_zh: "備案咖啡廳", unplanned: true, actual: { arrived: "13:00", departed: "13:40" } }),
    row({ itemId: "park", name_zh: "上野公園", planned: { start: "14:00", end: "15:30" }, actual: null, outcome: "skipped", visited: false }),
  ],
  visitedItemIds: ["temple", "cafe"],
  summary: { planned: 3, completed: 1, partial: 1, skipped: 1, notRecorded: 0, unplanned: 1 },
};
const day2: ActualTimeline = {
  date: "2026-11-21",
  rows: [
    row({ itemId: "museum", name_zh: "國立博物館", planned: { start: "10:00", end: "12:00" }, actual: { arrived: "10:00", departed: "11:30" }, arrivalDeltaMinutes: 0 }),
    row({ itemId: "sushi", name_zh: "壽司店", planned: { start: "12:30", end: "13:30" }, actual: { arrived: "12:20", departed: "13:30" }, arrivalDeltaMinutes: -10 }),
  ],
  visitedItemIds: ["museum", "sushi"],
  summary: { planned: 2, completed: 2, partial: 0, skipped: 0, notRecorded: 0, unplanned: 0 },
};

const items: PostTripItem[] = [
  { id: "temple", name_zh: "淺草寺", type: "attraction", post_trip_status: "revisit", generated_by: { provider: "anthropic", model: "claude-opus-5-5" }, backup: false },
  { id: "tower", name_zh: "晴空塔", type: "attraction", post_trip_status: "not_recommended", generated_by: { provider: "openai", model: "gpt-x" }, backup: false },
  { id: "cafe", name_zh: "備案咖啡廳", type: "restaurant", post_trip_status: "completed", generated_by: null, backup: true },
  { id: "park", name_zh: "上野公園", type: "photography", post_trip_status: "skipped", generated_by: null, backup: false },
  { id: "museum", name_zh: "國立博物館", type: "attraction", post_trip_status: "completed", generated_by: { provider: "google", model: "gemini-x" }, backup: false },
  { id: "sushi", name_zh: "壽司店", type: "restaurant", post_trip_status: "revisit", generated_by: null, backup: false },
];

const segments = [
  { from: "temple", to: "tower", minutes: 30 },
  { from: "museum", to: "sushi", minutes: 20 },
];

const report = () => postTripReport({ days: [day1, day2], items, segments });

describe("postTripReport", () => {
  it("報告欄位齊全（MEM-04）", () => {
    expect(Object.keys(report()).sort()).toEqual([...POST_TRIP_REPORT_FIELDS].sort());
    expect([...POST_TRIP_REPORT_FIELDS].sort()).toEqual(
      ["backupsUsed", "crowdedSlots", "favoriteActivityTypes", "stayDifferences", "transportDifferences", "unreliableRecommendations"].sort(),
    );
  });

  it("停留時間差異：只計有到達與離開的排定項目", () => {
    expect(report().stayDifferences).toEqual([
      { date: "2026-11-20", itemId: "temple", name_zh: "淺草寺", plannedMinutes: 90, actualMinutes: 120, diffMinutes: 30 },
      { date: "2026-11-20", itemId: "tower", name_zh: "晴空塔", plannedMinutes: 90, actualMinutes: 50, diffMinutes: -40 },
      { date: "2026-11-21", itemId: "museum", name_zh: "國立博物館", plannedMinutes: 120, actualMinutes: 90, diffMinutes: -30 },
      { date: "2026-11-21", itemId: "sushi", name_zh: "壽司店", plannedMinutes: 60, actualMinutes: 70, diffMinutes: 10 },
    ]);
  });

  it("交通估算差異：相鄰兩個有實際時間的地點（含部分完成），以前一站離開到下一站到達計算；沒有估算的移動不列入", () => {
    expect(report().transportDifferences).toEqual([
      { date: "2026-11-20", fromItemId: "temple", toItemId: "tower", fromName: "淺草寺", toName: "晴空塔", estimatedMinutes: 30, actualMinutes: 40, diffMinutes: 10 },
      { date: "2026-11-21", fromItemId: "museum", toItemId: "sushi", fromName: "國立博物館", toName: "壽司店", estimatedMinutes: 20, actualMinutes: 50, diffMinutes: 30 },
    ]);
  });

  it("實際用上的 Backup：計畫外且完成的項目", () => {
    expect(report().backupsUsed).toEqual([{ date: "2026-11-20", itemId: "cafe", name_zh: "備案咖啡廳", backup: true }]);
  });

  it("過密時段：到達晚 30 分鐘以上、部分完成或停留不到一半的相鄰排定項目合併為一段", () => {
    expect(report().crowdedSlots).toEqual([
      { date: "2026-11-20", from: "11:00", until: "12:30", itemIds: ["tower"], reasons: ["晚到 50 分鐘", "部分完成"] },
    ]);
  });

  it("證實不可靠的建議：旅後標示不推薦，記錄 provider 與模型", () => {
    expect(report().unreliableRecommendations).toEqual([
      { itemId: "tower", name_zh: "晴空塔", provider: "openai", model: "gpt-x", reason: "旅後標示不推薦" },
    ]);
  });

  it("最喜歡的活動類型：再訪 2 分、完成 1 分、不推薦扣 1 分，依分數排序", () => {
    expect(report().favoriteActivityTypes).toEqual([
      { type: "restaurant", score: 3, count: 2 },
      { type: "attraction", score: 2, count: 3 },
    ]);
  });

  it("沒有資料時每個欄位為空清單", () => {
    const empty = postTripReport({ days: [], items: [], segments: [] });
    for (const field of POST_TRIP_REPORT_FIELDS) expect(empty[field]).toEqual([]);
  });
});

describe("allowedPostTripStatuses", () => {
  it("實際去過：完成、再訪、不推薦", () => {
    expect(allowedPostTripStatuses(true)).toEqual(["completed", "revisit", "not_recommended"]);
  });
  it("沒有去過：不可標為完成或不推薦", () => {
    expect(allowedPostTripStatuses(false)).toEqual(["skipped", "cancelled", "revisit"]);
  });
});
