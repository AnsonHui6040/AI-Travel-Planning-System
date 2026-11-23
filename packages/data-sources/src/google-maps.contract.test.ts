import { checkDataSourceAdapter, checkKeyTester, saveApiKey } from "@atps/core";
import { describe, expect, it } from "vitest";
import {
  coordinatesDue,
  createGoogleMapsAdapter,
  createGoogleMapsClient,
  createGoogleMapsKeyTester,
  directionsUrl,
  type GoogleMapsOptions,
} from "./index";

// T19：Google Maps Platform adapter 契約測試。fixture 全部是合成資料，不是 Google 的真實回應
const KEY = "test-only-maps-key-0001";
const NOW = new Date("2026-11-23T09:00:00Z");
const PLACE = "ChIJsynthetic-place-0001";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fake(responses: Array<{ status: number; body: unknown } | "network-error">) {
  const requests: Captured[] = [];
  const queue = [...responses];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error("沒有更多錄製回應");
    if (next === "network-error") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  };
  const options: GoogleMapsOptions = { fetch, now: () => NOW, timeoutMs: 5_000 };
  return { options, requests };
}

const searchResult = (places: unknown[]) => ({ status: 200, body: { places } });
const syntheticPlace = (overrides: Record<string, unknown> = {}) => ({
  id: PLACE,
  displayName: { text: "淺草寺", languageCode: "zh-TW" },
  location: { latitude: 35.7148, longitude: 139.7967 },
  ...overrides,
});

describe("Places 搜尋：place_id 解析（S-16）", () => {
  it("名稱相符且位置在範圍內時回傳 place_id，不回傳 Google 的名稱或地址", async () => {
    const { options, requests } = fake([searchResult([syntheticPlace()])]);
    const result = await createGoogleMapsClient(options).resolvePlaceId(KEY, {
      name: "淺草寺",
      area: "淺草",
      near: { lat: 35.71, lng: 139.79 },
      languageCode: "zh-TW",
    });
    expect(result).toEqual({ status: "resolved", placeId: PLACE });

    const sent = requests[0];
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(sent?.headers["x-goog-api-key"]).toBe(KEY);
    expect(sent?.headers["x-goog-fieldmask"]).toBe("places.id,places.displayName,places.location");
    expect(sent?.body).toMatchObject({ textQuery: "淺草寺 淺草", languageCode: "zh-TW", pageSize: 5 });
    expect(sent?.body).toMatchObject({ locationBias: { circle: { center: { latitude: 35.71, longitude: 139.79 }, radius: 5000 } } });
    expect(sent?.url).not.toContain(KEY);
  });

  it("名稱不符時解析失敗", async () => {
    const { options } = fake([searchResult([syntheticPlace({ displayName: { text: "東京晴空塔", languageCode: "zh-TW" } })])]);
    await expect(createGoogleMapsClient(options).resolvePlaceId(KEY, { name: "淺草寺", languageCode: "zh-TW" })).resolves.toEqual({
      status: "unresolved",
      reason: "name_mismatch",
    });
  });

  it("位置超出範圍時解析失敗", async () => {
    const { options } = fake([searchResult([syntheticPlace({ location: { latitude: 34.69, longitude: 135.5 } })])]);
    const result = await createGoogleMapsClient(options).resolvePlaceId(KEY, {
      name: "淺草寺",
      near: { lat: 35.71, lng: 139.79 },
      languageCode: "zh-TW",
    });
    expect(result).toEqual({ status: "unresolved", reason: "too_far" });
  });

  it("沒有結果時解析失敗", async () => {
    const { options } = fake([searchResult([])]);
    await expect(createGoogleMapsClient(options).resolvePlaceId(KEY, { name: "不存在的店", languageCode: "zh-TW" })).resolves.toEqual({
      status: "unresolved",
      reason: "not_found",
    });
  });

  it("名稱比對忽略大小寫、空白與全形半形差異", async () => {
    const { options } = fake([searchResult([syntheticPlace({ displayName: { text: "Blue Bottle Coffee 清澄白河", languageCode: "ja" } })])]);
    await expect(createGoogleMapsClient(options).resolvePlaceId(KEY, { name: "ＢＬＵＥ ＢＯＴＴＬＥ　coffee", languageCode: "ja" })).resolves.toMatchObject({
      status: "resolved",
    });
  });
});

