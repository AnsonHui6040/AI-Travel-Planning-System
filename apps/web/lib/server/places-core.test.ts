import { describe, expect, it } from "vitest";
import { searchPlacesFor, type PlaceSearchDeps } from "./places-core";

const KEY = "maps-key-test-only-1234";
const result = { storable: false as const, placeId: "ChIJsynthetic-place-0001", name: "一蘭 道頓堀店", address: "大阪市中央區" };

function deps(key: string | null, search: PlaceSearchDeps["search"] = async () => [result]) {
  const queries: string[] = [];
  const d: PlaceSearchDeps = {
    mapsKey: async () => key,
    search: async (k, q) => {
      queries.push(q);
      return search(k, q);
    },
    logError: () => {},
  };
  return { d, queries };
}

describe("搜尋地點（決策 0010 S）", () => {
  it("沒有 Google Maps key 時只提供手動新增", async () => {
    const { d, queries } = deps(null);
    expect(await searchPlacesFor(d, "一蘭")).toEqual({ state: "no_key" });
    expect(queries).toEqual([]);
  });

  it("有 key、沒有搜尋字時不呼叫", async () => {
    const { d, queries } = deps(KEY);
    expect(await searchPlacesFor(d, "  ")).toEqual({ state: "idle" });
    expect(queries).toEqual([]);
  });

  it("回傳即時顯示的結果", async () => {
    const { d, queries } = deps(KEY);
    expect(await searchPlacesFor(d, " 一蘭 ")).toEqual({ state: "ok", query: "一蘭", results: [result] });
    expect(queries).toEqual(["一蘭"]);
  });

  it("失敗時的訊息不含 key", async () => {
    const { d } = deps(KEY, async () => {
      throw new Error(`denied ${KEY}`);
    });
    const outcome = await searchPlacesFor(d, "一蘭");
    expect(outcome).toMatchObject({ state: "error" });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });
});
