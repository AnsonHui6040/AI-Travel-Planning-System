import { describe, expect, it } from "vitest";
import { findDuplicateGroups, normalizePlaceName, type DedupeItem } from "./index";

// T25：以 place_id、名稱、位置去重

const item = (over: Partial<DedupeItem> & { id: string }): DedupeItem => ({
  place_id: null,
  name_zh: "淺草寺",
  name_local: null,
  area: "淺草",
  coord_lat: null,
  coord_lng: null,
  created_at: "2026-11-24T01:00:00Z",
  ...over,
});

describe("normalizePlaceName", () => {
  it("全形半形、大小寫、空白與標點視為相同", () => {
    expect(normalizePlaceName(" ＳＫＹ　Tree・展望台！")).toBe(normalizePlaceName("sky tree 展望台"));
    expect(normalizePlaceName("Blue Bottle Coffee（清澄白河）")).toBe("bluebottlecoffee清澄白河");
  });
});

describe("findDuplicateGroups", () => {
  it("place_id 相同即為重複，名稱不同也一樣", () => {
    const groups = findDuplicateGroups([
      item({ id: "a", place_id: "ChIJ_1", name_zh: "淺草寺" }),
      item({ id: "b", place_id: "ChIJ_1", name_zh: "金龍山淺草寺", area: "台東區" }),
      item({ id: "c", place_id: "ChIJ_2", name_zh: "雷門" }),
    ]);
    expect(groups).toEqual([{ keep: "a", drop: ["b"] }]);
  });

  it("沒有 place_id 時，名稱相同且地區相同為重複；中文名稱與當地名稱交叉比對", () => {
    const groups = findDuplicateGroups([
      item({ id: "a", name_zh: "淺草寺", name_local: "浅草寺" }),
      item({ id: "b", name_zh: "浅草寺観音堂", name_local: "浅草寺" }),
      item({ id: "c", name_zh: "淺草寺", area: "京都" }),
    ]);
    expect(groups).toEqual([{ keep: "a", drop: ["b"] }]);
  });

  it("地區寫法不同但座標在 300 公尺內為重複；超過則不是", () => {
    const groups = findDuplicateGroups([
      item({ id: "a", area: "淺草", coord_lat: 35.7148, coord_lng: 139.7967 }),
      item({ id: "b", area: "台東區", coord_lat: 35.7158, coord_lng: 139.7967 }),
      item({ id: "c", area: "上野", coord_lat: 35.7148, coord_lng: 139.7767 }),
    ]);
    expect(groups).toEqual([{ keep: "a", drop: ["b"] }]);
  });

  it("place_id 不同的兩筆不因名稱相同而合併", () => {
    expect(
      findDuplicateGroups([item({ id: "a", place_id: "ChIJ_1" }), item({ id: "b", place_id: "ChIJ_2" })]),
    ).toEqual([]);
  });

  it("保留最早建立的一筆；鏈狀重複合為一組", () => {
    const groups = findDuplicateGroups([
      item({ id: "late", place_id: "ChIJ_1", created_at: "2026-11-24T03:00:00Z" }),
      item({ id: "early", name_local: "浅草寺", created_at: "2026-11-24T01:00:00Z" }),
      item({ id: "mid", place_id: "ChIJ_1", name_zh: "淺草觀音", name_local: "浅草寺", created_at: "2026-11-24T02:00:00Z" }),
    ]);
    expect(groups).toEqual([{ keep: "early", drop: ["mid", "late"] }]);
  });
});