describe("座標（D28：最多保存 30 日）", () => {
  it("只要求 location 欄位，回傳座標與取得時間", async () => {
    const { options, requests } = fake([{ status: 200, body: { location: { latitude: 35.7148, longitude: 139.7967 } } }]);
    await expect(createGoogleMapsClient(options).coordinates(KEY, PLACE)).resolves.toEqual({ lat: 35.7148, lng: 139.7967, fetchedAt: NOW });
    expect(requests[0]?.url).toBe(`https://places.googleapis.com/v1/places/${PLACE}`);
    expect(requests[0]?.headers["x-goog-fieldmask"]).toBe("location");
  });

  it("取得超過 30 日（或沒有座標）的項目需要重新取得", () => {
    const day = 24 * 60 * 60 * 1000;
    const items = [
      { id: "a", place_id: PLACE, coord_fetched_at: new Date(NOW.getTime() - 29 * day).toISOString() },
      { id: "b", place_id: PLACE, coord_fetched_at: new Date(NOW.getTime() - 30 * day).toISOString() },
      { id: "c", place_id: PLACE, coord_fetched_at: null },
      { id: "d", place_id: null, coord_fetched_at: null },
    ];
    expect(coordinatesDue(items, NOW).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("place_id 格式不合時不送出請求", async () => {
    const { options, requests } = fake([]);
    await expect(createGoogleMapsClient(options).coordinates(KEY, "../places:searchText")).rejects.toThrow("place_id 格式不正確");
    expect(requests).toHaveLength(0);
  });
});

describe("詳情與照片（只即時顯示）", () => {
  it("詳情回傳即時顯示用的資料並標示不可儲存", async () => {
    const { options, requests } = fake([
      {
        status: 200,
        body: {
          id: PLACE,
          displayName: { text: "淺草寺", languageCode: "zh-TW" },
          formattedAddress: "合成地址 1-1",
          rating: 4.5,
          googleMapsUri: "https://maps.google.com/?cid=1",
          photos: [{ name: `places/${PLACE}/photos/p1`, widthPx: 800, heightPx: 600, authorAttributions: [{ displayName: "攝影者", uri: "https://maps.google.com/contrib/1", photoUri: "https://lh3.example/a.jpg" }] }],
        },
      },
    ]);
    const details = await createGoogleMapsClient(options).liveDetails(KEY, PLACE, "zh-TW");
    expect(details).toMatchObject({ storable: false, name: "淺草寺", address: "合成地址 1-1", rating: 4.5, googleMapsUri: "https://maps.google.com/?cid=1" });
    expect(details.photos[0]).toEqual({ name: `places/${PLACE}/photos/p1`, attributions: [{ displayName: "攝影者", uri: "https://maps.google.com/contrib/1" }] });
    expect(requests[0]?.headers["x-goog-fieldmask"]).toBe("id,displayName,formattedAddress,rating,googleMapsUri,photos");
    expect(requests[0]?.url).toContain("languageCode=zh-TW");
  });

  it("照片以 skipHttpRedirect 取得不含 key 的圖片網址", async () => {
    const { options, requests } = fake([{ status: 200, body: { name: `places/${PLACE}/photos/p1/media`, photoUri: "https://lh3.example/photo.jpg" } }]);
    const photo = await createGoogleMapsClient(options).photoUri(KEY, `places/${PLACE}/photos/p1`, 800);
    expect(photo).toEqual({ photoUri: "https://lh3.example/photo.jpg" });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe(`https://places.googleapis.com/v1/places/${PLACE}/photos/p1/media`);
    expect(url.searchParams.get("maxWidthPx")).toBe("800");
    expect(url.searchParams.get("skipHttpRedirect")).toBe("true");
    expect(photo.photoUri).not.toContain(KEY);
  });

  it("照片名稱格式不合時不送出請求", async () => {
    const { options, requests } = fake([]);
    await expect(createGoogleMapsClient(options).photoUri(KEY, "https://evil.example/x", 800)).rejects.toThrow("照片名稱格式不正確");
    expect(requests).toHaveLength(0);
  });

  it("回傳的照片網址不是 https 時拒絕", async () => {
    const { options } = fake([{ status: 200, body: { photoUri: "javascript:alert(1)" } }]);
    await expect(createGoogleMapsClient(options).photoUri(KEY, `places/${PLACE}/photos/p1`, 800)).rejects.toThrow();
  });
});

describe("錯誤", () => {
  it.each([
    [400, "Google Maps 請求失敗（400）"],
    [403, "Google Maps 拒絕請求（403）"],
    [429, "Google Maps 請求過於頻繁（429）"],
    [500, "Google Maps 暫時無法使用（500）"],
  ])("狀態 %i 回報固定訊息，不含 key", async (status, message) => {
    const { options } = fake([{ status, body: { error: { message: `bad key ${KEY}` } } }]);
    const error = await createGoogleMapsClient(options)
      .coordinates(KEY, PLACE)
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(error?.message).toBe(message);
    expect(error?.message).not.toContain(KEY);
  });

  it("連線失敗回報固定訊息", async () => {
    const { options } = fake(["network-error"]);
    await expect(createGoogleMapsClient(options).coordinates(KEY, PLACE)).rejects.toThrow("無法連線 Google Maps");
  });
});

describe("Google Maps key 儲存前測試呼叫（C-03）", () => {
  it("以只取編號的欄位做最小呼叫", async () => {
    const { options, requests } = fake([searchResult([{ id: PLACE }])]);
    const tester = createGoogleMapsKeyTester(options);
    expect(checkKeyTester(tester)).toEqual([]);
    expect(tester.provider).toBe("google_maps");
    await expect(tester.test(KEY)).resolves.toEqual({ ok: true });
    expect(requests[0]?.headers["x-goog-fieldmask"]).toBe("places.id");
    expect(requests[0]?.body).toMatchObject({ pageSize: 1 });
  });

  it("測試呼叫失敗時不儲存", async () => {
    const { options } = fake([{ status: 403, body: {} }]);
    const saved: unknown[] = [];
    const result = await saveApiKey(
      { store: { save: async (input) => void saved.push(input) }, testers: [createGoogleMapsKeyTester(options)], clock: { now: () => NOW } },
      { ownerId: "00000000-0000-4000-8000-0000000000a1", provider: "google_maps", secret: KEY },
    );
    expect(result.ok).toBe(false);
    expect(saved).toEqual([]);
  });

  it.each([400, 403])("key 無效或未啟用（%i）時失敗，原因不含 key", async (status) => {
    const { options } = fake([{ status, body: { error: { message: `API key ${KEY} not valid` } } }]);
    const result = await createGoogleMapsKeyTester(options).test(KEY);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});

describe("DataSourceAdapter 與導航連結", () => {
  it("通過 T11 的 DataSourceAdapter 契約檢查", () => {
    expect(checkDataSourceAdapter(createGoogleMapsAdapter({ apiKey: KEY }))).toEqual([]);
  });

  it("adapter 以 place 能力取得座標，來源標示 Google Maps", async () => {
    const { options } = fake([{ status: 200, body: { location: { latitude: 1, longitude: 2 } } }]);
    const result = await createGoogleMapsAdapter({ apiKey: KEY, ...options }).query({ capability: "place", params: { op: "coordinates", placeId: PLACE } });
    expect(result).toMatchObject({ capability: "place", data: { lat: 1, lng: 2 }, source: { name: "Google Maps" } });
  });

  it("導航連結使用 Maps URLs 的 dir、destination_place_id、travelmode=transit，不含 key", () => {
    const url = new URL(directionsUrl({ destination: "淺草寺", destinationPlaceId: PLACE }));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: "1",
      destination: "淺草寺",
      destination_place_id: PLACE,
      travelmode: "transit",
    });
    expect(url.href).not.toMatch(/key=/i);
  });

  it("沒有 place_id 時只用名稱", () => {
    const url = new URL(directionsUrl({ destination: "淺草寺", destinationPlaceId: null, travelmode: "walking" }));
    expect(url.searchParams.has("destination_place_id")).toBe(false);
    expect(url.searchParams.get("travelmode")).toBe("walking");
  });
});
